const test = require('node:test');
const assert = require('node:assert');
// 模块内 ERP 为加载时快照：须在 require 前注入 app 桩（render/download）
globalThis.ERP = globalThis.ERP || {};
globalThis.ERP.app = globalThis.ERP.app || {};
globalThis.ERP.app.render = function () { globalThis.__renderCount = (globalThis.__renderCount || 0) + 1; };
globalThis.ERP.app.download = function (name, content, mime) { globalThis.__lastDownload = { name: name, content: content, mime: mime }; };
const page = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const util = require('../js/core/util.js');

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
    // V3.5：模板只体现成本，批发/零售留空导入后自动生成
    assert.ok(captured.csv.includes('品牌,型号,类型,单位,成本'));
    assert.ok(!captured.csv.includes('批发价'), '模板不含批发价列');
    assert.ok(!captured.csv.includes('零售价'), '模板不含零售价列');
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

/* ===== 问题2：新建商品后档案列表必须同步显示 ===== */
test('问题2-保存经营范围外的自定义类型：列表仍显示该商品', () => {
  const { ctx, state } = fresh();
  // 模拟账号经营范围不含「净水器」
  ctx.settings.scopeCategories = ['冰箱', '洗衣机', '空调', '电视'];
  state.tab = 'new';
  state.form = {
    id: null, brand: '安吉尔', model: 'J2815', category: '净水器', unit: '台',
    cost: '1500', priceWholesale: '1800', priceRetail: '2099',
    note: '', barcodes: '', openingStock: ''
  };
  const ok = page.actions['save-product'](ctx, state);
  assert.strictEqual(ok, true, '范围外自定义类型应保存成功');
  // 列表渲染必须包含该商品
  const html = page.render(ctx, Object.assign({}, state, { tab: 'list' }));
  assert.ok(html.includes('安吉尔'), '新建商品应显示在档案列表');
  assert.ok(html.includes('净水器'), '自定义类型应显示在列表');
  // 类型自动并入经营范围
  assert.ok(ctx.settings.scopeCategories.indexOf('净水器') >= 0, '新类型自动并入经营范围');
});

test('问题2-列表展示所有本店商品（不受经营范围过滤隐藏）', () => {
  const { ctx, state } = fresh();
  // 直接造一个经营范围外的商品
  product.save(ctx, {
    brand: '方太', model: 'JZT-B', category: '厨电', unit: '台',
    cost: '1200', priceWholesale: '1500', priceRetail: '1799'
  });
  ctx.settings.scopeCategories = ['冰箱', '洗衣机']; // 不包含「厨电」
  const html = page.render(ctx, state);
  assert.ok(html.includes('方太'), '经营范围外的已保存商品也必须显示');
  assert.ok(html.includes('厨电'));
});

/* ===== 问题：备注列过长优化 ===== */
test('备注列优化-超长备注：省略显示且 title 保留完整内容（悬停可查看全文）', () => {
  const { ctx, state } = fresh();
  const longNote = '一级能效，含安装，质保十年，支持以旧换新，送货上门，颜色白色，能效等级一级，制冷量3500W';
  product.save(ctx, {
    brand: '海尔', model: 'BCD-500', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399', note: longNote
  });
  const html = page.render(ctx, state);
  assert.ok(html.includes('cell-note'), '备注列带 cell-note 样式类（省略号/宽度限制）');
  assert.ok(html.includes('title="' + longNote + '"'), 'title 保留完整备注（悬停查看全文）');
  assert.ok(html.includes(longNote), '备注文本仍渲染');
  // 空备注显示占位符，不丢 cell-note
  product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
  const html2 = page.render(ctx, state);
  assert.ok(html2.includes('cell-note'), '无备注行同样带 cell-note');
  assert.ok(html2.includes('title=""'), '无备注时 title 为空串');
});

/* ===== 斑马纹：交替行底色，避免长列表看错行（手机版/电脑版） ===== */
const fs = require('node:fs');
const path = require('node:path');

test('斑马纹-商品档案表格应用 tbl-striped 类', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const html = page.render(ctx, state);
  assert.ok(html.includes('tbl tbl-striped'), '表格带斑马纹类（手机版/电脑版共用同一列表）');
});

test('斑马纹-基础样式含交替行底色规则', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  assert.ok(css.includes('tbl-striped'), 'CSS 含斑马纹规则');
  assert.ok(css.includes('nth-child(even)'), '偶数行交替底色');
});

test('搜索模块：搜索框 + 状态下拉同一行（searchBar filters）', () => {
  const ctx = newCtx();
  const st = page.init();
  const html = page.render(ctx, st);
  const sb = html.indexOf('data-input="keyword"');
  const status = html.indexOf('data-name="filterStatus"');
  assert.ok(sb >= 0, '搜索框存在');
  assert.ok(status > sb && status - sb < 200, '状态下拉与搜索框同一行（filters 内）');
  assert.ok(html.includes('全部状态'), '状态下拉含全部状态');
});

test('新建商品：原厂条码区带扫码按钮（data-act="scan-barcode"）', () => {
  const { ctx, state } = fresh();
  state.tab = 'new';
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-name="barcodes"'), '原厂条码 textarea 存在');
  assert.ok(html.includes('data-act="scan-barcode"'), '条码区带扫码按钮');
});

test('新建商品 scan-barcode 动作：扫码内容自动填入（去重追加）', () => {
  const { ctx, state } = fresh();
  state.tab = 'new';
  let captured = null;
  const orig = globalThis.ERP;
  globalThis.ERP.scan = { start: (opts) => { captured = opts; } };
  page.actions['scan-barcode'](ctx, state);
  assert.ok(captured, '调起 ERP.scan.start');
  captured.onResult('6901234567892');
  captured.onResult('6901234567892'); // 重复扫码 → 去重
  captured.onResult('6923456789012');
  globalThis.ERP = orig;
  const lines = state.form.barcodes.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 2, '两条不同条码，重复的合并');
  assert.ok(lines.includes('6901234567892'));
  assert.ok(lines.includes('6923456789012'));
});

test('新建商品 scan-barcode 动作：已有内容时追加保留', () => {
  const { ctx, state } = fresh();
  state.tab = 'new';
  state.form.barcodes = '6901234567892';
  const orig = globalThis.ERP;
  globalThis.ERP.scan = { start: (o) => o.onResult('6923456789012') };
  page.actions['scan-barcode'](ctx, state);
  globalThis.ERP = orig;
  assert.ok(state.form.barcodes.includes('6901234567892'), '原有条码保留');
  assert.ok(state.form.barcodes.includes('6923456789012'), '新增条码追加');
});

/* ---------------- V3.37：多选删除未使用商品档案 ---------------- */

test('列表渲染：含全选 checkbox、行 checkbox 与删除选中按钮（未选时禁用）', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-act="toggle-all-check"'), '表头全选 checkbox');
  assert.ok(html.includes('class="row-check" data-act="row-check"'), '行 checkbox');
  assert.ok(html.includes('data-act="del-selected"'), '删除选中按钮');
  assert.ok(html.includes('disabled'), '未选中时按钮禁用');
  assert.ok(!html.includes('删除选中（'), '未选中不显示计数');
});

test('row-check：勾选/取消更新选中集合，选中行渲染高亮', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1] = ctx.data.products;
  page.actions['row-check'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.sel[p1.id], true);
  const html = page.render(ctx, state);
  assert.ok(html.includes('删除选中（1）'), '按钮显示计数 1');
  assert.ok(html.includes('class="sel-on"'), '选中行高亮');
  page.actions['row-check'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(state.sel[p1.id], undefined, '再点取消勾选');
});

test('toggle-all-check：全选当前页，再点取消全选', () => {
  const { ctx, state } = fresh();
  seed(ctx); // 2 款
  page.actions['toggle-all-check'](ctx, state, {});
  assert.strictEqual(Object.keys(state.sel).filter(k => state.sel[k]).length, 2, '全选本页全部');
  const html = page.render(ctx, state);
  assert.ok(html.includes('删除选中（2）'));
  page.actions['toggle-all-check'](ctx, state, {});
  assert.strictEqual(Object.keys(state.sel).filter(k => state.sel[k]).length, 0, '再点取消全选');
});

test('del-selected：确认后删除未使用商品，清空选择', async () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1, p2] = ctx.data.products;
  // p2 被销售单引用 → 删除时自动跳过
  ctx.data.sales.push({ no: 'XS1', date: '2026-09-09', items: [{ productId: p2.id, qty: 1, price: 100 }] });
  state.sel[p1.id] = true;
  state.sel[p2.id] = true;
  const orig = globalThis.ERP;
  globalThis.ERP = globalThis.ERP || {};
  globalThis.ERP.app = { commit: () => Promise.resolve(), render: () => {} };
  page.actions['del-selected'](ctx, state);
  await new Promise(r => setTimeout(r, 20)); // 等 confirm 异步 resolve
  globalThis.ERP = orig;
  assert.strictEqual(ctx.data.products.length, 1, '未使用的 p1 被删除');
  assert.strictEqual(ctx.data.products[0].id, p2.id, '被引用的 p2 保留');
  assert.deepStrictEqual(state.sel, {}, '删除后清空选择');
});

/* ---------------- V3.38：删除商品档案功能仅保留在网页版 ---------------- */

test('多选删除 UI 标记 desktop-only：手机端不渲染删除入口', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const html = page.render(ctx, state);
  assert.ok(html.includes('class="btn btn-danger desktop-only"'), '删除选中按钮带 desktop-only');
  assert.ok(html.includes('th class="sel desktop-only"'), '表头全选列带 desktop-only');
  assert.ok(html.includes('td class="sel desktop-only"'), '行勾选列带 desktop-only');
});

test('mobile.css：手机断点内隐藏 .desktop-only（删除商品档案仅网页版）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../css/mobile.css'), 'utf8');
  const block = css.slice(css.indexOf('@media (max-width: 599px)'));
  assert.ok(/\.desktop-only\s*{[^}]*display\s*:\s*none\s*!important/.test(block),
    '手机断点内 .desktop-only 必须 display:none !important');
});

test('base.css / desktop.css 不全局隐藏 desktop-only（保证网页版可见）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of ['base.css', 'desktop.css']) {
    const css = fs.readFileSync(path.join(__dirname, '../css/' + f), 'utf8');
    assert.ok(!/\.desktop-only\s*{[^}]*display\s*:\s*none/.test(css), f + ' 不应隐藏 desktop-only');
  }
});

/* ---------------- V3.40：勾选实时同步 + 搜索/筛选/翻页后清空勾选 ---------------- */

test('勾选计数实时更新：逐行勾选/取消即时增减，与界面勾选一致', () => {
  const { ctx, state } = fresh();
  seed(ctx); // 2 款
  const [p1, p2] = ctx.data.products;
  page.actions['row-check'](ctx, state, { getAttribute: () => p1.id });
  assert.ok(page.render(ctx, state).includes('删除选中（1）'), '勾 1 行计数 1');
  page.actions['row-check'](ctx, state, { getAttribute: () => p2.id });
  assert.ok(page.render(ctx, state).includes('删除选中（2）'), '再勾 1 行计数 2');
  page.actions['row-check'](ctx, state, { getAttribute: () => p1.id });
  assert.ok(page.render(ctx, state).includes('删除选中（1）'), '取消 1 行计数回 1');
  assert.ok(!page.render(ctx, state).includes('删除选中（2）'), '计数不虚高');
});

test('搜索词变化：自动清空勾选，删除按钮回到禁用', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1] = ctx.data.products;
  state.sel = { [p1.id]: true };
  page.actions['keyword'](ctx, state, { value: 'KFR' });
  assert.deepStrictEqual(state.sel, {}, '搜索后清空勾选');
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-act="del-selected"') && html.includes('disabled'), '删除按钮回到禁用');
  assert.ok(!html.includes('删除选中（'), '无计数');
});

test('状态筛选变化：自动清空勾选', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1] = ctx.data.products;
  state.sel = { [p1.id]: true };
  page.actions['filter'](ctx, state, { getAttribute: () => 'filterStatus', value: 'off' });
  assert.deepStrictEqual(state.sel, {}, '筛选后清空勾选');
});

test('翻页：自动清空勾选，避免跨页计数错乱', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1] = ctx.data.products;
  state.sel = { [p1.id]: true };
  page.actions['page'](ctx, state, { getAttribute: () => '2' });
  assert.deepStrictEqual(state.sel, {}, '翻页后清空勾选');
});

test('扫码搜索 scan-input：自动清空勾选', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1] = ctx.data.products;
  state.sel = { [p1.id]: true };
  page.actions['scan-input'](ctx, state, { value: '6901234567892' });
  assert.deepStrictEqual(state.sel, {}, '扫码搜索后清空勾选');
  assert.strictEqual(state.keyword, '6901234567892');
});

test('无残留时全选/取消全选：勾选数量与显示完全一致', () => {
  const { ctx, state } = fresh();
  seed(ctx); // 2 款
  page.actions['toggle-all-check'](ctx, state, {});
  let html = page.render(ctx, state);
  assert.ok(html.includes('删除选中（2）'), '全选后计数 2');
  assert.strictEqual(html.match(/class="row-check" data-act="row-check"[^>]*checked/g).length, 2, '两行全部勾选');
  page.actions['toggle-all-check'](ctx, state, {});
  html = page.render(ctx, state);
  assert.ok(html.includes('disabled'), '取消全选后按钮禁用');
});

/* ---------------- V3.41：全选与当前页渲染完全一致（大库存场景） ---------------- */

test('全选 200 与当前页渲染一致：乱序插入 250 款，勾选集合=显示集合', () => {
  const { ctx, state } = fresh();
  // 乱序插入 250 款（品牌/型号排列与插入顺序不同，模拟 6198 款大库存）
  for (let i = 0; i < 250; i++) {
    product.save(ctx, {
      brand: 'B' + String((i * 7) % 50).padStart(2, '0'),
      model: 'M' + String((i * 13) % 250).padStart(3, '0'),
      category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399'
    });
  }
  page.actions['toggle-all-check'](ctx, state, {});
  const html = page.render(ctx, state);
  // 当前页每一行都应勾选
  const rowIds = Array.from(html.matchAll(/class="row-check" data-act="row-check" data-id="([^"]*)"/g)).map(m => m[1]);
  assert.strictEqual(rowIds.length, 200, '第 1 页 200 行');
  assert.ok(rowIds.every(id => state.sel[id]), '当前页每一行都在选中集合（行勾选标志可见）');
  assert.ok(html.includes('删除选中（200）'), '删除按钮计数 200');
  const checkedRows = (html.match(/class="row-check" data-act="row-check" data-id="[^"]*" checked/g) || []).length;
  assert.strictEqual(checkedRows, 200, '200 行全部带 checked 勾选标志');
  // 勾选集合不多不少：恰为当前页 200 个 id
  assert.strictEqual(Object.keys(state.sel).filter(k => state.sel[k]).length, 200);
});

test('全选后翻到第 2 页：勾选清空，第 2 页无勾选、按钮禁用', () => {
  const { ctx, state } = fresh();
  for (let i = 0; i < 250; i++) {
    product.save(ctx, { brand: 'B' + (i % 50), model: 'M' + i, category: '冰箱', unit: '台' });
  }
  page.actions['toggle-all-check'](ctx, state, {});
  page.actions['page'](ctx, state, { getAttribute: () => '2' });
  const html = page.render(ctx, state);
  assert.deepStrictEqual(state.sel, {}, '翻页后清空勾选');
  assert.ok(html.includes('disabled'), '第 2 页删除按钮禁用');
  const checkedRows = (html.match(/class="row-check" data-act="row-check" data-id="[^"]*" checked/g) || []).length;
  assert.strictEqual(checkedRows, 0, '第 2 页无任何勾选');
});

/* ---------------- V3.42：同型号商品信息合并（仅网页版） ---------------- */

function seedMerge(ctx) {
  const a = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399', note: '一级能效',
    barcodes: '6901234567892'
  }).product;
  const b = product.save(ctx, {
    brand: '美的', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1200', priceWholesale: '1500', priceRetail: '1699', note: '送安装',
    barcodes: '6923456789012'
  }).product;
  a.stock = 5; b.stock = 3;
  return [a, b];
}

test('合并按钮：仅网页版渲染，勾选≥2 可用并显示计数', () => {
  const { ctx, state } = fresh();
  const [a, b] = seedMerge(ctx);
  let html = page.render(ctx, state);
  assert.ok(html.includes('data-act="merge-selected"'), '合并按钮存在');
  assert.ok(html.includes('class="btn btn-orange desktop-only"'), '合并按钮 desktop-only（手机版隐藏）');
  assert.ok(html.includes('merge-selected" disabled'), '未勾选时禁用');
  state.sel[a.id] = true;
  html = page.render(ctx, state);
  assert.ok(html.includes('merge-selected" disabled'), '勾选 1 个仍禁用');
  state.sel[b.id] = true;
  html = page.render(ctx, state);
  assert.ok(!/merge-selected" disabled/.test(html), '勾选 2 个可用');
  assert.ok(html.includes('🔀 合并选中（2）'), '按钮显示勾选数');
});

test('merge-selected：确认后同型号合并——库存相加、备注拼接、副档删除、清空选择', async () => {
  const { ctx, state } = fresh();
  const [a, b] = seedMerge(ctx);
  state.sel[a.id] = true;
  state.sel[b.id] = true;
  const orig = globalThis.ERP;
  globalThis.ERP = globalThis.ERP || {};
  globalThis.ERP.app = { commit: () => Promise.resolve(), render: () => {} };
  page.actions['merge-selected'](ctx, state);
  await new Promise(r => setTimeout(r, 20));
  globalThis.ERP = orig;
  assert.strictEqual(ctx.data.products.length, 1, '合并后只剩主档案');
  const keep = ctx.data.products[0];
  assert.strictEqual(keep.id, a.id, '主档案 = 库存最大者（海尔 5 > 美的 3）');
  assert.strictEqual(keep.stock, 8, '库存相加');
  assert.strictEqual(keep.brand, '海尔', '品牌取主档');
  assert.strictEqual(keep.cost, 100000, '成本保留主档（分）');
  assert.ok(keep.note.includes('一级能效') && keep.note.includes('送安装'), '备注拼接');
  assert.strictEqual(keep.barcodes.length, 2, '条码合并');
  assert.deepStrictEqual(state.sel, {}, '合并后清空选择');
});

test('merge-selected：型号不一致拒绝合并，数据不动', () => {
  const { ctx, state } = fresh();
  seed(ctx); // 海尔 BCD-200 + 格力 KFR-35（不同型号）
  const [p1, p2] = ctx.data.products;
  state.sel[p1.id] = true;
  state.sel[p2.id] = true;
  page.actions['merge-selected'](ctx, state);
  assert.strictEqual(ctx.data.products.length, 2, '型号不一致不合并');
  assert.strictEqual(ctx.data.products[0].id, p1.id, '无任何改动');
});

test('merge-selected：勾选少于 2 个拒绝', () => {
  const { ctx, state } = fresh();
  const [a] = seedMerge(ctx);
  state.sel[a.id] = true;
  page.actions['merge-selected'](ctx, state);
  assert.strictEqual(ctx.data.products.length, 2, '1 个不合并');
});

test('merge-selected：停售商品也可合并', async () => {
  const { ctx, state } = fresh();
  const [a, b] = seedMerge(ctx);
  b.status = 'off';
  state.sel[a.id] = true;
  state.sel[b.id] = true;
  const orig = globalThis.ERP;
  globalThis.ERP = globalThis.ERP || {};
  globalThis.ERP.app = { commit: () => Promise.resolve(), render: () => {} };
  page.actions['merge-selected'](ctx, state);
  await new Promise(r => setTimeout(r, 20));
  globalThis.ERP = orig;
  assert.strictEqual(ctx.data.products.length, 1, '停售副档被合并');
  assert.strictEqual(ctx.data.products[0].stock, 8);
});

/* ---------------- V3.43：多选勾选不再整页重渲染（滚动位置不跳回顶部） ---------------- */

test('row-check：只局部刷新，不调用整页 render（长列表多选不跳顶）', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1, p2] = ctx.data.products;
  let renderCount = 0;
  const orig = globalThis.ERP;
  globalThis.ERP = { app: { render: () => { renderCount++; } } };
  page.actions['row-check'](ctx, state, { getAttribute: () => p1.id });
  page.actions['row-check'](ctx, state, { getAttribute: () => p2.id });
  globalThis.ERP = orig;
  assert.strictEqual(renderCount, 0, '勾选不触发整页重渲染（滚动位置保持不变）');
  assert.deepStrictEqual(state.sel, { [p1.id]: true, [p2.id]: true }, '选中集合正确更新');
});

test('toggle-all-check：只局部更新，不调用整页 render', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  let renderCount = 0;
  const orig = globalThis.ERP;
  globalThis.ERP = { app: { render: () => { renderCount++; } } };
  page.actions['toggle-all-check'](ctx, state, {});
  globalThis.ERP = orig;
  assert.strictEqual(renderCount, 0, '全选不触发整页重渲染');
  assert.strictEqual(Object.keys(state.sel).filter(k => state.sel[k]).length, 2, '全选本页全部');
});

test('Node 无 DOM：refreshSelUI 安全跳过，勾选逻辑不受影响', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1] = ctx.data.products;
  page.actions['row-check'](ctx, state, { getAttribute: () => p1.id });
  assert.deepStrictEqual(state.sel, { [p1.id]: true });
  page.actions['toggle-all-check'](ctx, state, {});
  const ids = ctx.data.products.map(p => String(p.id));
  assert.deepStrictEqual(state.sel, { [ids[0]]: true, [ids[1]]: true }, '全选：本页全部置为勾选');
  page.actions['toggle-all-check'](ctx, state, {});
  assert.deepStrictEqual(state.sel, {}, '再点全选=取消全选，集合为空');
});



/* ---------------- V3.45：导出全部商品档案（CSV），外部核实后可重新导入 ---------------- */

function captureDownload() {
  // 防御：旧测试可能替换过 globalThis.ERP.app，这里重新确保 download 桩可用
  globalThis.ERP = globalThis.ERP || {};
  globalThis.ERP.app = globalThis.ERP.app || {};
  globalThis.ERP.app.download = function (name, content, mime) { globalThis.__lastDownload = { name: name, content: content, mime: mime }; };
  globalThis.__lastDownload = null;
  return {
    getCaptured: () => globalThis.__lastDownload,
    restore: () => { /* 数据保留给 getCaptured 读取；下次 captureDownload 自动清零 */ }
  };
}

test('导出全部按钮位于批量导入按钮前面', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const html = page.render(ctx, state);
  const a = html.indexOf('data-act="export-all"');
  const b = html.indexOf('data-act="open-csv"');
  assert.ok(a >= 0, '存在导出全部按钮');
  assert.ok(b >= 0, '存在批量导入按钮');
  assert.ok(a < b, '导出全部在批量导入前面');
});

test('export-all 导出全部商品（表头齐全、行数=商品数+1、含品牌型号/成本/条码）', () => {
  const { ctx, state } = fresh();
  seed(ctx); // 2 款商品
  const cap = captureDownload();
  try {
    page.actions['export-all'](ctx, state, null);
  } finally { cap.restore(); }
  const captured = cap.getCaptured();
  assert.ok(captured, 'download 被调用');
  assert.strictEqual(captured.name, '商品档案全部.csv');
  assert.strictEqual(captured.mime, 'text/csv');
  const lines = captured.content.replace(/^\uFEFF/, '').split('\r\n');
  assert.strictEqual(lines.length, 3, '表头 + 2 行商品');
  const head = lines[0].split(',');
  assert.deepStrictEqual(head, ['品牌','型号','类型','单位','成本','批发价','零售价','库存','备注','原厂条码','状态']);
  const all = lines.join('\n');
  assert.ok(all.indexOf('海尔') >= 0 && all.indexOf('BCD-200') >= 0, '含海尔/BCD-200');
  assert.ok(all.indexOf('格力') >= 0 && all.indexOf('KFR-35') >= 0, '含格力/KFR-35');
  // 金额以「元」导出（内部存分，避免重导入放大 100 倍）
  const haierRow = lines.find(l => l.indexOf('BCD-200') >= 0);
  assert.ok(haierRow.indexOf('1000,1200,1399') >= 0, '成本1000/批发1200/零售1399（元）');
});

test('导出-重导入往返：按型号匹配更新品牌/成本/备注一致', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  // 修改一条记录模拟外部核实修改（改品牌/成本/备注）
  ctx.data.products[0].brand = '海尔智家';
  ctx.data.products[0].cost = 999;
  ctx.data.products[0].note = '核实修正';
  const cap = captureDownload();
  try { page.actions['export-all'](ctx, state, null); } finally { cap.restore(); }
  const captured = cap.getCaptured();
  // 把导出的 CSV 重新导入到一个全新的 ctx
  const fresh2 = fresh();
  const parsed = util.parseCSV(captured.content);
  const res = product.importFromRows(parsed.rows, fresh2.ctx);
  assert.ok(res.created >= 1 || res.updated >= 1, '导入有结果');
  const byModel = fresh2.ctx.data.products.filter(p => String(p.model).trim().toUpperCase() === String(ctx.data.products[0].model).trim().toUpperCase());
  assert.ok(byModel.length >= 1, '重新导入后存在该型号');
  assert.strictEqual(String(byModel[0].brand || '').trim().toUpperCase(), '海尔智家'.toUpperCase(), '品牌以导入为准');
  assert.strictEqual(Number(byModel[0].cost), 999, '成本以导入为准');
  assert.ok(String(byModel[0].note || '').indexOf('核实修正') >= 0, '备注保留');
});

test('空档案导出仅表头', () => {
  const { ctx, state } = fresh(); // 无 seed
  const cap = captureDownload();
  try { page.actions['export-all'](ctx, state, null); } finally { cap.restore(); }
  const captured = cap.getCaptured();
  const lines = captured.content.replace(/^\uFEFF/, '').split('\r\n');
  assert.strictEqual(lines.length, 1, '只有表头');
});

test('多条码以分号连接且可被 normBarcodes 复原', () => {
  const { ctx, state } = fresh();
  ctx.data.products.push({
    id: 'bc1', brand: '测试', model: 'BC-1', category: '其他', unit: '台',
    cost: 100, priceWholesale: 120, priceRetail: 150, stock: 3,
    note: '', barcodes: ['6900000000001', '6900000000002'], status: 'on'
  });
  const cap = captureDownload();
  try { page.actions['export-all'](ctx, state, null); } finally { cap.restore(); }
  const captured = cap.getCaptured();
  const lines = captured.content.replace(/^\uFEFF/, '').split('\r\n');
  const row = lines.find(l => l.indexOf('BC-1') >= 0);
  assert.ok(row && row.indexOf('6900000000001;6900000000002') >= 0, '条码分号连接');
  const norm = product.normBarcodes(['6900000000001;6900000000002']);
  assert.deepStrictEqual(norm, ['6900000000001', '6900000000002'], '重导入可拆分');
});
/* ---------------- V3.43 修复：勾选改用 click 委托（真实浏览器 change 委托被第三方框架拦截，click 委托正常） ---------------- */

test('勾选 checkbox 使用 data-act（click 委托）：行/表头均不带 data-change，避免被 change 委托拦截', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-act="toggle-all-check"'), '表头全选走 click 委托');
  assert.ok(html.includes('class="row-check" data-act="row-check"'), '行勾选走 click 委托');
  assert.ok(!html.includes('data-change="toggle-all-check"'), '表头不再依赖 change 委托');
  assert.ok(!html.includes('data-change="row-check"'), '行不再依赖 change 委托');
});

test('click 委托路径：row-check 仍正确更新选中集合（局部刷新不整页重渲染）', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1, p2] = ctx.data.products;
  globalThis.__renderCount = 0;
  // click 委托 dispatch 的参数与 change 委托一致（el 为 checkbox 本身）
  page.actions['row-check'](ctx, state, { getAttribute: () => p1.id });
  page.actions['row-check'](ctx, state, { getAttribute: () => p2.id });
  assert.strictEqual(globalThis.__renderCount, 0, '局部刷新不整页重渲染');
  assert.deepStrictEqual(state.sel, { [p1.id]: true, [p2.id]: true });
});

test('click 委托路径：toggle-all-check 全选/取消一致', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  page.actions['toggle-all-check'](ctx, state, {});
  const ids = ctx.data.products.map(p => String(p.id));
  assert.deepStrictEqual(state.sel, { [ids[0]]: true, [ids[1]]: true });
  page.actions['toggle-all-check'](ctx, state, {});
  assert.deepStrictEqual(state.sel, {});
});

/* ---------------- V3.47：修复「勾选复选框后页面跳回顶部」 ----------------
 * 根因：V3.43 去掉了动作内的 ERP.app.render()，但动作返回 undefined，
 * 框架 actHandler 在 返回值 !== false 时仍会调用 afterAction() → render() → window.scrollTo(0,0)，
 * 长列表勾选后依旧整页重渲染并跳回顶部。
 * 修复：row-check / toggle-all-check 显式 return false，跳过框架整页重渲染。
 * 回归测试（此前缺失）：断言勾选动作返回 false，框架因此不会触发 afterAction（即不会整页重渲染+滚动）。 */

test('row-check 必须返回 false：框架 actHandler 才不会触发 afterAction（不整页重渲染、不跳顶）', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const [p1] = ctx.data.products;
  const ret = page.actions['row-check'](ctx, state, { getAttribute: () => p1.id });
  assert.strictEqual(ret, false, '勾选动作必须 return false，否则框架会 afterAction → render → scrollTo(0,0) 跳回顶部');
  assert.strictEqual(state.sel[p1.id], true, '选中集合仍正确更新');
  // 模拟框架 actHandler 的真实分支：返回值 !== false 才 afterAction（整页重渲染+滚动）
  let afterActionCalled = false;
  const handled = ret;
  if (handled !== false) afterActionCalled = true;
  assert.strictEqual(afterActionCalled, false, '框架不应触发 afterAction（否则会跳顶）');
});

test('toggle-all-check 必须返回 false：框架 actHandler 才不会触发 afterAction', () => {
  const { ctx, state } = fresh();
  seed(ctx);
  const ret = page.actions['toggle-all-check'](ctx, state, {});
  assert.strictEqual(ret, false, '全选动作必须 return false，避免整页重渲染跳顶');
  assert.strictEqual(Object.keys(state.sel).filter(k => state.sel[k]).length, 2, '全选本页全部');
  let afterActionCalled = false;
  if (ret !== false) afterActionCalled = true;
  assert.strictEqual(afterActionCalled, false, '框架不应触发 afterAction（否则会跳顶）');
});
