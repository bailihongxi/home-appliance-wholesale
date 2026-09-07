const test = require('node:test');
const assert = require('node:assert');
const debt = require('../js/core/debt.js');
const engine = require('../js/core/engine.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

function seed(ctx) {
  const { product: p } = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  // 补库存，保证销售开单不被「库存不足」拦截
  p.stock = 999;
  return p;
}

test('debt.ensurePartner：按 名称+类型 去重', () => {
  const ctx = newCtx();
  const a = debt.ensurePartner(ctx, { name: '格力经销商', type: 'supplier' });
  const b = debt.ensurePartner(ctx, { name: '格力经销商', type: 'supplier' });
  const c = debt.ensurePartner(ctx, { name: '格力经销商', type: 'customer' });
  assert.strictEqual(a.id, b.id, '同名同类型应去重');
  assert.notStrictEqual(a.id, c.id, '同名不同类型应分别建档');
  assert.strictEqual(ctx.data.partners.length, 2);
});

test('debt.applyPurchase / applySale：应付、应收 +N', () => {
  const ctx = newCtx();
  const sup = debt.ensurePartner(ctx, { name: '格力经销商', type: 'supplier' });
  const cus = debt.ensurePartner(ctx, { name: '王老板', type: 'customer' });
  debt.applyPurchase(ctx, { partnerId: sup.id, debt: 1500000 });
  debt.applySale(ctx, { partnerId: cus.id, debt: 139900 });
  assert.strictEqual(ctx.getPartner(sup.id).balance, 1500000, '供应商应付 +15000 元');
  assert.strictEqual(ctx.getPartner(cus.id).balance, 139900, '客户应收 +1399 元');
});

test('debt.settle：供应商余额夹紧到 0，客户可冲减', () => {
  const ctx = newCtx();
  const sup = debt.ensurePartner(ctx, { name: '格力经销商', type: 'supplier' });
  debt.applyPurchase(ctx, { partnerId: sup.id, debt: 15000 });
  const over = debt.settle(ctx, { partnerId: sup.id, amount: '9999', isSupplier: true });
  assert.strictEqual(over.overpay > 0, true, '多付金额应被记录');
  assert.strictEqual(ctx.getPartner(sup.id).balance, 0, '供应商余额不可为负，夹紧到 0');

  const cus = debt.ensurePartner(ctx, { name: '王老板', type: 'customer' });
  debt.applySale(ctx, { partnerId: cus.id, debt: 139900 });
  debt.settle(ctx, { partnerId: cus.id, amount: '1399', isSupplier: false });
  assert.strictEqual(ctx.getPartner(cus.id).balance, 0);
});

test('debt.reverseDoc：作废单据回滚欠款', () => {
  const ctx = newCtx();
  const sup = debt.ensurePartner(ctx, { name: '格力经销商', type: 'supplier' });
  debt.applyPurchase(ctx, { partnerId: sup.id, debt: 1500000 });
  debt.reverseDoc(ctx, { partnerId: sup.id, debt: 1500000 }, 'purchase');
  assert.strictEqual(ctx.getPartner(sup.id).balance, 0, '作废后应付回滚');
});

test('debt.list / payables / receivables / totals', () => {
  const ctx = newCtx();
  const sup = debt.ensurePartner(ctx, { name: '格力经销商', type: 'supplier' });
  const cus = debt.ensurePartner(ctx, { name: '王老板', type: 'customer' });
  debt.applyPurchase(ctx, { partnerId: sup.id, debt: 1500000 });
  debt.applySale(ctx, { partnerId: cus.id, debt: 139900 });

  assert.strictEqual(debt.payables(ctx).length, 1);
  assert.strictEqual(debt.receivables(ctx).length, 1);
  const t = debt.totals(ctx);
  assert.strictEqual(t.payable, 1500000);
  assert.strictEqual(t.receivable, 139900);

  // 结清后不出现在清单
  debt.settle(ctx, { partnerId: sup.id, amount: '15000', isSupplier: true });
  assert.strictEqual(debt.payables(ctx).length, 0, '应付余额为 0 不计入清单');
});

test('debt.overdue：应收超期（>15 天）提醒', () => {
  const ctx = newCtx();
  const old = debt.ensurePartner(ctx, { name: '老客户', type: 'customer' });
  const recent = debt.ensurePartner(ctx, { name: '新客户', type: 'customer' });
  const p = seed(ctx);
  engine.saveSale(ctx, {
    date: '2026-08-01', partnerId: old.id,
    items: [{ productId: p.id, qty: 1, price: '1399' }],
    payments: [{ method: 'debt', amount: '1399' }]
  });
  engine.saveSale(ctx, {
    date: '2026-08-25', partnerId: recent.id,
    items: [{ productId: p.id, qty: 1, price: '1399' }],
    payments: [{ method: 'debt', amount: '1399' }]
  });
  const over = debt.overdue(ctx, 15); // 超期天数按系统“今天”动态计算
  const found = over.find((o) => o.partner.id === old.id);
  const util = require('../js/core/util.js');
  const expectDays = util.diffDays('2026-08-01', util.today());
  assert.ok(found, '8/1 的应收应超期');
  assert.strictEqual(found.days, expectDays, '8/1 距今天 ' + expectDays + ' 天');
  assert.strictEqual(over.some((o) => o.partner.id === recent.id), false, '8/25 未超期');
});

test('PRD 10.1-④ 进货欠款付款闭环', () => {
  const ctx = newCtx();
  const sup = debt.ensurePartner(ctx, { name: '格力经销商', type: 'supplier' });
  const p = seed(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerId: sup.id,
    items: [{ productId: p.id, qty: 5, costPrice: '1000' }],
    paid: '1000'
  });
  assert.strictEqual(ctx.getPartner(sup.id).balance, 400000);
  const res = engine.settleAccount(ctx, { partnerId: sup.id, amount: '4000', isSupplier: true });
  assert.ok(res.ok);
  assert.strictEqual(ctx.getPartner(sup.id).balance, 0, '付款后应付清零');
  assert.strictEqual(debt.payables(ctx).length, 0);
});

test('PRD 10.1-⑤ 客户挂账收款闭环', () => {
  const ctx = newCtx();
  const cus = debt.ensurePartner(ctx, { name: '王老板', type: 'customer' });
  const p = seed(ctx);
  engine.saveSale(ctx, {
    date: '2026-09-01', partnerId: cus.id,
    items: [{ productId: p.id, qty: 1, price: '1399' }],
    payments: [{ method: 'debt', amount: '1399' }]
  });
  assert.strictEqual(ctx.getPartner(cus.id).balance, 139900);
  const res = engine.settleAccount(ctx, { partnerId: cus.id, amount: '1399', isSupplier: false });
  assert.ok(res.ok);
  assert.strictEqual(ctx.getPartner(cus.id).balance, 0, '收款后应清零');
  assert.strictEqual(debt.receivables(ctx).length, 0);
});
