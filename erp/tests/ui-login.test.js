/**
 * 问题4：多店铺登录页（创建账号含头像上传）
 * - 创建表单渲染含头像选择
 * - create-account 带头像创建成功
 * - 登录校验
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

test('问题4-创建表单：含头像选择与登录名/密码/店名', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.showCreate = true;
  const html = page.render(null, state);
  assert.ok(html.includes('选择图片'), '含头像上传入口');
  assert.ok(/<input[^>]*type="file"[^>]*data-input="create\.avatar"/.test(html), '头像 file input 存在');
  assert.ok(html.includes('data-input="create.username"'), '登录账号输入');
  assert.ok(html.includes('data-input="create.shopName"'), '店铺名称输入');
  assert.ok(html.includes('data-input="create.password"'), '密码输入');
});

test('问题4-create-account：带头像创建账号成功', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.showCreate = true;
  state.create = { username: 'shopx', shopName: '我的电器行', password: '8888', password2: '8888', avatar: 'data:image/png;base64,BBBB' };
  const ok = page.actions['create-account'](state, state);
  assert.strictEqual(ok, true);
  const list = accounts.load(store);
  const acct = accounts.getById(list, state.selectedId);
  assert.strictEqual(acct.username, 'shopx');
  assert.strictEqual(acct.avatar, 'data:image/png;base64,BBBB', '头像随创建账号保存');
  assert.strictEqual(acct.shopName, '我的电器行');
  // 创建后关闭表单并清空
  assert.strictEqual(state.showCreate, false);
});

test('问题4-create-account：密码不一致被拦截', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.create = { username: 'badpw', shopName: 'X', password: '1111', password2: '2222', avatar: '' };
  const ok = page.actions['create-account'](state, state);
  assert.strictEqual(ok, false);
  assert.ok(state.error.includes('不一致'));
});

test('问题4-登录校验：正确密码通过，错误拒绝', () => {
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
