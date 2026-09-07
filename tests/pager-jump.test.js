/**
 * pager-jump.test.js —— 分页跳转输入框测试
 * 验证分页组件包含输入框和跳转按钮，app.js 包含 page-jump action
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function read(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
}

test('分页组件包含跳转输入框和跳转按钮', () => {
  const components = read('js/ui/components.js');
  assert.ok(components.includes('pager-jump-input'), '分页组件包含 pager-jump-input 输入框');
  assert.ok(components.includes('page-jump'), '分页组件包含 page-jump 跳转按钮');
  assert.ok(components.includes('data-pager-act'), '分页组件包含 data-pager-act 属性');
  assert.ok(components.includes('type="number"'), '跳转输入框类型为 number');
  assert.ok(components.includes('min="1"'), '跳转输入框最小值为1');
});

test('app.js 包含全局 page-jump action', () => {
  const app = read('js/app.js');
  assert.ok(app.includes("'page-jump': function"), 'app.js 包含 page-jump action');
  assert.ok(app.includes('pager-jump-input'), 'page-jump action 读取输入框值');
  assert.ok(app.includes('data-pager-act'), 'page-jump action 读取分页 action 名称');
});

test('分页跳转输入框设置了 max 属性为总页数', () => {
  const components = read('js/ui/components.js');
  assert.ok(components.includes('max="\' + pages + \'"'), '跳转输入框 max 属性绑定总页数');
});

test('分页跳转 action 验证页码范围（小于1提示错误，大于max提示错误）', () => {
  const app = read('js/app.js');
  assert.ok(app.includes('请输入有效页码'), '小于1时提示"请输入有效页码"');
  assert.ok(app.includes('页码不能超过'), '大于max时提示"页码不能超过"');
});
