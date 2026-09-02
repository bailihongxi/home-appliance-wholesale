const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-inventory.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const inv = require('../js/core/inventory.js');

function seed(ctx) {
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
  return ctx;
}

function fresh(ctx) {
  return page.init();
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'inventory');
  assert.strictEqual(page.title, '库存管理');
  const ctx = seed(newCtx());
  const st = fresh(ctx);
  assert.strictEqual(st.tab, 'list');
});

test('库存列表：品牌/型号分列，成本/双价/库存', () => {
  const ctx = seed(newCtx());
  const st = fresh(ctx);
  const html = page.render(ctx, st);
  assert.ok(html.includes('海尔'));
  assert.ok(html.includes('BCD-200'));
  assert.ok(html.includes('格力'));
  assert.ok(html.includes('¥1000.00'));
  assert.ok(html.includes('¥1200.00'));
  assert.ok(html.includes('¥1399.00'));
  assert.ok(!html.includes('款号'));
});

test('预警：低于阈值 3 显示，充足不显示', () => {
  const ctx = seed(newCtx({ defaultThreshold: 3 }));
  const st = fresh(ctx);
  st.tab = 'alert';
  // 库存为 0 → 两个都在预警
  let html = page.render(ctx, st);
  assert.ok(html.includes('库存充足') === false, '有预警');
  // 补库存
  ctx.data.products.forEach(p => { p.stock = 10; });
  html = page.render(ctx, st);
  assert.ok(html.includes('库存充足，暂无预警'));
});

test('盘点：填实盘数保存，生成盘点单并调整库存', () => {
  const ctx = seed(newCtx());
  const st = fresh(ctx);
  st.tab = 'take';
  ctx.data.products[0].stock = 5; // 账面 5
  st.take.counts[ctx.data.products[0].id] = 8; // 实盘 8
  const ok = page.actions['save-take'](ctx, st);
  assert.strictEqual(ok, true);
  assert.strictEqual(ctx.data.stocktakes.length, 1);
  assert.strictEqual(ctx.data.products[0].stock, 8, '库存调整为实盘数');
  const doc = ctx.data.stocktakes[0];
  assert.strictEqual(doc.diffQty, 3);
  // 渲染含盘点记录
  const html = page.render(ctx, st);
  assert.ok(html.includes('最近盘点记录'));
});

test('变动明细：show-logs 显示进货入库记录', () => {
  const ctx = seed(newCtx());
  const p = ctx.data.products[0];
  inv.applyPurchase(ctx, { date: '2026-09-01', items: [{ productId: p.id, qty: 5, cost: 100000 }], supplier: '测试' });
  const st = fresh(ctx);
  page.actions['show-logs'](ctx, st, { getAttribute: () => p.id });
  const html = page.render(ctx, st);
  assert.ok(html.includes('进货入库'));
  assert.ok(html.includes('+5'));
});
