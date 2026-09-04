const test = require('node:test');
const assert = require('node:assert');
const profit = require('../js/core/profit.js');
const ledger = require('../js/core/ledger.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

/**
 * 构造 PRD 10.2 固定数据（电器版）：
 *   成本 1000、售价 1399、卖 10 台、赠 1 台、费用 5000 元
 * 期望：销售收入 13990、销售成本 10000、毛利 3990、赠送成本 1000、净利参考 -2010
 */
function buildFixed(ctx) {
  const { product: p } = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  ctx.data.sales.push({
    no: 'S1', date: '2026-09-01', type: 'sale', partnerId: null, partnerName: '',
    items: [
      { productId: p.id, brand: '海尔', model: 'BCD-200', qty: 10, price: 139900, costSnapshot: 100000, type: 'sale', giftReason: null },
      { productId: p.id, brand: '海尔', model: 'BCD-200', qty: 1, price: 0, costSnapshot: 100000, type: 'gift', giftReason: '赠品' }
    ],
    discount: 0, payable: 1399000, received: 1399000, debt: 0, payments: [{ method: 'cash', amount: 1399000 }],
    note: '', voided: false, createdAt: '2026-09-01T10:00:00'
  });
  ledger.manual(ctx, { date: '2026-09-01', category: '其他', direction: 'out', amount: '5000' });
}

test('PRD 10.2 固定数据：三层利润口径', () => {
  const ctx = newCtx();
  buildFixed(ctx);
  const s = profit.summary(ctx);
  assert.strictEqual(s.revenue, 1399000, '销售收入 13990 元');
  assert.strictEqual(s.saleCost, 1000000, '销售成本 10000 元（仅销售行，不含赠送）');
  assert.strictEqual(s.grossProfit, 399000, '毛利 3990 元');
  assert.ok(Math.abs(s.grossMargin - 3990 / 13990) < 1e-9, '毛利率 = 毛利/收入');
  assert.strictEqual(s.giftCost, 100000, '赠送成本 1000 元');
  assert.strictEqual(s.expense, 500000, '费用支出 5000 元');
  assert.strictEqual(s.netProfit, -201000, '净利参考 -2010 元');
});

test('PRD 10.2：改进价后历史报表数字不变（成本快照生效）', () => {
  const ctx = newCtx();
  buildFixed(ctx);
  const before = profit.summary(ctx);
  // 改商品档案成本，不影响已存销售单的 costSnapshot
  ctx.data.products[0].cost = 200000;
  const after = profit.summary(ctx);
  assert.strictEqual(after.revenue, before.revenue, '收入不变');
  assert.strictEqual(after.saleCost, before.saleCost, '销售成本不变（用快照）');
  assert.strictEqual(after.grossProfit, before.grossProfit, '毛利不变');
  assert.strictEqual(after.netProfit, before.netProfit, '净利不变');
});

test('退货冲减销售收入与成本', () => {
  const ctx = newCtx();
  const { product: p } = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  ctx.data.sales.push({
    no: 'S1', date: '2026-09-01', type: 'sale', items: [
      { productId: p.id, qty: 2, price: 139900, costSnapshot: 100000, type: 'sale' }
    ],
    discount: 0, payable: 279800, received: 279800, debt: 0, voided: false
  });
  let s = profit.summary(ctx);
  assert.strictEqual(s.revenue, 279800);
  assert.strictEqual(s.saleCost, 200000);
  // 退 1 台
  ctx.data.sales.push({
    no: 'S2', date: '2026-09-02', type: 'refund', refNo: 'S1', items: [
      { productId: p.id, qty: 1, price: 139900, costSnapshot: 100000, type: 'sale' }
    ],
    discount: 0, payable: 139900, received: 0, debt: 0, voided: false
  });
  s = profit.summary(ctx);
  assert.strictEqual(s.revenue, 139900, '退货后收入减半');
  assert.strictEqual(s.saleCost, 100000, '退货后成本减半');
});

test('作废销售单不计入利润', () => {
  const ctx = newCtx();
  const { product: p } = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  ctx.data.sales.push({
    no: 'S1', date: '2026-09-01', type: 'sale', items: [
      { productId: p.id, qty: 1, price: 139900, costSnapshot: 100000, type: 'sale' }
    ],
    discount: 0, payable: 139900, received: 139900, debt: 0, voided: true
  });
  const s = profit.summary(ctx);
  assert.strictEqual(s.revenue, 0, '作废单不计收入');
  assert.strictEqual(s.saleCost, 0);
});

test('topProducts：按商品聚合销量与毛利', () => {
  const ctx = newCtx();
  const { product: a } = product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  const { product: b } = product.save(ctx, { brand: '格力', model: 'KFR-35', category: '空调', unit: '台', cost: '1800', priceWholesale: '2200', priceRetail: '2599' });
  ctx.data.sales.push({
    no: 'S1', date: '2026-09-01', type: 'sale',
    items: [
      { productId: a.id, qty: 3, price: 139900, costSnapshot: 100000, type: 'sale' },
      { productId: b.id, qty: 2, price: 259900, costSnapshot: 180000, type: 'sale' }
    ],
    discount: 0, payable: 0, received: 0, debt: 0, voided: false
  });
  const top = profit.topProducts(ctx, { by: 'profit', n: 2 });
  assert.strictEqual(top.length, 2);
  // 冰箱毛利 3×(1399-1000)=1197；空调 2×(2599-1800)=1598 → 空调第一
  assert.strictEqual(top[0].productId, b.id);
  assert.strictEqual(top[0].grossProfit, 159800);
  assert.strictEqual(top[0].brand, '格力');
  assert.strictEqual(top[1].grossProfit, 119700);
});

test('stockValue：库存资金占用', () => {
  const ctx = newCtx();
  const { product: a } = product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  a.stock = 5;
  const { product: b } = product.save(ctx, { brand: '格力', model: 'KFR-35', category: '空调', unit: '台', cost: '1800', priceWholesale: '2200', priceRetail: '2599' });
  b.stock = 2;
  assert.strictEqual(profit.stockValue(ctx), 5 * 100000 + 2 * 180000);
});

test('monthly：按月汇总利润', () => {
  const ctx = newCtx();
  buildFixed(ctx);
  const m = profit.monthly(ctx);
  assert.ok(Array.isArray(m));
  const row = m.find((r) => r.month === '2026-09');
  assert.ok(row, '应有 2026-09 汇总');
  assert.strictEqual(row.revenue, 1399000);
});
