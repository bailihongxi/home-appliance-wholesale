/**
 * V2.3 管理员账号与账户权限管理（ui/page-admin.js + 我的页入口）
 * - 仅管理员可访问权限管理页（isAdmin 判断）
 * - 渲染：列出全部账号、9 类分类 chip、全部分类
 * - 勾选/全部分类 → 保存写入账号 scopeCategories
 * - 「我的」页仅管理员显示「权限管理」入口
 */
const test = require('node:test');
const assert = require('node:assert');
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
const USER_CTX = { currentAccount: { id: 'acct1', username: 'appliance', role: 'user', shopName: '大家电店' } };

test('页面元数据', () => {
  assert.strictEqual(page.name, 'admin');
  assert.strictEqual(page.title, '权限管理');
});

test('isAdmin：管理员 true，普通账号 false', () => {
  assert.strictEqual(page.isAdmin(ADMIN_CTX), true, 'admin 角色为管理员');
  assert.strictEqual(page.isAdmin(USER_CTX), false, 'user 角色非管理员');
  assert.strictEqual(page.isAdmin({}), false, '无账号信息非管理员');
});

test('非管理员访问：渲染无权限提示，不渲染管理内容', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(USER_CTX, state);
  assert.ok(html.includes('无权限'), '显示无权限');
  assert.ok(!html.includes('admin-toggle-cat'), '不渲染权限编辑');
  assert.ok(!html.includes('账户权限管理'), '不渲染管理标题');
});

test('管理员访问：列出全部账号（admin+3 店），9 类分类 chip', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(ADMIN_CTX, state);
  assert.ok(html.includes('账户权限管理'), '显示管理标题');
  assert.ok(html.includes('管理总控'), '列出管理员自身');
  assert.ok(html.includes('大家电店'), '列出大家电店');
  assert.ok(html.includes('小家电店'), '列出小家电店');
  assert.ok(html.includes('厨电店'), '列出厨电店');
  // 9 类 chip
  ['冰箱', '洗衣机', '空调', '电视', '厨房电器', '生活小家电', '数码影音', '配件耗材', '其他'].forEach((c) => {
    assert.ok(html.includes('data-cat="' + c + '"'), '含分类 chip：' + c);
  });
  assert.ok(html.includes('data-act="admin-save"'), '含保存按钮');
});

test('管理员自身账号：经营范围不可改（不渲染 chip），显示只读经营范围', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(ADMIN_CTX, state);
  // admin 卡片不应有 data-id="admin" 的 chip
  const adminChip = html.match(/data-act="admin-toggle-cat" data-id="admin"/g) || [];
  assert.strictEqual(adminChip.length, 0, 'admin 自身无编辑 chip');
  assert.ok(html.includes('系统账号'), '标注系统账号');
});

test('toggle-cat：点击分类切换勾选态', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.edits = { acct3: ['厨房电器', '生活小家电'] };
  const el = { getAttribute: (k) => (k === 'data-id' ? 'acct3' : k === 'data-cat' ? '电视' : '') };
  page.actions['admin-toggle-cat'](ADMIN_CTX, state, el);
  assert.ok(state.edits.acct3.includes('电视'), '已加入 电视');
  page.actions['admin-toggle-cat'](ADMIN_CTX, state, el);
  assert.ok(!state.edits.acct3.includes('电视'), '再次点击移除 电视');
});

test('all-cats：设为全部分类（空数组）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.edits = { acct2: ['冰箱'] };
  const el = { getAttribute: (k) => (k === 'data-id' ? 'acct2' : '') };
  page.actions['admin-all-cats'](ADMIN_CTX, state, el);
  assert.deepStrictEqual(state.edits.acct2, [], '全部分类 = 空数组');
});

test('saveEdits：保存部分勾选 → 写入账号 scopeCategories', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'myshop', password: '123456', shopName: '我的店' });
  const target = accounts.findByUsername(accounts.load(store), 'myshop');
  const edits = {};
  edits[target.id] = ['冰箱', '电视'];
  const r = page.saveEdits(store, edits);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.saved, 1);
  const updated = accounts.getById(accounts.load(store), target.id);
  assert.deepStrictEqual(updated.scopeCategories, ['冰箱', '电视'], '经营范围已写入');
});

test('saveEdits：全部分类（空/全选）→ 保存为空数组（不限制）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'allshop', password: '123456', shopName: '全店' });
  const target = accounts.findByUsername(accounts.load(store), 'allshop');
  const edits = {};
  edits[target.id] = [];
  page.saveEdits(store, edits);
  assert.deepStrictEqual(accounts.getById(accounts.load(store), target.id).scopeCategories, [], '全部分类 = 空数组');
});

test('saveEdits：跳过系统管理员 admin，不改其经营范围', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const before = accounts.getById(accounts.load(store), 'admin').scopeCategories.slice();
  const edits = { admin: ['冰箱'] };
  const r = page.saveEdits(store, edits);
  assert.strictEqual(r.saved, 0, 'admin 不计入已保存数');
  assert.deepStrictEqual(accounts.getById(accounts.load(store), 'admin').scopeCategories, before, 'admin 经营范围不变');
});

/* ===== 「我的」页权限管理入口 ===== */
function mineCtx(acct) {
  return {
    settings: { shopName: acct.shopName, scopeCategories: [], avatar: '' },
    currentAccount: acct
  };
}

test('我的页：管理员显示「权限管理」入口', () => {
  const mine = require('../js/ui/page-mine.js');
  const store = memStore();
  accounts.ensurePreset(store);
  const state = { cfg: null, busy: false, editShop: false, shopNameEdit: '管理总控' };
  const html = mine.render(mineCtx({ id: 'admin', username: 'admin', role: 'admin', shopName: '管理总控' }), state);
  assert.ok(html.includes('权限管理'), '管理员可见权限管理入口');
  assert.ok(html.includes('data-page="admin"'), '入口跳转权限管理页');
});

test('我的页：普通账号不显示「权限管理」入口', () => {
  const mine = require('../js/ui/page-mine.js');
  const store = memStore();
  accounts.ensurePreset(store);
  const state = { cfg: null, busy: false, editShop: false, shopNameEdit: '大家电店' };
  const html = mine.render(mineCtx({ id: 'acct1', username: 'appliance', role: 'user', shopName: '大家电店' }), state);
  assert.ok(!html.includes('权限管理'), '普通账号无权限管理入口');
  assert.ok(!html.includes('data-page="admin"'), '普通账号无跳转入口');
});
