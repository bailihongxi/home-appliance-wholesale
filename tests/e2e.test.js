/**
 * tests/e2e.test.js —— 电器版全流程闭环验收
 * 建档(期初) → 进货(挂账) → 付供应商 → 销售(零售现金) → 销售(批发挂账) →
 * 退货红冲 → 作废回滚；最终断言库存 / 流水 / 欠款 / 利润一致。
 */
const test = require('node:test');
const assert = require('node:assert');

const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const engine = require('../js/core/engine.js');
const profit = require('../js/core/profit.js');
const ledger = require('../js/core/ledger.js');

function stockOf(ctx, productId) {
  const p = ctx.getProduct(productId);
  return p ? (p.stock || 0) : null;
}

test('电器版全流程：从建档到作废，账实一致', () => {
  const ctx = newCtx();
  const { product: frigo } = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  const { product: ac } = product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });

  /* ① 进货：冰箱 10 台挂账，空调 5 台现结 */
  const pur = engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [
      { productId: frigo.id, qty: 10, costPrice: '1000' },
      { productId: ac.id, qty: 5, costPrice: '1800' }
    ],
    paid: '9000' // 空调 5×1800=9000 现结，冰箱 10×1000=10000 挂账
  });
  assert.ok(pur.ok);
  assert.strictEqual(stockOf(ctx, frigo.id), 10);
  assert.strictEqual(stockOf(ctx, ac.id), 5);
  const sup = ctx.getPartner(pur.doc.partnerId);
  assert.strictEqual(sup.balance, 1000000, '供应商应付 10000 元');

  /* ② 付供应商 10000 → 应付清零 */
  const pay = engine.settleAccount(ctx, { partnerId: sup.id, amount: '10000', date: '2026-09-02', isSupplier: true });
  assert.ok(pay.ok);
  assert.strictEqual(sup.balance, 0);
  assert.strictEqual(ledger.list(ctx, { type: 'pay_supplier' }).length, 1);

  /* ③ 零售现金卖 2 台冰箱 */
  const sale1 = engine.saveSale(ctx, {
    date: '2026-09-03',
    items: [{ productId: frigo.id, qty: 2, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '2798' }]
  });
  assert.ok(sale1.ok);
  assert.strictEqual(stockOf(ctx, frigo.id), 8);
  assert.strictEqual(sale1.doc.received, 279800);

  /* ④ 批发挂账卖 3 台空调给王老板 */
  const sale2 = engine.saveSale(ctx, {
    date: '2026-09-04', partnerName: '王老板',
    items: [{ productId: ac.id, qty: 3, price: '2200', priceType: 'wholesale' }],
    payments: [{ method: 'cash', amount: '3000' }]
  });
  assert.ok(sale2.ok);
  assert.strictEqual(stockOf(ctx, ac.id), 2);
  const cust = ctx.getPartner(sale2.doc.partnerId);
  assert.strictEqual(cust.balance, 660000 - 300000, '王老板欠 3600 元');

  /* ⑤ 王老板回款 2000 */
  const rec = engine.settleAccount(ctx, { partnerId: cust.id, amount: '2000', date: '2026-09-05' });
  assert.ok(rec.ok);
  assert.strictEqual(cust.balance, 160000);

  /* ⑥ 零售单退 1 台冰箱（红冲） */
  const ref = engine.refundSale(ctx, { originalNo: sale1.doc.no, items: [{ productId: frigo.id, qty: 1 }] });
  assert.ok(ref.ok);
  assert.strictEqual(stockOf(ctx, frigo.id), 9, '退货回库');

  /* ⑦ 作废批发单 → 库存回滚、王老板欠款清零 */
  const v = engine.voidSale(ctx, sale2.doc.no);
  assert.ok(v.ok);
  assert.strictEqual(stockOf(ctx, ac.id), 5, '作废后空调库存回到 5');
  assert.strictEqual(cust.balance, 0, '作废后客户应收清零');

  /* 最终一致性校验 */
  // 库存：冰箱 10-2+1=9；空调 5
  assert.strictEqual(stockOf(ctx, frigo.id), 9);
  assert.strictEqual(stockOf(ctx, ac.id), 5);
  // 进货流水 2、销售流水（sale1 + refund + 作废的反向）=4 条库存流水
  assert.ok(ctx.data.stockLogs.length >= 6);
  // 利润：只算零售销售 2 台冰箱（1 台退货冲减）→ 1×(1399-1000)=399 元；
  // 批发单已作废不计入
  const sm = profit.summary(ctx, { from: '2026-09-01', to: '2026-09-30' });
  assert.strictEqual(sm.netProfit, 39900);
  // 库存资金占用：9×1000 + 5×1800 = 18000 元
  assert.strictEqual(profit.stockValue(ctx), 9 * 100000 + 5 * 180000);
});
