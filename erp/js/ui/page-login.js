/**
 * ui/page-login.js —— V3 多账号登录页
 *  - 展示本机账号列表（头像/店名/经营范围标签）
 *  - 点击账号 → 输密码 → 校验通过（accounts.verify）→ 返回登录结果
 *  - 支持自行创建账号（最多 10 个，accounts.create）
 *  - 数据空间切换由 app 层在登录成功后处理（阶段2）
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var mod = factory(
    isNode ? require('../core/accounts.js') : (root.ERP && root.ERP.accounts),
    isNode ? require('./components.js') : (root.ERP && root.ERP.ui),
    isNode ? require('../core/util.js') : (root.ERP && root.ERP.util)
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.login = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (accounts, ui, util) {
  'use strict';

  var esc = util.escapeHtml;

  var page = {
    name: 'login',
    hideInNav: true, // V3：登录页不出现在侧栏/底栏导航
    init: function init(ctx, store) {
      return {
        store: store || null,
        selectedId: null,
        pwd: '',
        showCreate: false,
        create: { username: '', shopName: '', password: '', password2: '', avatar: '' },
        editId: null,
        edit: { username: '', shopName: '', password: '', password2: '', avatar: '' },
        pendingDeleteId: null,
        error: '',
        msg: ''
      };
    }
  };

  page.render = function render(ctx, state) {
    var store = state.store;
    var list = accounts.ensurePreset(store); // 首次自动创建预置账号
    var pubs = accounts.publicList(list);
    var sel = accounts.getById(list, state.selectedId);

    var h = '<div class="login-page">' +
      '<div class="login-card">' +
      '<div class="login-brand"><img src="assets/icon-192.png" alt="logo"><div class="login-title">我的电器店</div>' +
      '<div class="login-sub">V3 多店铺进销存 · 请选择店铺登录</div></div>';

    // 账号列表
    h += '<div class="login-accounts">';
    pubs.forEach(function (a) {
      var on = a.id === state.selectedId ? ' on' : '';
      var scope = (a.scopeCategories || []).join(' / ') || '全部分类';
      h += '<div class="login-account' + on + '" data-act="pick-account" data-id="' + esc(a.id) + '">' +
        '<span class="login-avatar">' + (a.avatar ? '<img src="' + esc(a.avatar) + '" alt="">' : esc(a.shopName.charAt(0))) + '</span>' +
        '<span class="login-acc-main"><span class="login-name">' + esc(a.shopName) + '</span>' +
        '<span class="login-user">@' + esc(a.username) + ' · 经营：' + esc(scope) + '</span></span>' +
        '<span class="login-actions">' +
          '<button class="login-act" data-act="edit-account" data-id="' + esc(a.id) + '" title="编辑账号">✎</button>' +
          '<button class="login-act danger" data-act="del-account" data-id="' + esc(a.id) + '" title="删除账号">🗑</button>' +
        '</span>' +
        (on ? '<span class="login-check">✓</span>' : '') +
        '</div>';
    });
    h += '</div>';

    // 选中账号 → 密码输入 + 进入
    if (sel) {
      h += '<div class="field mt8"><label>登录密码</label>' +
        '<input class="input" type="password" data-input="pwd" data-live="1" placeholder="输入密码" value="' + esc(state.pwd) + '" autocomplete="off"></div>';
      h += '<div class="row mt8">' +
        '<button class="btn btn-block btn-primary" data-act="do-login">进入「' + esc(sel.shopName) + '」</button></div>';
    } else {
      h += '<div class="row mt8"><button class="btn btn-block" data-act="toggle-create">＋ 新建店铺账号</button></div>';
    }

    // 编辑账号表单
    if (state.editId) {
      h += '<div class="card mt8 create-box">' +
        '<div class="card-title">编辑店铺账号</div>' +
        '<div class="field"><label>店铺头像（选填）</label>' +
        '<div class="row" style="gap:10px;align-items:center">' +
          (state.edit.avatar
            ? '<img class="avatar-img" src="' + esc(state.edit.avatar) + '" alt="头像预览" style="width:48px;height:48px;border-radius:50%;object-fit:cover">'
            : '<div class="avatar">⚡</div>') +
          '<label class="btn btn-sm" style="margin:0">📷 选择图片' +
            '<input type="file" accept="image/*" data-input="edit.avatar" style="display:none">' +
          '</label>' +
          (state.edit.avatar ? '<button class="btn btn-sm" data-act="clear-edit-avatar">清除</button>' : '') +
        '</div>' +
        '<div class="small muted mt4">仅本机保存，用于登录页与「我的」页展示</div></div>' +
        '<div class="field"><label>登录账号（2-20 位字母/数字/下划线）</label>' +
        '<input class="input" data-input="edit.username" data-live="1" placeholder="如 myShop" value="' + esc(state.edit.username) + '"></div>' +
        '<div class="field"><label>店铺名称</label>' +
        '<input class="input" data-input="edit.shopName" data-live="1" placeholder="如 我的小店" value="' + esc(state.edit.shopName) + '"></div>' +
        '<div class="field"><label>新密码（留空则不修改）</label>' +
        '<input class="input" type="password" data-input="edit.password" data-live="1" placeholder="留空不修改" value="' + esc(state.edit.password) + '"></div>' +
        '<div class="field"><label>确认新密码</label>' +
        '<input class="input" type="password" data-input="edit.password2" data-live="1" value="' + esc(state.edit.password2) + '"></div>' +
        '<div class="row"><button class="btn" data-act="cancel-edit">取消</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-primary" data-act="save-account">保存修改</button></div></div>';
    }

    // 删除确认
    if (state.pendingDeleteId) {
      var delAcct = accounts.getById(accounts.load(store), state.pendingDeleteId);
      h += '<div class="notice notice-warn mt8">确定删除账号「' + esc(delAcct ? delAcct.shopName : '') + '」？其全部数据（商品 / 单据 / 账本）将一并删除，且不可恢复。</div>' +
        '<div class="row mt8"><button class="btn" data-act="cancel-del-account">取消</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-danger" data-act="confirm-del-account" data-id="' + esc(state.pendingDeleteId) + '">确认删除</button></div>';
    }

    // 新建账号表单
    if (state.showCreate) {
      h += '<div class="card mt8 create-box">' +
        '<div class="card-title">新建店铺账号</div>' +
        '<div class="field"><label>店铺头像（选填）</label>' +
        '<div class="row" style="gap:10px;align-items:center">' +
          (state.create.avatar
            ? '<img class="avatar-img" src="' + esc(state.create.avatar) + '" alt="头像预览" style="width:48px;height:48px;border-radius:50%;object-fit:cover">'
            : '<div class="avatar">⚡</div>') +
          '<label class="btn btn-sm" style="margin:0">📷 选择图片' +
            '<input type="file" accept="image/*" data-input="create.avatar" style="display:none">' +
          '</label>' +
          (state.create.avatar ? '<button class="btn btn-sm" data-act="clear-create-avatar">清除</button>' : '') +
        '</div>' +
        '<div class="small muted mt4">仅本机保存，用于登录页与「我的」页展示</div></div>' +
        '<div class="field"><label>登录账号（2-20 位字母/数字/下划线）</label>' +
        '<input class="input" data-input="create.username" data-live="1" placeholder="如 myShop" value="' + esc(state.create.username) + '"></div>' +
        '<div class="field"><label>店铺名称</label>' +
        '<input class="input" data-input="create.shopName" data-live="1" placeholder="如 我的小店" value="' + esc(state.create.shopName) + '"></div>' +
        '<div class="field"><label>密码（至少 4 位）</label>' +
        '<input class="input" type="password" data-input="create.password" data-live="1" value="' + esc(state.create.password) + '"></div>' +
        '<div class="field"><label>确认密码</label>' +
        '<input class="input" type="password" data-input="create.password2" data-live="1" value="' + esc(state.create.password2) + '"></div>' +
        '<div class="row"><button class="btn" data-act="cancel-create">取消</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn btn-primary" data-act="create-account">创建账号</button></div></div>';
    }

    if (state.msg) h += '<div class="notice notice-info mt8">' + esc(state.msg) + '</div>';
    if (state.error) h += '<div class="notice notice-warn mt8">' + esc(state.error) + '</div>';

    h += '</div></div>';
    return h;
  };

  /** 纯校验：账号+密码 → {ok, account|error}（Node 与浏览器共用，便于单测） */
  page.loginWith = function loginWith(store, id, pwd) {
    var list = accounts.load(store);
    var acct = accounts.getById(list, id);
    if (!acct) return { ok: false, error: '请先选择账号' };
    if (!accounts.verify(acct, pwd)) return { ok: false, error: '密码错误，请重试' };
    return { ok: true, account: accounts.strip(acct) };
  };

  page.actions = {
    'pick-account': function (ctx, state, el) {
      state.selectedId = el.getAttribute('data-id');
      state.pwd = '';
      state.error = '';
      state.msg = '';
    },
    'toggle-create': function (ctx, state) {
      state.showCreate = !state.showCreate;
      state.error = '';
    },
    'cancel-create': function (ctx, state) {
      state.showCreate = false;
      state.error = '';
    },
    'pwd': function (ctx, state, el) {
      state.pwd = el.value;
    },
    'create.username': function (ctx, state, el) { state.create.username = el.value; },
    'create.shopName': function (ctx, state, el) { state.create.shopName = el.value; },
    'create.password': function (ctx, state, el) { state.create.password = el.value; },
    'create.password2': function (ctx, state, el) { state.create.password2 = el.value; },
    /** 头像文件选择 → 读为 dataURL 预览（创建时写入账号 avatar） */
    'create.avatar': function (ctx, state, el) {
      var f = el.files && el.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        state.create.avatar = String(reader.result || '');
        var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
        if (g && g.ERP && g.ERP.app && g.ERP.app.render) g.ERP.app.render();
      };
      reader.readAsDataURL(f);
    },
    'clear-create-avatar': function (ctx, state) {
      state.create.avatar = '';
      var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
      if (g && g.ERP && g.ERP.app && g.ERP.app.render) g.ERP.app.render();
    },

    /* ===== 编辑账号 ===== */
    'edit-account': function (ctx, state, el) {
      var id = el.getAttribute('data-id');
      var acct = accounts.getById(accounts.load(state.store), id);
      if (!acct) { state.error = '账号不存在'; return false; }
      state.editId = id;
      state.edit = {
        username: acct.username,
        shopName: acct.shopName,
        password: '',
        password2: '',
        avatar: acct.avatar || ''
      };
      state.error = '';
      return true;
    },
    'edit.username': function (ctx, state, el) { state.edit.username = el.value; },
    'edit.shopName': function (ctx, state, el) { state.edit.shopName = el.value; },
    'edit.password': function (ctx, state, el) { state.edit.password = el.value; },
    'edit.password2': function (ctx, state, el) { state.edit.password2 = el.value; },
    'edit.avatar': function (ctx, state, el) {
      var f = el.files && el.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        state.edit.avatar = String(reader.result || '');
        var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
        if (g && g.ERP && g.ERP.app && g.ERP.app.render) g.ERP.app.render();
      };
      reader.readAsDataURL(f);
    },
    'clear-edit-avatar': function (ctx, state) {
      state.edit.avatar = '';
      var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
      if (g && g.ERP && g.ERP.app && g.ERP.app.render) g.ERP.app.render();
    },
    'cancel-edit': function (ctx, state) {
      state.editId = null;
      state.error = '';
    },
    'save-account': function (ctx, state) {
      if (state.edit.password !== state.edit.password2) {
        state.error = '两次输入的密码不一致';
        return false;
      }
      var r = accounts.update(state.store, state.editId, {
        username: state.edit.username,
        shopName: state.edit.shopName,
        password: state.edit.password || undefined,
        avatar: state.edit.avatar
      });
      if (!r.ok) { state.error = r.error || '保存失败'; return false; }
      state.editId = null;
      state.error = '';
      state.msg = '账号资料已更新';
      return true;
    },

    /* ===== 删除账号 ===== */
    'del-account': function (ctx, state, el) {
      state.pendingDeleteId = el.getAttribute('data-id');
      state.error = '';
      return true;
    },
    'cancel-del-account': function (ctx, state) {
      state.pendingDeleteId = null;
      state.error = '';
    },
    'confirm-del-account': function (ctx, state, el) {
      var id = el.getAttribute('data-id') || state.pendingDeleteId;
      var r = accounts.remove(state.store, id);
      if (!r.ok) { state.error = r.error || '删除失败'; state.pendingDeleteId = null; return false; }
      // 清理该账号数据空间（浏览器环境尽力而为）
      var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
      if (g && g.ERP && g.ERP.app && g.ERP.app.deleteAccountDb) g.ERP.app.deleteAccountDb(id);
      if (state.selectedId === id) { state.selectedId = null; state.pwd = ''; }
      state.pendingDeleteId = null;
      state.error = '';
      state.msg = '账号「' + r.account.shopName + '」已删除';
      return true;
    },

    'create-account': function (ctx, state) {
      if (state.create.password !== state.create.password2) {
        state.error = '两次输入的密码不一致';
        return false;
      }
      var r = accounts.create(state.store, {
        username: state.create.username,
        shopName: state.create.shopName,
        password: state.create.password,
        avatar: state.create.avatar
      });
      if (!r.ok) { state.error = r.error || '创建失败'; return false; }
      state.showCreate = false;
      state.create = { username: '', shopName: '', password: '', password2: '', avatar: '' };
      state.selectedId = r.account.id;
      state.msg = '账号已创建，请设置登录密码进入';
      return true;
    },

    /** 登录：校验密码。成功触发 app.onLogin 切换数据空间；失败提示 */
    'do-login': function (ctx, state, el, ev) {
      var r = page.loginWith(state.store, state.selectedId, state.pwd);
      if (!r.ok) {
        state.error = r.error;
        return false;
      }
      // 触发 app 登录流程（异步建库/进入）；返回 false 阻止默认 afterAction（此时 db 未就绪）
      var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
      if (g && g.ERP && g.ERP.app && g.ERP.app.onLogin) {
        g.ERP.app.onLogin(r.account);
      } else if (g && g.ERP) {
        g.ERP.currentAccount = r.account;
      }
      return false;
    }
  };

  return page;
});
