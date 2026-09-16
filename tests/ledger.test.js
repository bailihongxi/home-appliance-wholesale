const test = require('node:test');
const assert = require('node:assert');
const ledger = require('../js/core/ledger.js');
const debt = require('../js/core/debt.js');
const engine = require('../js/core/engine.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

/** 建档 + 供应商 + 客户，返回 {ctx, sup, cus, p} */
function seed(ctx) {
  const { product: p } = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  p.stock = 999;
  const sup = debt.ensurePartner(ctx, { name: '格力经销商', type: 'supplier' });
  const cus = debt.ensurePartner(ctx, { name: '王老板', type: 'customer' });
  return { sup, cus, p };
}

test('ledger.add：方向由类型决定', () => {
  const ctx = newCtx();
  const r = ledger.add(ctx, { type: 'sale_income', amount: 100 });
  assert.strictEqual(r.direction, 'in');
  assert.strictEqual(r.amount, 100);
  assert.strictEqual(r.voided, false);
});

test('ledger.fromPurchase：有付款才生成进货支出流水', () => {
  const ctx = newCtx();
  const { sup } = seed(ctx);
  const noLedger = ledger.fromPurchase(ctx, { date: '2026-09-01', paid: 0, partnerId: sup.id, partnerName: '格力经销商' });
  assert.strictEqual(noLedger, null, '未付款不生成流水');
  ledger.fromPurchase(ctx, { date: '2026-09-01', paid: 300000, partnerId: sup.id, partnerName: '格力经销商' });
  const ls = ledger.list(ctx, { type: 'purchase_expense' });
  assert.strictEqual(ls.length, 1);
  assert.strictEqual(ls[0].amount, 300000);
  assert.strictEqual(ls[0].direction, 'out');
});

test('ledger.fromSale：销售收入 + 赠送成本 + 退货退款', () => {
  const ctx = newCtx();
  const { cus } = seed(ctx);
  const saleDoc = {
    no: 'S1', date: '2026-09-01', type: 'sale', partnerId: cus.id, partnerName: '王老板',
    received: 139900,
    items: [
      { type: 'sale', price: 139900, costSnapshot: 100000, qty: 1 },
      { type: 'gift', price: 0, costSnapshot: 100000, qty: 1, giftReason: '赠品' }
    ]
  };
  ledger.fromSale(ctx, saleDoc);
  const income = ledger.list(ctx, { type: 'sale_income' });
  assert.strictEqual(income.length, 1);
  assert.strictEqual(income[0].amount, 139900);
  const gift = ledger.list(ctx, { type: 'gift_cost' });
  assert.strictEqual(gift.length, 1);
  assert.strictEqual(gift[0].amount, 100000, '赠送成本 = 1×1000 元');

  const refundDoc = { no: 'S2', date: '2026-09-02', type: 'refund', refNo: 'S1', payable: 139900, partnerId: cus.id, items: [{ type: 'sale', price: 139900, costSnapshot: 100000, qty: 1 }] };
  ledger.fromSale(ctx, refundDoc);
  const rf = ledger.list(ctx, { type: 'refund_out' });
  assert.strictEqual(rf.length, 1);
  assert.strictEqual(rf[0].amount, 139900);
});

test('ledger.manual：费用支出与其他收入', () => {
  const ctx = newCtx();
  const exp = ledger.manual(ctx, { date: '2026-09-01', category: '房租', amount: '2000' });
  assert.ok(exp.ok);
  assert.strictEqual(exp.rec.type, 'expense');
  assert.strictEqual(exp.rec.amount, 200000);
  assert.strictEqual(exp.rec.auto, false);

  const inc = ledger.manual(ctx, { date: '2026-09-01', category: '其他', direction: 'in', amount: '500' });
  assert.ok(inc.ok);
  assert.strictEqual(inc.rec.type, 'income');
  assert.strictEqual(inc.rec.direction, 'in');

  const zero = ledger.manual(ctx, { date: '2026-09-01', category: '房租', amount: '0' });
  assert.strictEqual(zero.ok, false, '0 元应被拒绝');
});

test('ledger.voidByRef：作废关联流水（默认查询排除）', () => {
  const ctx = newCtx();
  const { cus } = seed(ctx);
  ledger.fromSale(ctx, { no: 'S1', date: '2026-09-01', type: 'sale', received: 139900, items: [{ type: 'sale', price: 139900, costSnapshot: 100000, qty: 1 }] });
  const before = ledger.list(ctx, {}).length;
  const n = ledger.voidByRef(ctx, 'S1');
  assert.strictEqual(n, 1);
  const after = ledger.list(ctx, {}).length;
  assert.strictEqual(after, before - 1, '默认 list 排除已作废');
  assert.strictEqual(ledger.list(ctx, { includeVoided: true }).length, before);
});

test('ledger.list：按日期/类型过滤；ledger.sum 收入/支出/净额', () => {
  const ctx = newCtx();
  ledger.manual(ctx, { date: '2026-09-10', category: '房租', amount: '1000' });
  ledger.manual(ctx, { date: '2026-09-20', category: '其他', direction: 'in', amount: '300' });
  const inSep = ledger.list(ctx, { from: '2026-09-15' });
  assert.strictEqual(inSep.length, 1, '只看 9/15 之后：仅 9/20 收入');
  const sum = ledger.sum(ctx, {});
  assert.strictEqual(sum.income, 30000);
  assert.strictEqual(sum.expense, 100000);
  assert.strictEqual(sum.net, -70000);
});

test('ledger.expenseTotal：费用支出合计（不含收入/作废）', () => {
  const ctx = newCtx();
  ledger.add(ctx, { type: 'expense', category: '房租', amount: 100000, date: '2026-09-01', refNo: 'E1' });
  ledger.add(ctx, { type: 'expense', category: '水电', amount: 20000, date: '2026-09-03', refNo: 'E2' });
  ledger.add(ctx, { type: 'income', category: '其他', amount: 50000, date: '2026-09-02' });
  ledger.voidByRef(ctx, 'E2');
  const t = ledger.expenseTotal(ctx, '2026-09-01', '2026-09-30');
  assert.strictEqual(t, 100000, '仅费用、排除收入与已作废');
});

test('PRD 10.1-④ 进货欠款付款 → 生成供应商付款流水', () => {
  const ctx = newCtx();
  const { sup, p } = seed(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerId: sup.id,
    items: [{ productId: p.id, qty: 5, costPrice: '1000' }],
    paid: '1000' // 总 5000，欠 4000
  });
  assert.strictEqual(ctx.getPartner(sup.id).balance, 400000);
  const res = engine.settleAccount(ctx, { partnerId: sup.id, amount: '4000', isSupplier: true });
  assert.ok(res.ok);
  assert.strictEqual(ctx.getPartner(sup.id).balance, 0, '应付清零');
  const pay = ledger.list(ctx, { type: 'pay_supplier' });
  assert.strictEqual(pay.length, 1, '应生成供应商付款流水');
  assert.strictEqual(pay[0].amount, 400000);
});

test('PRD 10.1-⑤ 客户挂账收款 → 生成客户回款流水', () => {
  const ctx = newCtx();
  const { cus, p } = seed(ctx);
  engine.saveSale(ctx, {
    date: '2026-09-01', partnerId: cus.id,
    items: [{ productId: p.id, qty: 1, price: '1399' }],
    payments: [{ method: 'debt', amount: '1399' }]
  });
  assert.strictEqual(ctx.getPartner(cus.id).balance, 139900);
  const res = engine.settleAccount(ctx, { partnerId: cus.id, amount: '1399', isSupplier: false });
  assert.ok(res.ok);
  assert.strictEqual(ctx.getPartner(cus.id).balance, 0, '应收清零');
  const recv = ledger.list(ctx, { type: 'receive_debt' });
  assert.strictEqual(recv.length, 1, '应生成客户回款流水');
  assert.strictEqual(recv[0].amount, 139900);
});
