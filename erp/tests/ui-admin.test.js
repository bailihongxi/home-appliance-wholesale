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
  assert.strictEqual(page.title, '账户权限管理');
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

test('管理员访问：列出管理总控与新建分配账户，9 类分类 chip', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'myshop', password: '123456', shopName: '我的电器行' });
  const state = page.init(null, store);
  const html = page.render(ADMIN_CTX, state);
  assert.ok(html.includes('账户权限管理'), '显示管理标题');
  assert.ok(html.includes('管理总控'), '列出管理总控自身');
  assert.ok(html.includes('我的电器行'), '列出新建分配账户');
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
  state.edits = { acct9: ['厨房电器', '生活小家电'] };
  const el = { getAttribute: (k) => (k === 'data-id' ? 'acct9' : k === 'data-cat' ? '电视' : '') };
  page.actions['admin-toggle-cat'](ADMIN_CTX, state, el);
  assert.ok(state.edits.acct9.includes('电视'), '已加入 电视');
  page.actions['admin-toggle-cat'](ADMIN_CTX, state, el);
  assert.ok(!state.edits.acct9.includes('电视'), '再次点击移除 电视');
});

test('all-cats：设为全部分类（空数组）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.edits = { acct9: ['冰箱'] };
  const el = { getAttribute: (k) => (k === 'data-id' ? 'acct9' : '') };
  page.actions['admin-all-cats'](ADMIN_CTX, state, el);
  assert.deepStrictEqual(state.edits.acct9, [], '全部分类 = 空数组');
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

/* ===== 账户管理（管理员统一新建/修改/删除，登录页已移除） ===== */
test('账户管理-渲染：含新建账号按钮，普通账户含修改/删除按钮，admin 自身无', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'myshop', password: '123456', shopName: '我的电器行' });
  const state = page.init(null, store);
  const html = page.render(ADMIN_CTX, state);
  assert.ok(html.includes('admin-new-toggle'), '含新建账号按钮');
  // 新建分配账户有 修改 + 删除
  const target = accounts.findByUsername(accounts.load(store), 'myshop');
  assert.ok(html.includes('data-act="admin-edit-account" data-id="' + target.id + '"'), target.id + ' 含修改按钮');
  assert.ok(html.includes('data-act="admin-del-account" data-id="' + target.id + '"'), target.id + ' 含删除按钮');
  // admin 自身无修改/删除按钮
  assert.ok(!html.includes('data-act="admin-edit-account" data-id="admin"'), 'admin 无修改按钮');
  assert.ok(!html.includes('data-act="admin-del-account" data-id="admin"'), 'admin 无删除按钮');
  // 登录页不再提供管理按钮
  const login = require('../js/ui/page-login.js');
  const lstate = login.init(null, store);
  const lhtml = login.render(null, lstate);
  assert.ok(!lhtml.includes('edit-account'), '登录页无编辑按钮');
  assert.ok(!lhtml.includes('del-account'), '登录页无删除按钮');
  assert.ok(!lhtml.includes('toggle-create'), '登录页无新建按钮');
});

test('账户管理-新建：createAccount 创建成功（含头像）并计入勾选态', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  state.edits = {};
  state.newForm = { username: 'myshop', shopName: '我的电器行', password: '8888', password2: '8888', avatar: 'data:image/png;base64,AA' };
  const ok = page.actions['admin-create-account'](ADMIN_CTX, state);
  assert.strictEqual(ok, true);
  const acct = accounts.findByUsername(accounts.load(store), 'myshop');
  assert.ok(acct, '账号已创建');
  assert.strictEqual(acct.role, 'user', '新账号默认普通用户');
  assert.strictEqual(acct.avatar, 'data:image/png;base64,AA', '头像已保存');
  assert.ok(state.edits[acct.id], '新账号纳入经营范围勾选态');
  assert.strictEqual(state.showNew, false, '创建后关闭表单');
  assert.ok(state.msg.includes('已创建'));
});

test('账户管理-新建：密码不一致被拦截', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = page.createAccount(store, { username: 'x', shopName: 'X', password: '1111', password2: '2222', avatar: '' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('不一致'));
  assert.strictEqual(accounts.findByUsername(accounts.load(store), 'x'), null, '未创建');
});

test('账户管理-修改：updateAccount 改店名/登录名/密码/头像成功', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const cr = accounts.create(store, { username: 'upd1', password: '123456', shopName: '店一' });
  const r = page.updateAccount(store, cr.account.id, {
    username: 'upd1_new', shopName: '西安电器总店', password: '9999', password2: '9999', avatar: 'data:image/png;base64,BB'
  });
  assert.strictEqual(r.ok, true);
  const acct = accounts.getById(accounts.load(store), cr.account.id);
  assert.strictEqual(acct.shopName, '西安电器总店');
  assert.strictEqual(acct.username, 'upd1_new');
  assert.strictEqual(acct.avatar, 'data:image/png;base64,BB');
  assert.strictEqual(accounts.verify(acct, '9999'), true, '新密码生效');
});

test('账户管理-修改：admin 不可修改；密码不一致被拦截', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const cr = accounts.create(store, { username: 'upd2', password: '123456', shopName: '店二' });
  const r1 = page.updateAccount(store, 'admin', { username: 'admin', shopName: '改', password: '', password2: '', avatar: '' });
  assert.strictEqual(r1.ok, false, 'admin 不可修改');
  assert.ok(r1.error.includes('管理员'));
  const r2 = page.updateAccount(store, cr.account.id, { username: 'a', shopName: 'b', password: '1111', password2: '2222', avatar: '' });
  assert.strictEqual(r2.ok, false, '密码不一致拦截');
  assert.ok(r2.error.includes('不一致'));
});

test('账户管理-修改流程：action 预填表单 → 保存生效', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const cr = accounts.create(store, { username: 'upd3', password: '123456', shopName: '小家电店' });
  const state = page.init(null, store);
  const el = { getAttribute: (k) => (k === 'data-id' ? cr.account.id : '') };
  page.actions['admin-edit-account'](ADMIN_CTX, state, el);
  assert.strictEqual(state.editId, cr.account.id);
  assert.strictEqual(state.editForm.shopName, '小家电店');
  assert.strictEqual(state.editForm.username, 'upd3');
  const html = page.render(ADMIN_CTX, state);
  assert.ok(html.includes('修改账号'), '编辑表单渲染');
  assert.ok(html.includes('data-input="admin-edit.shopName"'), '店名输入框');
  state.editForm = { username: 'upd3_new', shopName: '小家电旗舰店', password: '', password2: '', avatar: '' };
  const ok = page.actions['admin-save-edit'](ADMIN_CTX, state, { getAttribute: (k) => (k === 'data-id' ? cr.account.id : '') });
  assert.strictEqual(ok, true);
  const acct = accounts.getById(accounts.load(store), cr.account.id);
  assert.strictEqual(acct.shopName, '小家电旗舰店');
  assert.strictEqual(acct.username, 'upd3_new');
  assert.strictEqual(state.editId, null, '保存后关闭编辑');
});

test('账户管理-删除：removeAccount 删除成功；admin 不可删除', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'delshop', password: '123456', shopName: '待删电器' });
  const target = accounts.findByUsername(accounts.load(store), 'delshop');
  const r = page.removeAccount(store, target.id);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(accounts.findByUsername(accounts.load(store), 'delshop'), null, '账号已删除');
  const r2 = page.removeAccount(store, 'admin');
  assert.strictEqual(r2.ok, false, 'admin 不可删除');
  assert.ok(r2.error.includes('管理员'));
});

test('账户管理-删除流程：进入确认 → 确认删除 → 账号移除并清数据空间', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'delshop2', password: '123456', shopName: '待删电器2' });
  const target = accounts.findByUsername(accounts.load(store), 'delshop2');
  const state = page.init(null, store);
  state.edits = {};
  state.edits[target.id] = [];
  // 进入确认态
  let deleted = 0;
  page.actions['admin-del-account'](ADMIN_CTX, state, { getAttribute: (k) => (k === 'data-id' ? target.id : '') });
  assert.strictEqual(state.delId, target.id);
  const html = page.render(ADMIN_CTX, state);
  assert.ok(html.includes('确定删除账号'), '渲染删除确认');
  assert.ok(html.includes('data-act="admin-confirm-del"'), '含确认删除按钮');
  // 确认删除
  const ok = page.actions['admin-confirm-del'](ADMIN_CTX, state, { getAttribute: (k) => (k === 'data-id' ? target.id : '') });
  assert.strictEqual(ok, true);
  assert.strictEqual(accounts.findByUsername(accounts.load(store), 'delshop2'), null, '账号已删除');
  assert.strictEqual(state.delId, null, '确认态关闭');
  assert.ok(state.msg.includes('已删除'));
  assert.ok(!state.edits[target.id], '勾选态已清理');
});

test('账户管理-删除：admin 不可删（action 拦截）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const ok = page.actions['admin-del-account'](ADMIN_CTX, state, { getAttribute: (k) => (k === 'data-id' ? 'admin' : '') });
  assert.strictEqual(ok, false);
  assert.strictEqual(state.delId, null, '不进入删除确认');
  assert.ok(state.error.includes('管理员'));
});

test('账户管理-取消：新建/修改/删除取消不生效', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const cr = accounts.create(store, { username: 'canc1', password: '123456', shopName: '取消店' });
  const state = page.init(null, store);
  state.showNew = true;
  page.actions['admin-new-cancel'](ADMIN_CTX, state);
  assert.strictEqual(state.showNew, false);
  state.editId = cr.account.id;
  page.actions['admin-edit-cancel'](ADMIN_CTX, state);
  assert.strictEqual(state.editId, null);
  state.delId = cr.account.id;
  page.actions['admin-del-cancel'](ADMIN_CTX, state);
  assert.strictEqual(state.delId, null);
  assert.strictEqual(accounts.getById(accounts.load(store), cr.account.id) !== null, true, '账号仍在');
});
