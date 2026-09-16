/**
 * print-template-v315.test.js —— 打印模版列宽和表头样式验证
 * 品牌减少10%，类型缩小20%，型号增加；表头加粗加大居中，底行双线
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function read(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
}

test('打印模版品牌列宽度减少10%（chars 4→3.6）', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes("{ head: '品牌', chars: 3.6 }"), '品牌列 chars=3.6（减少10%）');
  assert.ok(!doc.includes("{ head: '品牌', chars: 4 }"), '品牌列不再是 chars=4');
});

test('打印模版类型列宽度缩小20%（chars 5→4）', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes("{ head: '类型', chars: 4 }"), '类型列 chars=4（缩小20%）');
  assert.ok(!doc.includes("{ head: '类型', chars: 5 }"), '类型列不再是 chars=5');
});

test('打印模版型号列仍为rest（占剩余空间，自然增加约10%）', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes("{ head: '型号', rest: true }"), '型号列仍为 rest');
});

test('打印表头文字加粗加大一个字号（font-size:12px）', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes('th { background: #f2f2f2; font-weight: 700; font-size: 12px;'),
    '表头 th font-size:12px（加大一个字号）');
  assert.ok(doc.includes('font-weight: 700'), '表头加粗 font-weight:700');
});

test('打印表头文字左右居中显示（text-align: center）', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes('text-align: center'), '表头 text-align: center 居中');
});

test('打印表头底行使用双线（border-bottom: 3px double）', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes('border-bottom: 3px double #000'), '表头底行使用双线 border-bottom: 3px double');
});

test('打印模版所有表格内容左右居中显示（th,td text-align:center）', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes('th, td { border: 1px solid #000; padding: 3px 5px; text-align: center;'),
    'th,td 默认 text-align:center 居中');
  assert.ok(!doc.includes('th.num, td.num { text-align: right; }'),
    '已移除 num 右对齐类，所有内容居中');
});

test('打印模版型号列添加折行样式（model-col class + word-break）', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes('td.model-col { text-align: left; word-break: break-all; word-wrap: break-word; white-space: normal; }'),
    '型号列 td.model-col 有折行样式');
  assert.ok(doc.includes('<td class="model-col">'), '明细行型号列 td 有 model-col class');
});

test('打印模版表格使用 table-layout:fixed 保障列宽弹性和折行', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes('table-layout: fixed'), '表格 table-layout:fixed 保障列宽固定和内容折行');
});

test('打印模版单元格垂直居中（vertical-align:middle）', () => {
  const doc = read('js/ui/print-doc.js');
  assert.ok(doc.includes('vertical-align: middle'), '单元格 vertical-align:middle 垂直居中');
});
