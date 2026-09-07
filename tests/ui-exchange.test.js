const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-exchange.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const engine = require('../js/core/engine.js');

function seedSale(ctx) {
  const r1 = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  const r2 = product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
  const p1 = r1.product, p2 = r2.product;
  // 进货
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '西安电器批发',
    items: [
      { productId: p1.id, qty: 10, costPrice: '1000' },
      { productId: p2.id, qty: 10, costPrice: '1800' }
    ],
    paid: '999999'
  });
  // 销售（1 台海尔 + 2 台格力）
  const sale = engine.saveSale(ctx, {
    date: '2026-09-02',
    items: [
      { productId: p1.id, qty: 1, price: '1399', priceType: 'retail', costSnapshot: 100000 },
      { productId: p2.id, qty: 2, price: '2200', priceType: 'wholesale', costSnapshot: 180000 }
    ],
    payments: [{ method: 'cash', amount: '6000' }]
  });
  return { ctx, p1, p2, saleNo: sale.doc.no };
}

function fresh() {
  return page.init();
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'exchange');
  assert.strictEqual(page.title, '退换货');
  const state = fresh();
  assert.strictEqual(state.tab, 'pick');
});

test('选原单：列出可退销售单', () => {
  const { ctx } = seedSale(newCtx());
  const state = fresh();
  const html = page.render(ctx, state);
  assert.ok(html.includes('退换货'));
  assert.ok(html.includes('选为原单'));
});

test('退货：do-return 红冲入库', () => {
  const { ctx, p1, saleNo } = seedSale(newCtx());
  const state = fresh();
  state.tab = 'return';
  state.originalNo = saleNo;
  state.returnQty[p1.id] = 1;
  const ok = page.actions['do-return'](ctx, state);
  assert.strictEqual(ok, true);
  const refund = ctx.data.sales.find(s => s.type === 'refund');
  assert.ok(refund, '生成退货单');
  assert.strictEqual(refund.refNo, saleNo);
  assert.strictEqual(product.getById(ctx, p1.id).stock, 10, '退货后库存回到 10');
});

test('退货：可退数量限制（已退后不能再退）', () => {
  const { ctx, p1, saleNo } = seedSale(newCtx());
  const state = fresh();
  state.tab = 'return';
  state.originalNo = saleNo;
  state.returnQty[p1.id] = 1;
  page.actions['do-return'](ctx, state);
  // 再退同商品 1 台（原单只有 1 台）→ 应拦截
  const state2 = fresh();
  state2.tab = 'return';
  state2.originalNo = saleNo;
  state2.returnQty[p1.id] = 1;
  const ok2 = page.actions['do-return'](ctx, state2);
  assert.strictEqual(ok2, false, '已全部退回不可再退');
});

test('换货：退旧换新收差价，两单联动', () => {
  const { ctx, p1, p2, saleNo } = seedSale(newCtx());
  const state = fresh();
  state.tab = 'exchange';
  state.originalNo = saleNo;
  state.exchReturnQty[p1.id] = 1; // 退 1 台海尔
  // 换 1 台格力（零售）
  page.actions['repl-add'](ctx, state, { getAttribute: () => p2.id });
  const ok = page.actions['do-exchange'](ctx, state);
  assert.strictEqual(ok, true);
  // 生成退货单 + 销售单，且互相关联
  const refund = ctx.data.sales.find(s => s.type === 'refund' && s.refNo === saleNo);
  const newSale = ctx.data.sales.find(s => s.type === 'sale' && s.no !== saleNo);
  assert.ok(refund, '生成退货单');
  assert.ok(newSale, '生成换新销售单');
  assert.strictEqual(newSale.exchangeOf, saleNo, '销售单关联原单');
  assert.strictEqual(refund.exchangeLinked, newSale.no, '退货单关联新销售单');
  // 库存：海尔回到 10，格力扣 1 台（10 进 − 2 卖 − 1 换 = 7）
  assert.strictEqual(product.getById(ctx, p1.id).stock, 10);
  assert.strictEqual(product.getById(ctx, p2.id).stock, 7);
});
