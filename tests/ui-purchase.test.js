const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
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
  assert.ok(detail.includes('>打印带价<'), '带价打印按钮');
  assert.ok(detail.includes('>打印无价<'), '无价打印按钮');
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
  // V3.52 进货选货区双布局：桌面 .pick-desktop（V3.49 表格）+ 手机 .pick-mobile（V3.51 卡片）
  assert.ok(html.includes('class="pick-desktop"'), '进货选货区桌面端包装 pick-desktop');
  assert.ok(html.includes('class="pick-mobile"'), '进货选货区手机端包装 pick-mobile');
  assert.ok(html.includes('class="pick-list"'), '进货选货手机端 pick-list 容器');
  assert.ok(html.includes('pick-sub'), '进货选货手机卡片第二行（类型/单位 + 成本）');
  // 桌面+手机各渲染一次，每页 15 条 → 总共 30 个 add-item 按钮
  assert.strictEqual((html.match(/data-act="add-item"/g) || []).length, 30, '默认显示 15 条商品，桌面+手机各渲染一次 = 30');
  assert.ok(html.includes('data-act="pick-page"'), '进货选货分页应使用 pick-page 动作');
  assert.ok(html.includes('共 18 条'), '分页显示总条数');

  // 翻到第 2 页
  page.actions['pick-page'](ctx, state, { getAttribute: (k) => (k === 'data-page' ? '2' : null) });
  const html2 = page.render(ctx, state);
  assert.strictEqual((html2.match(/data-act="add-item"/g) || []).length, 6, '第 2 页显示剩余 3 条 ×2（桌面+手机）= 6');
  assert.ok(html2.includes('2 / 2'), '第 2 页页码');

  // 搜索词变化重置回第 1 页
  page.actions['form-keyword'](ctx, state, { value: '品牌1' });
  assert.strictEqual(state.form.pickPage, 1, '搜索词变化回到选货第 1 页');
});

test('进货列表搜索模块：第1行搜索+供应商、第2行日期', () => {
  const ctx = newCtx();
  const st = fresh(ctx);
  st.tab = 'list';
  const html = page.render(ctx, st);
  const sb = html.indexOf('data-input="keyword"');
  const sup = html.indexOf('data-name="partnerId"');
  assert.ok(sb >= 0, '搜索框存在');
  assert.ok(sup > sb && sup - sb < 200, '供应商下拉与搜索框同一行（filters 内）');
  assert.ok(html.includes('全部供应商'), '供应商下拉含全部供应商');
  const from = html.indexOf('data-name="from"');
  assert.ok(from > sup, '日期选择在第二行');
});

/** 找到 html 中 openIdx 处 <div...> 的匹配闭合 </div> 位置 */
function closeTagIndex(html, openIdx) {
  var depth = 1;
  var i = openIdx + 1;
  while (i < html.length && depth > 0) {
    var openAt = html.indexOf('<div', i);
    var closeAt = html.indexOf('</div>', i);
    if (closeAt === -1) return -1;
    if (openAt !== -1 && openAt < closeAt) {
      depth++;
      i = openAt + 4;
    } else {
      depth--;
      if (depth === 0) return closeAt;
      i = closeAt + 6;
    }
  }
  return -1;
}

test('V3.17-问题3：新建进货单表单「品」字布局——供应商在上，选品加行与进货明细并排两列，已付款在下', () => {
  const ctx = newCtx();
  const { p1 } = seed(ctx);
  const st = fresh(ctx);
  st.tab = 'form';
  page.actions['add-item'](ctx, st, { getAttribute: () => p1.id });
  const html = page.render(ctx, st);

  // 存在专用两列容器
  const gridStart = html.indexOf('<div class="purchase-form-grid">');
  assert.ok(gridStart >= 0, '选品加行与进货明细包在 purchase-form-grid 容器内');
  const gridEnd = closeTagIndex(html, gridStart);
  assert.ok(gridEnd > gridStart, 'purchase-form-grid 容器有匹配闭合标签');
  const gridBlock = html.slice(gridStart, gridEnd + 6);

  // 容器内包含两个 card：选品加行、进货明细
  assert.ok(gridBlock.includes('按商品加行'), '选品加行模块在容器内');
  assert.ok(gridBlock.includes('进货明细'), '进货明细模块在容器内');

  // 供应商选择模块在容器之前（最上部）
  const supplierStart = html.indexOf('data-name="partnerId"');
  assert.ok(supplierStart > 0 && supplierStart < gridStart, '供应商选择模块在 purchase-form-grid 上方');

  // 已付款模块在容器之后
  const paidStart = html.indexOf('data-name="paid"');
  assert.ok(paidStart > gridEnd, '已付款模块在 purchase-form-grid 下方');

  // 桌面端：两列布局（V3.54 起用 minmax(0,1fr) 防止内部宽表格撑破页面）
  const base = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  const baseBlock = base.slice(base.indexOf('.purchase-form-grid {'));
  assert.ok(baseBlock.includes('display: grid'), 'purchase-form-grid 使用 grid 布局');
  assert.ok(baseBlock.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)'), '桌面端为两列布局（minmax(0,1fr) 防溢出）');

  // 手机端：单列堆叠（同样 minmax(0,1fr) 防溢出）
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');
  const mbBlock = mobile.slice(mobile.indexOf('.purchase-form-grid {'));
  assert.ok(mbBlock.includes('grid-template-columns: minmax(0, 1fr)'), '手机端 purchase-form-grid 单列堆叠（minmax(0,1fr) 防溢出）');
});

test('新建进货单选货区：搜索框后带扫码按钮（data-act="scan"）', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = fresh(ctx);
  state.tab = 'form';
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-input="form-keyword"'), '选货区搜索框存在');
  assert.ok(html.includes('data-act="scan"'), '搜索框后带扫码按钮');
});

/* V3.48：进货选货区搜索框启用原生一键清除 */
test('新建进货单选货区搜索框为 type="search" 且带 data-live/debounce', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = fresh(ctx);
  state.tab = 'form';
  const html = page.render(ctx, state);
  const tagMatch = html.match(/<input[^>]*data-input="form-keyword"[^>]*>/);
  assert.ok(tagMatch, '找到 form-keyword 输入框');
  const tag = tagMatch[0];
  assert.ok(/type\s*=\s*["']search["']/.test(tag), '进货选货搜索框为 type="search"');
  assert.ok(tag.includes('data-live="1"'), '进货选货搜索框有 data-live="1"');
  assert.ok(tag.includes('data-debounce="1"'), '进货选货搜索框有 data-debounce="1"');
});

test('新建进货单 scan 动作：识别后定位商品并直接加入明细', () => {
  const ctx = newCtx();
  const { p2 } = seed(ctx);
  const state = fresh(ctx);
  state.tab = 'form';
  let captured = null;
  const orig = globalThis.ERP;
  globalThis.ERP.scan = {
    start: (opts) => { captured = opts; },
    resolve: (c, code) => ({ found: true, product: p2 })
  };
  page.actions['scan'](ctx, state);
  assert.ok(captured, '调起 ERP.scan.start');
  captured.onResult('6923456789012');
  globalThis.ERP = orig;
  assert.strictEqual(state.form.keyword, '6923456789012', '选货区回显条码');
  assert.strictEqual(state.form.items.length, 1, '识别后直接加入明细');
  assert.strictEqual(state.form.items[0].productId, p2.id);
  assert.strictEqual(state.form.items[0].qty, 1);
  // 再次识别同一商品 → 数量累加，不新增行
  globalThis.ERP.scan = { start: (o) => o.onResult('6923456789012'), resolve: (c, code) => ({ found: true, product: p2 }) };
  page.actions['scan'](ctx, state);
  globalThis.ERP = orig;
  assert.strictEqual(state.form.items.length, 1);
  assert.strictEqual(state.form.items[0].qty, 2);
});

test('新建进货单 scan 动作：未找到商品时提示且不加入', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = fresh(ctx);
  state.tab = 'form';
  const orig = globalThis.ERP;
  globalThis.ERP.scan = {
    start: (o) => o.onResult('9999999999999'),
    resolve: (c, code) => ({ found: false, code })
  };
  page.actions['scan'](ctx, state);
  globalThis.ERP = orig;
  assert.strictEqual(state.form.items.length, 0, '未找到时不加入');
  assert.strictEqual(state.form.keyword, '9999999999999', '关键词仍回显以便列表展示');
});
