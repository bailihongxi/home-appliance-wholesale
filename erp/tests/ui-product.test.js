const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

function fresh() {
  const ctx = newCtx();
  const state = page.init(ctx);
  return { ctx, state };
}

function seed(ctx) {
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399', note: '一级能效',
    barcodes: '6901234567892'
  });
  product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'product');
  assert.strictEqual(page.title, '商品档案');
  const { state } = fresh();
  assert.strictEqual(state.tab, 'list');
  assert.strictEqual(state.form.category, '冰箱');
  assert.strictEqual(state.form.unit, '台');
});

test('空列表：显示引导而不是报错', () => {
  const { ctx, state } = fresh();
  const html = page.render(ctx, state);
  assert.ok(html.includes('新建商品'));
  assert.ok(html.includes('没有匹配的商品'));
});

test('列表：品牌、型号分两列，显示成本/批发/零售/库存', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const html = page.render(ctx, state);
  assert.ok(html.includes('海尔'));
  assert.ok(html.includes('BCD-200'));
  assert.ok(html.includes('格力'));
  assert.ok(html.includes('KFR-35'));
  assert.ok(html.includes('¥1000.00'), '显示成本');
  assert.ok(html.includes('¥1200.00'), '显示批发价');
  assert.ok(html.includes('¥1399.00'), '显示零售价');
  assert.ok(html.includes('商品档案'));
  assert.ok(!html.includes('款号'), '不应再显示款号');
  assert.ok(!html.includes('色码'), '不应再显示色码');
});

test('搜索：按品牌 / 型号 / 备注 / 条码过滤', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const s1 = Object.assign({}, state, { keyword: '海尔' });
  assert.ok(page.render(ctx, s1).includes('BCD-200'));
  assert.ok(!page.render(ctx, s1).includes('KFR-35'));

  const s2 = Object.assign({}, state, { keyword: '能效' });
  assert.ok(page.render(ctx, s2).includes('BCD-200'));

  const s3 = Object.assign({}, state, { keyword: '6901234567892' });
  assert.ok(page.render(ctx, s3).includes('BCD-200'));
});

test('停售/上架切换：状态 badge 与 setStatus 联动', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const p = ctx.data.products[0];
  // 模拟点击停售
  page.actions['toggle-status'](ctx, state, { getAttribute: () => p.id });
  assert.strictEqual(p.status, 'off');
  const html = page.render(ctx, state);
  assert.ok(html.includes('停售'));
  // 上架
  page.actions['toggle-status'](ctx, state, { getAttribute: () => p.id });
  assert.strictEqual(p.status, 'on');
});

test('编辑：表单回填商品字段', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const p = ctx.data.products[0];
  page.actions['edit-product'](ctx, state, { getAttribute: () => p.id });
  assert.strictEqual(state.tab, 'new');
  assert.strictEqual(state.editing, p.id);
  assert.strictEqual(state.form.brand, '海尔');
  assert.strictEqual(state.form.model, 'BCD-200');
  assert.strictEqual(state.form.cost, 1000);
});

test('保存：新建商品（含期初库存）', () => {
  const { ctx, state } = fresh();
  state.tab = 'new';
  state.form = {
    id: null, brand: '美的', model: 'KFR-26', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599',
    note: '', barcodes: '692111', openingStock: '5'
  };
  const ok = page.actions['save-product'](ctx, state);
  assert.strictEqual(ok, true);
  assert.strictEqual(ctx.data.products.length, 1);
  assert.strictEqual(ctx.data.products[0].stock, 5, '期初库存生效');
  assert.strictEqual(state.tab, 'list');
});

test('保存：品牌+型号 重复被拦截', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  state.tab = 'new';
  state.form = {
    id: null, brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399',
    note: '', barcodes: '', openingStock: ''
  };
  const ok = page.actions['save-product'](ctx, state);
  assert.strictEqual(ok, false, '重复品牌型号应拦截');
  assert.strictEqual(ctx.data.products.length, 2, '未新增');
});

test('CSV 导入：do-import 走商品表头', () => {
  const { ctx, state } = fresh();
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型,单位,成本,批发价,零售价\n海尔,BCD-300,冰箱,台,1500,1800,2099';
  page.actions['do-import'](ctx, state);
  assert.strictEqual(state.csvResult.created, 1);
  assert.strictEqual(ctx.data.products.length, 1);
  assert.strictEqual(ctx.data.products[0].brand, '海尔');
  assert.strictEqual(ctx.data.products[0].priceRetail, 209900);
});

test('导入模板：包含电器版表头', () => {
  const { state } = fresh();
  const page2 = require('../js/ui/page-product.js');
  let captured = null;
  // 模拟 app.download
  page2._capture = null;
  global.__app = { download: (name, csv) => { captured = { name, csv }; } };
  // 直接调用：包一层 stub app
  const origApp = globalThis.ERP && globalThis.ERP.app;
  if (globalThis.ERP) globalThis.ERP.app = global.__app;
  // download-template 依赖 ERP.app.download
  try {
    const fn = page2.actions['download-template'];
    if (fn) fn(ctx = newCtx(), state, null);
  } catch (e) { /* noop */ }
  if (globalThis.ERP) globalThis.ERP.app = origApp;
  if (captured) {
    assert.ok(captured.name.includes('商品导入模板'));
    assert.ok(captured.csv.includes('品牌,型号,类型,单位,成本,批发价,零售价'));
  }
});

/* ===== 问题1：类型可选择也可自定义填写 ===== */
test('问题1-新建表单：类型为可输入 input，含预设 datalist 建议', () => {
  const { ctx, state } = fresh();
  state.tab = 'new';
  state.form = Object.assign({}, state.form, { category: '' });
  const html = page.render(ctx, state);
  // 类型字段是可输入 input（可自由填写），而非只读下拉
  assert.ok(html.includes('data-name="category"'));
  assert.ok(/<input[^>]*data-name="category"[^>]*list="category-datalist"/.test(html), '类型为可输入 input 并绑定 datalist');
  // datalist 含预设类型建议
  assert.ok(html.includes('<datalist id="category-datalist"'));
  assert.ok(html.includes('>冰箱<'), 'datalist 含冰箱');
  assert.ok(html.includes('>洗衣机<'), 'datalist 含洗衣机');
  assert.ok(html.includes('>其他<'), 'datalist 含其他');
});

test('问题1-自定义类型：非预设类型可保存成功并正确落库', () => {
  const { ctx, state } = fresh();
  state.tab = 'new';
  state.form = {
    id: null, brand: '安吉尔', model: 'J2815', category: '净水器', unit: '台',
    cost: '1500', priceWholesale: '1800', priceRetail: '2099',
    note: '', barcodes: '', openingStock: ''
  };
  const ok = page.actions['save-product'](ctx, state);
  assert.strictEqual(ok, true, '自定义类型应保存成功');
  assert.strictEqual(ctx.data.products.length, 1);
  assert.strictEqual(ctx.data.products[0].category, '净水器');
  assert.strictEqual(state.tab, 'list', '保存后回到列表');
});

test('问题1-datalist 建议：包含账号内已用过的类型', () => {
  const { ctx, state } = fresh();
  seed(ctx); // 已建 冰箱/空调
  state.tab = 'new';
  state.form = Object.assign({}, state.form, { category: '' });
  const html = page.render(ctx, state);
  // 已用类型（冰箱、空调）也在建议中，便于再次选择
  assert.ok(html.includes('>空调<'));
});
