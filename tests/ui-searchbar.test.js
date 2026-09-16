/**
 * tests/ui-searchbar.test.js —— V3.5/V3.17 搜索模块样式
 * 背景：V3.3 三页搜索模块重排把下拉菜单移入 searchBar 与搜索框同行，电脑端下拉被压缩成内容宽度。
 * V3.5 给 `.search-bar .select` 增加固定 min-width（130px），仅影响电脑端（同行排布），
 * 手机端保持「下拉独占一行」的多行样式。
 * V3.17 库存管理搜索模块把「分类下拉 + 重置按钮」包进 `.search-bar-filters`：
 * 手机端筛选区整体换行到第二行，下拉与重置按钮在同一行并排（下拉自适应剩余宽度）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

test('方案B-电脑端下拉菜单固定宽度：search-bar 内 select 不撑满容器且固定 min-width 130px', () => {
  const base = read('css/base.css');
  const block = base.slice(base.indexOf('.search-bar'), base.indexOf('.matrix'));
  assert.ok(block.includes('.search-bar .select { flex: 0 0 auto; width: auto; min-width: 130px; }'),
    'search-bar 内下拉 width:auto 覆盖 base .select 的 width:100%（防止撑满容器挤窄搜索框），min-width 130px 保底');
});

test('V3.17-手机端筛选区整行换行、下拉与重置按钮同一行', () => {
  const mobile = read('css/mobile.css');
  const block = mobile.slice(mobile.indexOf('.search-bar'), mobile.indexOf('.account-head'));
  // 筛选区容器在手机端独占一行（整行换行到第二行）
  assert.ok(block.includes('.search-bar-filters { flex: 1 1 100%; margin-top: 4px; }'),
    '筛选区容器在手机端独占一行（flex 1 1 100%）');
  // 容器内部下拉自适应剩余宽度，与重置按钮并排
  assert.ok(block.includes('.search-bar .select,\n  .search-bar-filters .select { flex: 1 1 auto; width: auto; min-width: 0; margin-top: 0; }'),
    '容器内下拉 flex:auto 与重置按钮并排同一行');
  assert.ok(block.includes('.search-bar { flex-wrap: wrap; }'), '手机端搜索栏允许换行保持不变');
});

/* V3.48：搜索框统一启用浏览器原生一键清除按钮 */

test('searchBar 组件使用 type="search" 以启用原生清除按钮', () => {
  const src = read('js/ui/components.js');
  const fn = src.match(/C\.searchBar = function searchBar\(opts\) \{[\s\S]*?\n  \};/);
  assert.ok(fn, '找到 searchBar 函数');
  assert.ok(fn[0].includes('type="search"'), 'searchBar 输入框为 type="search"');
  assert.ok(fn[0].includes('data-live="1"'), 'searchBar 保持 data-live="1"');
  assert.ok(fn[0].includes('data-debounce="1"'), 'searchBar 保持 data-debounce="1"');
});

test('CSS 为 input[type=search] 显式启用原生清除按钮样式', () => {
  const base = read('css/base.css');
  const block = base.slice(base.indexOf('.input[type="search"]'));
  assert.ok(block.includes('-webkit-appearance: textfield'), '搜索框使用 textfield 外观');
  assert.ok(block.includes('::-webkit-search-cancel-button'), '定义原生清除按钮伪元素');
  assert.ok(block.includes('searchfield-cancel-button'), '启用原生 searchfield-cancel-button 图标');
});
