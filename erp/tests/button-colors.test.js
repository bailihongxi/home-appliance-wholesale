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

test('系统中所有取消按钮都使用红色 btn-danger class', () => {
  const files = ['page-sale.js', 'page-purchase.js', 'page-product.js', 'page-admin.js', 'page-supplier.js', 'page-customer.js', 'page-account.js'];
  let totalCancel = 0;
  let redCancel = 0;
  files.forEach(function(f) {
    const src = read('js/ui/' + f);
    const matches = src.match(/<button[^>]*>取消<\/button>/g) || [];
    matches.forEach(function(btn) {
      totalCancel++;
      if (btn.includes('btn-danger')) redCancel++;
    });
  });
  assert.strictEqual(totalCancel, 13, '系统中共有13个取消按钮');
  assert.strictEqual(redCancel, 13, '所有13个取消按钮都使用 btn-danger 红色样式');
});

test('取消按钮红色样式 btn-danger 已定义（白底红字）', () => {
  const css = read('css/base.css');
  assert.ok(css.includes('.btn-danger { background: #fff; border-color: var(--c-danger); color: var(--c-danger); }'),
    'btn-danger 样式已定义：白底红字');
});

test('系统中所有关闭按钮使用红色 btn-danger class', () => {
  const files = ['page-sale.js', 'page-purchase.js', 'page-inventory.js', 'page-account.js'];
  let totalClose = 0;
  let redClose = 0;
  files.forEach(function(f) {
    const src = read('js/ui/' + f);
    const matches = src.match(/<button[^>]*>关闭<\/button>/g) || [];
    matches.forEach(function(btn) {
      totalClose++;
      if (btn.includes('btn-danger')) redClose++;
    });
  });
  assert.ok(totalClose >= 4, '至少找到4个关闭按钮（实际 ' + totalClose + '）');
  assert.strictEqual(redClose, totalClose, '所有关闭按钮都使用 btn-danger 红色样式');
});

test('商品档案返回按钮使用红色 btn-danger class', () => {
  const product = read('js/ui/page-product.js');
  assert.ok(product.includes('class="btn btn-danger" data-act="cancel-form">返回</button>'),
    '商品档案返回按钮使用 btn-danger');
});

test('modal 组件默认关闭按钮使用红色 btn-danger', () => {
  const components = read('js/ui/components.js');
  assert.ok(components.includes("{ text: '关闭', cls: 'btn-danger', act: 'close-modal' }"),
    'modal 默认关闭按钮 cls 为 btn-danger');
});

test('打印页面关闭按钮已是红色样式（#dc2626 白底红字）', () => {
  const printDoc = read('js/ui/print-doc.js');
  assert.ok(printDoc.includes('.print-toolbar .pb-close { background: #fff; color: #dc2626; border-color: #dc2626; }'),
    '打印页面关闭按钮 pb-close 为白底红字');
});
