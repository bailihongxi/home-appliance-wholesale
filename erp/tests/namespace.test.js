/**
 * tests/namespace.test.js —— 命名空间隔离（严重问题修复）
 * 背景：早期版本与鞋服母版《Shoes and clothing ERP》共用存储——
 *   localStorage：erp.accounts（账号列表）/ erp.currentAccount（登录态）
 *   IndexedDB：erp_<acctId>（库名与母版一致）
 * 导致两个系统登录窗/账号/数据互相串用。
 * 修复：本系统独立命名空间 applianceErp.* / applianceErp_<acctId>，并提供一次性迁移。
 */
const test = require('node:test');
const assert = require('node:assert');

function makeLocalStorage(seed) {
  const m = {};
  const ls = {
    getItem(k) { return k in m ? m[k] : null; },
    setItem(k, v) { m[k] = String(v); },
    removeItem(k) { delete m[k]; }
  };
  (seed || []).forEach(([k, v]) => ls.setItem(k, v));
  return { ls, dump: () => m };
}

const realDb = require('../js/store/db.js');

/** 每次调用重置 ERP 环境；memory 库按 name 缓存（模拟浏览器同名库共享） */
function bootApp(ls) {
  const cache = Object.create(null);
  const create = function (o) {
    if (!cache[o.name]) cache[o.name] = realDb.create({ backend: realDb.memoryBackend(), name: o.name });
    return cache[o.name];
  };
  globalThis.localStorage = ls;
  if (!globalThis.ERP) globalThis.ERP = {};
  globalThis.ERP.db = { create };
  globalThis.ERP.migrate = require('../js/core/legacy-migrate.js');
  globalThis.ERP.accounts = require('../js/core/accounts.js');
  require('../js/app.js');
  return { app: globalThis.ERP.app, create };
}

test('命名空间隔离：账号列表与登录态从 erp.* 迁移到 applianceErp.*', async () => {
  const { ls, dump } = makeLocalStorage([
    ['erp.accounts', JSON.stringify([{ id: 'acct1', username: 'appliance' }])],
    ['erp.currentAccount', JSON.stringify({ id: 'acct1', username: 'appliance' })]
  ]);
  const { app } = bootApp(ls);
  const r = await app.migrateNamespace();
  assert.ok(r.migrated, '迁移成功');
  assert.ok(dump()['applianceErp.accounts'], '账号列表已迁移到新 key');
  assert.strictEqual(JSON.parse(dump()['applianceErp.accounts']).length, 1);
  assert.ok(dump()['applianceErp.currentAccount'], '登录态已迁移到新 key');
  assert.strictEqual(dump()['applianceErp.migrated'], '1', '迁移标记已设置');
  assert.ok(dump()['erp.accounts'], '旧 key 保留（供母版继续使用）');
  // 幂等：再次调用不重复迁移
  const r2 = await app.migrateNamespace();
  assert.strictEqual(r2.migrated, false, '二次调用不再迁移');
});

test('命名空间隔离：数据库数据从 erp_<id> 复制到 applianceErp_<id>', async () => {
  const { ls, dump } = makeLocalStorage([
    ['erp.accounts', JSON.stringify([{ id: 'acct1', username: 'appliance' }])]
  ]);
  const { app, create } = bootApp(ls);
  // 预置旧库数据（模拟此前与母版共用的 erp_acct1 库）
  const oldDb = await create({ name: 'erp_acct1' });
  await oldDb.put('products', { id: 'p1', brand: '海尔', model: 'BCD-200' });
  const r = await app.migrateNamespace();
  assert.ok(r.migrated, '迁移成功');
  // 新库 applianceErp_acct1 应有复制后的数据
  const newDb = await create({ name: 'applianceErp_acct1' });
  const rows = await newDb.getAll('products');
  assert.strictEqual(rows.length, 1, '新库含迁移商品');
  assert.strictEqual(rows[0].model, 'BCD-200');
  assert.ok(dump()['applianceErp.migrated'] === '1');
  // 旧库数据仍在（不删除，避免影响母版）
  const oldRows = await oldDb.getAll('products');
  assert.strictEqual(oldRows.length, 1, '旧库保留');
});
