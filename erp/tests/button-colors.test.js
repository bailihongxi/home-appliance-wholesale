/**
 * button-colors.test.js —— 按钮颜色验证
 * 打印带价=橘色(btn-orange)，打印无价=黄色(btn-yellow)，取消=红色(btn-danger)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function read(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
}

test('CSS新增橘色按钮样式 btn-orange', () => {
  const css = read('css/base.css');
  assert.ok(css.includes('.btn-orange { background: #f97316;'), 'btn-orange 背景色 #f97316 橘色');
  assert.ok(css.includes('border-color: #f97316'), 'btn-orange 边框橘色');
  assert.ok(css.includes('color: #fff'), 'btn-orange 文字白色');
});

test('CSS新增黄色按钮样式 btn-yellow', () => {
  const css = read('css/base.css');
  assert.ok(css.includes('.btn-yellow { background: #eab308;'), 'btn-yellow 背景色 #eab308 黄色');
  assert.ok(css.includes('border-color: #eab308'), 'btn-yellow 边框黄色');
});

test('销售单打印带价按钮使用橘色 btn-orange', () => {
  const sale = read('js/ui/page-sale.js');
  assert.ok(sale.includes('btn-orange" data-act="print-doc"'), '销售单打印带价按钮有 btn-orange class');
  assert.ok(sale.includes('>打印带价</button>'), '销售单有打印带价按钮');
});

test('销售单打印无价按钮使用黄色 btn-yellow', () => {
  const sale = read('js/ui/page-sale.js');
  assert.ok(sale.includes('btn-yellow" data-act="print-doc"'), '销售单打印无价按钮有 btn-yellow class');
  assert.ok(sale.includes('>打印无价</button>'), '销售单有打印无价按钮');
});

test('进货单打印带价按钮使用橘色 btn-orange', () => {
  const purchase = read('js/ui/page-purchase.js');
  assert.ok(purchase.includes('btn-orange" data-act="print-doc"'), '进货单打印带价按钮有 btn-orange class');
});

test('进货单打印无价按钮使用黄色 btn-yellow', () => {
  const purchase = read('js/ui/page-purchase.js');
  assert.ok(purchase.includes('btn-yellow" data-act="print-doc"'), '进货单打印无价按钮有 btn-yellow class');
});
