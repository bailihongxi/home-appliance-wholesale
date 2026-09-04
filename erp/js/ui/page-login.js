/**
 * ui/page-login.js —— V3 多账号登录页
 *  - 仅显示 登录人头像 + 登录账号输入框 + 密码输入框 + 登录按键（不展示全部用户列表选择登录）
 *  - 输入登录名+密码 → 校验通过（accounts.verify）→ 返回登录结果
 *  - 账户的「新建 / 修改 / 删除」统一由管理员（管理总控）在权限管理页管理，登录页不提供
 *  - 数据空间切换由 app 层在登录成功后处理
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
        username: '',
        pwd: '',
        error: '',
        msg: ''
      };
    }
  };

  page.render = function render(ctx, state) {
    var store = state.store;
    accounts.ensurePreset(store); // 首次自动创建预置账号（管理总控）

    var h = '<div class="login-page">' +
      '<div class="login-card">' +
      '<div class="login-brand"><img src="assets/favicon.png" alt="logo"><div class="login-title">我的电器店</div>' +
      '<div class="login-sub">电器批发进销存 · 请登录</div></div>' +
      // 登录人头像（默认系统图标）
      '<div class="login-head-avatar"><img src="assets/favicon.png" alt=""></div>' +
      '<div class="field mt8"><label>登录账号</label>' +
      '<input class="input" data-input="username" data-live="1" placeholder="请输入登录账号" value="' + esc(state.username) + '" autocomplete="username"></div>' +
      '<div class="field mt8"><label>登录密码</label>' +
      '<input class="input" type="password" data-input="pwd" data-live="1" placeholder="输入密码" autocomplete="current-password"></div>' +
      '<div class="row mt12">' +
      '<button class="btn btn-block btn-primary" data-act="do-login">登 录</button></div>';

    if (state.msg) h += '<div class="notice notice-info mt8">' + esc(state.msg) + '</div>';
    if (state.error) h += '<div class="notice notice-warn mt8">' + esc(state.error) + '</div>';

    h += '</div></div>';
    return h;
  };

  /** 纯校验：登录账号+密码 → {ok, account|error}（Node 与浏览器共用，便于单测） */
  page.loginWithUsername = function loginWithUsername(store, username, pwd) {
    var list = accounts.load(store);
    var acct = accounts.findByUsername(list, username);
    if (!acct) return { ok: false, error: '账号不存在，请检查登录账号' };
    if (!accounts.verify(acct, pwd)) return { ok: false, error: '密码错误，请重试' };
    return { ok: true, account: accounts.strip(acct) };
  };

  /** 兼容旧接口：按账号 id 登录 */
  page.loginWith = function loginWith(store, id, pwd) {
    var list = accounts.load(store);
    var acct = accounts.getById(list, id);
    if (!acct) return { ok: false, error: '请先选择账号' };
    if (!accounts.verify(acct, pwd)) return { ok: false, error: '密码错误，请重试' };
    return { ok: true, account: accounts.strip(acct) };
  };

  page.actions = {
    'username': function (ctx, state, el) {
      state.username = el.value;
      state.error = '';
    },
    'pwd': function (ctx, state, el) {
      state.pwd = el.value;
    },
    /** 登录：校验账号+密码。成功触发 app.onLogin 切换数据空间；失败提示 */
    'do-login': function (ctx, state, el, ev) {
      var r = page.loginWithUsername(state.store, state.username, state.pwd);
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
