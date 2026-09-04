/**
 * bluetooth-label.test.js —— 蓝牙标签打印模块测试
 * 验证 CPCL 指令生成、商品标签构建、模块接口完整性
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const btLabel = require('../js/print/bluetooth-label.js');

test('蓝牙打印模块接口完整', () => {
  assert.ok(typeof btLabel.isSupported === 'function', 'isSupported 存在');
  assert.ok(typeof btLabel.getState === 'function', 'getState 存在');
  assert.ok(typeof btLabel.connect === 'function', 'connect 存在');
  assert.ok(typeof btLabel.disconnect === 'function', 'disconnect 存在');
  assert.ok(typeof btLabel.buildCpclLabel === 'function', 'buildCpclLabel 存在');
  assert.ok(typeof btLabel.buildProductLabel === 'function', 'buildProductLabel 存在');
  assert.ok(typeof btLabel.printProductLabel === 'function', 'printProductLabel 存在');
  assert.ok(typeof btLabel.mmToDots === 'function', 'mmToDots 存在');
});

test('mmToDots 单位换算正确（203 DPI）', () => {
  // 203 DPI = 8 dots/mm (近似)
  assert.strictEqual(btLabel.mmToDots(40, 203), 320, '40mm = 320 dots');
  assert.strictEqual(btLabel.mmToDots(30, 203), 240, '30mm = 240 dots');
  assert.strictEqual(btLabel.mmToDots(10, 203), 80, '10mm = 80 dots');
});

test('CPCL 指令生成包含头部和 PRINT', () => {
  const data = btLabel.buildCpclLabel([
    { text: 'Test Product', x: 10, y: 10, font: 4, size: 0 },
    { barcode: '6901234567890', x: 10, y: 50, height: 60, barcodeType: 'CODE128' }
  ], { widthMm: 40, heightMm: 30, dpi: 203, copies: 1 });
  assert.ok(data instanceof Uint8Array, '返回 Uint8Array');
  const text = new TextDecoder().decode(data);
  assert.ok(text.startsWith('! 0 203 203 240 1'), 'CPCL 头部正确（高度240 dots，1份）');
  assert.ok(text.includes('TEXT 4 0 10 10 Test Product'), '文本指令正确');
  assert.ok(text.includes('BARCODE CODE128 60 10 50 6901234567890'), '条码指令正确');
  assert.ok(text.includes('PRINT'), '包含 PRINT 指令');
  assert.ok(text.includes('DENSITY'), '包含打印浓度设置');
  assert.ok(text.includes('PAGE-WIDTH 320'), '包含页面宽度设置');
});

test('商品标签构建包含品牌、型号、价格、条码', () => {
  const product = {
    brand: 'Haier',
    model: 'BCD-200',
    priceWholesale: 150000,
    priceRetail: 180000,
    barcodes: ['6901234567890']
  };
  const data = btLabel.buildProductLabel(product, { widthMm: 40, heightMm: 30, dpi: 203 }, { showPrice: 'retail' });
  const text = new TextDecoder().decode(data);
  assert.ok(text.includes('Haier'), '包含品牌');
  assert.ok(text.includes('BCD-200'), '包含型号');
  assert.ok(text.includes('1800.00'), '包含零售价');
  assert.ok(text.includes('6901234567890'), '包含条码');
});

test('商品标签支持不同价格显示模式', () => {
  const product = { brand: 'Gree', model: 'KFR-35', priceWholesale: 200000, priceRetail: 250000 };
  // 批发价
  let data = btLabel.buildProductLabel(product, {}, { showPrice: 'wholesale' });
  let text = new TextDecoder().decode(data);
  assert.ok(text.includes('2000.00'), '批发价模式');
  // 双价格
  data = btLabel.buildProductLabel(product, {}, { showPrice: 'both' });
  text = new TextDecoder().decode(data);
  assert.ok(text.includes('2000.00'), '双价格-批发');
  assert.ok(text.includes('2500.00'), '双价格-零售');
  // 无价格
  data = btLabel.buildProductLabel(product, {}, { showPrice: 'none' });
  text = new TextDecoder().decode(data);
  assert.ok(!text.includes('2000.00') && !text.includes('2500.00'), '无价格模式');
});

test('未连接时打印返回 rejected Promise', async () => {
  const product = { brand: '测试', model: 'T1' };
  try {
    await btLabel.printProductLabel(product, {}, {});
    assert.fail('应该抛出未连接错误');
  } catch (e) {
    assert.ok(e.message.includes('未连接'), '错误信息包含"未连接"');
  }
});

test('系统已移除蓝牙打印：index.html 不再引入 bluetooth-label.js（原测试改为验证移除）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!html.includes('js/print/bluetooth-label.js'), 'index.html 不再引入 bluetooth-label.js');
});

test('系统已移除蓝牙打印：设置页面不再有蓝牙打印机连接管理（原测试改为验证移除）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-setting.js'), 'utf8');
  assert.ok(!src.includes('bt-connect'), '不再包含蓝牙连接按钮');
  assert.ok(!src.includes('bt-disconnect'), '不再包含蓝牙断开按钮');
  assert.ok(!src.includes('bt-print-section'), '不再包含蓝牙打印模块');
});

test('系统已移除蓝牙打印：商品档案页面不再有打印标签按钮和 action（原测试改为验证移除）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-product.js'), 'utf8');
  assert.ok(!src.includes('print-label'), '不再包含打印标签按钮');
  assert.ok(!src.includes("'print-label': function"), '不再包含 print-label action');
});

test('蓝牙模块：平台检测 getPlatform/getBrowser 接口存在', () => {
  assert.strictEqual(typeof btLabel.getPlatform, 'function', 'getPlatform 是函数');
  assert.strictEqual(typeof btLabel.getBrowser, 'function', 'getBrowser 是函数');
  assert.strictEqual(typeof btLabel.getHelpInfo, 'function', 'getHelpInfo 是函数');
  assert.strictEqual(typeof btLabel.copyLink, 'function', 'copyLink 是函数');
});

test('蓝牙模块：getHelpInfo 返回结构化帮助信息（含平台、步骤、标题）', () => {
  const info = btLabel.getHelpInfo();
  assert.ok(info.platform, 'helpInfo 包含 platform');
  assert.ok(info.browser, 'helpInfo 包含 browser');
  assert.ok(info.title, 'helpInfo 包含 title');
  assert.ok(Array.isArray(info.steps), 'helpInfo.steps 是数组');
  assert.ok(info.steps.length >= 3, 'helpInfo.steps 至少3步引导');
});

test('蓝牙模块：getState 包含 platform 和 browser 字段', () => {
  const s = btLabel.getState();
  assert.ok('platform' in s, 'getState 包含 platform');
  assert.ok('browser' in s, 'getState 包含 browser');
});

test('系统已移除蓝牙打印：设置页面不再有蓝牙引导和复制链接按钮（原测试改为验证移除）', () => {
  const setting = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-setting.js'), 'utf8');
  assert.ok(!setting.includes('bt-copy-link'), '设置页不再有 bt-copy-link 按钮');
  assert.ok(!setting.includes('getHelpInfo'), '设置页不再调用 getHelpInfo');
  assert.ok(!setting.includes('Bluefy'), '设置页不再有 Bluefy 引导');
});

test('系统已移除蓝牙打印：商品档案页不再有蓝牙打印引导（原测试改为验证移除）', () => {
  const product = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-product.js'), 'utf8');
  assert.ok(!product.includes('getHelpInfo'), '商品页不再调用 getHelpInfo');
  assert.ok(!product.includes('copyLink'), '商品页不再调用 copyLink');
  assert.ok(!product.includes('Bluefy'), '商品页不再有 Bluefy 提示');
});


