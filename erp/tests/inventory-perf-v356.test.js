/**
 * tests/inventory-perf-v356.test.js —— V3.56 库存页性能专项（问题1）
 * 1) 预警/盘点接入分页：单页 DOM 规模受控（此前预警固定 300 行、盘点渲染全部商品+等量输入框）
 * 2) 翻页动作按标签分流到各自的页码字段
 * 3) 预警支持关键词/分类筛选（此前搜索框对预警无效）
 * 4) 区块化结构 + update() 局部刷新：无 DOM 时返回 false；有 DOM 时只替换变化的区块
 * 5) app.render 同路由优先调用 page.update（不整页重建 → 不闪屏，且不 scrollTo → 不跳回顶部）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const page = require('../js/ui/page-inventory.js');
const { newCtx } = require('./helpers/ctx.js');

const ROOT = path.join(__dirname, '..');

/** 造 n 个商品：库存 i%7（约 3/7 会触发默认阈值 3 的预警） */
function bigCtx(n) {
  const ctx = newCtx({ defaultThreshold: 3 });
  const ps = [];
  for (let i = 0; i < n; i++) {
    ps.push({
      id: 'p' + i, brand: '品牌' + (i % 50), model: '型号' + i, category: '分类' + (i % 12), unit: '台',
      cost: 100000 + i, priceWholesale: 120000 + i, priceRetail: 139900 + i, stock: i % 7, status: 'on',
      barcodes: ['69' + (1000000 + i)], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    });
  }
  ctx.data.products = ps;
  return ctx;
}

function rowCount(html) {
  return (html.match(/<tr>/g) || []).length - (html.match(/<tr><th>/g) || []).length;
}

/** 统计某段 HTML 里的 <tbody> 数据行（比全局 <tr> 更精确） */
function bodyRows(html) {
  const out = [];
  const re = /<tbody>([\s\S]*?)<\/tbody>/g;
  let m;
  while ((m = re.exec(html))) out.push((m[1].match(/<tr>/g) || []).length);
  return out;
}

test('V3.56-预警分页：3000 商品单页最多 200 行且带分页器', () => {
  const ctx = bigCtx(3000);
  const st = page.init();
  st.tab = 'alert';
  const html = page.render(ctx, st);
  const rows = bodyRows(html);
  assert.ok(Math.max.apply(null, rows) <= 200, '预警单页渲染行数 ≤ 200（实际 ' + Math.max.apply(null, rows) + '）');
  assert.ok(html.includes('class="pager"'), '预警页带分页器');
  assert.ok(/共 \d+ 条/.test(html), '分页器显示总条数');
  // 全部命中预警（stock 0/1/2）→ 3000/7 的整数分布：3000 个里 i%7<3 的共 1286 条
  const total = /共 (\d+) 条/.exec(html);
  assert.ok(Number(total[1]) > 200, '预警总数超过单页容量，分页确实生效（共 ' + total[1] + ' 条）');
});

test('V3.56-盘点分页：3000 商品单页最多 100 行 / 100 个实盘输入框', () => {
  const ctx = bigCtx(3000);
  const st = page.init();
  st.tab = 'take';
  const html = page.render(ctx, st);
  const rows = bodyRows(html);
  assert.ok(Math.max.apply(null, rows) <= 100, '盘点单页渲染行数 ≤ 100（实际 ' + Math.max.apply(null, rows) + '）');
  const inputs = (html.match(/data-change="real"/g) || []).length;
  assert.ok(inputs <= 100, '实盘输入框 ≤ 100 个（实际 ' + inputs + '，此前为全量 3000）');
  assert.ok(html.includes('class="pager"'), '盘点页带分页器');
});

test('V3.56-库存查询仍为 200/页（沿用既有分页口径）', () => {
  const ctx = bigCtx(3000);
  const st = page.init();
  const html = page.render(ctx, st);
  const rows = bodyRows(html);
  assert.ok(Math.max.apply(null, rows) <= 200, '库存查询单页 ≤ 200 行');
  const src = fs.readFileSync(path.join(ROOT, 'js/ui/page-inventory.js'), 'utf8');
  assert.ok(src.includes('util.paginate(list, st.page, 200)'), '库存查询保持 200/页');
  assert.ok(src.includes('util.paginate(alerts, st.alertPage,'), '预警使用独立页码分页');
  assert.ok(src.includes('util.paginate(list, st.takePage,'), '盘点使用独立页码分页');
});

test('V3.56-翻页动作按标签分流：list→page / alert→alertPage / take→takePage', () => {
  const st = page.init();
  const el = (n) => ({ getAttribute: () => String(n) });

  st.tab = 'list';
  page.actions.page(null, st, el(3));
  assert.strictEqual(st.page, 3, '库存查询翻页改 st.page');

  st.tab = 'alert';
  page.actions.page(null, st, el(5));
  assert.strictEqual(st.alertPage, 5, '预警翻页改 st.alertPage');
  assert.strictEqual(st.page, 3, '不影响库存查询页码');

  st.tab = 'take';
  page.actions.page(null, st, el(7));
  assert.strictEqual(st.takePage, 7, '盘点翻页改 st.takePage');
  assert.strictEqual(st.alertPage, 5, '不影响预警页码');
});

test('V3.56-搜索关键词重置当前标签页码（不会停在越界空页）', () => {
  const st = page.init();
  st.tab = 'alert';
  st.alertPage = 9;
  page.actions.keyword(null, st, { value: '品牌1' });
  assert.strictEqual(st.alertPage, 1, '改关键词后预警回到第 1 页');

  st.tab = 'take';
  st.takePage = 9;
  page.actions['take-keyword'](null, st, { value: '型号' });
  assert.strictEqual(st.takePage, 1, '盘点搜索后回到第 1 页');
});

test('V3.56-预警支持关键词筛选（此前搜索框对预警无效）', () => {
  const ctx = bigCtx(300);
  const st = page.init();
  st.tab = 'alert';
  const all = page.render(ctx, st);
  st.keyword = '型号11';
  const filtered = page.render(ctx, st);
  assert.ok(bodyRows(filtered)[0] < bodyRows(all)[0], '关键词命中更少行');
  assert.ok(filtered.includes('型号11'), '筛选结果包含命中商品');
  // 无命中时的空态文案区分「充足」与「没找到」
  st.keyword = '不存在的型号XYZ';
  const none = page.render(ctx, st);
  assert.ok(none.includes('没有找到匹配的预警商品'), '无命中显示「没有找到匹配的预警商品」');
});

test('V3.56-页面结构区块化：inv-root / inv-head / inv-tabs / inv-search / inv-body', () => {
  const ctx = bigCtx(10);
  const st = page.init();
  const html = page.render(ctx, st);
  assert.ok(html.includes('<div class="inv-root">'), '整页包进 .inv-root');
  assert.ok(html.includes('<div id="inv-head">'), '页头区块');
  assert.ok(html.includes('<div class="inv-tabs">'), '标签区块（沿用既有类名）');
  assert.ok(html.includes('id="inv-search"'), '搜索区块');
  assert.ok(html.includes('<div id="inv-body">'), '列表主体区块');
});

test('V3.56-update()：无 DOM 环境返回 false（走整页渲染，行为不变）', () => {
  const ctx = bigCtx(5);
  const st = page.init();
  assert.strictEqual(page.update(ctx, st), false, 'Node 环境（无 document）返回 false');
});

test('V3.56-update()：局部刷新只重写变化的区块，未变化的区块完全不动 DOM', () => {
  const ctx = bigCtx(500);
  const st = page.init();

  /** 极简 DOM 桩：统计每个区块 innerHTML 的写入次数 */
  function node() {
    const n = {
      __writes: 0,
      __invHtml: undefined,
      get innerHTML() { return n.__html || ''; },
      set innerHTML(v) { n.__html = v; n.__writes += 1; }
    };
    return n;
  }
  const nodes = { '#inv-head': node(), '.inv-tabs': node(), '#inv-search': node(), '#inv-body': node() };
  const wrap = { querySelector: (sel) => nodes[sel] || null };
  const prevDoc = global.document;
  global.document = {
    activeElement: null,
    querySelector: (sel) => (sel === '.inv-root' ? wrap : null)
  };

  try {
    // 1) 先整页渲染（记录各区块基线）
    const html = page.render(ctx, st);
    assert.ok(html.includes('inv-root'));
    nodes['#inv-body'].__invHtml = undefined;

    // 2) 首次局部刷新：写入一次基线
    assert.strictEqual(page.update(ctx, st), true, '有 DOM 且区块齐全 → 局部刷新成功');
    const writes1 = Object.keys(nodes).map((k) => nodes[k].__writes);

    // 3) 状态不变再刷新一次：四个区块都不应再写 DOM
    Object.keys(nodes).forEach((k) => { nodes[k].__writes = 0; });
    assert.strictEqual(page.update(ctx, st), true);
    Object.keys(nodes).forEach((k) => {
      assert.strictEqual(nodes[k].__writes, 0, '状态未变时 ' + k + ' 区块不重写 DOM（无闪屏）');
    });

    // 4) 切换标签：只有页头/标签/搜索/主体会按需更新，且主体一定被重写
    Object.keys(nodes).forEach((k) => { nodes[k].__writes = 0; });
    st.tab = 'take';
    assert.strictEqual(page.update(ctx, st), true);
    assert.strictEqual(nodes['#inv-body'].__writes, 1, '切标签后列表主体被重写一次');
    assert.ok(nodes['#inv-body'].innerHTML.includes('data-change="real"'), '主体已换成盘点录入表');
    assert.ok(writes1.length === 4);
  } finally {
    global.document = prevDoc;
  }
});

test('V3.56-app.render：同路由优先调用 page.update 局部刷新，且局部成功时不整页重建/不 scrollTo', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(src.includes('typeof page.update === \'function\''), 'app.render 检测页面是否支持局部刷新');
  assert.ok(src.includes('patched = page.update(app.ctx, state) === true'), '调用 page.update 并以返回值为准');
  assert.ok(src.includes('if (!patched) {'), '局部刷新成功则跳过整页 innerHTML 重建');
  assert.ok(src.includes('if (win && !patched) {'), '局部刷新成功则不调用 scrollTo（滚动位置天然保持）');
});
