const test = require('node:test');
const assert = require('node:assert');
const schema = require('../js/core/schema.js');

test('默认设置：店名、阈值、经营范围空=不限制；不含鞋服版编码/标签设置', () => {
  const s = schema.defaultSettings();
  assert.strictEqual(s.shopName, '我的电器店');
  assert.strictEqual(s.defaultThreshold, 3);
  assert.deepStrictEqual(s.scopeCategories, []);
  assert.strictEqual(s.lock.enabled, false);
  assert.strictEqual(s.debtOverdueDays, 15);
  // 已移除鞋服版字段
  assert.strictEqual(s.categoryPrefix, undefined);
  assert.strictEqual(s.oneCodePerSku, undefined);
  assert.strictEqual(s.label, undefined);
  assert.strictEqual(s.print, undefined);
});

test('设置合并：缺字段补默认，自定义保留', () => {
  const merged = schema.mergeSettings({
    shopName: '大家电中心',
    defaultThreshold: 5,
    scopeCategories: ['冰箱', '空调']
  });
  assert.strictEqual(merged.shopName, '大家电中心');
  assert.strictEqual(merged.defaultThreshold, 5);
  assert.deepStrictEqual(merged.scopeCategories, ['冰箱', '空调']);
  assert.strictEqual(merged.lock.enabled, false);
  assert.deepStrictEqual(schema.mergeSettings(null), schema.defaultSettings());
});

test('空数据结构：包含全部数据表、schemaVersion=2、无 skus/printJobs', () => {
  const data = schema.emptyData();
  assert.strictEqual(data.schemaVersion, schema.VERSION);
  assert.strictEqual(schema.VERSION, 2);
  schema.DATA_STORES.forEach((name) => {
    assert.ok(Array.isArray(data[name]), name + ' 应为数组');
    assert.strictEqual(data[name].length, 0);
  });
  assert.ok(schema.DATA_STORES.includes('products'));
  assert.ok(schema.DATA_STORES.includes('sales'));
  assert.ok(!schema.DATA_STORES.includes('skus'), '不再有 skus 表');
  assert.ok(!schema.DATA_STORES.includes('printJobs'), '不再有 printJobs 表');
  assert.ok(!('skus' in data));
  assert.ok(!('printJobs' in data));
});

test('每个仓库都有主键定义；products 主键 id', () => {
  Object.keys(schema.STORES).forEach((name) => {
    assert.ok(schema.KEY_PATH[name], name + ' 缺少 keyPath');
  });
  assert.strictEqual(schema.KEY_PATH.products, 'id');
  assert.strictEqual(schema.KEY_PATH.sales, 'no');
  assert.strictEqual(schema.KEY_PATH.purchases, 'no');
});

test('商品类型字典为电器分类', () => {
  assert.ok(schema.CATEGORIES.includes('冰箱'));
  assert.ok(schema.CATEGORIES.includes('洗衣机'));
  assert.ok(schema.CATEGORIES.includes('空调'));
  assert.ok(schema.CATEGORIES.includes('电视'));
  assert.ok(schema.CATEGORIES.includes('厨房电器'));
  assert.ok(schema.CATEGORIES.includes('生活小家电'));
  assert.ok(schema.CATEGORIES.includes('数码影音'));
  assert.ok(schema.CATEGORIES.includes('配件耗材'));
  assert.ok(schema.CATEGORIES.includes('其他'));
  assert.ok(!schema.CATEGORIES.includes('鞋'));
  assert.ok(!schema.CATEGORIES.includes('服装'));
});

test('批发/零售双价格类型定义', () => {
  assert.strictEqual(schema.PRICE_TYPE.WHOLESALE, 'wholesale');
  assert.strictEqual(schema.PRICE_TYPE.RETAIL, 'retail');
  assert.strictEqual(schema.PRICE_TYPE_LABEL.wholesale, '批发');
  assert.strictEqual(schema.PRICE_TYPE_LABEL.retail, '零售');
});

test('多账号独立库名：erp_<acctId>', () => {
  assert.strictEqual(schema.dbNameFor('acct1'), 'erp_acct1');
  assert.strictEqual(schema.dbNameFor('acct2'), 'erp_acct2');
  assert.strictEqual(schema.dbNameFor(), 'erp');
  assert.strictEqual(schema.DB_NAME, 'erp');
});

test('经营范围过滤 categoriesFor / inScope（电器分类）', () => {
  assert.deepStrictEqual(schema.categoriesFor(null), schema.CATEGORIES);
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: [] }), schema.CATEGORIES);
  const appliance = { scopeCategories: ['冰箱', '洗衣机', '空调'] };
  assert.deepStrictEqual(schema.categoriesFor(appliance), ['冰箱', '洗衣机', '空调']);
  assert.strictEqual(schema.inScope(appliance, '冰箱'), true);
  assert.strictEqual(schema.inScope(appliance, '电视'), false);
  assert.strictEqual(schema.inScope({ scopeCategories: [] }, '电视'), true);
});

test('备份校验：结构缺失、非法对象、版本过高都要明确报错', () => {
  assert.strictEqual(schema.validateBackup(null).ok, false);
  assert.strictEqual(schema.validateBackup([]).ok, false);
  assert.strictEqual(schema.validateBackup({ a: 1 }).ok, false);
  assert.strictEqual(schema.validateBackup({ schemaVersion: 99 }).ok, false, '版本过高应拒绝');

  const ok = schema.emptyData();
  assert.strictEqual(schema.validateBackup(ok).ok, true);
});

test('migrate：v1 鞋服版备份明确拒绝（不兼容），v2 备份直接通过', () => {
  // v1 鞋服版结构含 skus
  const v1 = schema.emptyData();
  v1.schemaVersion = 1;
  v1.skus = [];
  v1.printJobs = [];
  const r1 = schema.migrate(v1);
  assert.strictEqual(r1.ok, false, 'v1 鞋服版备份应拒绝迁移');
  assert.ok(r1.error.includes('不兼容') || r1.error.includes('旧版'), '应提示不兼容');

  const v2 = schema.emptyData();
  const r2 = schema.migrate(v2);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.to, schema.VERSION);
});
