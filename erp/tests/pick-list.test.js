const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const salePage = require('../js/ui/page-sale.js');
const purchasePage = require('../js/ui/page-purchase.js');
const exchangePage = require('../js/ui/page-exchange.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const engine = require('../js/core/engine.js');

function seed(ctx) {
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '100000', priceWholesale: '120000', priceRetail: '139900'
  });
  product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '180000', priceWholesale: '220000', priceRetail: '259900'
  });
  // 给首款商品补库存，否则保存销售单会因「库存不足」被拒
  ctx.data.products[0].stock = 5;
  // 建一张销售单，供退换货选原单使用
  const sale = engine.saveSale(ctx, {
    date: '2026-09-01',
    items: [{ productId: ctx.data.products[0].id, qty: 1, price: '139900', priceType: 'retail', costSnapshot: 100000 }],
    payments: [{ method: 'cash', amount: '139900' }]
  });
  return sale.doc.no;
}

test('V3.50 销售开单选货区：两行卡片式，价格内联、无需横向滚动', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = salePage.init();
  state.tab = 'new';
  const html = salePage.render(ctx, state);
  assert.ok(html.includes('class="pick-list"'), '选货区使用 pick-list 容器');
  assert.ok(html.includes('class="pick-item"'), '每个商品一个 pick-item 卡片');
  assert.ok(html.includes('class="pick-name"'), '第一行为品牌+型号');
  assert.ok(html.includes('class="pick-sub"'), '第二行存在');
  assert.ok(html.includes('批:'), '第二行含批发价');
  assert.ok(html.includes('零:'), '第二行含零售价');
  assert.ok(!html.includes('tbl tbl-striped'), '选货区不再使用横向表格');
});

test('V3.50 进货单按商品加行：两行卡片式，第二行显示成本', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = purchasePage.init();
  state.tab = 'form';
  const html = purchasePage.render(ctx, state);
  assert.ok(html.includes('class="pick-list"'), '进货选货区使用 pick-list 容器');
  assert.ok(html.includes('class="pick-sub"'), '第二行存在');
  assert.ok(html.includes('成本:'), '第二行含档案成本');
  assert.ok(!html.includes('tbl tbl-striped'), '进货选货区不再使用横向表格');
});

test('V3.50 退换货换货选货区：两行卡片式，批/零内联', () => {
  const ctx = newCtx();
  const saleNo = seed(ctx);
  const state = exchangePage.init();
  state.tab = 'exchange';
  state.originalNo = saleNo;
  const html = exchangePage.render(ctx, state);
  assert.ok(html.includes('class="pick-list"'), '换货选货区使用 pick-list 容器');
  assert.ok(html.includes('批:'), '第二行含批发价');
  assert.ok(html.includes('零:'), '第二行含零售价');
});

test('V3.50 CSS：定义 pick-list / pick-item / pick-sub 两行卡片样式', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  assert.ok(css.includes('.pick-list'), 'CSS 含 .pick-list');
  assert.ok(css.includes('.pick-item'), 'CSS 含 .pick-item');
  assert.ok(css.includes('.pick-sub'), 'CSS 含 .pick-sub');
  assert.ok(css.includes('.pick-stock'), 'CSS 含 .pick-stock');
});
