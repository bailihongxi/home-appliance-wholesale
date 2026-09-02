/**
 * V3 多店铺登录页（问题4 + V2.3 管理员）
 * - 登录页仅作账号选择与密码校验
 * - 账户的「新建 / 修改 / 删除」统一由管理员在权限管理页管理，登录页不再提供
 * - 登录列表含管理员账号 admin
 */
const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-login.js');
const accounts = require('../js/core/accounts.js');

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

test('页面元数据', () => {
  assert.strictEqual(page.name, 'login');
  assert.strictEqual(page.hideInNav, true);
});

test('登录页-渲染：列出全部账号（admin + 3 店）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(null, state);
  assert.ok(html.includes('大家电店'), '列出大家电店');
  assert.ok(html.includes('小家电店'), '列出小家电店');
  assert.ok(html.includes('厨电店'), '列出厨电店');
  assert.ok(html.includes('管理总控'), '列出管理员账号');
  assert.ok(html.includes('@admin'), '显示 @admin 登录名');
});

test('登录页-无账户管理按钮：不含编辑/删除/新建店铺账号', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(null, state);
  assert.ok(!html.includes('edit-account'), '无编辑按钮');
  assert.ok(!html.includes('del-account'), '无删除按钮');
  assert.ok(!html.includes('toggle-create'), '无新建账号按钮');
  assert.ok(!html.includes('新建店铺账号'), '无新建店铺账号字样');
  assert.ok(!html.includes('create-account'), '无创建动作');
});

test('登录校验：正确密码通过，错误拒绝', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.selectedId = 'acct1';
  state.pwd = '000000';
  const ok = page.loginWith(store, 'acct1', '000000');
  assert.ok(ok.ok, '正确密码通过');
  const bad = page.loginWith(store, 'acct1', 'wrong');
  assert.strictEqual(bad.ok, false, '错误密码拒绝');
});

/* ===== V2.3 管理员账号 ===== */
test('V2.3-管理员登录：初始密码 admina1b22c333 校验通过', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const ok = page.loginWith(store, 'admin', 'admina1b22c333');
  assert.strictEqual(ok.ok, true, '管理员初始密码可登录');
  assert.strictEqual(ok.account.role, 'admin', '登录结果含 role=admin');
  const bad = page.loginWith(store, 'admin', 'wrong');
  assert.strictEqual(bad.ok, false, '错误密码拒绝');
});

test('V2.3-登录页提示账户由管理员统一管理', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(null, state);
  assert.ok(html.includes('管理员') && html.includes('统一管理'), '提示账户由管理员统一管理');
});
