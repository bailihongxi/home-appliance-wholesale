/**
 * tests/backup.test.js —— 备份导出 / 校验 / 恢复（电器版）
 */
const test = require('node:test');
const assert = require('node:assert');

const schema = require('../js/core/schema.js');
const repo = require('../js/store/repo.js');
const backup = require('../js/core/backup.js');

function newCtx(settings) {
  const data = schema.emptyData();
  data.settings = schema.mergeSettings(settings || {});
  return repo.createContext(data);
}

function seed(ctx) {
  ctx.data.products.push({
    id: 'p1', brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: 100000, priceWholesale: 120000, priceRetail: 139900, stock: 3,
    note: '', barcodes: ['6901234567892'], status: 'on'
  });
  ctx.data.partners.push({ id: 'cus_1', name: '王老板', type: 'customer', balance: 20000 });
  ctx.touch('products', ctx.data.products[0]);
  ctx.touch('partners', ctx.data.partners[0]);
}

test('build：导出结构含全部仓库 + schemaVersion=2 + 时间 + 摘要计数', () => {
  const ctx = newCtx();
  seed(ctx);
  const b = backup.build(ctx);
  assert.strictEqual(b.app, 'appliance-erp');
  assert.strictEqual(b.schemaVersion, schema.VERSION);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(b.exportedAt), 'exportedAt 应为 ISO');
  assert.strictEqual(b.summary.products, 1);
  assert.strictEqual(b.summary.partners, 1);
  assert.strictEqual(b.summary.skus, undefined, '不再有 skus 摘要');
  schema.DATA_STORES.forEach((n) => {
    assert.ok(Array.isArray(b[n]), n + ' 应为数组');
  });
});

test('导出→清空→恢复：数据一致', () => {
  const ctx = newCtx();
  seed(ctx);
  const json = JSON.stringify(backup.build(ctx));

  const fresh = newCtx();
  assert.strictEqual(fresh.data.products.length, 0);
  const r = backup.restore(fresh, json);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fresh.data.products.length, 1);
  assert.strictEqual(fresh.data.products[0].id, 'p1');
  assert.strictEqual(fresh.data.products[0].brand, '海尔');
  assert.deepStrictEqual(fresh.data.products[0].barcodes, ['6901234567892']);
  assert.strictEqual(fresh.data.partners[0].balance, 20000);
});

test('validate：损坏的 JSON 报错且不破坏现有数据', () => {
  const ctx = newCtx();
  seed(ctx);
  const before = ctx.data.products.length;
  const r = backup.restore(ctx, '{这不是合法json');
  assert.strictEqual(r.ok, false);
  assert.ok(/JSON/.test(r.error), '应提示 JSON 错误');
  assert.strictEqual(ctx.data.products.length, before, '现有数据不应被修改');
});

test('validate：结构不完整（缺仓库）报错', () => {
  const bad = { schemaVersion: schema.VERSION, products: [] }; // 缺其余仓库
  const r = backup.validate(bad);
  assert.strictEqual(r.ok, false);
});

test('restore：高版本 schema 被拦截', () => {
  const ctx = newCtx();
  const high = backup.build(ctx);
  high.schemaVersion = 999;
  const r = backup.restore(ctx, JSON.stringify(high));
  assert.strictEqual(r.ok, false);
  assert.ok(/版本/.test(r.error), '应提示版本过高');
});

test('restore：对象形式同样可恢复', () => {
  const ctx = newCtx();
  seed(ctx);
  const obj = backup.build(ctx);
  const r = backup.restore(newCtx(), obj);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.summary.products, 1);
});

test('restore：旧版（鞋服版 v1）备份明确拒绝', () => {
  const v1 = schema.emptyData();
  v1.schemaVersion = 1;
  v1.skus = [];
  v1.printJobs = [];
  const r = backup.restore(newCtx(), JSON.stringify(v1));
  assert.strictEqual(r.ok, false);
  assert.ok(/不兼容|旧版/.test(r.error), '应提示不兼容');
});

test('fileName：以店名 + 时间戳命名', () => {
  const ctx = newCtx({ shopName: '我的电器店' });
  const fn = backup.fileName(ctx);
  assert.ok(/^我的电器店_\d{8}_\d{4}\.json$/.test(fn), '文件名格式 ' + fn);
});
