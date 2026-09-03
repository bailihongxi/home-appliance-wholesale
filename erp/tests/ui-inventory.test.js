const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const page = require('../js/ui/page-inventory.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const inv = require('../js/core/inventory.js');

function seed(ctx) {
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
  return ctx;
}

function fresh(ctx) {
  return page.init();
}

test('页面元数据与初始状态', () => {
  assert.strictEqual(page.name, 'inventory');
  assert.strictEqual(page.title, '库存管理');
  const ctx = seed(newCtx());
  const st = fresh(ctx);
  assert.strictEqual(st.tab, 'list');
});

test('库存列表：品牌/型号分列，成本/双价/库存', () => {
  const ctx = seed(newCtx());
  const st = fresh(ctx);
  const html = page.render(ctx, st);
  assert.ok(html.includes('海尔'));
  assert.ok(html.includes('BCD-200'));
  assert.ok(html.includes('格力'));
  assert.ok(html.includes('¥1000.00'));
  assert.ok(html.includes('¥1200.00'));
  assert.ok(html.includes('¥1399.00'));
  assert.ok(!html.includes('款号'));
});

test('统计卡片紧凑化 + 列表斑马纹', () => {
  const ctx = seed(newCtx());
  const st = fresh(ctx);
  const html = page.render(ctx, st);
  assert.ok(html.includes('stat-grid stat-grid-compact'), '库存统计卡片使用紧凑布局');
  assert.ok(html.includes('tbl tbl-striped'), '库存列表表格带斑马纹样式');
  assert.ok(html.includes('商品数'), '统计卡片保留商品数');
  assert.ok(html.includes('资金占用'), '统计卡片保留资金占用');
});

test('搜索/分类/重置单行排布（searchBar filters 内）+ 取消扫码按钮', () => {
  const ctx = seed(newCtx());
  const st = fresh(ctx);
  const html = page.render(ctx, st);
  const sbStart = html.indexOf('data-input="keyword"');
  const catSelect = html.indexOf('data-name="cat"');
  const reset = html.indexOf('data-act="reset-filter"');
  assert.ok(sbStart >= 0, '搜索框存在');
  assert.ok(catSelect > sbStart, '分类下拉应紧跟搜索框在同一行');
  assert.ok(reset > catSelect, '重置按钮与分类下拉同一行');
  // searchBar 用 filters 承接 select+spacer+重置，整体在一个 row 内
  const rowOpen = html.indexOf('data-input="keyword"');
  const rowClose = html.indexOf('</div>', html.indexOf('data-act="reset-filter"'));
  assert.ok(rowClose > rowOpen && rowClose - rowOpen < 600, '搜索/分类/重置应处于同一紧凑行');
  assert.ok(!html.includes('data-act="scan"'), '库存搜索行取消扫码按钮，节省空间');
});

test('预警：低于阈值 3 显示，充足不显示', () => {
  const ctx = seed(newCtx({ defaultThreshold: 3 }));
  const st = fresh(ctx);
  st.tab = 'alert';
  // 库存为 0 → 两个都在预警
  let html = page.render(ctx, st);
  assert.ok(html.includes('库存充足') === false, '有预警');
  // 补库存
  ctx.data.products.forEach(p => { p.stock = 10; });
  html = page.render(ctx, st);
  assert.ok(html.includes('库存充足，暂无预警'));
});

test('盘点：填实盘数保存，生成盘点单并调整库存', () => {
  const ctx = seed(newCtx());
  const st = fresh(ctx);
  st.tab = 'take';
  ctx.data.products[0].stock = 5; // 账面 5
  st.take.counts[ctx.data.products[0].id] = 8; // 实盘 8
  const ok = page.actions['save-take'](ctx, st);
  assert.strictEqual(ok, true);
  assert.strictEqual(ctx.data.stocktakes.length, 1);
  assert.strictEqual(ctx.data.products[0].stock, 8, '库存调整为实盘数');
  const doc = ctx.data.stocktakes[0];
  assert.strictEqual(doc.diffQty, 3);
  // 渲染含盘点记录
  const html = page.render(ctx, st);
  assert.ok(html.includes('最近盘点记录'));
});

test('变动明细：show-logs 显示进货入库记录', () => {
  const ctx = seed(newCtx());
  const p = ctx.data.products[0];
  inv.applyPurchase(ctx, { date: '2026-09-01', items: [{ productId: p.id, qty: 5, cost: 100000 }], supplier: '测试' });
  const st = fresh(ctx);
  page.actions['show-logs'](ctx, st, { getAttribute: () => p.id });
  const html = page.render(ctx, st);
  assert.ok(html.includes('进货入库'));
  assert.ok(html.includes('+5'));
});

test('统计卡片 CSS：内边距/高度/间距减半 + 数字图标放大两倍', () => {
  const base = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  const compactBlock = base.slice(base.indexOf('.stat-grid-compact'), base.indexOf('.stat {'));
  assert.ok(compactBlock.includes('padding: 2px 5px'), '内边距减半（2px 5px）');
  assert.ok(compactBlock.includes('min-height: 20px'), '卡片最小高度减半（20px）');
  assert.ok(compactBlock.includes('.stat-grid-compact .stat-card .value { font-size: 24px'), '数字扩大近两倍（24px）');
  assert.ok(compactBlock.includes('width: 30px'), '图标扩大近两倍（30px）');
  // 桌面保持 4 列并收紧间距
  const desktop = fs.readFileSync(path.join(__dirname, '..', 'css', 'desktop.css'), 'utf8');
  assert.ok(desktop.includes('.stat-grid-compact { grid-template-columns: repeat(4, 1fr); gap: 3px; }'),
    '桌面保持 4 列并收紧间距');
  // 移动端 2 列适配屏幕宽度（避免 4 列过窄撑破/截断），数字防溢出
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');
  assert.ok(mobile.includes('.stat-grid-compact { grid-template-columns: repeat(2, 1fr); gap: 5px; }'),
    '移动端改为 2 列适配屏幕宽度（修复撑破）');
  assert.ok(mobile.includes('text-overflow: ellipsis'), '移动端数值超长防溢出截断');
});
