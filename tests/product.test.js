const test = require('node:test');
const assert = require('node:assert');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

test('nextId：自增生成 p1、p2…', () => {
  const ctx = newCtx();
  assert.strictEqual(product.nextId(ctx), 'p1');
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  assert.strictEqual(product.nextId(ctx), 'p2');
});

test('新建商品：字段完整、金额转「分」、库存 0、默认在售', () => {
  const ctx = newCtx();
  const r = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399', note: '风冷'
  });
  assert.strictEqual(r.ok, true);
  const p = r.product;
  assert.strictEqual(p.id, 'p1');
  assert.strictEqual(p.brand, '海尔');
  assert.strictEqual(p.model, 'BCD-200');
  assert.strictEqual(p.category, '冰箱');
  assert.strictEqual(p.unit, '台');
  assert.strictEqual(p.cost, 100000);
  assert.strictEqual(p.priceWholesale, 120000);
  assert.strictEqual(p.priceRetail, 139900);
  assert.strictEqual(p.stock, 0);
  assert.strictEqual(p.status, 'on');
  assert.deepStrictEqual(p.barcodes, []);
});

test('必填校验：品牌/型号/类型缺失都拒绝', () => {
  const ctx = newCtx();
  assert.strictEqual(product.save(ctx, { model: 'X', category: '冰箱' }).ok, false);
  assert.strictEqual(product.save(ctx, { brand: '海尔', category: '冰箱' }).ok, false);
  assert.strictEqual(product.save(ctx, { brand: '海尔', model: 'X' }).ok, false);
  assert.strictEqual(product.save(ctx, { brand: '海尔', model: 'X', category: '冰箱' }).ok, true);
});

test('查重：品牌+型号 重复拦截；不同品牌可同型号', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  const dup = product.save(ctx, { brand: '海尔', model: 'bcd-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  assert.strictEqual(dup.ok, false, '大小写不敏感查重');
  const otherBrand = product.save(ctx, { brand: '美的', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  assert.strictEqual(otherBrand.ok, true, '不同品牌可同型号');
});

test('编辑商品：更新价格/备注，id 不变', () => {
  const ctx = newCtx();
  const { product: p } = product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  const r = product.save(ctx, { id: p.id, brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1100', priceWholesale: '1300', priceRetail: '1499', note: '一级能效' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.product.id, 'p1');
  assert.strictEqual(r.product.cost, 110000);
  assert.strictEqual(r.product.priceRetail, 149900);
  assert.strictEqual(ctx.data.products.length, 1, '编辑不应新增记录');
});

test('原厂条码归一化：逗号/换行分隔、大写、去重、去空白', () => {
  const ctx = newCtx();
  const r = product.save(ctx, {
    brand: '美的', model: 'KFR-35', category: '空调', unit: '台', cost: '2000', priceWholesale: '2400', priceRetail: '2799',
    barcodes: '6901234567892\n6922233445566,6901234567892; abc123'
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.product.barcodes, ['6901234567892', '6922233445566', 'ABC123']);
});

test('期初库存：建档填期初数 → 库存写入并生成盘点单（D2 已确认）', () => {
  const ctx = newCtx();
  const r = product.save(ctx, {
    brand: '格力', model: 'KFR-26', category: '空调', unit: '台', cost: '1800', priceWholesale: '2200', priceRetail: '2599',
    openingStock: 10
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.product.stock, 10, '期初库存生效');
  assert.strictEqual(ctx.data.stocktakes.length, 1, '生成一条盘点单');
  const st = ctx.data.stocktakes[0];
  assert.strictEqual(st.items[0].realQty, 10);
  assert.strictEqual(ctx.data.stockLogs.length, 1);
  assert.strictEqual(ctx.data.stockLogs[0].balance, 10);
});

test('displayName / search', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399', note: '一级能效' });
  product.save(ctx, { brand: '美的', model: 'KFR-35', category: '空调', unit: '台', cost: '2000', priceWholesale: '2400', priceRetail: '2799' });
  const p1 = ctx.data.products[0];
  assert.strictEqual(product.displayName(p1), '海尔 BCD-200');
  assert.strictEqual(product.search(ctx, '海尔').length, 1);
  assert.strictEqual(product.search(ctx, 'KFR').length, 1);
  assert.strictEqual(product.search(ctx, '能效').length, 1);
  assert.strictEqual(product.search(ctx, '不存在').length, 0);
});

test('setStatus：停售/恢复在售', () => {
  const ctx = newCtx();
  const { product: p } = product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  product.setStatus(ctx, p.id, 'off');
  assert.strictEqual(ctx.data.products[0].status, 'off');
  product.setStatus(ctx, p.id, 'on');
  assert.strictEqual(ctx.data.products[0].status, 'on');
});
