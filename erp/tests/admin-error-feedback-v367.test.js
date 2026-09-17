/**
 * V3.67：账户权限管理页「操作无反应」修复回归
 *
 * 背景（真机复现）：管理员点「创建账号」后页面毫无变化、也看不到任何提示。
 * 根因有两处，且互相叠加：
 *   ① 校验失败的分支写了 `return false` —— 本框架中 `return false` 表示
 *      「跳过 afterAction 重渲染」（V3.47 起用于防止勾选跳顶），
 *      于是 state.error 存进了内存，页面却从不重绘 → 表现为「点了没反应」。
 *   ② 即便重绘，错误提示渲染在整页最底部（保存按钮之后），
 *      而新建表单在页面上方，长页面下用户根本看不到。
 *
 * 本文件把「错误必须可见」固化成断言，防止回归。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const page = require('../js/ui/page-admin.js');
const accounts = require('../js/core/accounts.js');

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

const ADMIN_CTX = { currentAccount: { id: 'admin', username: 'admin', role: 'admin', shopName: '管理总控' } };

/** 建好 preset 并打开新建表单的 state */
function openNewForm() {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.store = store;
  state.showNew = true;
  state.newForm = { username: '', shopName: '', password: '', password2: '', avatar: '', dataSpace: 'shared' };
  return state;
}

/** 取渲染结果中「新建表单」那一段（create-box 之后、账号卡片之前） */
function createBoxSegment(html) {
  const start = html.indexOf('create-box');
  assert.ok(start >= 0, '渲染出新建表单 create-box');
  const rest = html.slice(start);
  const end = rest.indexOf('admin-acct');
  return end >= 0 ? rest.slice(0, end) : rest;
}

test('V3.67：创建账号校验失败必须返回 true（触发重渲染，否则提示永远不显示）', () => {
  const state = openNewForm();
  state.newForm.username = '测试店'; // 非法：非字母/数字/下划线
  state.newForm.shopName = '测试店';
  state.newForm.password = '1234';
  state.newForm.password2 = '1234';

  const ret = page.actions['admin-create-account'](ADMIN_CTX, state);

  assert.strictEqual(ret, true, '校验失败必须返回 true 以重绘页面（返回 false 会导致「点了没反应」）');
  assert.ok(state.error, 'state.error 已设置');
  assert.ok(state.error.includes('登录账号'), '提示内容指向登录账号格式：' + state.error);
  assert.strictEqual(state.showNew, true, '表单保持打开，便于用户改正');
});

test('V3.67：两次密码不一致同样返回 true 并提示', () => {
  const state = openNewForm();
  state.newForm.username = 'okshop';
  state.newForm.shopName = '好店';
  state.newForm.password = '1234';
  state.newForm.password2 = '5678';

  const ret = page.actions['admin-create-account'](ADMIN_CTX, state);
  assert.strictEqual(ret, true, '返回 true 触发重绘');
  assert.ok(state.error && state.error.includes('密码'), '提示密码不一致：' + state.error);
});

test('V3.67：错误提示就地显示在新建表单内（用户点按钮的地方就能看到）', () => {
  const state = openNewForm();
  state.error = '登录账号需为 2-20 位字母/数字/下划线';
  const html = page.render(ADMIN_CTX, state);

  const box = createBoxSegment(html);
  assert.ok(box.includes('notice-warn'), '新建表单内有警告块');
  assert.ok(box.includes('登录账号需为'), '警告块内是本次的错误文案');
  assert.ok(box.includes('data-act="admin-create-account"'), '警告块与创建按钮同在表单内');
});

test('V3.67：同一条错误不在页面上重复出现两次', () => {
  const state = openNewForm();
  state.error = '登录账号需为 2-20 位字母/数字/下划线';
  const html = page.render(ADMIN_CTX, state);

  const times = (html.match(/登录账号需为/g) || []).length;
  assert.strictEqual(times, 1, '错误只在表单内出现一次（页底不再重复），实际出现 ' + times + ' 次');
});

test('V3.67：修改/删除账号的错误分支同样返回 true（原 return false 会吞掉提示）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.store = store;
  const elAdmin = { getAttribute: () => 'admin' };

  assert.strictEqual(
    page.actions['admin-edit-account'](ADMIN_CTX, state, elAdmin), true,
    '修改管理员账号 → 返回 true 并显示「管理员账号不可修改」');
  assert.ok(state.error.includes('不可修改'), '提示已设置：' + state.error);

  state.error = '';
  assert.strictEqual(
    page.actions['admin-del-account'](ADMIN_CTX, state, elAdmin), true,
    '删除管理员账号 → 返回 true 并显示「管理员账号不可删除」');
  assert.ok(state.error.includes('不可删除'), '提示已设置：' + state.error);
});

test('V3.67：非法账号不会被创建（修复只影响提示，不改变校验语义）', () => {
  const state = openNewForm();
  state.newForm.username = '测试店';
  state.newForm.shopName = '测试店';
  state.newForm.password = '1234';
  state.newForm.password2 = '1234';

  page.actions['admin-create-account'](ADMIN_CTX, state);
  const list = accounts.load(state.store);
  assert.strictEqual(
    list.filter((a) => a.username === '测试店').length, 0,
    '非法登录账号未写入账号表');
});

test('V3.67：合法账号仍能正常创建并给出成功提示', () => {
  const state = openNewForm();
  state.newForm.username = 'goodshop';
  state.newForm.shopName = '好电器行';
  state.newForm.password = '1234';
  state.newForm.password2 = '1234';

  const ret = page.actions['admin-create-account'](ADMIN_CTX, state);
  assert.strictEqual(ret, true, '成功也返回 true');
  assert.ok(state.msg && state.msg.includes('已创建'), '给出成功提示：' + state.msg);
  assert.strictEqual(state.error, '', '成功时无错误');
  assert.strictEqual(state.showNew, false, '成功后收起表单');
  assert.ok(
    accounts.load(state.store).some((a) => a.username === 'goodshop'),
    '账号已写入账号表');
});

test('V3.79 版本号：page-mine V3.82 / sw.js v111', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.82'), '关于页应显示 V3.79');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v111';"), 'SW 缓存版本应为 v106');
});
