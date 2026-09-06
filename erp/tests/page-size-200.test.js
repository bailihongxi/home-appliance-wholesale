/**
 * page-size-200.test.js —— 商品档案和库存管理分页每页200条验证
 * 提升显示速度和内存优化
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function read(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
}

test('商品档案页面分页每页显示200条', () => {
  const product = read('js/ui/page-product.js');
  assert.ok(product.includes('util.paginate(list, state.page, 200)'),
    '商品档案使用 util.paginate(list, state.page, 200)');
});

test('库存管理页面分页每页显示200条', () => {
  const inventory = read('js/ui/page-inventory.js');
  assert.ok(inventory.includes('util.paginate(list, st.page, 200)'),
    '库存管理使用 util.paginate(list, st.page, 200)');
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
