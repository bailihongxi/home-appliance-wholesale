/**
 * page-size-100.test.js —— 全系统列表分页统一「每页 100 条」验证（V3.58）
 * 目的：降低单页 DOM 规模与内存占用，提升列表渲染与翻页速度。
 * 覆盖范围：商品档案 / 库存查询 / 预警 / 盘点 / 销售单 / 进货单。
 * 说明：由 page-size-200.test.js 迁移而来（旧版断言 200/页，V3.58 起统一 100/页）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function read(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
}

test('V3.58 商品档案：每页 100 条', () => {
  const product = read('js/ui/page-product.js');
  assert.ok(product.includes('util.paginate(list, state.page, 100)'),
    '商品档案使用 util.paginate(list, state.page, 100)');
  assert.ok(!product.includes('util.paginate(list, state.page, 200)'),
    '商品档案不应再保留 200/页');
});

test('V3.58 库存查询：每页 100 条', () => {
  const inventory = read('js/ui/page-inventory.js');
  assert.ok(inventory.includes('util.paginate(list, st.page, 100)'),
    '库存查询使用 util.paginate(list, st.page, 100)');
  assert.ok(!inventory.includes('util.paginate(list, st.page, 200)'),
    '库存查询不应再保留 200/页');
});

test('V3.58 库存预警 / 盘点：每页 100 条', () => {
  const inventory = read('js/ui/page-inventory.js');
  assert.ok(inventory.includes('var PAGE_ALERT = 100;'), '预警 PAGE_ALERT = 100');
  assert.ok(inventory.includes('var PAGE_TAKE = 100;'), '盘点 PAGE_TAKE = 100');
  assert.ok(inventory.includes('util.paginate(alerts, st.alertPage, PAGE_ALERT)'), '预警分页');
  assert.ok(inventory.includes('util.paginate(list, st.takePage, PAGE_TAKE)'), '盘点分页');
});

test('V3.58 销售单列表：每页 100 条', () => {
  const sale = read('js/ui/page-sale.js');
  assert.ok(sale.includes('util.paginate(list, state.page, 100)'),
    '销售单列表使用 util.paginate(list, state.page, 100)');
  assert.ok(!sale.includes('util.paginate(list, state.page, 300)'),
    '销售单列表不应再保留 300/页');
});

test('V3.58 进货单列表：每页 100 条', () => {
  const purchase = read('js/ui/page-purchase.js');
  assert.ok(purchase.includes('util.paginate(list, state.page, 100)'),
    '进货单列表使用 util.paginate(list, state.page, 100)');
  assert.ok(!purchase.includes('util.paginate(list, state.page, 300)'),
    '进货单列表不应再保留 300/页');
});

test('选货区（销售/进货）仍保持每页 15 条：快速挑货，不套用列表页大小', () => {
  const sale = read('js/ui/page-sale.js');
  const purchase = read('js/ui/page-purchase.js');
  assert.ok(sale.includes('limit: 15'), '销售选货区 limit: 15');
  assert.ok(purchase.includes('limit: 15'), '进货选货区 limit: 15');
});

test('util.paginate 函数第三个参数为每页条数', () => {
  const util = read('js/core/util.js');
  assert.ok(util.includes('util.paginate = function paginate(list, page, size)'),
    'paginate 函数签名包含 size 参数');
  assert.ok(util.includes('var pageSize = size > 0 ? size : (total || 1)'),
    'paginate 使用 size 作为每页条数');
  assert.ok(util.includes('arr.slice(start, start + pageSize)'),
    'paginate 按 pageSize 切片');
});

/* ---------- 行为验证：100 条/页真实生效（而非仅源码文本） ---------- */

test('行为：库存查询单页最多渲染 100 行', () => {
  const page = require('../js/ui/page-inventory.js');
  const { newCtx } = require('./helpers/ctx.js');
  const ctx = newCtx();
  const ps = [];
  for (let i = 0; i < 250; i++) {
    ps.push({ id: 'p' + i, brand: '品', model: '型' + i, category: '空调', unit: '台', stock: 1, cost: 1, priceRetail: 2, status: 'on', barcodes: [] });
  }
  ctx.data.products = ps;
  const st = page.init();
  const html = page.render(ctx, st);
  const rows = (html.match(/<tr>/g) || []).length;
  assert.ok(rows <= 120, '库存查询单页行数应受控于 100/页（含表头等），实际 ' + rows);
});

test('行为：预警单页最多渲染 100 行', () => {
  const page = require('../js/ui/page-inventory.js');
  const { newCtx } = require('./helpers/ctx.js');
  const ctx = newCtx({ defaultThreshold: 3 });
  const ps = [];
  for (let i = 0; i < 250; i++) {
    ps.push({ id: 'p' + i, brand: '品', model: '型' + i, category: '空调', unit: '台', stock: 0, cost: 1, priceRetail: 2, status: 'on', barcodes: [] });
  }
  ctx.data.products = ps;
  const st = page.init();
  st.tab = 'alert';
  const html = page.render(ctx, st);
  const rows = (html.match(/<tr>/g) || []).length;
  assert.ok(rows <= 120, '预警单页行数应受控于 100/页，实际 ' + rows);
});
