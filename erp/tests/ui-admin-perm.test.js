/**
 * V3.59 账户权限管理页（ui/page-admin.js）—— 手动分配权限 UI
 * - 账号卡片权限摘要 + 分配权限按钮（admin 自身不可分配）
 * - 四组 16 项手动勾选：toggle / 全选 / 清空 / 保存
 * - 新建账号：数据空间选择（共用本店数据=员工 ownerId=admin / 独立数据空间）
 */
const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-admin.js');
const accounts = require('../js/core/accounts.js');

function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
}

const ADMIN_CTX = { currentAccount: { id: 'admin', username: 'hawsystem', role: 'admin', shopName: '管理总控' } };
const el = (attrs) => ({ getAttribute: (k) => attrs[k] || '' });

test('render：管理总控自身卡片不渲染「分配权限」按钮与权限摘要', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  const html = page.render(ADMIN_CTX, state);
  assert.ok(!html.includes('data-act="admin-perm-open" data-id="admin"'), 'admin 自身无分配按钮');
  assert.ok(!html.includes('data-act="admin-perm-toggle" data-id="admin"'), 'admin 无权限勾选');
});

test('render：普通账号卡片显示权限摘要与「分配权限」按钮；展开后含五组面板', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'staff', password: '123456', shopName: '店员' });
  const state = page.init(null, store);
  const html = page.render(ADMIN_CTX, state);
  const id = accounts.findByUsername(accounts.load(store), 'staff').id;
  assert.ok(html.includes('data-act="admin-perm-open" data-id="' + id + '"'), '有分配权限按钮');
  assert.ok(html.includes('未开通任何权限'), '未开通权限有摘要提示');
  // 展开后
  state.permsEditId = id;
  const html2 = page.render(ADMIN_CTX, state);
  accounts.PERM_GROUPS.forEach((g) => {
    assert.ok(html2.includes('>' + g.name + '</div>'), '含分组：' + g.name);
  });
  // V3.81：新增「价格可见」组（显示零售价 / 显示批发价）→ 16 → 18 项
  assert.strictEqual((html2.match(/data-act="admin-perm-toggle"/g) || []).length,
    accounts.PERMS.length, '18 项权限开关');
  assert.ok(html2.includes('data-act="admin-perm-all"'), '含全选');
  assert.ok(html2.includes('data-act="admin-perm-none"'), '含清空');
  assert.ok(html2.includes('data-act="admin-perm-save"'), '含保存权限');
});

test('admin-perm-toggle：点击切换单权限勾选态', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'staff2', password: '123456' });
  const id = accounts.findByUsername(accounts.load(store), 'staff2').id;
  const state = page.init(null, store);
  state.permsEditId = id;
  page.actions['admin-perm-toggle'](ADMIN_CTX, state, el({ 'data-id': id, 'data-perm': 'sale_bill' }));
  assert.strictEqual(state.permsEdits[id].sale_bill, true, '勾上');
  page.actions['admin-perm-toggle'](ADMIN_CTX, state, el({ 'data-id': id, 'data-perm': 'sale_bill' }));
  assert.strictEqual(state.permsEdits[id].sale_bill, false, '再点取消');
});

test('admin-perm-all / admin-perm-none：全选 18 项 / 一键清空', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'staff3', password: '123456' });
  const id = accounts.findByUsername(accounts.load(store), 'staff3').id;
  const state = page.init(null, store);
  page.actions['admin-perm-all'](ADMIN_CTX, state, el({ 'data-id': id }));
  assert.strictEqual(Object.keys(state.permsEdits[id]).length, accounts.PERMS.length, '全选 18 项');
  page.actions['admin-perm-none'](ADMIN_CTX, state, el({ 'data-id': id }));
  assert.deepStrictEqual(state.permsEdits[id], {}, '清空');
});

test('admin-perm-save：保存勾选写入账号 perms，未变化的账号不计入 saved', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'staff4', password: '123456' });
  accounts.create(store, { username: 'staff5', password: '123456' });
  const id4 = accounts.findByUsername(accounts.load(store), 'staff4').id;
  const id5 = accounts.findByUsername(accounts.load(store), 'staff5').id;
  const state = page.init(null, store);
  state.permsEdits = {};
  state.permsEdits[id4] = { sale_bill: true, ws_bill: true, stock_read: true };
  state.permsEditId = id4;
  page.actions['admin-perm-save'](ADMIN_CTX, state, el({ 'data-id': id4 }));
  assert.ok(state.msg.includes('1'), '保存 1 个账号');
  const a4 = accounts.getById(accounts.load(store), id4);
  assert.strictEqual(accounts.can(a4, 'sale_bill'), true);
  assert.strictEqual(accounts.can(a4, 'report'), false, '未勾选不生效');
  const a5 = accounts.getById(accounts.load(store), id5);
  // V3.81：新建账号的 perms 显式带价格两项 false（「已明确关闭」），不再是空对象
  assert.deepStrictEqual(a5.perms,
    { price_retail_view: false, price_wholesale_view: false }, '未操作账号保持全关');
  assert.strictEqual(accounts.can(a5, 'price_retail_view'), false, '未操作账号看不到零售价');
  assert.strictEqual(state.permsEditId, null, '保存后收起面板');
});

test('savePerms：admin 自身跳过，不会被修改', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = page.savePerms(store, { admin: { sale_bill: true } });
  assert.strictEqual(r.saved, 0);
  assert.strictEqual(accounts.can(accounts.getById(accounts.load(store), 'admin'), 'sale_bill'), true, 'admin 本就全权限');
});

test('createAccount：默认「共用本店数据」（员工 ownerId=admin）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = page.createAccount(store, { username: 'emp', shopName: '员工', password: '123456', password2: '123456' });
  assert.ok(r.ok);
  const acct = accounts.getById(accounts.load(store), r.account.id);
  assert.strictEqual(acct.ownerId, 'admin', '员工共用老板库');
  // V3.81：价格两项显式 false（区别于「无 key」的老账号）
  assert.deepStrictEqual(acct.perms,
    { price_retail_view: false, price_wholesale_view: false }, '默认权限全关');
  accounts.PERMS.forEach((p) => {
    assert.strictEqual(accounts.can(acct, p.id), false, '默认全关：' + p.id);
  });
});

test('createAccount：选择「独立数据空间」→ ownerId=null', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = page.createAccount(store, {
    username: 'solo2', shopName: '独立', password: '123456', password2: '123456', dataSpace: 'solo'
  });
  assert.ok(r.ok);
  const acct = accounts.getById(accounts.load(store), r.account.id);
  assert.strictEqual(acct.ownerId, null);
});

test('admin-new-ds：切换新建表单数据空间', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const state = page.init(null, store);
  assert.strictEqual(state.newForm.dataSpace, 'shared', '默认共用本店数据');
  page.actions['admin-new-ds'](ADMIN_CTX, state, el({ 'data-value': 'solo' }));
  assert.strictEqual(state.newForm.dataSpace, 'solo');
  page.actions['admin-new-ds'](ADMIN_CTX, state, el({ 'data-value': 'shared' }));
  assert.strictEqual(state.newForm.dataSpace, 'shared');
});

test('render：展开权限面板时其他账号的卡片不受影响', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 's1', password: '123456' });
  accounts.create(store, { username: 's2', password: '123456' });
  const id1 = accounts.findByUsername(accounts.load(store), 's1').id;
  const id2 = accounts.findByUsername(accounts.load(store), 's2').id;
  const state = page.init(null, store);
  state.permsEditId = id1;
  const html = page.render(ADMIN_CTX, state);
  assert.ok(html.includes('data-act="admin-perm-open" data-id="' + id2 + '"'), '未展开账号仍是分配按钮');
});
