const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-sale.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

function seed(ctx) {
  const p1 = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  const p2 = product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599',
    barcodes: '6923456789012'
  });
  return { p1: p1.product, p2: p2.product };
}

function fresh(ctx) {
  const s = page.init();
  s.tab = 'new'; // 测试聚焦开单表单视图
  return s;
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'sale');
  assert.strictEqual(page.title, '销售管理');
  const ctx = newCtx();
  const state = page.init();
  assert.strictEqual(state.tab, 'list', '默认进入销售管理（列表）视图，与进货管理同等级');
  assert.deepStrictEqual(state.form.items, []);
});

test('init：跨页预选 pendingSaleProduct', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  global.__sale = page;
  const E = globalThis.ERP;
  const orig = globalThis.ERP;
  if (!globalThis.ERP) globalThis.ERP = {};
  globalThis.ERP.pendingSaleProduct = p1.id;
  const state = page.init();
  assert.strictEqual(state.form.productId, p1.id);
  globalThis.ERP = orig;
});

test('pick-product：加入商品，默认零售价', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const state = fresh(ctx);
  page.actions['pick-product'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.form.items.length, 1);
  const it = state.form.items[0];
  assert.strictEqual(it.productId, p1.id);
  assert.strictEqual(it.qty, 1);
  assert.strictEqual(it.price, p1.priceRetail, '默认零售价');
  assert.strictEqual(it.priceType, 'retail');
  // 再次点击 → 数量累加
  page.actions['pick-product'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.form.items[0].qty, 2);
});

test('toggle-price：零售 ↔ 批发 切换', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const state = fresh(ctx);
  page.actions['pick-product'](ctx, state, { getAttribute: () => p1.id });
  // 切批发
  page.actions['toggle-price'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.form.items[0].priceType, 'wholesale');
  assert.strictEqual(state.form.items[0].price, p1.priceWholesale);
  // 切回零售
  page.actions['toggle-price'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.form.items[0].priceType, 'retail');
  assert.strictEqual(state.form.items[0].price, p1.priceRetail);
});

test('cart-qty / cart-price / del-item', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const state = fresh(ctx);
  page.actions['pick-product'](ctx, state, { getAttribute: () => p1.id });
  page.actions['cart-qty'](ctx, state, { getAttribute: () => p1.id, value: '3' });
  assert.strictEqual(state.form.items[0].qty, 3);
  page.actions['cart-price'](ctx, state, { getAttribute: () => p1.id, value: '1300' });
  assert.strictEqual(state.form.items[0].price, 130000);
  page.actions['del-item'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.form.items.length, 0);
});

test('save-sale：出单成功，库存扣减，批发价落单', () => {
  const ctx = newCtx();
  const { p1, p2 } = seed(ctx);
  // 先加库存
  const inv = require('../js/core/inventory.js');
  inv.applyPurchase(ctx, { date: '2026-09-01', items: [{ productId: p1.id, qty: 10, cost: 100000 }], supplier: '测试' });
  inv.applyPurchase(ctx, { date: '2026-09-01', items: [{ productId: p2.id, qty: 10, cost: 180000 }], supplier: '测试' });

  const state = fresh(ctx);
  page.actions['pick-product'](ctx, state, { getAttribute: () => p1.id });
  page.actions['toggle-price'](ctx, state, { getAttribute: () => p1.id }); // 批发
  page.actions['pick-product'](ctx, state, { getAttribute: () => p2.id }); // 零售
  page.actions['field'](ctx, state, { getAttribute: () => 'pay.cash', value: '4000' });

  const ok = page.actions['save-sale'](ctx, state);
  assert.strictEqual(ok, true);
  const doc = ctx.data.sales[0];
  assert.ok(doc);
  assert.strictEqual(doc.items[0].priceType, 'wholesale');
  assert.strictEqual(doc.items[0].price, p1.priceWholesale);
  assert.strictEqual(doc.items[1].priceType, 'retail');
  // 库存扣减
  assert.strictEqual(product.getById(ctx, p1.id).stock, 9);
  assert.strictEqual(product.getById(ctx, p2.id).stock, 9);
});

test('save-sale：欠款需选客户；未收齐未开欠款则拦截', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const inv = require('../js/core/inventory.js');
  inv.applyPurchase(ctx, { date: '2026-09-01', items: [{ productId: p1.id, qty: 5, cost: 100000 }], supplier: '测试' });

  const state = fresh(ctx);
  page.actions['pick-product'](ctx, state, { getAttribute: () => p1.id });
  // 未收齐且不开欠款
  const ok1 = page.actions['save-sale'](ctx, state);
  assert.strictEqual(ok1, false, '未收齐应拦截');
  // 开欠款但未选客户
  page.actions['toggle-debt'](ctx, state);
  const ok2 = page.actions['save-sale'](ctx, state);
  assert.strictEqual(ok2, false, '欠款未选客户应拦截');
});

test('列表渲染：销售记录含品牌型号', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const inv = require('../js/core/inventory.js');
  inv.applyPurchase(ctx, { date: '2026-09-01', items: [{ productId: p1.id, qty: 3, cost: 100000 }], supplier: '测试' });
  const state = fresh(ctx);
  state.tab = 'list';
  state.form = page.init().form;
  page.actions['pick-product'](ctx, state, { getAttribute: () => p1.id });
  page.actions['field'](ctx, state, { getAttribute: () => 'pay.cash', value: '1399' });
  page.actions['save-sale'](ctx, state);
  const html = page.render(ctx, state);
  assert.ok(html.includes('销售管理'));
  assert.ok(html.includes('销售开单'), '列表页右上角有「销售开单」按钮');
  assert.ok(html.includes('S2026'), '含销售单号');
  // 查看详情 → 弹层显示品牌型号
  const doc = ctx.data.sales[0];
  page.actions['view-doc'](ctx, state, { getAttribute: () => doc.no });
  const detail = page.render(ctx, state);
  assert.ok(detail.includes('海尔'));
  assert.ok(detail.includes('BCD-200'));
  assert.ok(detail.includes('零售'), '详情显示价格类型');
  assert.ok(detail.includes('data-act="print-doc"'), '单据弹层有打印按钮');
  assert.ok(detail.includes('>打印<'), '打印按钮文案');
});

test('扫码加单：scan-input 按条码定位商品', () => {
  const ctx = newCtx();
  const { p2 } = seed(ctx);
  const state = fresh(ctx);
  page.actions['scan-input'](ctx, state, { value: '6923456789012' });
  assert.strictEqual(state.form.items.length, 1);
  assert.strictEqual(state.form.items[0].productId, p2.id);
});

test('收款模块在页面底部横排（sale-bottom-pay + 一行紧凑排布，非右列 sale-col-pay）', () => {
  const ctx = newCtx();
  const state = fresh(ctx);
  state.tab = 'new';
  const html = page.render(ctx, state);
  // 收款模块在底部容器中
  assert.ok(html.includes('sale-bottom-pay'), '收款模块位于底部容器');
  assert.ok(html.includes('pay-grid'), '收款内部为横向排布容器');
  assert.ok(html.includes('pay-row1'), '第1行：收款方式/指标/按钮包裹在 pay-row1 中');
  assert.ok(html.includes('pm-input'), '收款方式（微信/现金/支付宝）为紧凑输入框');
  assert.ok(html.includes('pay-stats'), '实收/余款处理/欠款为一行指标区');
  assert.ok(html.includes('pay-actions'), '取消/保存按钮区');
  assert.ok(html.includes('pay-note'), '第2行备注区独立存在（独占整行加长）');
  assert.ok(html.indexOf('pay-note') > html.indexOf('data-act="save-sale"'),
    '备注行位于按钮区之后（按钮在第1行，备注独占第2行）');
  // 不再出现旧右列结构
  assert.ok(!html.includes('sale-col-pay'), '收款不再作为右侧独立列');
  assert.ok(!html.includes('pay-methods-row'), '不再使用旧的横向包装类');
  // 上部两列容器存在
  assert.ok(html.includes('sale-top-col'), '上部两列容器（选货+订单）存在');
});

test('默认销售管理视图：tab=list 渲染列表页，右上角「销售开单」按钮', () => {
  const ctx = newCtx();
  const state = page.init(); // tab='list'
  const html = page.render(ctx, state);
  assert.ok(html.includes('销售管理'), '页头标题为销售管理');
  assert.ok(html.includes('data-act="open-new"'), '含开单动作按钮');
  assert.ok(html.includes('销售开单'), '按钮文案为销售开单');
});

test('直达开单：hash #/sale?tab=new 应用后进入开单视图并清除 query', () => {
  const origLoc = globalThis.location, origHist = globalThis.history;
  const calls = [];
  globalThis.location = { hash: '#/sale?tab=new' };
  globalThis.history = { replaceState: function () { calls.push(Array.from(arguments)); } };
  try {
    const ctx = newCtx();
    const state = page.init(); // 初始 tab='list'
    const html = page.render(ctx, state);
    assert.strictEqual(state.tab, 'new', 'query 直达开单视图');
    assert.ok(html.includes('sale-top-col'), '渲染开单表单布局');
    assert.ok(html.includes('sale-bottom-pay'), '渲染底部收款');
    assert.strictEqual(calls.length, 1, '应用后清除 query 避免与页内操作冲突');
    assert.strictEqual(calls[0][2], '#/sale');
  } finally {
    globalThis.location = origLoc;
    globalThis.history = origHist;
  }
});

test('选货区：默认每页 15 条 + 斑马纹 + 分页导航（pick-page）', () => {
  const ctx = newCtx();
  for (let i = 0; i < 20; i++) {
    product.save(ctx, {
      brand: '品牌' + i, model: 'M' + String(i).padStart(3, '0'), category: '生活小家电',
      unit: '台', cost: '500', priceWholesale: '800', priceRetail: '1290'
    });
  }
  const state = fresh(ctx);
  const html = page.render(ctx, state);
  // 斑马纹 + 默认 15 行
  assert.ok(html.includes('tbl tbl-striped'), '选货表格应带斑马纹样式');
  const rows = (html.match(/data-act="pick-product"/g) || []).length;
  assert.strictEqual(rows, 15, '默认只显示前 15 条商品，避免加载过多');
  // 分页导航：共 20 条 → 2 页，动作名为 pick-page
  assert.ok(html.includes('data-act="pick-page"'), '选货分页应使用 pick-page 动作');
  assert.ok(html.includes('共 20 条'), '分页显示总条数');

  // 翻到第 2 页
  page.actions['pick-page'](ctx, state, { getAttribute: (k) => (k === 'data-page' ? '2' : null) });
  const html2 = page.render(ctx, state);
  assert.strictEqual((html2.match(/data-act="pick-product"/g) || []).length, 5, '第 2 页显示剩余 5 条');
  assert.ok(html2.includes('2 / 2'), '第 2 页页码高亮');

  // 搜索词变化重置回第 1 页
  page.actions['keyword'](ctx, state, { value: '品牌1' });
  assert.strictEqual(state.form.pickPage, 1, '搜索词变化回到选货第 1 页');
});

test('销售列表搜索模块：第1行搜索+类型、第2行日期', () => {
  const ctx = newCtx();
  const state = page.init();
  state.tab = 'list';
  const html = page.render(ctx, state);
  const sb = html.indexOf('data-input="keyword"');
  const type = html.indexOf('data-name="typeFilter"');
  assert.ok(sb >= 0, '搜索框存在');
  assert.ok(type > sb && type - sb < 200, '类型下拉与搜索框同一行（filters 内）');
  assert.ok(html.includes('全部类型'), '类型下拉含全部类型');
  const from = html.indexOf('data-name="from"');
  assert.ok(from > type, '日期选择在第二行');
});
