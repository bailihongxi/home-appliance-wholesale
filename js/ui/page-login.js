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
    isNode ? require('../core/util.js') : (root.ERP && root.ERP.util),
    isNode ? require('../core/sync.js') : (root.ERP && root.ERP.sync)
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.login = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (accounts, ui, util, sync) {
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
      // 全局只保留这1处头像，放置在标题文字上方
      '<div class="login-head-avatar"><img src="assets/favicon.png" alt=""></div>' +
      // 标题区域：完全移除图片，只保留文字
      '<div class="login-brand">' +
          '<div class="login-title">我的电器店</div>' +
          '<div class="login-sub">电器批发进销存 · 请登录</div>' +
      '</div>' +

      '<div class="field mt8"><label>登录账号</label>' +
      '<input class="input" data-input="username" data-live="1" placeholder="请输入登录账号" value="' + esc(state.username) + '" autocomplete="username"></div>' +

      '<div class="field mt8"><label>登录密码</label>' +
      '<input class="input" type="password" data-input="pwd" data-live="1" placeholder="输入密码" value="' + esc(state.pwd) + '" autocomplete="current-password"></div>' +

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

  /**
   * V3.60/3.61 账号云同步登录降级（Node 可测）：
   * 本地无该登录名时，从云端拉取账号表（零配置公开通道优先，本地同步配置兜底）→ 合并到本地 → 重新校验登录。
   * @returns {Promise<{ok:boolean, account?, error?, cloud:boolean}>}
   *  cloud=true 表示本次登录依赖了云端账号表（拉取成功）；
   *  拉取失败时返回真实原因分类（不再一律静默成"账号不存在"）：
   *   - NO_CFG       → 提示先配置云同步或使用在线版
   *   - NO_SNAPSHOT  → 提示先用管理总控上传账号表
   *   - 其他          → 网络 / 解密错误原样透出（不含任何敏感配置）
   */
  page.tryCloudLogin = function tryCloudLogin(store, username, pwd, fetchImpl) {
    // 本地已有该账号：直接本地校验成功，无需云端（云同步仅是降级通道）
    var localOk = page.loginWithUsername(store, username, pwd);
    if (localOk.ok) return Promise.resolve({ ok: true, account: localOk.account, cloud: false });
    if (!sync || !sync.pullAccountsAny) {
      return Promise.resolve({ ok: false, cloud: false, error: '账号不存在，请检查登录账号' });
    }
    return sync.pullAccountsAny(store, fetchImpl).then(function (res) {
      if (!res.ok) {
        var msg = '账号不存在，请检查登录账号';
        if (res.error === 'NO_CFG') {
          msg = '当前环境无法自动同步账号表：本地无云同步配置。请先在其中任一设备「我的 → 云同步」填写 GitHub Token，或使用在线版登录';
        } else if (res.error === 'NO_SNAPSHOT') {
          msg = '云端还没有账号表：请先用管理总控（hawsystem）登录，在「账户权限管理」点「账号表上传到云端」';
        } else if (typeof res.error === 'string' && /账号表|云端|fetch|Failed|Network|网络|load/i.test(res.error)) {
          msg = '无法同步云端账号表：' + res.error;
        }
        return { ok: false, cloud: false, error: msg };
      }
      var list = accounts.load(store);
      var merged = accounts.mergeCloud(list, res.list);
      if (merged.changed) accounts.save(store, merged.list);
      var r = page.loginWithUsername(store, username, pwd);
      if (r.ok) return { ok: true, account: r.account, cloud: true };
      return { ok: false, cloud: true, error: r.error };
    });
  };

  page.actions = {
    'username': function (ctx, state, el) {
      state.username = el.value;
      state.error = '';
    },
    'pwd': function (ctx, state, el) {
      state.pwd = el.value;
    },
    /** 登录：先本地校验；本地无此账号时自动从云端拉取账号表合并后再校验（V3.60 跨端账号同步） */
    'do-login': function (ctx, state, el, ev) {
      var r = page.loginWithUsername(state.store, state.username, state.pwd);
      if (!r.ok) {
        // 账号不存在 → 尝试云端账号表（手机/新设备自动拉取管理总控上传的账号）
        if (r.error && r.error.indexOf('账号不存在') >= 0) {
          state.msg = '本地无此账号，正在从云端同步账号表…';
          state.error = '';
          page.rerenderIfPossible();
          page.tryCloudLogin(state.store, state.username, state.pwd).then(function (r2) {
            if (r2.ok) {
              state.msg = '';
              page._doLoginSuccess(ctx, state, r2.account);
            } else {
              state.msg = '';
              state.error = r2.error || r.error;
              page.rerenderIfPossible();
            }
          });
          return false; // 异步进行中：阻止默认 afterAction
        }
        state.error = r.error;
        return false;
      }
      page._doLoginSuccess(ctx, state, r.account);
      return false;
    }
  };

  /** 同步模块（浏览器读 ERP.sync；Node 下可用 opts.sync 注入） */
  function syncRef() {
    var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
    return (g && g.ERP && g.ERP.sync) || null;
  }

  /**
   * V3.69：员工「零配置自助取数」。
   * 用本次登录输入的**明文密码**解开该账号的取数凭证 syncPhraseEnc → 得到老板的同步口令，
   * 写入本机云同步配置（按「数据归属账号」存，与老板共用同一份配置）。
   * 于是员工在新设备只要用自己的账号密码登录，就能直接「从云端恢复」拉本店数据，
   * 全程不需要老板到场、也不需要把同步口令告诉员工。
   *
   * 安全边界：凭证是用员工密码加密的，云端账号表里只有密文 + 密码哈希，
   * 拿到账号表的人没有明文密码依然解不开。
   *
   * 纯逻辑（Node 可测）：任何环节缺失或解密失败都返回 {ok:false}，不抛错、不影响登录本身。
   * @returns {Promise<{ok:boolean, reason:string}>}
   */
  page.claimCredential = function claimCredential(store, account, pwd, opts) {
    var s = (opts && opts.sync) || syncRef();
    if (!s || !s.unwrapPhrase) return Promise.resolve({ ok: false, reason: 'no-sync' });
    if (!account || !pwd) return Promise.resolve({ ok: false, reason: 'no-input' });
    if (!account.syncPhraseEnc) return Promise.resolve({ ok: false, reason: 'no-credential' });
    return s.unwrapPhrase(pwd, account.syncPhraseEnc).then(function (phrase) {
      if (!phrase) return { ok: false, reason: 'unwrap-failed' };
      if (!s.loadConfig || !s.saveConfig) return { ok: false, reason: 'no-config-api' };
      var owner = (opts && opts.ownerId) ||
        (accounts.dataOwnerId ? accounts.dataOwnerId(account) : '') || account.id;
      var cfg = s.loadConfig(store, owner) || {};
      if (cfg.passphrase) return { ok: true, reason: 'already-configured' };
      cfg.passphrase = phrase;
      s.saveConfig(store, cfg, owner);
      return { ok: true, reason: 'applied' };
    }, function () { return { ok: false, reason: 'error' }; });
  };

  /** 登录成功：触发 app 登录流程（异步建库/进入） */
  page._doLoginSuccess = function _doLoginSuccess(ctx, state, account) {
    var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
    var finish = function () {
      if (g && g.ERP && g.ERP.app && g.ERP.app.onLogin) {
        g.ERP.app.onLogin(account);
      } else if (g && g.ERP) {
        g.ERP.currentAccount = account;
      }
    };
    // V3.69：先进入主流程（保持原有同步时序），再后台解凭证写入同步口令
    finish();
    try {
      var p = page.claimCredential(state.store, account, state.pwd);
      if (p && typeof p.then === 'function') p.then(null, function () {});
    } catch (e) { /* 取数凭证失败不影响登录 */ }
  };

  /** 尽力重渲染（浏览器环境）；Node 测试无 app 时静默跳过 */
  page.rerenderIfPossible = function rerenderIfPossible() {
    var g = (typeof globalThis !== 'undefined' ? globalThis : null) || (typeof self !== 'undefined' ? self : null);
    if (g && g.ERP && g.ERP.app && g.ERP.app.render) g.ERP.app.render();
  };

  return page;
});
