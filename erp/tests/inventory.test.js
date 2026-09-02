const test = require('node:test');
const assert = require('node:assert');
const inv = require('../js/core/inventory.js');
const { newCtx } = require('./helpers/ctx.js');

/** 建一台商品（海尔 BCD-200 冰箱，成本 1000 元） */
function seed(ctx) {
  const product = require('../js/core/product.js');
  const r = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  return r.product;
}

test('changeStock：+3 → 库存 3，写流水留痕；不足出库被拒', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  assert.strictEqual(p.stock, 0);

  const r1 = inv.changeStock(ctx, p.id, 3, 'purchase', 'P1', '2026-09-01');
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(p.stock, 3);
  assert.strictEqual(r1.log.delta, 3);
  assert.strictEqual(r1.log.balance, 3);
  assert.strictEqual(ctx.data.stockLogs.length, 1);

  const r2 = inv.changeStock(ctx, p.id, -5, 'sale', 'S1', '2026-09-01');
  assert.strictEqual(r2.ok, false, '库存不足应被拒');
  assert.ok(r2.error.includes('库存不足'));
  assert.strictEqual(p.stock, 3, '被拒后库存不变');
});

test('changeStock：重复增减、流水按时间记录', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  inv.changeStock(ctx, p.id, 5, 'purchase', 'P1', '2026-09-01');
  inv.changeStock(ctx, p.id, -2, 'sale', 'S1', '2026-09-02');
  assert.strictEqual(p.stock, 3);
  assert.strictEqual(ctx.data.stockLogs.length, 2);
  assert.strictEqual(ctx.data.stockLogs[1].balance, 3);
});

test('getAlerts：低于阈值（默认 3）预警，onlyEmpty 只看零库存', () => {
  const ctx = newCtx({ defaultThreshold: 3 });
  const p = seed(ctx);
  inv.changeStock(ctx, p.id, 2, 'purchase', 'P1', '2026-09-01'); // 库存 2 < 3
  const alerts = inv.getAlerts(ctx);
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].productId, p.id);
  assert.strictEqual(alerts[0].stock, 2);

  // 零库存也算预警
  const ctx2 = newCtx();
  const p2 = seed(ctx2); // 库存 0
  assert.strictEqual(inv.alertStyleCount(ctx2), 1);
  assert.strictEqual(inv.getAlerts(ctx2, { onlyEmpty: true }).length, 1);
});

test('stockValue：库存资金占用 = 库存 × 档案成本', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  inv.changeStock(ctx, p.id, 4, 'purchase', 'P1', '2026-09-01');
  assert.strictEqual(inv.stockValue(ctx), 4 * 100000);
});

test('applyStocktake：差异调整并写盘点单与流水', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  inv.changeStock(ctx, p.id, 5, 'purchase', 'P1', '2026-09-01'); // 账面 5
  const res = inv.applyStocktake(ctx, {
    date: '2026-09-02',
    counts: (function () { var c = {}; c[p.id] = 7; return c; })(),
    note: '季度盘点'
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(p.stock, 7, '库存更新到实盘数');
  assert.strictEqual(res.doc.diffQty, 2);
  assert.strictEqual(res.doc.diffCount, 1);
  assert.strictEqual(ctx.data.stocktakes.length, 1);
  assert.strictEqual(ctx.data.stockLogs.length, 2);
});

test('applyStocktake：实盘数非法（负数/非数字）拒绝且不改库存', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  inv.changeStock(ctx, p.id, 5, 'purchase', 'P1', '2026-09-01');
  const bad = inv.applyStocktake(ctx, {
    date: '2026-09-02',
    counts: (function () { var c = {}; c[p.id] = -1; return c; })()
  });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(p.stock, 5);
});

test('logsOfProduct：按商品取流水，倒序', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  inv.changeStock(ctx, p.id, 3, 'purchase', 'P1', '2026-09-01');
  inv.changeStock(ctx, p.id, -1, 'sale', 'S1', '2026-09-02');
  const logs = inv.logsOfProduct(ctx, p.id);
  assert.strictEqual(logs.length, 2);
  assert.strictEqual(logs[0].date, '2026-09-02', '倒序');
  assert.strictEqual(logs[0].refNo, 'S1');
});
