/**
 * tests/sale.test.js —— 电器版单据核心：进货 / 销售(批发·零售) / 赠送 / 成本快照 /
 * 退货红冲 / 换货 / 作废回滚 / 收付款
 */
const test = require('node:test');
const assert = require('node:assert');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const engine = require('../js/core/engine.js');
const schema = require('../js/core/schema.js');
const profit = require('../js/core/profit.js');

/** 建 1 台商品并返回 ctx */
function seedOne(ctx, opts) {
  opts = opts || {};
  const r = product.save(ctx, {
    brand: opts.brand || '海尔',
    model: opts.model || 'BCD-200',
    category: opts.category || '冰箱',
    unit: '台',
    cost: opts.cost || '1000',
    priceWholesale: opts.priceWholesale || '1200',
    priceRetail: opts.priceRetail || '1399'
  });
  return r.product;
}

test('进货：库存 +N、档案成本回写、供应商应付挂账', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  const r = engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 5, costPrice: '950' }],
    paid: '0'
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(p.stock, 5);
  assert.strictEqual(p.cost, 95000, '档案成本回写为本次进价 950 元');
  assert.strictEqual(r.doc.total, 5 * 95000);
  assert.strictEqual(r.doc.debt, 5 * 95000, '未付款全额挂账');
  const sup = ctx.getPartner(r.doc.partnerId);
  assert.strictEqual(sup.balance, 5 * 95000);
  assert.strictEqual(ctx.data.stockLogs.length, 1);
});

test('进货：售货价联动 —— 档案成本带出且可改，保存后同步档案', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 3, costPrice: '1050' }],
    paid: '99999'
  });
  assert.strictEqual(p.cost, 105000);
});

test('销售（零售价）：库存减少、利润按成本快照、priceType 落单', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }], paid: '99999'
  });
  const s = engine.saveSale(ctx, {
    date: '2026-09-02',
    items: [{ productId: p.id, qty: 2, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '2798' }]
  });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(p.stock, 8);
  const doc = s.doc;
  assert.strictEqual(doc.items[0].price, 139900);
  assert.strictEqual(doc.items[0].priceType, 'retail');
  assert.strictEqual(doc.items[0].costSnapshot, 100000);
  assert.strictEqual(doc.payable, 279800);
  assert.strictEqual(doc.received, 279800);
  assert.strictEqual(doc.debt, 0);
  // 利润：2 × (1399 - 1000) = 798 元
  const sm = profit.summary(ctx, { from: '2026-09-01', to: '2026-09-30' });
  assert.strictEqual(sm.netProfit, 79800);
});

test('销售（批发价）：priceType=wholesale，用批发价结算', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }], paid: '99999'
  });
  const s = engine.saveSale(ctx, {
    date: '2026-09-02',
    items: [{ productId: p.id, qty: 4, price: '1200', priceType: 'wholesale' }],
    payments: [{ method: 'cash', amount: '4800' }]
  });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.doc.items[0].priceType, 'wholesale');
  assert.strictEqual(s.doc.payable, 480000);
  assert.strictEqual(p.stock, 6);
});

test('销售挂账：赊销客户应收增加', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }], paid: '99999'
  });
  const s = engine.saveSale(ctx, {
    date: '2026-09-02', partnerName: '王老板',
    items: [{ productId: p.id, qty: 3, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '1000' }]
  });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.doc.debt, 319700, '欠款 1399×3-1000');
  const cust = ctx.getPartner(s.doc.partnerId);
  assert.strictEqual(cust.balance, 319700);
});

test('成本快照：进货改成本后，历史销售利润不随档案变（D1 已确认）', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }], paid: '99999'
  });
  // 卖 2 台（此时成本快照 1000）
  engine.saveSale(ctx, {
    date: '2026-09-02',
    items: [{ productId: p.id, qty: 2, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '2798' }]
  });
  // 再进货改成本为 1200
  engine.savePurchase(ctx, {
    date: '2026-09-03', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 1, costPrice: '1200' }], paid: '1200'
  });
  assert.strictEqual(p.cost, 120000, '档案成本已更新');
  const sm = profit.summary(ctx, { from: '2026-09-01', to: '2026-09-30' });
  // 历史销售利润仍按旧快照 1000 计算：2×(1399-1000)=798
  assert.strictEqual(sm.netProfit, 79800, '历史利润不受档案成本变更影响');
});

test('赠送出库：库存减少、售价为 0、记录赠送原因', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }], paid: '99999'
  });
  const s = engine.saveSale(ctx, {
    date: '2026-09-02', partnerName: '老客户',
    items: [{ productId: p.id, qty: 1, type: 'gift', giftReason: '赠品' }],
    payments: []
  });
  assert.strictEqual(s.ok, true);
  assert.strictEqual(p.stock, 9);
  assert.strictEqual(s.doc.items[0].type, 'gift');
  assert.strictEqual(s.doc.items[0].price, 0);
  assert.strictEqual(s.doc.payable, 0);
});

test('销售退货红冲：库存回库、收入冲减、已退数量受限', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }], paid: '99999'
  });
  const s = engine.saveSale(ctx, {
    date: '2026-09-02', partnerName: '王老板',
    items: [{ productId: p.id, qty: 3, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '4197' }]
  });
  const beforeStock = p.stock; // 7
  const ref = engine.refundSale(ctx, { originalNo: s.doc.no, items: [{ productId: p.id, qty: 1 }] });
  assert.strictEqual(ref.ok, true);
  assert.strictEqual(ref.doc.type, 'refund');
  assert.strictEqual(ref.doc.refNo, s.doc.no);
  assert.strictEqual(p.stock, beforeStock + 1, '退货 1 台回库');
  assert.strictEqual(ref.doc.payable, 139900);
  assert.strictEqual(ctx.data.stockLogs.length, 3);

  // 超量退货被拒
  const over = engine.refundSale(ctx, { originalNo: s.doc.no, items: [{ productId: p.id, qty: 99 }] });
  assert.strictEqual(over.ok, true, '超量自动截断到剩余可退数 2');
  assert.strictEqual(over.doc.items[0].qty, 2);
});

test('换货：退旧 + 换新，一退一销两单联动', () => {
  const ctx = newCtx();
  const pOld = seedOne(ctx, { brand: '海尔', model: 'BCD-200' });
  const pNew = seedOne(ctx, { brand: '美的', model: 'KFR-35', category: '空调' });
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [
      { productId: pOld.id, qty: 10, costPrice: '1000' },
      { productId: pNew.id, qty: 10, costPrice: '2000' }
    ], paid: '99999'
  });
  const s = engine.saveSale(ctx, {
    date: '2026-09-02',
    items: [{ productId: pOld.id, qty: 1, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '1399' }]
  });
  const ex = engine.exchange(ctx, {
    originalNo: s.doc.no,
    returns: [{ productId: pOld.id, qty: 1 }],
    replacements: [{ productId: pNew.id, qty: 1, price: '2599', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '1200' }] // 补差价 2599-1399=1200
  });
  assert.strictEqual(ex.ok, true);
  assert.strictEqual(pOld.stock, 10, '退旧 1 台回库');
  assert.strictEqual(pNew.stock, 9, '换新 1 台出库');
  assert.ok(ex.refund && ex.sale, '应生成退货单 + 新销售单');
  assert.strictEqual(ex.sale.exchangeOf, s.doc.no);
  assert.strictEqual(ex.refund.exchangeLinked, ex.sale.no);
});

test('作废销售单：库存回滚、欠款冲回、流水作废留痕', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }], paid: '99999'
  });
  const s = engine.saveSale(ctx, {
    date: '2026-09-02', partnerName: '王老板',
    items: [{ productId: p.id, qty: 3, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '1000' }]
  });
  const beforeStock = p.stock; // 7
  const v = engine.voidSale(ctx, s.doc.no);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(p.stock, beforeStock + 3, '库存回滚');
  const cust = ctx.getPartner(s.doc.partnerId);
  assert.strictEqual(cust.balance, 0, '欠款冲回');
  const s2 = ctx.getDoc('sales', s.doc.no);
  assert.strictEqual(s2.voided, true);
});

test('作废进货单：库存回滚、应付冲回', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  const r = engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 5, costPrice: '950' }], paid: '0'
  });
  const v = engine.voidPurchase(ctx, r.doc.no);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(p.stock, 0, '进货作废库存归零');
  const sup = ctx.getPartner(r.doc.partnerId);
  assert.strictEqual(sup.balance, 0, '应付冲回');
});

test('收付款：供应商付款 / 客户回款', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  const pur = engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 5, costPrice: '950' }], paid: '0'
  });
  const sup = ctx.getPartner(pur.doc.partnerId);
  const pay = engine.settleAccount(ctx, { partnerId: sup.id, amount: '3000', date: '2026-09-03', isSupplier: true });
  assert.strictEqual(pay.ok, true);
  assert.strictEqual(sup.balance, 5 * 95000 - 300000);

  const s = engine.saveSale(ctx, {
    date: '2026-09-04', partnerName: '王老板',
    items: [{ productId: p.id, qty: 1, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '0' }]
  });
  const cust = ctx.getPartner(s.doc.partnerId);
  const rec = engine.settleAccount(ctx, { partnerId: cust.id, amount: '1399', date: '2026-09-05', isSupplier: false });
  assert.strictEqual(rec.ok, true);
  assert.strictEqual(cust.balance, 0);
});

test('销售明细含价格类型枚举校验：非法类型回退零售', () => {
  const ctx = newCtx();
  const p = seedOne(ctx);
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '格力经销商',
    items: [{ productId: p.id, qty: 2, costPrice: '1000' }], paid: '99999'
  });
  const s = engine.saveSale(ctx, {
    date: '2026-09-02',
    items: [{ productId: p.id, qty: 1, price: '1399', priceType: 'OTHER' }],
    payments: [{ method: 'wechat', amount: '1399' }]
  });
  assert.strictEqual(s.doc.items[0].priceType, 'retail', '非法价格类型回退零售');
});
