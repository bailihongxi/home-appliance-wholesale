/**
 * tests/doc-detail-position.test.js —— V3.26 单据明细模块移到列表上方
 * 进货管理 / 销售管理页面：点「查看」展开的单据明细，此前追加在单据列表下方，
 * 需要下滚才能看到；现在渲染在列表上方，点开即可见，列表仍在下方。
 */
const test = require('node:test');
const assert = require('node:assert');
const engine = require('../js/core/engine.js');
const product = require('../js/core/product.js');
const purchasePage = require('../js/ui/page-purchase.js');
const salePage = require('../js/ui/page-sale.js');
const { newCtx } = require('./helpers/ctx.js');

/** 列表表格的表头标记（明细卡中不存在） */
const LIST_HEAD = '<th>单号</th>';

function seedProduct(ctx, model) {
  const r = product.save(ctx, {
    brand: '海尔', model: model, category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  return r.product;
}

test('进货管理：点「查看」后明细渲染在单据列表上方', () => {
  const ctx = newCtx();
  const p = seedProduct(ctx, 'BCD-200');
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '美的总代理',
    items: [{ productId: p.id, qty: 5, costPrice: '1000' }],
    paid: '1000'
  });
  const no = ctx.data.purchases[0].no;

  const state = purchasePage.init();
  state.viewNo = no;
  const h = purchasePage.render(ctx, state);

  const detailIdx = h.indexOf('进货单 ' + no);
  const listIdx = h.indexOf(LIST_HEAD);
  assert.ok(detailIdx >= 0, '明细卡已渲染');
  assert.ok(listIdx >= 0, '单据列表已渲染');
  assert.ok(detailIdx < listIdx, '明细在列表上方（不再需要下滚查看）');
});

test('进货管理：未点查看时不渲染明细，仅显示列表', () => {
  const ctx = newCtx();
  const p = seedProduct(ctx, 'BCD-201');
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '美的总代理',
    items: [{ productId: p.id, qty: 2, costPrice: '1000' }],
    paid: '0'
  });

  const state = purchasePage.init();
  const h = purchasePage.render(ctx, state);
  assert.ok(h.indexOf(LIST_HEAD) >= 0, '列表正常显示');
  assert.ok(h.indexOf('data-act="close-view"') < 0, '未点查看时不出现明细卡');
});

test('销售管理：点「查看」后明细渲染在单据列表上方', () => {
  const ctx = newCtx();
  const p = seedProduct(ctx, 'BCD-202');
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '美的总代理',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }],
    paid: '10000'
  });
  const r = engine.saveSale(ctx, {
    date: '2026-09-02', partnerName: '张三电器',
    items: [{ productId: p.id, qty: 3, price: '1300' }],
    received: '3900'
  });
  assert.ok(r.ok, '销售单保存成功');
  const no = ctx.data.sales[0].no;

  const state = salePage.init();
  state.tab = 'list';
  state.viewNo = no;
  const h = salePage.render(ctx, state);

  const detailIdx = h.indexOf('销售单 ' + no);
  const listIdx = h.indexOf(LIST_HEAD);
  assert.ok(detailIdx >= 0, '明细卡已渲染');
  assert.ok(listIdx >= 0, '单据列表已渲染');
  assert.ok(detailIdx < listIdx, '明细在列表上方');
});

test('销售管理：退货弹窗仍在列表下方，不受明细位置调整影响', () => {
  const ctx = newCtx();
  const p = seedProduct(ctx, 'BCD-203');
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '美的总代理',
    items: [{ productId: p.id, qty: 10, costPrice: '1000' }],
    paid: '10000'
  });
  engine.saveSale(ctx, {
    date: '2026-09-02', partnerName: '张三电器',
    items: [{ productId: p.id, qty: 3, price: '1300' }],
    received: '3900'
  });
  const no = ctx.data.sales[0].no;

  const state = salePage.init();
  state.tab = 'list';
  state.refundNo = no;
  const h = salePage.render(ctx, state);

  const refundIdx = h.indexOf('data-act="do-refund"');
  const listIdx = h.indexOf(LIST_HEAD);
  assert.ok(refundIdx >= 0, '退货弹窗已渲染');
  assert.ok(listIdx >= 0, '列表已渲染');
  assert.ok(refundIdx > listIdx, '退货弹窗仍在列表下方（本次只调整明细位置）');
});

test('明细卡功能完整：关闭按钮与打印按钮仍在明细中', () => {
  const ctx = newCtx();
  const p = seedProduct(ctx, 'BCD-204');
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '美的总代理',
    items: [{ productId: p.id, qty: 5, costPrice: '1000' }],
    paid: '1000'
  });
  const no = ctx.data.purchases[0].no;

  const state = purchasePage.init();
  state.viewNo = no;
  const h = purchasePage.render(ctx, state);
  assert.ok(h.indexOf('data-act="close-view"') >= 0, '关闭按钮存在');
  assert.ok(h.indexOf('data-act="print-doc"') >= 0, '打印按钮存在');
  assert.ok(h.indexOf('合计') >= 0, '合计信息存在');
});
