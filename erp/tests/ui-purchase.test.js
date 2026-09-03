const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-purchase.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const inv = require('../js/core/inventory.js');

function seed(ctx) {
  const p1 = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  const p2 = product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
  return { p1: p1.product, p2: p2.product };
}

function fresh(ctx) {
  return page.init();
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'purchase');
  assert.strictEqual(page.title, '进货管理');
  const ctx = newCtx();
  const state = fresh(ctx);
  assert.strictEqual(state.tab, 'list');
  assert.deepStrictEqual(state.form.items, []);
});

test('add-item：加入商品，数量累加，成本带出档案值', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const state = fresh(ctx);
  page.actions['add-item'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.form.items.length, 1);
  const it = state.form.items[0];
  assert.strictEqual(it.productId, p1.id);
  assert.strictEqual(it.qty, 1);
  assert.strictEqual(it.costPrice, '1000', '默认带出档案成本（元）');
  page.actions['add-item'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.form.items[0].qty, 2);
});

test('qty / price / del-item', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const state = fresh(ctx);
  page.actions['add-item'](ctx, state, { getAttribute: () => p1.id });
  page.actions['qty'](ctx, state, { getAttribute: () => p1.id, value: '5' });
  assert.strictEqual(state.form.items[0].qty, 5);
  page.actions['price'](ctx, state, { getAttribute: () => p1.id, value: '980' });
  assert.strictEqual(state.form.items[0].costPrice, '980');
  page.actions['del-item'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.form.items.length, 0);
});

test('applyBulkPrice：批量成本应用到全部明细', () => {
  const ctx = newCtx();
  const { p1, p2 } = seed(ctx);
  const state = fresh(ctx);
  page.actions['add-item'](ctx, state, { getAttribute: () => p1.id });
  page.actions['add-item'](ctx, state, { getAttribute: () => p2.id });
  const r = page.applyBulkPrice(state.form, '950');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(state.form.items[0].costPrice, '950');
  assert.strictEqual(state.form.items[1].costPrice, '950');
  const bad = page.applyBulkPrice(state.form, '');
  assert.strictEqual(bad.ok, false);
});

test('save-purchase：保存后库存增加、档案成本同步', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const state = fresh(ctx);
  state.tab = 'form';
  state.form.newPartner = '西安电器批发';
  page.actions['add-item'](ctx, state, { getAttribute: () => p1.id });
  page.actions['price'](ctx, state, { getAttribute: () => p1.id, value: '1050' });
  page.actions['quick-paid'](ctx, state);
  const ok = page.actions['save-purchase'](ctx, state);
  assert.strictEqual(ok, true);
  assert.strictEqual(ctx.data.purchases.length, 1);
  assert.strictEqual(product.getById(ctx, p1.id).stock, 1, '库存 +1');
  assert.strictEqual(product.getById(ctx, p1.id).cost, 105000, '档案成本同步为本次进价');
});

test('save-purchase：未选供应商被拦截', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const state = fresh(ctx);
  state.tab = 'form';
  page.actions['add-item'](ctx, state, { getAttribute: () => p1.id });
  const ok = page.actions['save-purchase'](ctx, state);
  assert.strictEqual(ok, false);
  assert.strictEqual(ctx.data.purchases.length, 0);
});

test('列表渲染：含供应商与金额', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const state = fresh(ctx);
  state.tab = 'form';
  state.form.newPartner = '西安电器批发';
  page.actions['add-item'](ctx, state, { getAttribute: () => p1.id });
  page.actions['quick-paid'](ctx, state);
  page.actions['save-purchase'](ctx, state);
  const html = page.render(ctx, state);
  assert.ok(html.includes('进货管理'));
  assert.ok(html.includes('供应商'));
  // 查看详情含品牌型号
  const doc = ctx.data.purchases[0];
  page.actions['view-doc'](ctx, state, { getAttribute: () => doc.no });
  const detail = page.render(ctx, state);
  assert.ok(detail.includes('海尔'));
  assert.ok(detail.includes('BCD-200'));
  assert.ok(detail.includes('data-act="print-doc"'), '单据弹层有打印按钮');
  assert.ok(detail.includes('>打印<'), '打印按钮文案');
});

test('进货选货区：默认每页 15 条 + 斑马纹 + 分页导航（pick-page）', () => {
  const ctx = newCtx();
  for (let i = 0; i < 18; i++) {
    product.save(ctx, {
      brand: '品牌' + i, model: 'M' + String(i).padStart(3, '0'), category: '生活小家电',
      unit: '台', cost: '500', priceWholesale: '800', priceRetail: '1290'
    });
  }
  const state = fresh(ctx);
  state.tab = 'form';
  const html = page.render(ctx, state);
  assert.ok(html.includes('tbl tbl-striped'), '进货选货表格应带斑马纹样式');
  assert.strictEqual((html.match(/data-act="add-item"/g) || []).length, 15, '默认只显示前 15 条商品');
  assert.ok(html.includes('data-act="pick-page"'), '进货选货分页应使用 pick-page 动作');
  assert.ok(html.includes('共 18 条'), '分页显示总条数');

  // 翻到第 2 页
  page.actions['pick-page'](ctx, state, { getAttribute: (k) => (k === 'data-page' ? '2' : null) });
  const html2 = page.render(ctx, state);
  assert.strictEqual((html2.match(/data-act="add-item"/g) || []).length, 3, '第 2 页显示剩余 3 条');
  assert.ok(html2.includes('2 / 2'), '第 2 页页码');

  // 搜索词变化重置回第 1 页
  page.actions['form-keyword'](ctx, state, { value: '品牌1' });
  assert.strictEqual(state.form.pickPage, 1, '搜索词变化回到选货第 1 页');
});
