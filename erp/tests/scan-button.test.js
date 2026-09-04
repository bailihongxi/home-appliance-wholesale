/**
 * scan-button.test.js —— 扫码按钮功能测试
 * 验证所有显示扫码按钮的页面都有对应的 scan action，点击后能调起 ERP.scan.start
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const uiDir = path.join(__dirname, '..', 'js', 'ui');

test('所有显示扫码按钮的页面都有 scan action', () => {
  const files = fs.readdirSync(uiDir).filter(f => f.startsWith('page-') && f.endsWith('.js'));
  const problems = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(uiDir, f), 'utf8');
    // 检查是否使用 searchBar 且未设置 scan:false（即会显示扫码按钮）
    const hasSearchBar = /ui\.searchBar\s*\(\s*\{[^}]*\}/.test(src);
    const hasScanFalse = /scan:\s*false/.test(src);
    const hasScanTrue = /scan:\s*true/.test(src);
    const showsScanButton = hasSearchBar && !hasScanFalse;
    if (!showsScanButton) continue;
    // 检查是否有 scan action
    const hasScanAction = /'scan':\s*function/.test(src) || /"scan":\s*function/.test(src);
    if (!hasScanAction) {
      problems.push(f + ': 显示扫码按钮但无 scan action');
    }
  }
  assert.strictEqual(problems.length, 0,
    '以下页面显示扫码按钮但无 scan action：\n' + problems.join('\n'));
});

test('商品档案页面有 scan action，扫码后设置关键词并搜索', () => {
  const src = fs.readFileSync(path.join(uiDir, 'page-product.js'), 'utf8');
  assert.ok(src.includes("'scan': function"), '商品档案页面有 scan action');
  assert.ok(src.includes('ERP.scan.start'), 'scan action 调用 ERP.scan.start');
  assert.ok(src.includes('state.keyword = code'), '扫码结果设置为搜索关键词');
});

test('记账中心页面不显示扫码按钮（scan:false）', () => {
  const src = fs.readFileSync(path.join(uiDir, 'page-account.js'), 'utf8');
  assert.ok(src.includes('scan: false'), '记账中心页面设置 scan:false，不显示扫码按钮');
});

test('ERP.scan 模块存在且支持三级降级', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'barcode', 'scan.js'), 'utf8');
  assert.ok(src.includes('scan.start = function'), 'ERP.scan.start 存在');
  assert.ok(src.includes('BarcodeDetector'), '支持实时扫码（BarcodeDetector）');
  assert.ok(src.includes('getUserMedia'), '支持摄像头调用');
  assert.ok(src.includes('manualCard'), '支持手动输入降级');
});
