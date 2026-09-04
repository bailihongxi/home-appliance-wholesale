/**
 * input-live.test.js —— 输入框实时重渲染与焦点恢复测试
 * 重点：表格行内输入框（data-change + data-id，无 data-name）重渲染后焦点必须回到原输入框，
 * 不能跳到第一个同类输入框（退换货页面曾出现此 bug，导致用户感觉"输入被清除"）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('inputSelector 支持 data-id 精确定位（表格行内输入框）', () => {
  // 静态检查 app.js 中 inputSelector 函数包含 data-id 处理
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const fnMatch = src.match(/function inputSelector\(el, key\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, '找到 inputSelector 函数');
  assert.ok(fnMatch[0].includes('data-id'), 'inputSelector 读取 data-id 属性');
  assert.ok(fnMatch[0].includes('idPart'), 'inputSelector 构造 idPart 选择器片段');
  assert.ok(fnMatch[0].includes('idPart'), '选择器末尾拼接 idPart 精确定位行内输入框');
});

test('退换货页面表格输入框使用 data-change + data-id（无 data-name）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-exchange.js'), 'utf8');
  // 退货数量输入框
  assert.ok(src.includes('data-change="return-qty"'), '退货数量输入框使用 data-change="return-qty"');
  assert.ok(src.includes('data-live="1" data-id="'), '退货数量输入框有 data-live 和 data-id');
  // 换货数量输入框
  assert.ok(src.includes('data-change="exch-return-qty"'), '换货数量输入框使用 data-change="exch-return-qty"');
});

test('所有 data-change+data-live 输入框要么有 data-name 要么有 data-id（防止焦点恢复到错误输入框）', () => {
  const uiDir = path.join(__dirname, '..', 'js', 'ui');
  const files = fs.readdirSync(uiDir).filter(f => f.endsWith('.js'));
  const problems = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(uiDir, f), 'utf8');
    // 匹配 <input ... data-change="xxx" ... data-live="1" ...>
    const re = /<input\b[^>]*data-change="[^"]+"[^>]*data-live="1"[^>]*>/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const tag = m[0];
      const hasName = /data-name=/.test(tag);
      const hasId = /data-id=/.test(tag);
      if (!hasName && !hasId) {
        problems.push(f + ': ' + tag.substring(0, 120));
      }
    }
  }
  assert.strictEqual(problems.length, 0,
    '以下 data-change+data-live 输入框既无 data-name 也无 data-id，焦点恢复会跳到错误输入框：\n' + problems.join('\n'));
});
