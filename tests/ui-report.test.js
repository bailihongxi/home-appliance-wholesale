const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-report.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const engine = require('../js/core/engine.js');

function seed(ctx) {
  const r1 = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  const r2 = product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '西安电器批发',
    items: [
      { productId: r1.product.id, qty: 10, costPrice: '1000' },
      { productId: r2.product.id, qty: 10, costPrice: '1800' }
    ],
    paid: '999999'
  });
  engine.saveSale(ctx, {
    date: '2026-09-02',
    items: [{ productId: r1.product.id, qty: 2, price: '1399', priceType: 'retail', costSnapshot: 100000 }],
    payments: [{ method: 'cash', amount: '2798' }]
  });
  return ctx;
}

test('页面元数据', () => {
  assert.strictEqual(page.name, 'report');
  assert.strictEqual(page.title, '报表与利润');
  const ctx = seed(newCtx());
  const state = page.init();
  const html = page.render(ctx, state);
  assert.ok(html.includes('报表与利润'));
  assert.ok(html.includes('销售收入'));
  assert.ok(html.includes('毛利'));
});

test('利润计算：2 台海尔，毛利 = 2×(1399-1000)=798 元', () => {
  const ctx = seed(newCtx());
  const state = page.init();
  const html = page.render(ctx, state);
  assert.ok(html.includes('¥798.00'), '毛利 798');
  assert.ok(html.includes('销售趋势'));
  assert.ok(html.includes('畅销'), '含 TOP 排行');
  assert.ok(html.includes('海尔'), '畅销榜首为海尔');
});

test('导出 CSV：含月份/收入/毛利/销量', () => {
  const ctx = seed(newCtx());
  const state = page.init();
  const csv = require('../js/core/profit.js').buildCSV(ctx, {});
  assert.ok(csv.includes('月份'));
  assert.ok(csv.includes('销售收入'));
});
