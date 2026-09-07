/**
 * tests/perf-ui.test.js —— 大数据量 UI 性能优化（电器版）
 * 1) 搜索框实时化 + 防抖：searchBar / 进货选货 / 换货补货 搜索输入均带 data-live+data-debounce；
 * 2) app 防抖调度 _scheduleSearch：多次输入只执行最后一次（避免逐键全量过滤/重渲染卡顿）；
 * 3) 防抖阈值 250ms。
 */
const test = require('node:test');
const assert = require('node:assert');

const ui = require('../js/ui/components.js');
require('../js/app.js');
const app = globalThis.ERP && globalThis.ERP.app;
const purchase = require('../js/ui/page-purchase.js');
const exchange = require('../js/ui/page-exchange.js');
const product = require('../js/core/product.js');
const engine = require('../js/core/engine.js');
const { newCtx } = require('./helpers/ctx.js');

function seedSale(ctx) {
  const r = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  const p = r.product;
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '西安电器批发',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }], paid: '999999'
  });
  const sale = engine.saveSale(ctx, {
    date: '2026-09-02',
    items: [{ productId: p.id, qty: 1, price: '1399', priceType: 'retail', costSnapshot: 100000 }],
    payments: [{ method: 'cash', amount: '1399' }]
  });
  return sale.doc.no;
}

test('搜索栏 searchBar 带实时+防抖标记（data-live + data-debounce）', () => {
  const html = ui.searchBar({ value: '', placeholder: 'x' });
  assert.ok(html.includes('data-input="keyword"'), '搜索框为 keyword 输入');
  assert.ok(html.includes('data-live="1"'), '搜索框实时搜索（data-live）');
  assert.ok(html.includes('data-debounce="1"'), '搜索框防抖（data-debounce），大数据量不逐键重渲染');
});

test('进货选货搜索带防抖标记（form-keyword + data-live + data-debounce）', () => {
  const ctx = newCtx();
  const state = purchase.init(ctx);
  state.tab = 'form';
  const html = purchase.render(ctx, state);
  assert.ok(html.includes('data-input="form-keyword"'), '进货选货搜索框存在');
  assert.ok(html.includes('data-live="1" data-debounce="1"'), '进货选货搜索带实时+防抖标记');
});

test('换货/补货商品搜索带防抖标记（replKeyword + data-debounce）', () => {
  const ctx = newCtx();
  const saleNo = seedSale(ctx);
  const state = exchange.init(ctx);
  state.tab = 'exchange';
  state.originalNo = saleNo;
  const html = exchange.render(ctx, state);
  assert.ok(html.includes('data-name="replKeyword"'), '换货补货搜索框存在');
  assert.ok(html.includes('data-debounce="1"'), '换货补货搜索带防抖标记');
});

test('防抖阈值 250ms（app._debounceMs）', () => {
  assert.strictEqual(app._debounceMs, 250, '搜索防抖阈值为 250ms');
});

test('防抖调度 _scheduleSearch：多次调用只执行最后一次', async () => {
  let calls = [];
  app._scheduleSearch(function () { calls.push(1); }, 5);
  app._scheduleSearch(function () { calls.push(2); }, 5);
  app._scheduleSearch(function () { calls.push(3); }, 5);
  assert.strictEqual(calls.length, 0, '防抖期内不应立即执行');
  await new Promise(function (r) { setTimeout(r, 30); });
  assert.deepStrictEqual(calls, [3], '防抖后只执行最后一次调用');
});
