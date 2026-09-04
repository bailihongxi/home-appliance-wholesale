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

  var api = {};

  api.ACCOUNTS_KEY = ACCOUNTS_KEY;
  api.MAX_ACCOUNTS = MAX_ACCOUNTS;
  api.DEFAULT_PASSWORD = DEFAULT_PASSWORD;
  api.ALL_CATEGORIES = ALL_CATEGORIES;

  /** 预置账号（电器版 V3.6+）：仅保留管理总控 admin，登录名 hawystem（默认店铺账户已移除） */
  api.PRESET = [
    { id: 'admin', username: 'hawystem', shopName: '管理总控', role: 'admin', scopeCategories: null, password: 'admina1b22c333' }
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
   * - 首次初始化：仅写入管理总控 admin（登录名 hawystem）；
   * - 迁移：清理历史默认店铺账户（acct1-3），并确保 admin 登录名为 hawystem；
   * - 后续调用：仅确保「管理总控 admin」存在（系统级账号，删除后自动补回，登录名强制 hawystem）；
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
    if (firstInit) {
      api.PRESET.forEach(pushOne);
    }
    // 迁移/清理历史默认店铺账户（旧预置 acct1-3，三重匹配避免误删同 id 自建账户），仅保留管理总控
    var cleaned = list.filter(function (a) { return !isLegacyShop(a); });
    if (cleaned.length !== list.length) {
      list = cleaned;
      changed = true;
    }
    // 系统级管理员账号必须存在：缺失即补回；存在则登录名强制 hawystem
    var admin = api.getById(list, 'admin');
    if (!admin) {
      pushOne(api.PRESET[0]);
    } else if (admin.username !== 'hawystem') {
      admin.username = 'hawystem';
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
    // 自建账号默认全部分类开放（未分配经营范围，后续可由管理员收紧）
    var account = {
      id: api.nextId(list),
      username: username,
      shopName: shopName,
      role: 'user', // 自建账号均为普通用户；管理员仅预置 admin
      avatar: typeof input.avatar === 'string' ? input.avatar : '',
      scopeCategories: input.scopeCategories && input.scopeCategories.length ? input.scopeCategories.slice() : ALL_CATEGORIES.slice(),
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
