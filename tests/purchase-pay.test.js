/**
 * V3.16 问题2 —— 进货单未结清款后续处理：按单据补付款（分期结清）
 * 验证：
 *  ① engine.payPurchase 部分付款 / 分次付款 / 结清 / 超额拦截 / 已结清拦截 / 作废单拦截；
 *  ② 供应商应付余额同步冲减、付款流水留痕（refNo 指向单据）；
 *  ③ 补付款后作废进货单：只回滚剩余未结部分，不与已补付款重复冲减；
 *  ④ 进货管理页 UI：付款按钮、补付款弹窗、部分付款/已结清状态、剩余未结合计。
 */
const test = require('node:test');
const assert = require('node:assert');
const engine = require('../js/core/engine.js');
const ledger = require('../js/core/ledger.js');
const schema = require('../js/core/schema.js');
const product = require('../js/core/product.js');
const page = require('../js/ui/page-purchase.js');
const { newCtx } = require('./helpers/ctx.js');

function seed(ctx) {
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  return ctx.data.products[0];
}

/** 建一张总额 5000 元、已付 1000、欠款 4000 的进货单，返回 {doc, partner} */
function unpaidDoc(ctx, p) {
  const r = engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '美的总代理',
    items: [{ productId: p.id, qty: 5, costPrice: '1000' }],
    paid: '1000'
  });
  assert.ok(r.ok, '进货单保存成功');
  return { doc: ctx.data.purchases[0], partner: ctx.data.partners[0] };
}

test('payPurchase：部分付款——paidExtra/剩余未结/供应商应付同步冲减/流水留痕', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  const { doc, partner } = unpaidDoc(ctx, p);
  assert.strictEqual(doc.debt, 400000, '初始欠款 4000 元');
  assert.strictEqual(partner.balance, 400000, '供应商应付 4000 元');

  const r = engine.payPurchase(ctx, { no: doc.no, amount: '1500', date: '2026-09-10', method: '微信', note: '第一批款' });
  assert.ok(r.ok, '补付款成功');
  assert.strictEqual(r.doc.paidExtra, 150000, '补付累计 1500 元');
  assert.strictEqual(r.remaining, 250000, '剩余未结 2500 元');
  assert.strictEqual(r.settled, false, '未结清');
  assert.strictEqual(partner.balance, 250000, '供应商应付同步冲减至 2500 元');

  // 流水留痕：付供应商款，refNo 指向进货单号
  const flow = (ctx.data.ledgers || []).find(function (l) {
    return l.type === schema.LEDGER.PAY_SUPPLIER && l.refNo === doc.no;
  });
  assert.ok(flow, '生成付款流水');
  assert.strictEqual(flow.amount, 150000, '流水金额 1500 元');

  // 分次补付：再付 2500 结清
  const r2 = engine.payPurchase(ctx, { no: doc.no, amount: '2500', date: '2026-09-20', method: '银行转账' });
  assert.ok(r2.ok, '第二次补付成功');
  assert.strictEqual(r2.settled, true, '已结清');
  assert.strictEqual(r2.remaining, 0, '剩余未结 0');
  assert.ok(r2.doc.settledAt === '2026-09-20', '记录结清日期');
  assert.strictEqual(partner.balance, 0, '供应商应付清零');
  assert.strictEqual(r2.doc.payLog.length, 2, '补付款记录 2 笔');
});

test('payPurchase：超额付款被拦截、已结清单与作废单不能再付款', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  const { doc } = unpaidDoc(ctx, p);

  const over = engine.payPurchase(ctx, { no: doc.no, amount: '5000' });
  assert.strictEqual(over.ok, false, '超过剩余未结被拦截');
  assert.ok(String(over.error).indexOf('2500') > 0 || String(over.error).indexOf('未结') > 0, '提示剩余未结金额');

  engine.payPurchase(ctx, { no: doc.no, amount: '4000' });
  const again = engine.payPurchase(ctx, { no: doc.no, amount: '1' });
  assert.strictEqual(again.ok, false, '已结清单不能再付款');

  const ctx2 = newCtx();
  const p2 = seed(ctx2);
  const d2 = unpaidDoc(ctx2, p2).doc;
  engine.voidPurchase(ctx2, d2.no);
  const onVoid = engine.payPurchase(ctx2, { no: d2.no, amount: '100' });
  assert.strictEqual(onVoid.ok, false, '作废单不能再付款');
});

test('补付款后作废进货单：只回滚剩余未结部分（不与补付款重复冲减）', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  const { doc, partner } = unpaidDoc(ctx, p); // 欠 4000
  engine.payPurchase(ctx, { no: doc.no, amount: '1500', date: '2026-09-10' });
  assert.strictEqual(partner.balance, 250000, '补付后应付 2500');

  const v = engine.voidPurchase(ctx, doc.no);
  assert.ok(v.ok, '作废成功');
  assert.strictEqual(partner.balance, 0, '只回滚剩余未结 2500 → 应付归 0（补付 1500 不重复回滚）');
});

test('UI：列表显示付款按钮/剩余未结/部分付款状态，付款弹窗与 do-pay 全流程', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  const { doc } = unpaidDoc(ctx, p);
  const st = page.init();

  // 未结清：显示「付款」按钮与未结金额 4000
  let html = page.render(ctx, st);
  assert.ok(html.includes('data-act="open-pay"'), '未结清单显示付款按钮');
  assert.ok(html.includes('¥4000.00'), '列表显示未结金额');
  assert.ok(html.includes('未结清'), '显示未结清状态');

  // 打开补付款弹窗：默认填入剩余未结金额
  page.actions['open-pay'](ctx, st, { getAttribute: () => doc.no });
  html = page.render(ctx, st);
  assert.ok(html.includes('进货单补付款 · ' + doc.no), '弹窗标题含单号');
  assert.ok(html.includes('剩余未结 ¥4000.00'), '弹窗显示剩余未结');
  assert.ok(html.includes('value="4000"'), '默认填入未结金额');
  assert.ok(html.includes('data-act="do-pay"'), '确认付款按钮');

  // 部分付款后：状态变「部分付款」，已付列含补付金额
  page.actions['pay-field'](ctx, st, { getAttribute: (k) => (k === 'data-name' ? 'amount' : null), value: '1500' });
  const ok = page.actions['do-pay'](ctx, st);
  assert.strictEqual(ok, true, '付款成功');
  html = page.render(ctx, st);
  assert.ok(html.includes('部分付款'), '部分付款状态');
  assert.ok(html.includes('¥2500.00'), '剩余未结更新为 2500');
  assert.ok(html.includes('data-act="open-pay"'), '仍有未结，保留付款按钮');

  // 查看单据：显示补付款记录
  page.actions['view-doc'](ctx, st, { getAttribute: () => doc.no });
  html = page.render(ctx, st);
  assert.ok(html.includes('补付款日期'), '详情含补付款记录表');
  assert.ok(html.includes('¥1500.00'), '详情显示补付金额');

  // 全部结清后：付款按钮消失、状态「已结清」
  engine.payPurchase(ctx, { no: doc.no, amount: '2500' });
  html = page.render(ctx, st);
  assert.ok(!html.includes('data-act="open-pay"'), '结清后无付款按钮');
  assert.ok(html.includes('已结清'), '结清状态');
});

test('UI：无欠款单与作废单不显示付款按钮，未结合计只算剩余未结', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  const r1 = engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '甲供应商',
    items: [{ productId: p.id, qty: 1, costPrice: '1000' }], paid: '1000'
  });
  const r2 = engine.savePurchase(ctx, {
    date: '2026-09-02', partnerName: '乙供应商',
    items: [{ productId: p.id, qty: 2, costPrice: '1000' }], paid: '0'
  });
  assert.ok(r1.ok && r2.ok);
  engine.voidPurchase(ctx, r2.doc.no);
  const st = page.init();
  const html = page.render(ctx, st);
  assert.ok(!html.includes('data-act="open-pay"'), '已付清/作废单均无付款按钮');
  assert.ok(html.includes('未结 ¥0.00'), '未结合计为 0');
});
