/**
 * V3 多店铺登录页（问题4 + V2.3 管理员 + 问题2 登录界面）
 * - 登录页仅显示：登录人头像 + 登录账号输入框 + 密码输入框 + 登录按键（不再展示全部用户列表选择式登录）
 * - 输入登录名+密码直接登录（loginWithUsername）
 * - 账户的「新建 / 修改 / 删除」统一由管理员（管理总控）在权限管理页管理，登录页不提供
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
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

test('登录页-渲染：仅头像+账号输入+密码输入+登录键，不展示用户列表', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'myshop', password: '000000', shopName: '我的电器行' });
  const state = page.init(null, store);
  const html = page.render(null, state);
  // 四要素：登录人头像 + 登录账号输入框 + 密码输入框 + 登录按键
  assert.ok(html.includes('login-head-avatar'), '含登录人头像');
  assert.ok(html.includes('data-input="username"'), '含登录账号输入框');
  assert.ok(html.includes('type="password"'), '含密码输入框');
  assert.ok(html.includes('data-act="do-login"'), '含登录按键');
  // 不再展示全部用户列表选择式登录
  assert.ok(!html.includes('login-accounts'), '无账号列表容器');
  assert.ok(!html.includes('pick-account'), '无点选账号动作');
  assert.ok(!html.includes('大家电店') && !html.includes('小家电店') && !html.includes('厨电店'), '不列出默认店铺');
  assert.ok(!html.includes('我的电器行'), '不列出全部自建账户');
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

test('登录校验-loginWithUsername：正确账号密码通过，错误拒绝', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'myshop', password: '000000', shopName: '我的电器行' });
  const ok = page.loginWithUsername(store, 'myshop', '000000');
  assert.ok(ok.ok, '正确账号密码通过');
  assert.strictEqual(ok.account.shopName, '我的电器行', '返回账户信息');
  const bad = page.loginWithUsername(store, 'myshop', 'wrong');
  assert.strictEqual(bad.ok, false, '错误密码拒绝');
  assert.ok(bad.error.includes('密码'), '提示密码错误');
  const noSuch = page.loginWithUsername(store, 'nobody', '000000');
  assert.strictEqual(noSuch.ok, false, '账号不存在拒绝');
  assert.ok(noSuch.error.includes('账号不存在'), '提示账号不存在');
});

test('登录校验-兼容 loginWith：按 id 登录', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'myshop', password: '000000', shopName: '我的电器行' });
  const created = accounts.findByUsername(accounts.load(store), 'myshop');
  const ok = page.loginWith(store, created.id, '000000');
  assert.ok(ok.ok, '正确密码通过');
  const bad = page.loginWith(store, created.id, 'wrong');
  assert.strictEqual(bad.ok, false, '错误密码拒绝');
});

/* ===== V2.3 管理员账号（管理总控，登录名 hawsystem） ===== */
test('V2.3-管理总控登录：登录名 hawsystem / 密码 admina1b22c333 校验通过', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const ok = page.loginWithUsername(store, 'hawsystem', 'admina1b22c333');
  assert.strictEqual(ok.ok, true, '管理总控登录名+初始密码可登录');
  assert.strictEqual(ok.account.role, 'admin', '登录结果含 role=admin');
  const okById = page.loginWith(store, 'admin', 'admina1b22c333');
  assert.strictEqual(okById.ok, true, '兼容旧接口 admin 登录');
  const bad = page.loginWithUsername(store, 'hawsystem', 'wrong');
  assert.strictEqual(bad.ok, false, '错误密码拒绝');
});

test('V2.3-登录页提示账户由管理员统一管理', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(null, state);
  assert.ok(html.includes('请输入登录账号'), '提示输入登录账号');
});

test('登录页：头像图标放置在标题文字上方（我的电器店/电器批发进销存请登录）', () => {
  const login = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-login.js'), 'utf8');
  const avatarIdx = login.indexOf('login-head-avatar');
  const brandIdx = login.indexOf('login-brand');
  const titleIdx = login.indexOf('我的电器店');
  const subIdx = login.indexOf('电器批发进销存 · 请登录');
  assert.ok(avatarIdx > -1, '存在 login-head-avatar 头像');
  assert.ok(brandIdx > -1, '存在 login-brand 标题区域');
  assert.ok(avatarIdx < brandIdx, '头像在标题区域之前（上方）');
  assert.ok(avatarIdx < titleIdx, '头像在"我的电器店"标题之前');
  assert.ok(avatarIdx < subIdx, '头像在"电器批发进销存·请登录"副标题之前');
});
