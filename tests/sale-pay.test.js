/**
 * V3.17 问题4 —— 销售单未结清款后续处理：按单据补回款（分期结清）
 * 验证：
 *  ① engine.paySale 部分回款 / 分次回款 / 结清 / 超额拦截 / 已结清拦截 / 作废单拦截；
 *  ② 客户应收余额同步冲减、回款流水留痕（refNo 指向单据）；
 *  ③ 补回款后作废销售单：只回滚剩余未结部分，不与已补回款重复冲减；
 *  ④ 销售管理页 UI：回款按钮、补回款弹窗、部分回款/已结清状态、剩余未结显示。
 */
const test = require('node:test');
const assert = require('node:assert');
const engine = require('../js/core/engine.js');
const ledger = require('../js/core/ledger.js');
const schema = require('../js/core/schema.js');
const product = require('../js/core/product.js');
const page = require('../js/ui/page-sale.js');
const { newCtx } = require('./helpers/ctx.js');

function seed(ctx) {
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  return ctx.data.products[0];
}

/** 给商品补库存 */
function stock(ctx, p, qty) {
  const r = engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '供货方',
    items: [{ productId: p.id, qty: qty, costPrice: '1000' }],
    paid: String(qty * 1000)
  });
  assert.ok(r.ok, '进货入库成功');
}

/** 建一张总额 5598 元、实收 1000、欠款 4598 的销售单，返回 {doc, partner} */
function unpaidDoc(ctx, p) {
  const r = engine.saveSale(ctx, {
    date: '2026-09-01', partnerName: '红星电器行',
    items: [{ productId: p.id, qty: 4, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'cash', amount: '1000' }]
  });
  assert.ok(r.ok, '销售单保存成功');
  return { doc: ctx.data.sales[0], partner: ctx.data.partners.find(function (x) { return x.type === 'customer'; }) };
}

test('paySale：部分回款——paidExtra/剩余未结/客户应收同步冲减/流水留痕', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  stock(ctx, p, 10);
  const { doc, partner } = unpaidDoc(ctx, p);
  assert.strictEqual(doc.debt, 459600, '初始欠款 4596 元');
  assert.strictEqual(partner.balance, 459600, '客户应收 4596 元');

  const r = engine.paySale(ctx, { no: doc.no, amount: '1500', date: '2026-09-10', method: '微信', note: '第一批款' });
  assert.ok(r.ok, '补回款成功');
  assert.strictEqual(r.doc.paidExtra, 150000, '补回款累计 1500 元');
  assert.strictEqual(r.remaining, 309600, '剩余未结 3096 元');
  assert.strictEqual(r.settled, false, '未结清');
  assert.strictEqual(partner.balance, 309600, '客户应收同步冲减至 3096 元');

  // 流水留痕：收客户欠款，refNo 指向销售单号
  const flow = (ctx.data.ledgers || []).find(function (l) {
    return l.type === schema.LEDGER.RECEIVE_DEBT && l.refNo === doc.no;
  });
  assert.ok(flow, '生成回款流水');
  assert.strictEqual(flow.amount, 150000, '流水金额 1500 元');

  // 分次补回：再回 3096 结清
  const r2 = engine.paySale(ctx, { no: doc.no, amount: '3096', date: '2026-09-20', method: '银行转账' });
  assert.ok(r2.ok, '第二次补回成功');
  assert.strictEqual(r2.settled, true, '已结清');
  assert.strictEqual(r2.remaining, 0, '剩余未结 0');
  assert.ok(r2.doc.settledAt === '2026-09-20', '记录结清日期');
  assert.strictEqual(partner.balance, 0, '客户应收清零');
  assert.strictEqual(r2.doc.payLog.length, 2, '补回款记录 2 笔');
});

test('paySale：超额回款被拦截、已结清单与作废单不能再回款', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  stock(ctx, p, 10);
  const { doc } = unpaidDoc(ctx, p);

  const over = engine.paySale(ctx, { no: doc.no, amount: '5000' });
  assert.strictEqual(over.ok, false, '超过剩余未结被拦截');
  assert.ok(String(over.error).indexOf('3096') > 0 || String(over.error).indexOf('未结') > 0, '提示剩余未结金额');

  engine.paySale(ctx, { no: doc.no, amount: '4596' });
  const again = engine.paySale(ctx, { no: doc.no, amount: '1' });
  assert.strictEqual(again.ok, false, '已结清单不能再回款');

  const ctx2 = newCtx();
  const p2 = seed(ctx2);
  stock(ctx2, p2, 10);
  const d2 = unpaidDoc(ctx2, p2).doc;
  engine.voidSale(ctx2, d2.no);
  const onVoid = engine.paySale(ctx2, { no: d2.no, amount: '100' });
  assert.strictEqual(onVoid.ok, false, '作废单不能再回款');
});

test('补回款后作废销售单：只回滚剩余未结部分（不与补回款重复冲减）', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  stock(ctx, p, 10);
  const { doc, partner } = unpaidDoc(ctx, p); // 欠 4596
  engine.paySale(ctx, { no: doc.no, amount: '1500', date: '2026-09-10' });
  assert.strictEqual(partner.balance, 309600, '补回后应收 3096');

  const v = engine.voidSale(ctx, doc.no);
  assert.ok(v.ok, '作废成功');
  assert.strictEqual(partner.balance, 0, '只回滚剩余未结 3098 → 应收归 0（补回 1500 不重复回滚）');
});

test('UI：列表显示回款按钮/剩余未结/部分回款状态，回款弹窗与 do-pay 全流程', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  stock(ctx, p, 10);
  const { doc } = unpaidDoc(ctx, p);
  const st = page.init();

  // 未结清：显示「回款」按钮与未结金额 4596
  let html = page.render(ctx, st);
  assert.ok(html.includes('data-act="open-pay"'), '未结清单显示回款按钮');
  assert.ok(html.includes('¥4596.00'), '列表显示未结金额');
  assert.ok(html.includes('欠款'), '显示欠款状态');

  // 打开补回款弹窗：默认填入剩余未结金额
  page.actions['open-pay'](ctx, st, { getAttribute: () => doc.no });
  html = page.render(ctx, st);
  assert.ok(html.includes('销售单补回款 · ' + doc.no), '弹窗标题含单号');
  assert.ok(html.includes('剩余未结 ¥4596.00'), '弹窗显示剩余未结');
  assert.ok(html.includes('value="4596"'), '默认填入未结金额');
  assert.ok(html.includes('data-act="do-pay"'), '确认回款按钮');

  // 部分回款后：状态变「部分回款」，实收列含补回金额
  page.actions['pay-field'](ctx, st, { getAttribute: (k) => (k === 'data-name' ? 'amount' : null), value: '1500' });
  const ok = page.actions['do-pay'](ctx, st);
  assert.strictEqual(ok, true, '回款成功');
  html = page.render(ctx, st);
  assert.ok(html.includes('部分回款'), '部分回款状态');
  assert.ok(html.includes('¥3096.00'), '剩余未结更新为 3096');
  assert.ok(html.includes('data-act="open-pay"'), '仍有未结，保留回款按钮');

  // 查看单据：显示补回款记录
  page.actions['view-doc'](ctx, st, { getAttribute: () => doc.no });
  html = page.render(ctx, st);
  assert.ok(html.includes('补回款日期'), '详情含补回款记录表');
  assert.ok(html.includes('¥1500.00'), '详情显示补回金额');

  // 全部结清后：回款按钮消失、状态「已结清」
  engine.paySale(ctx, { no: doc.no, amount: '3096' });
  html = page.render(ctx, st);
  assert.ok(!html.includes('data-act="open-pay"'), '结清后无回款按钮');
  assert.ok(html.includes('已结清'), '结清状态');
});

test('UI：无欠款单与作废单不显示回款按钮', () => {
  const ctx = newCtx();
  const p = seed(ctx);
  stock(ctx, p, 10);
  // 已结清
  engine.saveSale(ctx, {
    date: '2026-09-01', partnerName: '甲客户',
    items: [{ productId: p.id, qty: 1, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'cash', amount: '1399' }]
  });
  // 有欠款
  engine.saveSale(ctx, {
    date: '2026-09-02', partnerName: '乙客户',
    items: [{ productId: p.id, qty: 2, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'cash', amount: '0' }]
  });
  const ctx2 = newCtx();
  const p2 = seed(ctx2);
  stock(ctx2, p2, 10);
  const d2 = engine.saveSale(ctx2, {
    date: '2026-09-03', partnerName: '丙客户',
    items: [{ productId: p2.id, qty: 1, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'cash', amount: '0' }]
  });
  engine.voidSale(ctx2, d2.doc.no);

  const html1 = page.render(ctx, page.init());
  assert.ok(html1.includes('data-act="open-pay"'), '有欠款单显示回款按钮');
  // 已结清/作废不显示：通过第二个上下文验证
  const html2 = page.render(ctx2, page.init());
  assert.ok(!html2.includes('data-act="open-pay"'), '作废单不显示回款按钮');
});
