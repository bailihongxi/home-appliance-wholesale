/**
 * product-search-layout.test.js —— 商品档案搜索模块布局验证
 * 下拉收缩40%，搜索框扩宽，桌面端一行、手机端两行
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function read(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
}

test('商品档案搜索栏使用专属 class search-bar-product', () => {
  const product = read('js/ui/page-product.js');
  assert.ok(product.includes("cls: 'search-bar-product'"), '商品档案搜索栏有 search-bar-product class');
});

test('searchBar 组件支持 cls 参数', () => {
  const components = read('js/ui/components.js');
  assert.ok(components.includes("opts.cls ? ' ' + esc(opts.cls) : ''"),
    'searchBar 组件拼接 cls 参数');
});

test('桌面端：下拉菜单宽度收缩40%（min-width 130px→78px）', () => {
  const css = read('css/base.css');
  assert.ok(css.includes('.search-bar-product .select { flex: 0 0 auto; width: auto; min-width: 78px; }'),
    'base.css 商品档案下拉 min-width 78px（收缩40%）');
  assert.ok(!css.includes('.search-bar-product .select { flex: 0 0 auto; width: auto; min-width: 130px; }'),
    '商品档案下拉不再是 min-width 130px');
});

test('手机端：搜索框独占一行（flex:1 1 100%）', () => {
  const css = read('css/mobile.css');
  assert.ok(css.includes('.search-bar-product .input { flex: 1 1 100%; }'),
    'mobile.css 商品档案搜索框独占一行');
});

test('手机端：下拉菜单+扫描按钮同一行（flex:0 0 auto）', () => {
  const css = read('css/mobile.css');
  assert.ok(css.includes('.search-bar-product .btn { flex: 0 0 auto; }'),
    'mobile.css 扫描按钮固定宽度');
  assert.ok(css.includes('.search-bar-product .select { flex: 0 0 auto; width: auto; min-width: 78px; }'),
    'mobile.css 商品档案下拉固定宽度且收缩40%');
});
