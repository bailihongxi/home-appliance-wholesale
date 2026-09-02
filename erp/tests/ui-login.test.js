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

/* ===== 登录账户管理：编辑（UI） ===== */
test('登录账户管理-渲染：每个账号卡片含编辑/删除按钮', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(null, state);
  assert.ok(html.includes('data-act="edit-account"'), '含编辑按钮');
  assert.ok(html.includes('data-act="del-account"'), '含删除按钮');
  // 4 个预置账号（admin + 3 店）× 各 2 个管理按钮
  const editCount = (html.match(/data-act="edit-account"/g) || []).length;
  const delCount = (html.match(/data-act="del-account"/g) || []).length;
  assert.strictEqual(editCount, 4);
  assert.strictEqual(delCount, 4);
});

test('登录账户管理-edit-account：点击编辑预填店名/登录名，打开编辑表单', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const el = { getAttribute: (k) => (k === 'data-id' ? 'acct1' : '') };
  page.actions['edit-account'](state, state, el);
  assert.strictEqual(state.editId, 'acct1');
  assert.strictEqual(state.edit.shopName, '大家电店');
  assert.strictEqual(state.edit.username, 'appliance');
  assert.strictEqual(state.edit.password, '', '密码不预填');
  const html = page.render(null, state);
  assert.ok(html.includes('编辑店铺账号'), '编辑表单渲染');
  assert.ok(html.includes('data-input="edit.shopName"'), '店名输入框');
  assert.ok(html.includes('data-input="edit.password"'), '新密码输入框');
});

test('登录账户管理-save-account：修改店名+登录账号+密码保存成功', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.editId = 'acct1';
  state.edit = { username: 'appliance_new', shopName: '西安电器总店', password: '9999', password2: '9999', avatar: '' };
  const ok = page.actions['save-account'](state, state);
  assert.strictEqual(ok, true);
  const acct = accounts.getById(accounts.load(store), 'acct1');
  assert.strictEqual(acct.shopName, '西安电器总店');
  assert.strictEqual(acct.username, 'appliance_new');
  assert.strictEqual(accounts.verify(acct, '9999'), true, '新密码生效');
  assert.strictEqual(state.editId, null, '保存后关闭编辑');
});

test('登录账户管理-save-account：两次密码不一致被拦截', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.editId = 'acct1';
  state.edit = { username: 'appliance', shopName: '大家电店', password: '1111', password2: '2222', avatar: '' };
  const ok = page.actions['save-account'](state, state);
  assert.strictEqual(ok, false);
  assert.ok(state.error.includes('不一致'));
});

/* ===== 登录账户管理：删除（UI） ===== */
test('登录账户管理-del-account：点击删除进入确认态', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const el = { getAttribute: (k) => (k === 'data-id' ? 'acct2' : '') };
  page.actions['del-account'](state, state, el);
  assert.strictEqual(state.pendingDeleteId, 'acct2');
  const html = page.render(null, state);
  assert.ok(html.includes('确定删除账号'), '渲染删除确认');
  assert.ok(html.includes('data-act="confirm-del-account"'), '含确认删除按钮');
  assert.ok(html.includes('data-act="cancel-del-account"'), '含取消按钮');
});

test('登录账户管理-confirm-del-account：确认后账号被删除并清除选中', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'delshop', password: '123456', shopName: '待删电器' });
  const target = accounts.findByUsername(accounts.load(store), 'delshop');
  const state = page.init(null, store);
  state.selectedId = target.id;
  const el = { getAttribute: (k) => (k === 'data-id' ? target.id : '') };
  const ok = page.actions['confirm-del-account'](state, state, el);
  assert.strictEqual(ok, true);
  assert.strictEqual(accounts.findByUsername(accounts.load(store), 'delshop'), null, '账号已删除');
  assert.strictEqual(state.selectedId, null, '选中态已清除');
  assert.strictEqual(state.pendingDeleteId, null, '确认态关闭');
  assert.ok(state.msg.includes('已删除'));
});

test('登录账户管理-cancel-del-account：取消不删除', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.pendingDeleteId = 'acct1';
  page.actions['cancel-del-account'](state, state);
  assert.strictEqual(state.pendingDeleteId, null);
  assert.strictEqual(accounts.getById(accounts.load(store), 'acct1') !== null, true, '账号仍在');
});

/* ===== V2.3 管理员账号 ===== */
test('V2.3-登录列表：含管理员账号 admin（管理总控）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(null, state);
  assert.ok(html.includes('管理总控'), '登录列表显示管理员店名');
  assert.ok(html.includes('@admin'), '显示 @admin 登录名');
  const admin = accounts.getById(accounts.load(store), 'admin');
  assert.strictEqual(admin.role, 'admin');
});

test('V2.3-管理员登录：初始密码 admina1b22c333 校验通过', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const ok = page.loginWith(store, 'admin', 'admina1b22c333');
  assert.strictEqual(ok.ok, true, '管理员初始密码可登录');
  assert.strictEqual(ok.account.role, 'admin', '登录结果含 role=admin');
  const bad = page.loginWith(store, 'admin', 'wrong');
  assert.strictEqual(bad.ok, false, '错误密码拒绝');
});
