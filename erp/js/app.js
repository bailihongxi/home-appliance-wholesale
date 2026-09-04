/**
 * app.js —— 启动、路由挂载、事件委托、落库
 * 依赖：core/*、store/*、ui/*、barcode/* 全部以经典 <script> 按序加载（file:// 可用）
 */
(function (root, factory) {
  var mod = factory(root.ERP || {});
  root.ERP = root.ERP || {};
  root.ERP.app = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP) {
  'use strict';

  var app = {
    db: null,
    ctx: null,
    ready: false,
    pageStates: Object.create(null),
    main: null,
    // 搜索防抖：250ms 内多次输入只渲染一次（大数据量下实时搜索不卡顿；纯函数可测）
    _debounceMs: 250
  };

  // 通用防抖调度（可测）：多次调用只执行最后一次
  var searchTimer = null;
  app._scheduleSearch = function (fn, ms) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      fn();
    }, ms);
  };

  function router() {
    return ERP.router;
  }
  function ui() {
    return ERP.ui;
  }

  /* ---------------- 启动 ---------------- */

  function store() {
    return (typeof localStorage !== 'undefined' && localStorage) || {
      getItem: function () { return null; },
      setItem: function () {}
    };
  }
  var CURRENT_KEY = 'applianceErp.currentAccount';
  function loadCurrent() {
    try {
      var raw = store().getItem(CURRENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveCurrent(acct) {
    try { store().setItem(CURRENT_KEY, JSON.stringify(acct)); } catch (e) { /* ignore */ }
  }
  function clearCurrent() {
    try { store().removeItem ? store().removeItem(CURRENT_KEY) : store().setItem(CURRENT_KEY, ''); } catch (e) { /* ignore */ }
  }

  /** 账号信息并入本账号 settings（店名/经营范围/头像，仅当未设置时） */
  function applyAccountToSettings(account) {
    if (!account || !app.ctx) return;
    var s = app.ctx.settings;
    if (!s.shopName || s.shopName === '我的电器店') s.shopName = account.shopName || s.shopName;
    if (!s.scopeCategories || !s.scopeCategories.length) {
      s.scopeCategories = (account.scopeCategories && account.scopeCategories.length)
        ? account.scopeCategories.slice()
        : (ERP.schema.ALL_CATEGORIES || []).slice();
    }
    if (!s.avatar && account.avatar) s.avatar = account.avatar;
  }

  /** 渲染登录页（V3：多账号选择 + 密码） */
  function renderLogin() {
    var page = ERP.pages && ERP.pages.login;
    if (!page) return;
    if (!app.pageStates.login) app.pageStates.login = page.init(null, store());
    app.main.innerHTML = page.render(null, app.pageStates.login);
  }

  app.boot = async function boot() {
    if (typeof document === 'undefined') return null;
    app.main = document.getElementById('view');

    // 注册所有已加载的页面到路由
    if (ERP.pages) {
      Object.keys(ERP.pages).forEach(function (name) {
        router().register(name, ERP.pages[name]);
      });
    }

    app.ready = true;
    bindGlobalEvents();

    // 命名空间隔离：一次性迁移旧版（与鞋服母版共用）的账号/登录态/数据库到本系统独立命名空间
    try {
      await app.migrateNamespace();
    } catch (e) { /* 迁移失败不阻断启动 */ }

    // V3：多账号登录——已有登录态直接进入，否则展示登录页
    var saved = loadCurrent();
    if (saved && saved.id) {
      ERP.currentAccount = saved;
      await app.enterAccount(saved);
    } else {
      renderLogin();
    }
    return app.ctx;
  };

  /** 登录成功：保存会话 + 按账号独立库进入 */
  app.onLogin = async function onLogin(account) {
    if (!account || !account.id) return;
    ERP.currentAccount = account;
    saveCurrent(account);
    await app.enterAccount(account);
  };

  /** 切换/进入某账号的数据空间（独立 IndexedDB 库 applianceErp_<acctId>，与鞋服母版隔离） */
  app.enterAccount = async function enterAccount(account) {
    if (!account || !account.id) return app.ctx;
    app.db = await ERP.db.create({ name: ERP.schema.dbNameFor(account.id) });
    // V2 存量单账号数据 → 账号1（仅首次进入账号1 且旧库有数据时迁移）
    if (account.id === 'acct1') await app.migrateLegacyData();
    var data = await ERP.repo.loadAll(app.db);
    app.ctx = ERP.repo.createContext(data);
    applyAccountToSettings(account);
    app.pageStates = Object.create(null);
    app.main = document.getElementById('view');
    if (app.ctx.settings.lock && app.ctx.settings.lock.enabled && app.ctx.settings.lock.hash) {
      showLock();
    } else {
      enter();
    }
    return app.ctx;
  };

  /** V2 存量数据迁移：旧库 shoeErp → 账号1 库（只迁移一次） */
  app.migrateLegacyData = async function migrateLegacyData() {
    if (store().getItem('applianceErp.migratedV3') === '1' || store().getItem('erp.migratedV3') === '1') {
      // 兼容旧标记：若旧标记已置位，补设新标记后视为已迁移
      store().setItem('applianceErp.migratedV3', '1');
      return { migrated: false, reason: 'already' };
    }
    var r = { migrated: false, reason: 'no-migrate-module' };
    try {
      if (ERP.migrate) {
        r = await ERP.migrate.migrate(
          function (name) { return ERP.db.create({ name: name }); },
          'shoeErp',
          ERP.schema.dbNameFor('acct1')
        );
      }
    } catch (e) {
      r = { migrated: false, reason: 'error' };
    }
    // 无论结果如何都标记，避免每次进入账号1 都检查旧库
    store().setItem('applianceErp.migratedV3', '1');
    return r;
  };

  /**
   * 命名空间隔离迁移（一次性）：早期版本与鞋服母版共用存储——
   *   localStorage：erp.accounts / erp.currentAccount → applianceErp.accounts / applianceErp.currentAccount
   *   IndexedDB：每账号 erp_<id> → applianceErp_<id>
   * 规则：新 key 已非空则跳过（不覆盖）；数据库 target 非空自动跳过（migrate 保护）；迁移失败不阻断登录。
   */
  app.migrateNamespace = async function migrateNamespace() {
    var st = store();
    var MARK = 'applianceErp.migrated';
    try {
      if (st.getItem(MARK) === '1') return { migrated: false, reason: 'already' };
      // 1) localStorage：账号列表 + 当前登录态
      ['accounts', 'currentAccount'].forEach(function (k) {
        var oldK = 'erp.' + k, newK = 'applianceErp.' + k;
        if (!st.getItem(newK)) {
          var v = st.getItem(oldK);
          if (v) {
            try { st.setItem(newK, v); } catch (e) { /* ignore */ }
          }
        }
      });
      // 2) IndexedDB：每个账号 erp_<id> → applianceErp_<id>
      if (ERP.migrate && ERP.db && ERP.accounts) {
        var list = ERP.accounts.load(st);
        for (var i = 0; i < list.length; i++) {
          var id = list[i] && list[i].id;
          if (!id) continue;
          var oldName = 'erp_' + id, newName = 'applianceErp_' + id;
          if (oldName === newName) continue;
          try {
            await ERP.migrate.migrate(function (n) { return ERP.db.create({ name: n }); }, oldName, newName);
          } catch (e) { /* 单账号迁移失败不阻断整体 */ }
        }
      }
      try { st.setItem(MARK, '1'); } catch (e) { /* ignore */ }
      return { migrated: true };
    } catch (e) {
      return { migrated: false, reason: 'error' };
    }
  };

  /** 退出登录：清会话回登录页 */
  app.logout = function logout() {
    clearCurrent();
    ERP.currentAccount = null;
    app.db = null;
    app.ctx = null;
    renderLogin();
  };

  /** 删除账号数据空间（IndexedDB 库 erp_<acctId>），尽力而为，失败忽略 */
  app.deleteAccountDb = function deleteAccountDb(acctId) {
    try {
      var idb = (typeof indexedDB !== 'undefined') ? indexedDB : null;
      if (!idb || !acctId || !ERP.schema) return;
      var req = idb.deleteDatabase(ERP.schema.dbNameFor(acctId));
      req.onerror = function () {};
      req.onsuccess = function () {};
      req.onblocked = function () {};
    } catch (e) { /* ignore */ }
  };

  function enter() {
    router().start();
    router().onChange(function () {
      render();
    });
    // V3：登录成功后若仍停在 login 页（hash 为 #/login），自动跳转到首页，避免"点进入无反馈"
    if (router().currentName && router().currentName() === 'login') {
      router().go('home');
    }
    render();
  }

  function bindGlobalEvents() {
    document.addEventListener('click', function (ev) {
      actHandler(ev, function (el) {
        return el.getAttribute('data-act');
      }, function (name, el, ev2) {
        return dispatch(name, el, ev2);
      });
    });

    document.addEventListener('change', function (ev) {
      actHandler(ev, function (el) {
        return el.getAttribute('data-change');
      }, function (name, el, ev2) {
        return dispatch(name, el, ev2);
      });
    });

    document.addEventListener('input', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-input],[data-change]') : null;
      if (!el) return;
      var name = el.getAttribute('data-input') || el.getAttribute('data-change');
      // 输入法组合进行中：完全忽略，等 compositionend 统一处理，避免打断中文输入
      if (app._isComposing(el, ev)) return;
      dispatch(name, el, ev);
      // data-live="1"：实时预览（重渲染并恢复焦点/光标）；普通字段只更新内存，不重渲染
      if (app._isLive(el)) relive(el);
    });

    // 输入法结束后补一次重渲染（中文/日文等组合输入必须靠它才能正确刷新预览）
    document.addEventListener('compositionend', function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-input],[data-change]') : null;
      if (!el) return;
      var name = el.getAttribute('data-input') || el.getAttribute('data-change');
      dispatch(name, el, ev);
      if (app._isLive(el)) relive(el);
    });

    function relive(el) {
      var pos = null;
      try {
        pos = el.selectionStart;
      } catch (e) {
        pos = null;
      }
      var key = el.getAttribute('data-name') || '';
      // 搜索类输入（data-debounce="1"）：防抖 250ms 后渲染一次，
      // 避免数据量大时逐键触发全量过滤/排序/重建 DOM 导致卡顿（实时搜索但不逐键重渲染）
      if (el.getAttribute('data-debounce') === '1') {
        scheduleSearchRender(el, key);
        return;
      }
      render();
      scheduleCommit();
      var selector = inputSelector(el, key);
      var next = document.querySelector(selector);
      if (next) {
        next.focus();
        if (pos !== null) {
          try {
            next.setSelectionRange(pos, pos);
          } catch (e2) { /* 部分输入类型不支持 */ }
        }
      }
    }

    /** 生成输入框选择器：同时支持 data-input 和 data-change，以及 data-id 精确定位（表格中行内输入框） */
    function inputSelector(el, key) {
      var idAttr = el.getAttribute('data-id');
      var idPart = idAttr ? '[data-id="' + idAttr + '"]' : '';
      var v = el.getAttribute('data-input');
      if (v !== null) return '[data-input="' + v + '"]' + (key ? '[data-name="' + key + '"]' : '') + idPart;
      v = el.getAttribute('data-change');
      if (v !== null) return '[data-change="' + v + '"]' + (key ? '[data-name="' + key + '"]' : '') + idPart;
      return '[data-input=""]' + (key ? '[data-name="' + key + '"]' : '') + idPart;
    }

    // 搜索防抖：250ms 内多次输入只渲染一次；渲染后恢复搜索框焦点与光标
    var searchState = null;
    function scheduleSearchRender(el, key) {
      searchState = { el: el, key: key || '' };
      app._scheduleSearch(function () {
        render();
        var s = searchState;
        searchState = null;
        if (!s || !s.el) return;
        var selector = inputSelector(s.el, s.key);
        var next = document.querySelector(selector);
        if (next) {
          next.focus();
          if (s.el.selectionStart !== null && s.el.selectionStart !== undefined) {
            try {
              next.setSelectionRange(s.el.selectionStart, s.el.selectionEnd);
            } catch (e2) { /* 忽略 */ }
          }
        }
      }, app._debounceMs);
    }

    // 扫码枪：光标在搜索框内，回车即视为扫码输入
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var el = ev.target;
      if (!el || !el.getAttribute) return;
      if (el.getAttribute('data-input') !== 'keyword') return;
      ev.preventDefault();
      var val = String(el.value || '').trim();
      if (!val) return;
      var page = router().current();
      if (page && page.actions && page.actions['scan-input']) {
        page.actions['scan-input'](app.ctx, stateOf(page), { value: val });
        afterAction();
      }
    });

    // 电脑端顶栏全局搜索：回车后带关键词跳转「商品档案」页
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var el = ev.target;
      if (!el || !el.id || el.id !== 'global-search-input') return;
      ev.preventDefault();
      var val = String(el.value || '').trim();
      el.blur();
      if (!val) {
        router().go('product');
        return;
      }
      if (!app.pageStates.product) {
        app.pageStates.product = (ERP.pages && ERP.pages.product && ERP.pages.product.init
          ? ERP.pages.product.init(app.ctx)
          : {});
      }
      app.pageStates.product.keyword = val;
      app.pageStates.product.page = 1;
      router().go('product');
    });

    // 安全网：页面被隐藏 / 卸载前，把尚未落库的脏数据最佳努力写入 IndexedDB，
    // 避免「刚保存就刷新/切走」导致的数据丢失（IndexedDB 事务在页面卸载时可能被中断）。
    function flushOnHide() {
      if (!app.db || !app.ctx) return;
      var pending = app.ctx.dirtyKeys && app.ctx.dirtyKeys().length;
      if (!pending) return;
      app.commit().catch(function (e) {
        if (typeof console !== 'undefined') console.error('页面卸载前落库失败', e);
      });
    }
    document.addEventListener('pagehide', flushOnHide);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushOnHide();
    });
  }

  /** 找到动作处理函数：页面 → 全局（V3：未登录时走登录页 action） */
  function dispatch(name, el, ev) {
    var page = ERP.currentAccount ? router().current() : loginPage();
    var state = stateOf(page);
    var fn = null;
    if (page && page.actions && page.actions[name]) fn = page.actions[name];
    else if (ui().globalActions && ui().globalActions[name]) fn = ui().globalActions[name];
    else if (app.actions && app.actions[name]) fn = app.actions[name];
    if (!fn) return undefined;
    return fn(app.ctx, state, el, ev);
  }

  function loginPage() {
    return (ERP.pages && ERP.pages.login) || null;
  }

  /**
   * 统一的动作派发：先执行动作，再「可靠落库 + 重渲染」。
   * - 动作抛错时给出明确错误提示，而不是整页静默无反应；
   * - afterAction 内部 await 落库，避免保存后因页面刷新/关闭而丢失数据。
   */
  function actHandler(ev, getName, run) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-act],[data-change]') : null;
    if (!el) return;
    var name = getName(el);
    if (!name) return;
    var handled = true;
    try {
      handled = run(name, el, ev);
    } catch (err) {
      if (typeof console !== 'undefined') console.error('动作执行出错：' + name, err);
      ui().toast('操作失败：' + (err && err.message ? err.message : err), 'err');
      return;
    }
    if (handled !== false) {
      afterAction();
    }
  }

  function stateOf(page) {
    if (!page) return {};
    if (!app.pageStates[page.name]) {
      app.pageStates[page.name] = page.init ? page.init(app.ctx) : {};
    }
    return app.pageStates[page.name];
  }

  /**
   * 动作完成后：先把脏数据落库（IndexedDB），成功后再重渲染。
   * 落库失败会明确提示，避免「看起来保存了其实没存上」的假象。
   */
  async function afterAction() {
    try {
      await app.commit();
    } catch (err) {
      if (typeof console !== 'undefined') console.error('落库失败', err);
      ui().toast('保存失败：数据未能写入本地存储（' + (err && err.message ? err.message : err) + '）', 'err');
      return;
    }
    render();
  }

  /* 防抖落库：实时输入（data-live）期间不每次 flush，松开输入 400ms 后再写盘，避免逐键写 IndexedDB 卡顿 */
  var commitTimer = null;
  function scheduleCommit() {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(function () {
      commitTimer = null;
      app.commit();
    }, 400);
  }

  /** 落库（脏数据刷新） */
  app.commit = async function commit() {
    if (!app.db || !app.ctx) return {};
    return ERP.repo.flush(app.ctx, app.db);
  };

  app.saveSettings = async function saveSettings() {
    app.ctx.settings = ERP.schema.mergeSettings(app.ctx.settings);
    await ERP.repo.saveSettings(app.db, app.ctx.settings);
    return app.ctx.settings;
  };

  app.setMeta = async function setMeta(key, value) {
    await ERP.repo.setMeta(app.db, key, value);
    app.ctx.data[key] = value;
    return value;
  };

  app.toast = function (msg, type) {
    ui().toast(msg, type);
  };

  app.go = function (page, query) {
    router().go(page, query);
  };

  app.resetState = function (name) {
    delete app.pageStates[name];
  };

  /* ---------------- 渲染 ---------------- */

  function render() {
    if (!app.ready) return;
    // V3：未登录 → 只渲染登录页（不进入业务路由）
    if (!ERP.currentAccount) {
      renderLogin();
      return;
    }
    var page = router().current();
    if (!page) return;
    var state = stateOf(page);

    // 供页面读取当前登录账号（role 判断：如权限管理页仅管理员可见）
    if (app.ctx) app.ctx.currentAccount = ERP.currentAccount;

    renderNav(page);

    var html = '';
    try {
      html = page.render(app.ctx, state) || '';
    } catch (err) {
      html = '<div class="card"><div class="notice notice-danger">页面渲染出错：' +
        (err && err.message ? String(err.message) : String(err)) + '</div></div>';
      if (typeof console !== 'undefined') console.error(err);
    }
    html = decorateHtml(page, html);

    app.main.innerHTML = html;
    document.title = (ERP.branding ? ERP.branding.pageTitle(app.ctx.settings, page.title) : ((app.ctx.settings.shopName || '电器店') + ' · ' + (page.title || '')));
    applyFavicon();
    if (page.mount) {
      try {
        page.mount(app.ctx, app.main, state);
      } catch (err2) {
        if (typeof console !== 'undefined') console.error(err2);
      }
    }
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }

  /** 页面渲染结果是否已自带薄荷绿 banner（home/inventory/mine 已内置） */
  function hasBanner(html) {
    return /class="[^"]*page-banner/.test(html || '');
  }

  /** 手机端统一页头 banner：标题 + 可选右上角动作；桌面端由各页 page-head 负责 */
  function mobileBanner(page) {
    return '<div class="page-banner mobile-only page-banner-plain">' +
      '<div class="banner-title">' + (page.title || page.name || '') + '</div>' +
      '</div>';
  }

  /** 渲染前给手机端页面自动补齐薄荷绿 banner（除自带 banner 的页面外） */
  function decorateHtml(page, html) {
    if (hasBanner(html)) return html;
    return mobileBanner(page) + html;
  }

  app.hasBanner = hasBanner;
  app.mobileBanner = mobileBanner;
  app.decorateHtml = decorateHtml;

  app.render = render;

  /* ---------------- 实时输入判定（纯函数，可单测） ---------------- */

  /** 是否处于输入法组合中（中文/日文等）—— 组合中必须忽略 input 事件，否则会打断组字 */
  app._isComposing = function _isComposing(el, ev) {
    if (ev && ev.isComposing) return true;
    if (el && (el.isComposing || el.composing)) return true;
    return false;
  };

  /** 该输入是否为“实时预览”字段（data-live="1"）—— 是则重渲染并恢复焦点 */
  app._isLive = function _isLive(el) {
    return !!(el && el.getAttribute && el.getAttribute('data-live') === '1');
  };

  // 底部导航只保留最高频的三个入口；其余（开单/进货/商品/记账/报表/设置）统一收进「我的 → 常用入口」
  function navItems() {
    return [
      { name: 'home', icon: '📊', text: '首页' },
      { name: 'inventory', icon: '📋', text: '库存' },
      { name: 'mine', icon: '👤', text: '我的' }
    ];
  }
  app.navItems = navItems;

  // 电脑端侧栏导航顺序（用户指定）：首页→进货→销售→档案→库存→记账→报表→退换→供应商→客户→我的→账户权限
  function desktopNavOrder() {
    return ['home', 'purchase', 'sale', 'product', 'inventory', 'account', 'report', 'exchange', 'supplier', 'customer', 'mine', 'admin'];
  }
  app.desktopNavOrder = desktopNavOrder;

  /** 当前登录账户是否为管理总控（admin）——账户权限管理菜单仅管理总控可见 */
  function isAdmin() {
    var g = (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : null));
    var a = (g && g.ERP && g.ERP.currentAccount) || (app.ctx && app.ctx.currentAccount);
    return !!(a && (a.role === 'admin' || a.id === 'admin'));
  }
  app.isAdmin = isAdmin;

  // 电脑端侧栏折叠：切换 collapsed class + 记忆到 localStorage（收起后仅保留图标）
  function toggleSidebar() {
    var side = document.querySelector('.app-sidebar');
    if (!side) return;
    var collapsed = side.classList.toggle('collapsed');
    try {
      localStorage.setItem('applianceErp.sidebarCollapsed', collapsed ? '1' : '0');
    } catch (e) { /* ignore */ }
    var btn = document.querySelector('.side-toggle');
    if (btn) btn.innerHTML = collapsed ? '▶' : '◀';
  }
  app.toggleSidebar = toggleSidebar;

  function applySidebarState() {
    var side = document.querySelector('.app-sidebar');
    if (!side) return;
    var collapsed = false;
    try {
      collapsed = localStorage.getItem('applianceErp.sidebarCollapsed') === '1';
    } catch (e) { /* ignore */ }
    if (collapsed) side.classList.add('collapsed');
    var btn = document.querySelector('.side-toggle');
    if (btn) btn.innerHTML = collapsed ? '▶' : '◀';
  }
  app.applySidebarState = applySidebarState;

  function renderNav(page) {
    var bar = document.querySelector('.app-tabbar');
    var side = document.querySelector('.app-sidebar .nav-list');
    var inPrimary = navItems().some(function (n) {
      return n.name === page.name;
    });
    var active = inPrimary ? page.name : 'mine';

    if (bar) {
      bar.innerHTML = navItems()
        .map(function (n) {
          return '<button class="tab-item' + (n.name === active ? ' on' : '') + '" data-act="nav" data-page="' + n.name + '">' +
            '<span class="ico">' + n.icon + '</span><span>' + n.text + '</span></button>';
        })
        .join('');
    }
    if (side) {
      // 侧栏：按 desktopNavOrder 重排 + 支持 navTitle 自定义导航显示名
      var byName = {};
      router().all().forEach(function (p) { byName[p.name] = p; });
      side.innerHTML = desktopNavOrder()
        .map(function (n) { return byName[n]; })
        .filter(function (p) {
          if (!p || p.hideInNav) return false;
          // 账户权限管理菜单：仅管理总控可见（管理总控新建的普通账户无权限看到）
          if (p.name === 'admin' && !isAdmin()) return false;
          return true;
        })
        .map(function (p) {
          var label = p.navTitle || p.title || p.name;
          return '<button class="nav-item' + (p.name === page.name ? ' on' : '') + '" data-act="nav" data-page="' + p.name + '">' +
            '<span class="ico">' + (p.icon || '·') + '</span><span>' + label + '</span></button>';
        })
        .join('');
    }
    var brand = document.querySelector('.app-header .brand');
    var brandLogo = (ERP.branding ? ERP.branding.logoHref(app.ctx.settings) : ((app.ctx.settings.avatar) ? app.ctx.settings.avatar : 'assets/favicon.png'));
    if (brand) brand.innerHTML = '<img class="brand-logo" src="' + brandLogo + '" alt="">' + (app.ctx.settings.shopName || '我的电器店');
    var sbrand = document.querySelector('.app-sidebar .brand');
    if (sbrand) sbrand.innerHTML = '<img class="logo" src="' + brandLogo + '" alt="logo"> <span>' + (app.ctx.settings.shopName || '我的电器店') + '</span>';

    /* 电脑端顶栏（v2）：店名 + 铃铛红点（有低库存预警时亮） */
    var topShop = document.getElementById('top-shop-name');
    if (topShop) topShop.textContent = (ERP.branding ? ERP.branding.shopName(app.ctx.settings) : (app.ctx.settings.shopName || '我的电器店'));
    var bellDot = document.getElementById('top-bell-dot');
    if (bellDot) {
      var alertCount = 0;
      try {
        alertCount = (ERP.inventory && ERP.inventory.alertStyleCount
          ? ERP.inventory.alertStyleCount(app.ctx) : 0) || 0;
      } catch (e) { /* 库存引擎未就绪时忽略 */ }
      if (alertCount > 0) bellDot.classList.remove('hidden');
      else bellDot.classList.add('hidden');
    }
    applySidebarState();
  }

  /* 动态 favicon：跟随账号自定义头像（settings.avatar）；未设置则用电器版默认图标 */
  function applyFavicon() {
    if (typeof document === 'undefined') return;
    var settings = app.ctx && app.ctx.settings;
    var href = (ERP.branding ? ERP.branding.logoHref(settings) : ((settings && settings.avatar) || 'assets/favicon.png'));
    var links = document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]');
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (l.getAttribute('href') !== href) l.setAttribute('href', href);
    }
  }

  app.actions = {
    nav: function (ctx, state, el) {
      router().go(el.getAttribute('data-page'));
      return false;
    },
    'toggle-side': function (ctx, state, el) {
      toggleSidebar();
      return false;
    }
  };

  /* ---------------- 打开密码 ---------------- */

  function showLock() {
    var mask = document.createElement('div');
    mask.className = 'lock-mask';
    mask.id = 'lock-mask';
    mask.innerHTML =
      '<div class="card lock-card">' +
      '<img class="lock-logo" src="assets/favicon.png" alt="">' +
      '<h3 style="margin-bottom:8px">' + (app.ctx.settings.shopName || '我的电器店') + '</h3>' +
      '<p class="muted small mb8">请输入打开密码</p>' +
      '<input class="input" id="lock-pwd" type="password" inputmode="numeric" placeholder="打开密码" autocomplete="off">' +
      '<div id="lock-err" class="small" style="color:#dc2626;min-height:20px"></div>' +
      '<button class="btn btn-primary btn-block" id="lock-ok">进入</button>' +
      '</div>';
    document.body.appendChild(mask);
    var input = mask.querySelector('#lock-pwd');
    var err = mask.querySelector('#lock-err');
    function tryUnlock() {
      var v = input.value || '';
      if (ERP.util.verifyPassword(v, app.ctx.settings.lock.hash)) {
        document.body.removeChild(mask);
        enter();
      } else {
        err.textContent = '密码错误，请重试';
        input.value = '';
        input.focus();
      }
    }
    mask.querySelector('#lock-ok').addEventListener('click', tryUnlock);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') tryUnlock();
    });
    setTimeout(function () {
      input.focus();
    }, 60);
  }

  /* ---------------- 全局导出：下载文件 ---------------- */

  app.download = function (filename, content, mime) {
    var blob = new Blob([content], { type: (mime || 'application/json') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        app.boot().catch(function (err) {
          var el = document.getElementById('view');
          if (el) {
            el.innerHTML = '<div class="card"><div class="notice notice-danger">启动失败：' +
              (err && err.message ? err.message : err) + '</div></div>';
          }
          if (typeof console !== 'undefined') console.error(err);
        });
      });
    } else {
      app.boot();
    }
  }

  return app;
});
