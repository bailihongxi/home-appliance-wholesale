/**
 * ui/page-admin.js —— 账户权限管理（V2.3+，仅管理员「管理总控」可见）
 *  - 管理员登录后「我的」页出现入口，进入本页统一管理全部账号
 *  - 列表：全部账号（头像/店名/登录名/当前经营范围）
 *  - 每账号可用 9 类商品分类 chip 勾选经营范围，或「全部分类」；保存写 scopeCategories
 *  - 账户管理（新建 / 修改 / 删除）统一在此页进行，登录页不再提供
 *    · 新建：登录名/店名/初始密码/头像（可选）→ accounts.create
 *    · 修改：登录名/店名/重置密码/头像 → accounts.update
 *    · 删除：二次确认 → accounts.remove + 清理该账号数据空间（app.deleteAccountDb）
 *    · 管理员自身账号（admin）不可删除、经营范围不可改
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
    title: '账户权限管理',
    icon: '🔐',
    init: function init(ctx, store) {
      return {
        store: store || null,
        edits: null, // { [acctId]: [分类] } 经营范围勾选态
        permsEdits: null, // { [acctId]: { permId: bool } } 权限勾选态（V3.59）
        permsEditId: null, // 正在分配权限的账号 id
        msg: '',
        error: '',
        showNew: false,
        newForm: { username: '', shopName: '', password: '', password2: '', avatar: '', dataSpace: 'shared' },
        editId: null,
        editForm: { username: '', shopName: '', password: '', password2: '', avatar: '' },
        delId: null
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

  /** 浏览器 app 引用（删除账号时清理其数据空间） */
  function appRef() {
    var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
    return (g && g.ERP && g.ERP.app) || null;
  }

  /** 头像 dataURL 预览后重渲染 */
  function rerender() {
    var a = appRef();
    if (a && a.render) a.render();
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

  /** V3.59 初始权限编辑态：拷贝各账号当前 perms（admin 不参与分配） */
  function initPerms(list) {
    var edits = {};
    (list || []).forEach(function (a) {
      if (a.id === 'admin') return;
      edits[a.id] = Object.assign({}, a.perms || {});
    });
    return edits;
  }

  /** 该账号某权限是否勾选 */
  function permOn(state, id, permId) {
    return !!((state.permsEdits && state.permsEdits[id] && state.permsEdits[id][permId]));
  }

  /** V3.59 纯逻辑：保存权限编辑态到账号列表（Node 可测；admin 跳过） */
  page.savePerms = function savePerms(store, permsEdits) {
    var list = accounts.load(store);
    var changed = [];
    Object.keys(permsEdits || {}).forEach(function (id) {
      var acct = accounts.getById(list, id);
      if (!acct || acct.id === 'admin') return;
      var cur = Object.assign({}, acct.perms || {});
      var next = Object.assign({}, permsEdits[id] || {});
      if (JSON.stringify(cur) !== JSON.stringify(next)) {
        acct.perms = next;
        changed.push(id);
      }
    });
    if (changed.length) accounts.save(store, list);
    return { ok: true, saved: changed.length };
  };

  /** 该账号某分类是否选中：edits 为空数组 = 全部分类（全部选中） */
  function catOn(edits, id, cat) {
    var arr = (edits && edits[id]) || [];
    if (!arr.length) return true; // 空 = 全部分类
    return arr.indexOf(cat) >= 0;
  }

  page.render = function render(ctx, state) {
    if (!page.isAdmin(ctx)) {
      return '<div class="card"><div class="notice notice-warn">无权限：仅管理员账号可管理账户。</div></div>';
    }
    var store = state.store || localStore();
    var list = accounts.ensurePreset(store);
    if (!state.edits) state.edits = initEdits(list);
    if (!state.permsEdits) state.permsEdits = initPerms(list);

    var h = '<div class="admin-page">' +
      '<div class="card">' +
      '<div class="card-title">账户权限管理</div>' +
      '<div class="small muted">统一管理全部店铺账号：新建、修改、删除、各账号的经营范围（9 类商品分类）与功能权限（V3.59：16 项权限全部手动逐项勾选，管理总控固定全权限）。保存后，对应账号下次登录生效。</div>' +
      '<div class="row mt8" style="gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-primary btn-sm" data-act="admin-new-toggle">' +
        (state.showNew ? '收起新建表单' : '＋ 新建店铺账号') + '</button>' +
      '<button class="btn btn-sm" data-act="admin-sync-accounts">☁️ 账号表上传到云端</button>' +
      '</div>' +
      '<div class="small muted mt8">「账号表上传到云端」：把全部账号（登录名/权限/数据空间/密码哈希，加密后）传到云端，手机 / 本地版 / 其他浏览器登录时自动拉取同一份账号，跨端通用。修改账号或权限后需重新上传。</div>' +
      '</div>';

    // 新建账号表单
    if (state.showNew) {
      h += renderNewForm(state);
    }

    // 账号列表
    list.forEach(function (a) {
      var isAdminSelf = a.id === 'admin';
      var isEdit = state.editId === a.id;
      h += '<div class="card mt8 admin-acct">' +
        '<div class="row" style="align-items:center;gap:10px">' +
          '<span class="login-avatar">' + (a.avatar ? '<img src="' + esc(a.avatar) + '" alt="">' : esc((a.shopName || '?').charAt(0))) + '</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="name" style="font-weight:700">' + esc(a.shopName) +
              (a.role === 'admin' ? ' <span class="badge" style="font-size:11px;color:#fff;background:var(--c-mint-600,#2aa)">管理员</span>' : '') +
            '</div>' +
            '<div class="small muted">@' + esc(a.username) + (isAdminSelf ? ' · 系统账号（不可删除，经营范围不可改）' : '') + '</div>' +
          '</div>' +
          (isAdminSelf ? '' :
            '<button class="btn btn-sm" data-act="admin-edit-account" data-id="' + esc(a.id) + '">修改</button>' +
            '<button class="btn btn-sm btn-danger-outline" data-act="admin-del-account" data-id="' + esc(a.id) + '">删除</button>') +
        '</div>';

      if (isEdit) {
        h += renderEditForm(state, a);
      } else if (!isAdminSelf) {
        h += '<div class="admin-cats mt8">' +
          accounts.ALL_CATEGORIES.map(function (cat) {
            var on = catOn(state.edits, a.id, cat) ? ' on' : '';
            return '<button class="chip' + on + '" data-act="admin-toggle-cat" data-id="' + esc(a.id) + '" data-cat="' + esc(cat) + '">' + esc(cat) + '</button>';
          }).join('') +
          '<button class="chip admin-all' + (!(state.edits[a.id] || []).length ? ' on' : '') + '" data-act="admin-all-cats" data-id="' + esc(a.id) + '">全部分类</button>' +
          '<button class="chip admin-clear" data-act="admin-clear-cats" data-id="' + esc(a.id) + '">仅自定义</button>' +
        '</div>';
        // V3.59 权限分配区块（手动逐项勾选；账号卡片显示已开通权限摘要）
        h += renderPermBlock(state, a);
      } else {
        var scopeAdmin = (a.scopeCategories || []).join(' / ') || '全部分类';
        h += '<div class="small muted mt8">经营范围：' + esc(scopeAdmin) + '</div>';
      }
      h += '</div>';
    });

    // 删除确认
    if (state.delId) {
      var delAcct = accounts.getById(list, state.delId);
      h += '<div class="notice notice-warn mt8">确定删除账号「' + esc(delAcct ? delAcct.shopName : '') + '」？其全部数据（商品 / 单据 / 账本）将一并删除，且不可恢复。</div>' +
        '<div class="row mt8"><button class="btn btn-danger" data-act="admin-del-cancel">取消</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-danger" data-act="admin-confirm-del" data-id="' + esc(state.delId) + '">确认删除</button></div>';
    }

    h += '<div class="row mt8">' +
      '<button class="btn btn-primary btn-block" data-act="admin-save">保存全部经营范围修改</button></div>';

    if (state.msg) h += '<div class="notice notice-info mt8">' + esc(state.msg) + '</div>';
    if (state.error) h += '<div class="notice notice-warn mt8">' + esc(state.error) + '</div>';

    h += '</div>';
    return h;
  };

  /** 新建账号表单 */
  function renderNewForm(state) {
    var f = state.newForm;
    return '<div class="card mt8 create-box">' +
      '<div class="card-title">新建店铺账号</div>' +
      '<div class="field"><label>店铺头像（选填）</label>' +
      '<div class="row" style="gap:10px;align-items:center">' +
        (f.avatar
          ? '<img class="avatar-img" src="' + esc(f.avatar) + '" alt="头像预览" style="width:48px;height:48px;border-radius:50%;object-fit:cover">'
          : '<div class="avatar">⚡</div>') +
        '<label class="btn btn-sm" style="margin:0">📷 选择图片' +
          '<input type="file" accept="image/*" data-input="admin-new.avatar" style="display:none">' +
        '</label>' +
        (f.avatar ? '<button class="btn btn-sm" data-act="admin-new-clear-avatar">清除</button>' : '') +
      '</div></div>' +
      '<div class="field"><label>登录账号（2-20 位字母/数字/下划线）</label>' +
      '<input class="input" data-input="admin-new.username" data-live="1" placeholder="如 myShop" value="' + esc(f.username) + '"></div>' +
      '<div class="field"><label>店铺名称</label>' +
      '<input class="input" data-input="admin-new.shopName" data-live="1" placeholder="如 我的小店" value="' + esc(f.shopName) + '"></div>' +
      '<div class="field"><label>初始密码（至少 4 位）</label>' +
      '<input class="input" type="password" data-input="admin-new.password" data-live="1" value="' + esc(f.password) + '"></div>' +
      '<div class="field"><label>确认密码</label>' +
      '<input class="input" type="password" data-input="admin-new.password2" data-live="1" value="' + esc(f.password2) + '"></div>' +
      '<div class="field"><label>数据空间（V3.59）</label>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap">' +
        '<button class="chip' + (f.dataSpace !== 'solo' ? ' on' : '') + '" data-act="admin-new-ds" data-value="shared">共用本店数据（员工）</button>' +
        '<button class="chip' + (f.dataSpace === 'solo' ? ' on' : '') + '" data-act="admin-new-ds" data-value="solo">独立数据空间</button>' +
      '</div></div>' +
      '<div class="small muted">「共用本店数据」：员工登录后与本店老板使用同一本账（数据不隔离，权限隔离）；「独立数据空间」：数据与全店隔离。创建后默认经营范围＝全部分类、默认权限＝全部关闭，可在该账号卡片中手动分配。</div>' +
      '<div class="row mt8"><button class="btn btn-danger" data-act="admin-new-cancel">取消</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-primary" data-act="admin-create-account">创建账号</button></div></div>';
  }

  /** V3.59 权限分配区块：账号权限摘要 + 展开后的 4 组 16 项手动勾选面板（仅管理总控可见此页） */
  function renderPermBlock(state, a) {
    var permLabels = {};
    accounts.PERMS.forEach(function (p) { permLabels[p.id] = p.label; });
    var onIds = Object.keys(a.perms || {}).filter(function (k) { return a.perms[k]; });
    var summary = onIds.length
      ? onIds.map(function (k) { return permLabels[k] || k; }).join('、')
      : '未开通任何权限（登录后仅可见基础页）';
    var h = '<div class="admin-perms mt8">' +
      '<div class="row" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<span class="small muted" style="flex:1;min-width:0">权限：' + esc(summary) + '</span>' +
        (state.permsEditId === a.id
          ? '<button class="btn btn-sm btn-danger" data-act="admin-perm-close" data-id="' + esc(a.id) + '">收起</button>'
          : '<button class="btn btn-sm btn-primary" data-act="admin-perm-open" data-id="' + esc(a.id) + '">分配权限</button>') +
      '</div>';
    if (state.permsEditId === a.id) {
      h += '<div class="perm-panel mt8">' +
        '<div class="small muted">全部手动勾选：' + esc(a.username) + ' 登录后仅可使用勾选功能（侧栏菜单与快捷入口自动隐藏、操作拦截、成本/利润列隐藏）。</div>' +
        '<div class="row mt8" style="gap:8px">' +
          '<button class="btn btn-sm btn-primary" data-act="admin-perm-all" data-id="' + esc(a.id) + '">全选</button>' +
          '<button class="btn btn-sm" data-act="admin-perm-none" data-id="' + esc(a.id) + '">清空</button>' +
        '</div>';
      accounts.PERM_GROUPS.forEach(function (g) {
        h += '<div class="perm-group mt8"><div class="small" style="font-weight:700;color:#2563EB">' + esc(g.name) + '</div><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">';
        accounts.PERMS.filter(function (p) { return p.group === g.id; }).forEach(function (p) {
          h += '<button class="chip' + (permOn(state, a.id, p.id) ? ' on' : '') + '" data-act="admin-perm-toggle" data-id="' + esc(a.id) + '" data-perm="' + esc(p.id) + '">' + esc(p.label) + '</button>';
        });
        h += '</div></div>';
      });
      h += '<div class="row mt8" style="gap:8px">' +
        '<button class="btn btn-danger btn-sm" data-act="admin-perm-close" data-id="' + esc(a.id) + '">取消</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-primary btn-sm" data-act="admin-perm-save" data-id="' + esc(a.id) + '">保存权限</button>' +
      '</div></div>';
    }
    h += '</div>';
    return h;
  }

  /** 编辑账号表单 */
  function renderEditForm(state, acct) {
    var f = state.editForm;
    return '<div class="card mt8 edit-box">' +
      '<div class="card-title">修改账号「' + esc(acct.shopName) + '」</div>' +
      '<div class="field"><label>店铺头像（选填）</label>' +
      '<div class="row" style="gap:10px;align-items:center">' +
        (f.avatar
          ? '<img class="avatar-img" src="' + esc(f.avatar) + '" alt="头像预览" style="width:48px;height:48px;border-radius:50%;object-fit:cover">'
          : '<div class="avatar">⚡</div>') +
        '<label class="btn btn-sm" style="margin:0">📷 选择图片' +
          '<input type="file" accept="image/*" data-input="admin-edit.avatar" style="display:none">' +
        '</label>' +
        (f.avatar ? '<button class="btn btn-sm" data-act="admin-edit-clear-avatar">清除</button>' : '') +
      '</div></div>' +
      '<div class="field"><label>登录账号（2-20 位字母/数字/下划线）</label>' +
      '<input class="input" data-input="admin-edit.username" data-live="1" value="' + esc(f.username) + '"></div>' +
      '<div class="field"><label>店铺名称</label>' +
      '<input class="input" data-input="admin-edit.shopName" data-live="1" value="' + esc(f.shopName) + '"></div>' +
      '<div class="field"><label>新密码（留空则不修改）</label>' +
      '<input class="input" type="password" data-input="admin-edit.password" data-live="1" placeholder="留空不修改" value="' + esc(f.password) + '"></div>' +
      '<div class="field"><label>确认新密码</label>' +
      '<input class="input" type="password" data-input="admin-edit.password2" data-live="1" value="' + esc(f.password2) + '"></div>' +
      '<div class="row mt8"><button class="btn btn-danger" data-act="admin-edit-cancel">取消</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-primary" data-act="admin-save-edit" data-id="' + esc(acct.id) + '">保存修改</button></div></div>';
  }

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

  /** 纯逻辑：创建账号（Node 可测） */
  page.createAccount = function createAccount(store, form) {
    if (form.password !== form.password2) return { ok: false, error: '两次输入的密码不一致' };
    return accounts.create(store, {
      username: form.username,
      shopName: form.shopName,
      password: form.password,
      avatar: form.avatar,
      // V3.59：共用本店数据（默认，员工 ownerId=admin）或独立数据空间
      ownerId: form.dataSpace === 'solo' ? null : 'admin'
    });
  };

  /** 纯逻辑：修改账号（Node 可测；admin 自身不可改） */
  page.updateAccount = function updateAccount(store, id, form) {
    if (id === 'admin') return { ok: false, error: '管理员账号不可修改' };
    if (form.password !== form.password2) return { ok: false, error: '两次输入的密码不一致' };
    return accounts.update(store, id, {
      username: form.username,
      shopName: form.shopName,
      password: form.password || undefined,
      avatar: form.avatar
    });
  };

  /** 纯逻辑：删除账号（Node 可测；admin 自身不可删） */
  page.removeAccount = function removeAccount(store, id) {
    if (id === 'admin') return { ok: false, error: '管理员账号不可删除' };
    return accounts.remove(store, id);
  };

  page.actions = {
    /* ===== 经营范围勾选 ===== */
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
      state.edits[id] = [];
      state.error = '';
      return true;
    },
    'admin-save': function (ctx, state) {
      var st = state.store || localStore();
      var r = page.saveEdits(st, state.edits);
      state.msg = r.saved > 0 ? ('已保存 ' + r.saved + ' 个账号的经营范围') : '经营范围无变化';
      state.error = '';
      return true;
    },

    /* ===== 新建账号 ===== */
    'admin-new-toggle': function (ctx, state) {
      state.showNew = !state.showNew;
      state.error = '';
      return true;
    },
    /* ===== V3.60 账号云同步：账号表加密上传云端（仅管理总控；本页本身仅管理员可见） ===== */
    'admin-sync-accounts': function (ctx, state) {
      var st = state.store || localStore();
      var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
      var syncMod = (g && g.ERP && g.ERP.sync) || null;
      if (!syncMod || !syncMod.pushAccounts) {
        state.error = '同步模块不可用，请先刷新页面重试';
        return false;
      }
      var list = accounts.load(st);
      if (!list.length) { state.error = '本地没有可上传的账号'; return false; }
      state.msg = '正在加密上传账号表（' + list.length + ' 个账号）…';
      state.error = '';
      syncMod.pushAccounts(st, list).then(function (res) {
        state.msg = '';
        if (res.ok) {
          state.msg = '账号表已上传到云端（' + res.count + ' 个账号），手机 / 本地版 / 其他浏览器登录时自动同步';
        } else {
          state.error = '账号表上传失败：' + (res.error || '未知错误');
        }
        rerender();
      });
      return false; // 异步：阻止默认 afterAction，完成后手动重渲染
    },
    'admin-new-cancel': function (ctx, state) {
      state.showNew = false;
      state.error = '';
      return true;
    },
    'admin-new.username': function (ctx, state, el) { state.newForm.username = el.value; },
    'admin-new.shopName': function (ctx, state, el) { state.newForm.shopName = el.value; },
    'admin-new.password': function (ctx, state, el) { state.newForm.password = el.value; },
    'admin-new.password2': function (ctx, state, el) { state.newForm.password2 = el.value; },
    'admin-new.avatar': function (ctx, state, el) {
      var f = el.files && el.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        state.newForm.avatar = String(reader.result || '');
        rerender();
      };
      reader.readAsDataURL(f);
    },
    'admin-new-clear-avatar': function (ctx, state) {
      state.newForm.avatar = '';
      rerender();
      return true;
    },
    /* ===== V3.59 权限分配 ===== */
    'admin-new-ds': function (ctx, state, el) {
      state.newForm.dataSpace = el.getAttribute('data-value') === 'solo' ? 'solo' : 'shared';
      state.error = '';
      return true;
    },
    'admin-perm-open': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      if (id === 'admin') return false;
      if (!state.permsEdits || !state.permsEdits[id]) state.permsEdits = initPerms(accounts.load(state.store || localStore()));
      state.permsEditId = id;
      state.error = '';
      return true;
    },
    'admin-perm-close': function (ctx, state) {
      state.permsEditId = null;
      state.error = '';
      return true;
    },
    'admin-perm-toggle': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      if (id === 'admin') return false;
      if (!state.permsEdits) state.permsEdits = initPerms(accounts.load(state.store || localStore()));
      var perm = el.getAttribute('data-perm');
      var edits = state.permsEdits[id] || (state.permsEdits[id] = {});
      edits[perm] = !edits[perm];
      state.error = '';
      return true;
    },
    'admin-perm-all': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      if (id === 'admin') return false;
      if (!state.permsEdits) state.permsEdits = initPerms(accounts.load(state.store || localStore()));
      var edits = state.permsEdits[id] || (state.permsEdits[id] = {});
      accounts.PERMS.forEach(function (p) { edits[p.id] = true; });
      state.error = '';
      return true;
    },
    'admin-perm-none': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      if (id === 'admin') return false;
      if (!state.permsEdits) state.permsEdits = initPerms(accounts.load(state.store || localStore()));
      state.permsEdits[id] = {};
      state.error = '';
      return true;
    },
    'admin-perm-save': function (ctx, state, el) {
      var st = state.store || localStore();
      if (!state.permsEdits) state.permsEdits = initPerms(accounts.load(st));
      var r = page.savePerms(st, state.permsEdits);
      state.msg = r.saved > 0 ? ('已保存 ' + r.saved + ' 个账号的功能权限') : '权限无变化';
      state.error = '';
      state.permsEditId = null;
      return true;
    },
    'admin-create-account': function (ctx, state) {
      var st = state.store || localStore();
      var r = page.createAccount(st, state.newForm);
      if (!r.ok) { state.error = r.error || '创建失败'; return false; }
      var newId = r.account.id;
      // 新账号默认全部分类，纳入经营范围勾选态
      if (state.edits) state.edits[newId] = (r.account.scopeCategories || []).slice();
      state.showNew = false;
      state.newForm = { username: '', shopName: '', password: '', password2: '', avatar: '' };
      state.error = '';
      state.msg = '账号「' + r.account.shopName + '」已创建';
      return true;
    },

    /* ===== 修改账号 ===== */
    'admin-edit-account': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      if (id === 'admin') { state.error = '管理员账号不可修改'; return false; }
      var st = state.store || localStore();
      var acct = accounts.getById(accounts.load(st), id);
      if (!acct) { state.error = '账号不存在'; return false; }
      state.editId = id;
      state.editForm = {
        username: acct.username,
        shopName: acct.shopName,
        password: '',
        password2: '',
        avatar: acct.avatar || ''
      };
      state.error = '';
      return true;
    },
    'admin-edit.username': function (ctx, state, el) { state.editForm.username = el.value; },
    'admin-edit.shopName': function (ctx, state, el) { state.editForm.shopName = el.value; },
    'admin-edit.password': function (ctx, state, el) { state.editForm.password = el.value; },
    'admin-edit.password2': function (ctx, state, el) { state.editForm.password2 = el.value; },
    'admin-edit.avatar': function (ctx, state, el) {
      var f = el.files && el.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        state.editForm.avatar = String(reader.result || '');
        rerender();
      };
      reader.readAsDataURL(f);
    },
    'admin-edit-clear-avatar': function (ctx, state) {
      state.editForm.avatar = '';
      rerender();
      return true;
    },
    'admin-edit-cancel': function (ctx, state) {
      state.editId = null;
      state.error = '';
      return true;
    },
    'admin-save-edit': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      var st = state.store || localStore();
      var r = page.updateAccount(st, id, state.editForm);
      if (!r.ok) { state.error = r.error || '保存失败'; return false; }
      state.editId = null;
      state.error = '';
      state.msg = '账号「' + r.account.shopName + '」已更新';
      return true;
    },

    /* ===== 删除账号 ===== */
    'admin-del-account': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      if (id === 'admin') { state.error = '管理员账号不可删除'; return false; }
      state.delId = id;
      state.error = '';
      return true;
    },
    'admin-del-cancel': function (ctx, state) {
      state.delId = null;
      state.error = '';
      return true;
    },
    'admin-confirm-del': function (ctx, state, el) {
      var id = el.getAttribute('data-id') || state.delId;
      var st = state.store || localStore();
      var r = page.removeAccount(st, id);
      if (!r.ok) { state.error = r.error || '删除失败'; state.delId = null; return false; }
      // 清理该账号数据空间（浏览器环境尽力而为）
      var a = appRef();
      if (a && a.deleteAccountDb) a.deleteAccountDb(id);
      if (state.edits) delete state.edits[id];
      state.delId = null;
      state.error = '';
      state.msg = '账号「' + r.account.shopName + '」已删除';
      return true;
    }
  };

  return page;
});
