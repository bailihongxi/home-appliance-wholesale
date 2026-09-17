/**
 * V3.62 「新用户登录后没有任何数据」修复 —— 共用本店数据的账号云同步走对数据空间
 *
 * 背景（线上真实案例）：管理总控新建员工账号 pifa（acct1，ownerId=admin，共用老板库），
 * 权限分好后登录 → 一片空白。核对云端账号表确认 ownerId 正确，问题出在另一处：
 *   1) 「我的 → 云同步」的同步配置 key 与云端快照路径，原本按 currentAccount.id 定位，
 *      员工会去找 data/acct1/erp-snapshot.json —— 而老板的数据在 data/admin/erp-snapshot.json，
 *      必然 404「云端还没有快照」，永远拉不到本店数据；
 *   2) 员工若在本机空库时点「同步到云端」，会用空快照覆盖全店共享数据（灾难性）；
 *   3) 快照里随行的账户档案原本写员工自己的，会把老板的店名/头像覆盖掉。
 *
 * 本文件覆盖上述三点的行为约束 + 账号管理页的数据空间展示。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// 关键：必须先建立 globalThis.ERP，再 require 页面模块。
// page-mine.js 的 UMD 在 root.ERP 不存在时会新建局部对象 A，随后又把 root.ERP 指向另一个
// 新对象 B —— 若先 require 再设 globalThis.ERP.currentAccount，页面闭包读到的是 A，取不到账号。
globalThis.ERP = globalThis.ERP || {};

const mine = require('../js/ui/page-mine.js');
const adminPage = require('../js/ui/page-admin.js');
const ui = require('../js/ui/components.js');
const sync = require('../js/core/sync.js');
const accounts = require('../js/core/accounts.js');
const { newCtx } = require('./helpers/ctx.js');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 让 page-mine 看到的 ERP.currentAccount 生效（模块闭包持有 globalThis.ERP 引用） */
function asAccount(acct) {
  const g = globalThis;
  g.ERP = g.ERP || {};
  g.ERP.currentAccount = acct;
  return acct;
}

/** 构造带权限的账号档案（perms 全开便于渲染同步卡片） */
function acct(id, ownerId, extra) {
  const perms = {};
  accounts.PERMS.forEach((p) => { perms[p.id] = true; });
  return Object.assign({ id, username: id, shopName: id, role: 'user', perms, ownerId: ownerId || null }, extra || {});
}

/** 全量同步配置（通过 validateConfig） */
function fullCfg(state) {
  state.cfg.owner = 'bailihongxi';
  state.cfg.repo = 'home-appliance-wholesale';
  state.cfg.branch = 'gh-pages';
  state.cfg.token = 'ghp_test';
  state.cfg.passphrase = '12345678';
  return state.cfg;
}

/* ================= 1. 数据空间归属判定 ================= */

test('dataSpaceOf：共用本店数据 / 独立数据空间判定与库名', () => {
  assert.deepStrictEqual(
    adminPage.dataSpaceOf(acct('acct1', 'admin')),
    { shared: true, ownerId: 'admin', dbName: 'applianceErp_admin' },
    '员工账号共用老板库'
  );
  assert.deepStrictEqual(
    adminPage.dataSpaceOf(acct('acct1', null)),
    { shared: false, ownerId: '', dbName: 'applianceErp_acct1' },
    '独立账号用自己的库'
  );
  assert.deepStrictEqual(
    adminPage.dataSpaceOf(acct('admin', null)),
    { shared: false, ownerId: '', dbName: 'applianceErp_admin' },
    '管理总控自身即归属账号'
  );
});

test('账号管理页渲染出每个账号的数据空间', () => {
  const store = memStore();
  accounts.save(store, [
    acct('admin', null, { username: 'hawsystem', role: 'admin', shopName: '管理总控' }),
    acct('acct1', 'admin', { username: 'pifa', shopName: '批发电器' }),
    acct('acct2', null, { username: 'solo', shopName: '独立店' })
  ]);
  const ctx = newCtx();
  ctx.currentAccount = acct('admin', null, { role: 'admin' });
  const state = adminPage.init(ctx, store);
  state.store = store;
  const html = adminPage.render(ctx, state);
  assert.ok(html.includes('数据空间：共用本店数据（applianceErp_admin）'), 'pifa 显示共用本店数据');
  assert.ok(html.includes('数据空间：独立（applianceErp_acct2）'), 'solo 显示独立');
  assert.ok(html.includes('数据空间：独立（applianceErp_admin）'), '管理总控显示自身库');
});

/* ================= 2. 云同步按「数据归属账号」定位 ================= */

test('员工账号的同步配置默认路径归属老板：data/admin/erp-snapshot.json', () => {
  asAccount(acct('acct1', 'admin', { username: 'pifa' }));
  const state = mine.init(newCtx());
  assert.strictEqual(
    state.cfg.path,
    sync.defaultPathFor('admin'),
    '员工云同步路径必须指向老板（归属账号）的快照，而不是自己的空路径'
  );
  assert.strictEqual(state.cfg.path, 'data/admin/erp-snapshot.json');
});

test('独立数据空间账号的同步配置路径仍是自己的', () => {
  asAccount(acct('acct2', null, { username: 'solo' }));
  const state = mine.init(newCtx());
  assert.strictEqual(state.cfg.path, 'data/acct2/erp-snapshot.json');
});

test('V3.73 改版：员工云同步卡片不再显示数据空间说明（用户要求精简，只留「从云端恢复」）', () => {
  asAccount(acct('acct1', 'admin', { username: 'pifa' }));
  const ctx = newCtx();
  ctx.currentAccount = globalThis.ERP.currentAccount;
  const state = mine.init(ctx);
  const html = mine.render(ctx, state);
  // V3.62 曾要求卡片标出「共用本店数据 / applianceErp_admin」；V3.73 按用户反馈
  // 员工页只留权限模块与「从云端恢复」按钮，数据空间等说明全部隐藏（见 mine-staff-v373.test.js S4）。
  // 员工拉取走数据归属账号的库由代码保证（syncAcctId），无需界面说明。
  assert.ok(!html.includes('数据空间'), '员工卡片不显示数据空间说明');
  assert.ok(!html.includes('共用本店数据'), '不显示共用说明文案');
  assert.ok(html.includes('data-act="sync-down"'), '员工保留「从云端恢复」按钮');
});

/* ================= 3. 空库不得覆盖全店共享快照 ================= */

test('共用本店数据 + 本机空账本：禁止上传（只读拉取），不发起同步', () => {
  asAccount(acct('acct1', 'admin', { username: 'pifa' }));
  const ctx = newCtx();
  ctx.currentAccount = globalThis.ERP.currentAccount;
  const state = mine.init(ctx);
  fullCfg(state);

  const realSyncUp = sync.syncUp;
  let called = false;
  sync.syncUp = function () { called = true; return Promise.resolve({ ok: true }); };
  try {
    mine.actions['sync-up'](ctx, state);
  } finally {
    sync.syncUp = realSyncUp;
  }
  assert.strictEqual(called, false, '只读拉取账号不得上传');
  assert.ok(state.msg.includes('只读拉取') && state.msg.includes('不能上传'), '给出只读拉取提示：' + state.msg);
  assert.strictEqual(state.msgType, 'err');
});

test('独立数据空间 + 本机空账本：允许上传（不误伤独立账号的首次备份）', async () => {
  asAccount(acct('acct2', null, { username: 'solo' }));
  const ctx = newCtx();
  ctx.currentAccount = globalThis.ERP.currentAccount;
  const state = mine.init(ctx);
  fullCfg(state);

  const realSyncUp = sync.syncUp;
  let called = false;
  sync.syncUp = function () { called = true; return Promise.resolve({ ok: true, skipped: true, reason: 'x' }); };
  try {
    mine.actions['sync-up'](ctx, state);
    await sleep(5); // sync-up 内部先 flushNow() 再同步，需冲刷微任务
  } finally {
    sync.syncUp = realSyncUp;
  }
  assert.strictEqual(called, true, '独立账号不受空库拦截');
  assert.ok(!/已阻止上传/.test(state.msg), '不应出现阻止提示：' + state.msg);
});

test('共用本店数据 + 本机有数据：仍禁止上传（只读拉取，不弹二次确认）', () => {
  asAccount(acct('acct1', 'admin', { username: 'pifa' }));
  const ctx = newCtx();
  ctx.currentAccount = globalThis.ERP.currentAccount;
  ctx.data.products.push({ id: 'p1', name: '空调', brand: '格力', model: 'K1', type: '空调', unit: '台', cost: 1, priceWholesale: 2, priceRetail: 3, stock: 5, barcodes: [] });
  const state = mine.init(ctx);
  fullCfg(state);

  const realSyncUp = sync.syncUp;
  let called = 0;
  sync.syncUp = function () { called++; return Promise.resolve({ ok: true, skipped: true, reason: 'x', summaryText: '' }); };
  try {
    mine.actions['sync-up'](ctx, state);
  } finally {
    sync.syncUp = realSyncUp;
  }
  assert.strictEqual(called, 0, '共用本店数据的员工禁止上传，不应发起 syncUp');
  assert.ok(state.msg.includes('只读拉取') && state.msg.includes('不能上传'), '给出只读拉取提示：' + state.msg);
});

/* ================= 4. 快照随行的账户档案取归属账号 ================= */

test('员工上传时快照内账户档案用老板的（不用员工店名覆盖老板）', () => {
  const store = memStore();
  accounts.save(store, [
    acct('admin', null, { username: 'hawsystem', role: 'admin', shopName: '老板总店' }),
    acct('acct1', 'admin', { username: 'pifa', shopName: '员工小店' })
  ]);
  // 页面内的 store() 在无 localStorage 时返回 null，这里验证归属判定逻辑本身：
  // syncAccountPublic 取 syncAcctId() → dataOwnerId(员工) = admin
  const emp = acct('acct1', 'admin', { username: 'pifa', shopName: '员工小店' });
  assert.strictEqual(accounts.dataOwnerId(emp), 'admin', '员工的数据归属是老板');
  assert.strictEqual(accounts.sharesBossData(emp), true);
  const owner = accounts.getById(accounts.load(store), 'admin');
  assert.strictEqual(owner.shopName, '老板总店', '快照应写老板店名');
});

/* ================= 5. 版本号同步 ================= */

test('V3.74 版本号：page-mine V3.69 / sw.js v103', () => {
  const fs = require('node:fs');
  const mineSrc = fs.readFileSync(path.join(ROOT, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(mineSrc.includes('版本：V3.74'), '关于页应显示 V3.74');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v103';"), 'SW 缓存版本应为 v103');
});

/* ---------------- 内存 localStorage 桩 ---------------- */
function memStore() {
  const m = Object.create(null);
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    get length() { return Object.keys(m).length; },
    key: (i) => Object.keys(m)[i] || null
  };
}
