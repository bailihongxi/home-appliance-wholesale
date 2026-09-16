const test = require('node:test');
const assert = require('node:assert');
const scan = require('../js/barcode/scan.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

function seed(ctx) {
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399',
    barcodes: '6901234567892\nABC200'
  });
  product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599',
    barcodes: '6923456789012'
  });
  return ctx;
}

test('scan.resolve：按原厂条码定位商品（大小写不敏感）', () => {
  const ctx = seed(newCtx());
  const r = scan.resolve(ctx, '6901234567892');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.product.brand, '海尔');
  const r2 = scan.resolve(ctx, 'abc200');
  assert.strictEqual(r2.found, true, '条码匹配大小写不敏感');
  assert.strictEqual(r2.product.model, 'BCD-200');
});

test('scan.resolve：按二维码内容匹配（多码之一）', () => {
  const ctx = seed(newCtx());
  const r = scan.resolve(ctx, '6923456789012');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.product.brand, '格力');
});

test('scan.resolve：手输 品牌+型号 定位', () => {
  const ctx = seed(newCtx());
  const r = scan.resolve(ctx, '格力 KFR-35');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.product.brand, '格力');
});

test('scan.resolve：单品牌/单型号唯一命中', () => {
  const ctx = seed(newCtx());
  const r = scan.resolve(ctx, 'BCD-200');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.product.model, 'BCD-200');
});

test('scan.resolve：未建档 → 找不到', () => {
  const ctx = seed(newCtx());
  const r = scan.resolve(ctx, 'ZZZ999');
  assert.strictEqual(r.found, false);
});

test('scan.resolve：空输入 / 歧义处理', () => {
  const ctx = seed(newCtx());
  assert.strictEqual(scan.resolve(ctx, '').found, false);
  assert.strictEqual(scan.resolve(ctx, '  ').found, false);
});

test('scan.card：单层商品卡数据（双价 + 库存 + 预警标记）', () => {
  const ctx = seed(newCtx({ defaultThreshold: 3 }));
  const p = ctx.getProductByCode('6901234567892');
  const c0 = scan.card(ctx, p.id);
  assert.ok(c0);
  assert.strictEqual(c0.totalStock, 0);
  assert.strictEqual(c0.allZero, true, '0 库存应标记');
  assert.strictEqual(c0.product.priceWholesale, 120000);
  assert.strictEqual(c0.product.priceRetail, 139900);

  // 补库存 5 → 不再 0 库存，也不低库存（>=3）
  p.stock = 5;
  const c = scan.card(ctx, p.id);
  assert.strictEqual(c.totalStock, 5);
  assert.strictEqual(c.allZero, false);
  assert.strictEqual(c.low, false);

  // 库存 2 → 低库存预警
  p.stock = 2;
  const c2 = scan.card(ctx, p.id);
  assert.strictEqual(c2.low, true, '低于默认阈值 3 应标记低库存');
});
