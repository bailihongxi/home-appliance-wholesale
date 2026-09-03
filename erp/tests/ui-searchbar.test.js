/**
 * tests/ui-searchbar.test.js —— V3.5 方案B：电脑端搜索模块下拉宽度微调
 * 背景：V3.3 三页搜索模块重排把下拉菜单移入 searchBar 与搜索框同行，电脑端下拉被压缩成内容宽度。
 * 本版给 `.search-bar .select` 增加固定 min-width（130px），仅影响电脑端（同行排布），
 * 手机端保持「下拉独占一行」的多行样式不受影响。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

test('方案B-电脑端下拉菜单固定宽度：search-bar 内 select 设 min-width 130px', () => {
  const base = read('css/base.css');
  const block = base.slice(base.indexOf('.search-bar'), base.indexOf('.matrix'));
  assert.ok(block.includes('.search-bar .select { flex: 0 0 auto; min-width: 130px; }'),
    'search-bar 内下拉固定宽度 min-width 130px（不被压缩成内容宽度）');
});

test('方案B-手机端下拉仍独占一行：不受电脑端固定宽度影响', () => {
  const mobile = read('css/mobile.css');
  const block = mobile.slice(mobile.indexOf('.search-bar'), mobile.indexOf('.account-head'));
  assert.ok(block.includes('.search-bar .select { flex: 1 1 100%; margin-top: 4px; }'),
    '手机端下拉独占一行（flex 1 1 100%）保持不变');
  assert.ok(block.includes('.search-bar { flex-wrap: wrap; }'), '手机端搜索栏允许换行保持不变');
});
