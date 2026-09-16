/**
 * core/accounts.js —— V3 多账号体系
 *
 * 设计：
 *  - 本地账号 + 密码（无服务器、离线可用）；密码只存哈希（util.hashPassword，不存明文）
 *  - 账号列表存 localStorage['applianceErp.accounts']（与鞋服母版隔离）；数据按账号独立（IndexedDB dbName = applianceErp_<acctId>）
 *  - 预置 3 个账号（经营范围：鞋 / 服装 / 配饰，初始密码 000000），允许自行创建账号，最多 10 个
 *  - store 抽象：浏览器传 localStorage 之类 {getItem,setItem}，Node 单测传内存 mock
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : (root.ERP && root.ERP.util);
  var mod = factory(util);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.accounts = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util) {
  'use strict';

  var ACCOUNTS_KEY = 'applianceErp.accounts';
  var MAX_ACCOUNTS = 10;
  var DEFAULT_PASSWORD = '000000';
  var ALL_CATEGORIES = ['冰箱', '洗衣机', '空调', '电视', '厨房电器', '生活小家电', '数码影音', '配件耗材', '其他'];

  /**
   * V3.59 权限分级：16 项权限，按「零售 / 批发 / 档案库存 / 资金管理」四组。
   * 全部手动分配（无角色模板）：管理总控（admin）固定全权限；其他账号默认全关，由管理总控逐个开通。
   */
  var PERM_GROUPS = [
    { id: 'retail', name: '零售' },
    { id: 'wholesale', name: '批发' },
    { id: 'archive', name: '档案 · 库存' },
    { id: 'finance', name: '资金 · 管理' }
  ];
  var PERMS = [
    { id: 'sale_bill',    group: 'retail',    label: '零售开单（前台销售、含扫描）' },
    { id: 'sale_pay',     group: 'retail',    label: '零售收款 / 找零 / 抹零' },
    { id: 'sale_return',  group: 'retail',    label: '零售退货 / 作废零售单' },
    { id: 'sale_price',   group: 'retail',    label: '零售改价 / 折扣' },
    { id: 'ws_bill',      group: 'wholesale', label: '批发开单（客户挂账 / 应收）' },
    { id: 'ws_pay',       group: 'wholesale', label: '批发收款 / 应收核销' },
    { id: 'ws_return',    group: 'wholesale', label: '批发退货 / 作废批发单' },
    { id: 'product_read', group: 'archive',   label: '商品档案（只读，隐藏成本/利润列）' },
    { id: 'stock_read',   group: 'archive',   label: '库存查询（只读）' },
    { id: 'purchase',     group: 'archive',   label: '进货入库 / 供应商' },
    { id: 'product_edit', group: 'archive',   label: '商品建档 / 改价 / 合并 / 删除' },
    { id: 'stock_adjust', group: 'archive',   label: '库存盘点 / 调整' },
    { id: 'ledger',       group: 'finance',   label: '记账中心（流水 / 记一笔）' },
    { id: 'report',       group: 'finance',   label: '报表与利润（含成本）' },
    { id: 'customer',     group: 'finance',   label: '客户管理' },
    { id: 'data_manage',  group: 'finance',   label: '数据管理（导入/导出/清空/备份/设置/同步）' }
  ];
  /** 全开权限对象（旧账号迁移默认值） */
  function allPerms() {
    var o = {};
    PERMS.forEach(function (p) { o[p.id] = true; });
    return o;
  }
  /** 页面 → 所需权限（任一即可进入；null = 无门槛）。admin 由 isAdmin 单独控制 */
  var PAGE_PERM = {
    purchase: ['purchase'],
    sale: ['sale_bill', 'ws_bill'],
    product: ['product_read', 'product_edit'],
    inventory: ['stock_read', 'stock_adjust'],
    account: ['ledger'],
    report: ['report'],
    exchange: ['sale_return', 'ws_return'],
    supplier: ['purchase'],
    customer: ['customer'],
    setting: ['data_manage'],
    admin: null
  };

  var api = {};

  api.ACCOUNTS_KEY = ACCOUNTS_KEY;
  api.MAX_ACCOUNTS = MAX_ACCOUNTS;
  api.DEFAULT_PASSWORD = DEFAULT_PASSWORD;
  api.ALL_CATEGORIES = ALL_CATEGORIES;
  api.PERM_GROUPS = PERM_GROUPS;
  api.PERMS = PERMS;
  api.PAGE_PERM = PAGE_PERM;

  /** 是否管理总控（全权限账号） */
  api.isAdmin = function isAdmin(a) {
    return !!(a && (a.role === 'admin' || a.id === 'admin'));
  };

  /** 权限校验：管理总控全权限；普通账号按手动分配的 perms */
  api.can = function can(acct, perm) {
    if (!acct) return false;
    if (api.isAdmin(acct)) return true;
    return !!(acct.perms && acct.perms[perm]);
  };

  /** 任一权限即通过（管理总控全权限） */
  api.canAny = function canAny(acct, perms) {
    if (api.isAdmin(acct)) return true;
    if (!perms || !perms.length) return false;
    for (var i = 0; i < perms.length; i++) {
      if (api.can(acct, perms[i])) return true;
    }
    return false;
  };

  /** 页面可见性（侧栏 / 快捷入口 / 路由守卫共用）；admin 页仅管理总控 */
  api.canView = function canView(acct, pageName) {
    if (pageName === 'admin') return api.isAdmin(acct);
    var need = PAGE_PERM[pageName];
    if (!need) return true; // 无门槛页面
    return api.canAny(acct, need);
  };

  /** 成本 / 利润可见性：管理总控或拥有「报表与利润」权限 */
  api.canViewCost = function canViewCost(acct) {
    return api.can(acct, 'report');
  };

  /**
   * V3.59 动作级拦截规则：页面 → [{ 动作名正则, 所需权限(任一) }]
   * 未命中规则的动作默认放行（只读/导航/个人操作，如改自己密码、勾选行、分页跳转）。
   * 库级操作（导入/导出全部/备份/清空/设置/同步）统一归 data_manage。
   */
  var ACTION_RULES = {
    sale: [
      { test: /^(do-return|do-refund|open-refund|close-refund|goto-return|void-sale|toggle-debt)$/, perm: ['sale_return', 'ws_return'] },
      { test: /(price|discount|gift)/, perm: ['sale_price'] },
      { test: /^(do-pay|open-pay|close-pay|quick-paid|do-settle|open-settle|close-settle|pay)$/, perm: ['sale_pay', 'ws_pay'] },
      { test: /^(collect|select-original|back-pick)$/, perm: ['ws_bill'] },
      { test: /^(add-item|save-sale|scan|scan-barcode|pick-product|toggle-price)$/, perm: ['sale_bill', 'ws_bill'] }
    ],
    purchase: [
      { test: /^(do-pay|open-pay|close-pay|quick-paid)$/, perm: ['ws_pay', 'purchase'] },
      { test: /^(void-purchase|update-purchase|save-purchase|open-new|add-item)$/, perm: ['purchase'] },
      { test: /^(export-csv|export-all)$/, perm: ['purchase'] },
      { test: /^(do-import|clear-data|download-template)$/, perm: ['data_manage'] }
    ],
    product: [
      { test: /^(save-product|edit-product|del-item|del-selected|merge-selected|apply-bulk-price|apply-price-sys|save-price-sys|toggle-price|export-csv)$/, perm: ['product_edit'] },
      { test: /^(do-import|export-all|download-template|clear-data)$/, perm: ['data_manage'] }
    ],
    inventory: [
      { test: /^(do-preview|save-take|retire-uncovered|clear-stock-products)$/, perm: ['stock_adjust'] },
      { test: /^(export-csv|export-all)$/, perm: ['stock_read'] },
      { test: /^clear-data$/, perm: ['data_manage'] }
    ],
    exchange: [
      { test: /^(do-exchange|do-return|do-refund|add-item)$/, perm: ['sale_return', 'ws_return'] }
    ],
    account: [
      { test: /^(save-manual|quick-paid|save-customer|toggle-log)$/, perm: ['ledger'] },
      { test: /^(export-csv|export-all)$/, perm: ['ledger'] },
      { test: /^clear-data$/, perm: ['data_manage'] }
    ],
    supplier: [
      { test: /^(save-supplier|edit-supplier|delete-supplier)$/, perm: ['purchase'] }
    ],
    customer: [
      { test: /^(save-customer|edit-customer|delete-customer)$/, perm: ['customer'] }
    ],
    report: [
      { test: /^(save-price-sys|apply-price-sys|export-csv|export-all)$/, perm: ['report'] }
    ],
    setting: [
      { test: /^(save-settings|save-shop|save-price-sys|apply-price-sys|clear-data|toggle-shop-edit)$/, perm: ['data_manage'] }
    ],
    mine: [
      { test: /^(sync-up|sync-down|save-sync-cfg|test-sync-conn|export-backup|clear-data)$/, perm: ['data_manage'] }
    ]
  };

  /** 动作级权限判定（页面 + 动作名 → 权限；admin 放行；未命中规则放行） */
  api.requireActionPerm = function requireActionPerm(acct, pageName, actName) {
    if (!acct || api.isAdmin(acct)) return true;
    var rules = ACTION_RULES[pageName];
    if (!rules || !rules.length) return true;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].test.test(actName)) return api.canAny(acct, rules[i].perm);
    }
    return true;
  };

  /** 数据归属账号 id：员工账号（ownerId）共用老板库；独立账号用自身 id */
  api.dataOwnerId = function dataOwnerId(acct) {
    return (acct && acct.ownerId) || (acct && acct.id) || '';
  };

  /** V3.59：是否共用老板本店数据（员工 ownerId 非空）——共用时 settings/店名/头像属于老板，不得用员工信息覆盖 */
  api.sharesBossData = function sharesBossData(acct) {
    return !!(acct && acct.ownerId);
  };

  /** 预置账号（电器版 V3.6+）：仅保留管理总控 admin，登录名 hawsystem（默认店铺账户已移除） */
  api.PRESET = [
    { id: 'admin', username: 'hawsystem', shopName: '管理总控', role: 'admin', scopeCategories: null, password: 'admina1b22c333' }
  ];

  /** 历史默认店铺账户（V3.6 前预置 acct1-3，按 id+登录名+店名三重匹配），迁移时清理，改由管理总控新建分配账户 */
  var LEGACY_SHOP = {
    acct1: { username: 'appliance', shopName: '大家电店' },
    acct2: { username: 'smallapp', shopName: '小家电店' },
    acct3: { username: 'kitchen', shopName: '厨电店' }
  };
  function isLegacyShop(a) {
    var spec = LEGACY_SHOP[a.id];
    return !!spec && a.username === spec.username && a.shopName === spec.shopName;
  }

  /** 生成新账号 id（自建账号：acct4 起递增，避开已存在 id） */
  api.nextId = function nextId(list) {
    var used = {};
    (list || []).forEach(function (a) { used[a.id] = true; });
    for (var i = 1; i <= MAX_ACCOUNTS + 1; i++) {
      var cand = 'acct' + i;
      if (!used[cand]) return cand;
    }
    return 'acct' + (Date.now().toString(36));
  };

  /** 读账号列表（不含密码哈希） */
  api.load = function load(store) {
    if (!store || !store.getItem) return [];
    var raw = null;
    try {
      raw = store.getItem(ACCOUNTS_KEY);
    } catch (e) {
      return [];
    }
    if (!raw) return [];
    try {
      var list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (e2) {
      return [];
    }
  };

  api.save = function save(store, list) {
    if (!store || !store.setItem) return false;
    try {
      store.setItem(ACCOUNTS_KEY, JSON.stringify(list || []));
      return true;
    } catch (e) {
      return false;
    }
  };

  api.getById = function getById(list, id) {
    return (list || []).find(function (a) { return a.id === id; }) || null;
  };

  api.findByUsername = function findByUsername(list, username) {
    var u = String(username || '').trim().toLowerCase();
    return (list || []).find(function (a) { return String(a.username).toLowerCase() === u; }) || null;
  };

  /** 校验密码：返回 true 表示通过 */
  api.verify = function verify(account, pwd) {
    return !!account && util.verifyPassword(pwd, account.hash);
  };

  /**
   * 确保预置账号存在。
   * - 首次初始化：仅写入管理总控 admin（登录名 hawsystem）；
   * - 迁移：清理历史默认店铺账户（acct1-3），并确保 admin 登录名为 hawsystem；
   * - 后续调用：仅确保「管理总控 admin」存在（系统级账号，删除后自动补回，登录名强制 hawsystem）；
   *   用户删除的普通账户不会被自动补回。
   */
  api.ensurePreset = function ensurePreset(store) {
    if (!store || !store.getItem) return [];
    var raw = null;
    try {
      raw = store.getItem(ACCOUNTS_KEY);
    } catch (e) {
      raw = null;
    }
    var list = api.load(store);
    var firstInit = (raw === null || raw === undefined || raw === '');
    var changed = false;
    var pushOne = function (p) {
      list.push({
        id: p.id,
        username: p.username,
        shopName: p.shopName,
        role: p.role || 'user',
        avatar: '',
        scopeCategories: p.scopeCategories ? p.scopeCategories.slice() : ALL_CATEGORIES.slice(),
        hash: util.hashPassword(p.password),
        createdAt: new Date().toISOString().slice(0, 10)
      });
      changed = true;
    };
    // V3.59 权限迁移：旧账号（无 perms 字段）默认补为全权限，避免突然锁死已有账号；管理总控可后续手动收紧。
    list.forEach(function (a) {
      if (a && a.perms === undefined) {
        a.perms = allPerms();
        changed = true;
      }
      if (a && a.ownerId === undefined) {
        a.ownerId = null; // 独立数据空间
        changed = true;
      }
    });
    if (firstInit) {
      api.PRESET.forEach(pushOne);
    }
    // 迁移/清理历史默认店铺账户（旧预置 acct1-3，三重匹配避免误删同 id 自建账户），仅保留管理总控
    var cleaned = list.filter(function (a) { return !isLegacyShop(a); });
    if (cleaned.length !== list.length) {
      list = cleaned;
      changed = true;
    }
    // 系统级管理员账号必须存在：缺失即补回；存在则登录名强制 hawsystem
    var admin = api.getById(list, 'admin');
    if (!admin) {
      pushOne(api.PRESET[0]);
    } else if (admin.username !== 'hawsystem') {
      admin.username = 'hawsystem';
      changed = true;
    }
    if (changed) api.save(store, list);
    return list;
  };

  /**
   * 创建账号（自行注册）。最多 MAX_ACCOUNTS 个。
   * @returns {object} {ok:boolean, error?:string, account?:object}
   */
  api.create = function create(store, input) {
    input = input || {};
    var username = String(input.username || '').trim();
    var pwd = String(input.password === undefined || input.password === null ? '' : input.password);
    var shopName = String(input.shopName || '').trim() || username;
    if (!username) return { ok: false, error: '请输入登录账号' };
    if (!/^[A-Za-z0-9_]{2,20}$/.test(username)) {
      return { ok: false, error: '登录账号需为 2-20 位字母/数字/下划线' };
    }
    if (pwd.length < 4) return { ok: false, error: '密码至少 4 位' };

    var list = api.load(store);
    if (list.length >= MAX_ACCOUNTS) {
      return { ok: false, error: '账号数量已达上限（最多 ' + MAX_ACCOUNTS + ' 个）' };
    }
    if (api.findByUsername(list, username)) {
      return { ok: false, error: '该登录账号已存在' };
    }
    // V3.59：新建账号默认全部权限关闭（perms={}），由管理总控手动逐项开通；
    // 数据空间：ownerId 存在（如 'admin'）= 员工共用老板库；不传 = 独立数据空间（兼容旧行为）。
    var perms = {};
    if (input.perms && typeof input.perms === 'object') {
      PERMS.forEach(function (p) {
        if (input.perms[p.id]) perms[p.id] = true;
      });
    }
    var account = {
      id: api.nextId(list),
      username: username,
      shopName: shopName,
      role: 'user', // 自建账号均为普通用户；管理员仅预置 admin
      avatar: typeof input.avatar === 'string' ? input.avatar : '',
      scopeCategories: input.scopeCategories && input.scopeCategories.length ? input.scopeCategories.slice() : ALL_CATEGORIES.slice(),
      perms: perms,
      ownerId: typeof input.ownerId === 'string' && input.ownerId ? input.ownerId : null,
      hash: util.hashPassword(pwd),
      createdAt: new Date().toISOString().slice(0, 10)
    };
    list.push(account);
    api.save(store, list);
    // 返回的 account 剥离 hash，避免明文/哈希外泄给界面
    return { ok: true, account: api.strip(account) };
  };

  /** 更新账号资料（店名/头像），供「我的」页保存 */
  api.updateProfile = function updateProfile(store, id, patch) {
    var list = api.load(store);
    var acct = api.getById(list, id);
    if (!acct) return { ok: false, error: '账号不存在' };
    patch = patch || {};
    if (typeof patch.shopName === 'string' && String(patch.shopName).trim()) {
      acct.shopName = String(patch.shopName).trim();
    }
    if (typeof patch.avatar === 'string') acct.avatar = patch.avatar;
    api.save(store, list);
    return { ok: true, account: api.strip(acct) };
  };

  /**
   * 更新账号（登录页「编辑账号」）。
   * patch 可选字段：username（唯一性校验）、password（留空/不传则不修改）、
   * shopName、avatar、scopeCategories。返回 {ok, error?, account?}。
   */
  api.update = function update(store, id, patch) {
    var list = api.load(store);
    var acct = api.getById(list, id);
    if (!acct) return { ok: false, error: '账号不存在' };
    patch = patch || {};

    // 登录账号：可选修改，格式 + 唯一性（排除自身）
    if (patch.username !== undefined && patch.username !== null) {
      var username = String(patch.username).trim();
      if (!username) return { ok: false, error: '请输入登录账号' };
      if (!/^[A-Za-z0-9_]{2,20}$/.test(username)) {
        return { ok: false, error: '登录账号需为 2-20 位字母/数字/下划线' };
      }
      var dup = api.findByUsername(list, username);
      if (dup && dup.id !== id) return { ok: false, error: '该登录账号已存在' };
      acct.username = username;
    }

    // 密码：可选修改（空串/不传 = 不改）
    if (patch.password !== undefined && patch.password !== null && String(patch.password) !== '') {
      var pwd = String(patch.password);
      if (pwd.length < 4) return { ok: false, error: '密码至少 4 位' };
      acct.hash = util.hashPassword(pwd);
    }

    if (typeof patch.shopName === 'string' && String(patch.shopName).trim()) {
      acct.shopName = String(patch.shopName).trim();
    }
    if (typeof patch.avatar === 'string') acct.avatar = patch.avatar;
    if (patch.scopeCategories !== undefined && Array.isArray(patch.scopeCategories)) {
      acct.scopeCategories = patch.scopeCategories.slice();
    }
    // V3.59：手动分配权限（perms 对象）与数据归属（ownerId）
    if (patch.perms !== undefined && patch.perms && typeof patch.perms === 'object') {
      var nextPerms = {};
      PERMS.forEach(function (p) {
        if (patch.perms[p.id]) nextPerms[p.id] = true;
      });
      acct.perms = nextPerms;
    }
    if (patch.ownerId !== undefined && patch.ownerId !== null) {
      acct.ownerId = String(patch.ownerId);
    } else if (patch.ownerId === null) {
      acct.ownerId = null;
    }
    api.save(store, list);
    return { ok: true, account: api.strip(acct) };
  };

  /**
   * 删除账号（登录页「删除账号」）。返回 {ok, error?, account?}。
   * 仅从账号列表移除；对应数据空间 erp_<id> 的清理由 app 层负责。
   */
  api.remove = function remove(store, id) {
    var list = api.load(store);
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return { ok: false, error: '账号不存在' };
    var removed = list[idx];
    list.splice(idx, 1);
    api.save(store, list);
    return { ok: true, account: api.strip(removed) };
  };

  /** 去掉敏感字段（hash）后的公开账号视图 */
  api.strip = function strip(a) {
    if (!a) return null;
    var out = {
      id: a.id,
      username: a.username,
      shopName: a.shopName,
      role: a.role || 'user',
      avatar: a.avatar || '',
      scopeCategories: (a.scopeCategories || []).slice(),
      perms: Object.assign({}, a.perms || {}),
      ownerId: a.ownerId || null,
      createdAt: a.createdAt || ''
    };
    return out;
  };

  /** 列表 → 公开视图（脱敏） */
  api.publicList = function publicList(list) {
    return (list || []).map(api.strip);
  };

  return api;
});
