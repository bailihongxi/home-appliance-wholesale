/**
 * V3-阶段2：多账号数据隔离（电器版）
 * - 每账号独立 IndexedDB 库名（schema.dbNameFor → erp_<acctId>）
 * - 账号1 库与账号2 库数据互不可见
 * - settings 新增字段（scopeCategories/avatar）经 mergeSettings 保留
 */
const test = require('node:test');
const assert = require('node:assert');
const db = require('../js/store/db.js');
const schema = require('../js/core/schema.js');

async function newDb(name) {
  return db.create({ backend: db.memoryBackend(), name: name });
}

test('schema.dbNameFor：每账号独立库名，使用 applianceErp_ 前缀与鞋服母版（erp_/shoeErp_）隔离', () => {
  assert.strictEqual(schema.dbNameFor('acct1'), 'applianceErp_acct1');
  assert.strictEqual(schema.dbNameFor('acct2'), 'applianceErp_acct2');
  assert.strictEqual(schema.dbNameFor('acct3'), 'applianceErp_acct3');
  assert.strictEqual(schema.dbNameFor(''), 'applianceErp');
  assert.strictEqual(schema.dbNameFor(null), 'applianceErp');
  assert.strictEqual(schema.dbNameFor(undefined), 'applianceErp');
  assert.strictEqual(schema.dbNameFor('shop'), 'applianceErp_shop');
  assert.ok(!schema.dbNameFor('acct1').startsWith('erp_'), '不与鞋服版 erp_ 前缀共用');
  assert.ok(schema.dbNameFor('acct1').startsWith('applianceErp_'), '使用本系统独立前缀');
  assert.ok(schema.dbNameFor('acct1') !== schema.dbNameFor('acct2'), '不同账号库名不同');
});

test('数据隔离：账号1 与账号2 独立库互不可见', async () => {
  const d1 = await newDb(schema.dbNameFor('acct1'));
  const d2 = await newDb(schema.dbNameFor('acct2'));
  await d1.put('products', { id: 'p1', brand: '海尔', model: 'BCD-200' });
  await d1.put('meta', { key: 'settings', value: { shopName: '大家电店' } });

  assert.strictEqual(await d2.count('products'), 0, '账号2 看不到账号1 的商品');
  assert.strictEqual(await d2.get('products', 'p1'), null);
  assert.strictEqual(await d2.get('meta', 'settings'), null);

  assert.strictEqual(await d1.count('products'), 1);
  const p = await d1.get('products', 'p1');
  assert.strictEqual(p.brand, '海尔');
  const s = await d1.get('meta', 'settings');
  assert.strictEqual(s.value.shopName, '大家电店');
});

test('数据隔离：账号1 与账号2 各自 settings（店名/经营范围）互不串扰', async () => {
  const d1 = await newDb(schema.dbNameFor('acct1'));
  const d2 = await newDb(schema.dbNameFor('acct3'));
  await d1.put('meta', { key: 'settings', value: { shopName: '大家电A', scopeCategories: ['冰箱', '空调'] } });
  await d2.put('meta', { key: 'settings', value: { shopName: '厨电C', scopeCategories: ['厨房电器'] } });

  const s1 = (await d1.get('meta', 'settings')).value;
  const s2 = (await d2.get('meta', 'settings')).value;
  assert.strictEqual(s1.shopName, '大家电A');
  assert.deepStrictEqual(s1.scopeCategories, ['冰箱', '空调']);
  assert.strictEqual(s2.shopName, '厨电C');
  assert.deepStrictEqual(s2.scopeCategories, ['厨房电器']);
  assert.notDeepStrictEqual(s1.scopeCategories, s2.scopeCategories);
});

test('settings 新增字段：mergeSettings 保留 scopeCategories / avatar', () => {
  const s = schema.mergeSettings({ shopName: '我的电器店', scopeCategories: ['冰箱', '洗衣机'], avatar: 'data:image/png;base64,xx' });
  assert.strictEqual(s.shopName, '我的电器店');
  assert.deepStrictEqual(s.scopeCategories, ['冰箱', '洗衣机']);
  assert.strictEqual(s.avatar, 'data:image/png;base64,xx');

  const def = schema.mergeSettings(null);
  assert.deepStrictEqual(def.scopeCategories, []);
  assert.strictEqual(def.avatar, '');
});
