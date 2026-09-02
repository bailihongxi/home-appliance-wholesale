/**
 * ui/page-admin.js —— 权限管理（V2.3，仅管理员可见）
 *  - 管理员登录后「我的」页出现入口，进入本页
 *  - 列出全部账号（头像/店名/登录名/当前经营范围）
 *  - 每个账号可用 9 类商品分类 chip 勾选经营范围，或「全部分类」
 *  - 保存 → accounts.update 写入各账号 scopeCategories（[] = 全部分类/不限制）
 *  - 非管理员访问本页：显示无权限提示（路由守卫）
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var accounts = isNode ? require('../core/accounts.js') : (root.ERP && root.ERP.accounts);
  var util = isNode ? require('../core/util.js') : (root.ERP && root.ERP.util);
  var mod = factory(accounts, util);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.admin = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (accounts, util) {
  'use strict';

  var esc = util.escapeHtml;

  var page = {
    name: 'admin',
    title: '权限管理',
    icon: '🔐',
    init: function init(ctx, store) {
      return {
        store: store || null,
        edits: null, // { [acctId]: [分类] } 勾选态
        msg: '',
        error: ''
      };
    }
  };

  /** 本机存储（localStorage）；不可用时返回 null（Node 测试可传 state.store 注入） */
  function localStore() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  /** 当前登录账号（浏览器读 ERP.currentAccount；Node 测试读 ctx/globalThis） */
  function currentAccount(ctx) {
    if (ctx && ctx.currentAccount) return ctx.currentAccount;
    var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
    return (g && g.ERP && g.ERP.currentAccount) || null;
  }

  /** 是否管理员 */
  page.isAdmin = function isAdmin(ctx) {
    var acct = currentAccount(ctx);
    return !!(acct && (acct.role === 'admin' || acct.id === 'admin'));
  };

  /** 初始勾选态：scopeCategories 为空（全分类）→ 全部分类选中 */
  function initEdits(list) {
    var edits = {};
    (list || []).forEach(function (a) {
      edits[a.id] = (a.scopeCategories || []).slice();
    });
    return edits;
  }

  /** 该账号某分类是否选中：edits 为空数组 = 全部分类（全部选中） */
  function catOn(edits, id, cat) {
    var arr = (edits && edits[id]) || [];
    if (!arr.length) return true; // 空 = 全部分类
    return arr.indexOf(cat) >= 0;
  }

  page.render = function render(ctx, state) {
    if (!page.isAdmin(ctx)) {
      return '<div class="card"><div class="notice notice-warn">无权限：仅管理员账号可管理账户权限。</div></div>';
    }
    var store = state.store || localStore();
    var list = accounts.ensurePreset(store);
    if (!state.edits) state.edits = initEdits(list);

    var h = '<div class="admin-page">' +
      '<div class="card">' +
      '<div class="card-title">账户权限管理</div>' +
      '<div class="small muted">为每个店铺账号设置经营范围（可经营的 9 类商品分类）；「全部分类」= 不限制。修改保存后，对应账号下次登录生效。</div>' +
      '</div>';

    list.forEach(function (a) {
      var isAdminSelf = a.id === 'admin';
      h += '<div class="card mt8 admin-acct">' +
        '<div class="row" style="align-items:center;gap:10px">' +
          '<span class="login-avatar">' + (a.avatar ? '<img src="' + esc(a.avatar) + '" alt="">' : esc((a.shopName || '?').charAt(0))) + '</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="name" style="font-weight:700">' + esc(a.shopName) +
              (a.role === 'admin' ? ' <span class="badge" style="font-size:11px;color:#fff;background:var(--c-mint-600,#2aa)" >管理员</span>' : '') +
            '</div>' +
            '<div class="small muted">@' + esc(a.username) + (isAdminSelf ? ' · 系统账号（经营范围不可改）' : '') + '</div>' +
          '</div>' +
        '</div>';

      if (!isAdminSelf) {
        h += '<div class="admin-cats mt8">' +
          accounts.ALL_CATEGORIES.map(function (cat) {
            var on = catOn(state.edits, a.id, cat) ? ' on' : '';
            return '<button class="chip' + on + '" data-act="admin-toggle-cat" data-id="' + esc(a.id) + '" data-cat="' + esc(cat) + '">' + esc(cat) + '</button>';
          }).join('') +
          '<button class="chip admin-all' + (!(state.edits[a.id] || []).length ? ' on' : '') + '" data-act="admin-all-cats" data-id="' + esc(a.id) + '">全部分类</button>' +
          '<button class="chip admin-clear" data-act="admin-clear-cats" data-id="' + esc(a.id) + '">仅自定义</button>' +
        '</div>';
      } else {
        var scopeAdmin = (a.scopeCategories || []).join(' / ') || '全部分类';
        h += '<div class="small muted mt8">经营范围：' + esc(scopeAdmin) + '</div>';
      }
      h += '</div>';
    });

    h += '<div class="row mt8">' +
      '<button class="btn btn-primary btn-block" data-act="admin-save">保存全部修改</button></div>';

    if (state.msg) h += '<div class="notice notice-info mt8">' + esc(state.msg) + '</div>';
    if (state.error) h += '<div class="notice notice-warn mt8">' + esc(state.error) + '</div>';

    h += '</div>';
    return h;
  };

  /** 纯逻辑：保存勾选态到账号列表（Node 可测）。[] = 全部分类 */
  page.saveEdits = function saveEdits(store, edits) {
    var list = accounts.load(store);
    var changed = [];
    Object.keys(edits || {}).forEach(function (id) {
      var acct = accounts.getById(list, id);
      if (!acct || acct.id === 'admin') return; // 系统账号跳过
      var cats = (edits[id] || []).slice();
      // 全部分类语义：空数组或含全部分类 = []（不限制）
      var isAll = cats.length === 0 || accounts.ALL_CATEGORIES.every(function (c) { return cats.indexOf(c) >= 0; });
      var next = isAll ? [] : cats;
      if (JSON.stringify(next.slice().sort()) !== JSON.stringify((acct.scopeCategories || []).slice().sort())) {
        acct.scopeCategories = next;
        changed.push(id);
      }
    });
    if (changed.length) accounts.save(store, list);
    return { ok: true, saved: changed.length };
  };

  page.actions = {
    'admin-toggle-cat': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      var cat = el.getAttribute('data-cat');
      if (id === 'admin') return false;
      var arr = (state.edits[id] || []).slice();
      var idx = arr.indexOf(cat);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(cat);
      state.edits[id] = arr;
      state.error = '';
      return true;
    },
    'admin-all-cats': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      if (id === 'admin') return false;
      state.edits[id] = []; // 空 = 全部分类
      state.error = '';
      return true;
    },
    'admin-clear-cats': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      if (id === 'admin') return false;
      state.edits[id] = []; // 与全部分类同义（[] = 不限制），保留按钮以明确表达
      state.error = '';
      return true;
    },
    'admin-save': function (ctx, state) {
      var st = state.store || localStore();
      var r = page.saveEdits(st, state.edits);
      state.msg = r.saved > 0 ? ('已保存 ' + r.saved + ' 个账号的经营范围') : '经营范围无变化';
      state.error = '';
      return true;
    }
  };

  return page;
});
