/**
 * V3.59 权限分级（core/accounts.js 扩展）
 * - 16 项权限，4 组（零售/批发/档案库存/资金管理），全部手动分配，无角色模板
 * - can()/canAny()/canView()/canViewCost() 校验
 * - 数据归属 dataOwnerId（员工 ownerId 共用老板库）
 * - 新建账号默认全关；旧账号迁移补全权限；admin 全权限固定
 */
const test = require('node:test');
const assert = require('node:assert');
const accounts = require('../js/core/accounts.js');

function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

const ADMIN = { id: 'admin', username: 'hawsystem', role: 'admin', shopName: '管理总控' };
const USER = { id: 'acct1', username: 'staff', role: 'user', shopName: '店员', perms: {} };

test('权限清单：16 项，4 组，id 唯一，每项含 label', () => {
  assert.strictEqual(accounts.PERMS.length, 16, '共 16 项权限');
  assert.strictEqual(accounts.PERM_GROUPS.length, 4, '4 个分组');
  const ids = new Set();
  accounts.PERMS.forEach((p) => {
    assert.ok(p.id, '有 id');
    assert.ok(p.label, '有 label：' + p.id);
    assert.ok(p.group, '有 group：' + p.id);
    assert.ok(!ids.has(p.id), 'id 唯一：' + p.id);
    ids.add(p.id);
  });
  const groups = new Set(accounts.PERM_GROUPS.map((g) => g.id));
  accounts.PERMS.forEach((p) => {
    assert.ok(groups.has(p.group), 'group 属于已定义分组：' + p.group);
  });
});

test('can：管理总控全权限（任意权限返回 true）', () => {
  accounts.PERMS.forEach((p) => {
    assert.strictEqual(accounts.can(ADMIN, p.id), true, 'admin 有权限：' + p.id);
  });
  assert.strictEqual(accounts.can(null, 'sale_bill'), false, '无账号 false');
});

test('can：普通账号默认全关，手动勾选后生效', () => {
  assert.strictEqual(accounts.can(USER, 'sale_bill'), false, '默认无零售开单');
  assert.strictEqual(accounts.can(USER, 'report'), false, '默认无报表');
  const staff = { id: 'acct2', role: 'user', perms: { sale_bill: true, stock_read: true } };
  assert.strictEqual(accounts.can(staff, 'sale_bill'), true, '勾选后生效');
  assert.strictEqual(accounts.can(staff, 'ws_bill'), false, '未勾选不生效');
});

test('canAny：任一权限即通过；空列表 false', () => {
  assert.strictEqual(accounts.canAny(USER, ['sale_bill', 'ws_bill']), false);
  const staff = { id: 'acct3', role: 'user', perms: { ws_bill: true } };
  assert.strictEqual(accounts.canAny(staff, ['sale_bill', 'ws_bill']), true);
  assert.strictEqual(accounts.canAny(staff, []), false);
  assert.strictEqual(accounts.canAny(ADMIN, []), true, 'admin 空列表也通过（全权限）');
});

test('canView：页面权限映射', () => {
  const staff = { id: 'acct4', role: 'user', perms: { sale_bill: true, product_read: true } };
  assert.strictEqual(accounts.canView(staff, 'sale'), true, '有零售开单可进销售');
  assert.strictEqual(accounts.canView(staff, 'purchase'), false, '无进货权限不可进进货');
  assert.strictEqual(accounts.canView(staff, 'product'), true, '有档案只读可进档案');
  assert.strictEqual(accounts.canView(staff, 'report'), false, '无报表权限');
  assert.strictEqual(accounts.canView(staff, 'exchange'), false, '无退货权限');
  assert.strictEqual(accounts.canView(staff, 'home'), true, '首页无门槛');
  assert.strictEqual(accounts.canView(staff, 'mine'), true, '我的无门槛');
  assert.strictEqual(accounts.canView(staff, 'setting'), false, '设置需数据管理');
  assert.strictEqual(accounts.canView(staff, 'admin'), false, 'admin 页仅管理总控');
  assert.strictEqual(accounts.canView(ADMIN, 'admin'), true, 'admin 可见账户权限管理');
  assert.strictEqual(accounts.canView(ADMIN, 'purchase'), true, 'admin 全可见');
  assert.strictEqual(accounts.canView(ADMIN, 'report'), true);
});

test('canViewCost：成本/利润可见性 = 管理总控或报表权限', () => {
  assert.strictEqual(accounts.canViewCost(ADMIN), true, 'admin 可见成本');
  assert.strictEqual(accounts.canViewCost(USER), false, '默认不可见成本');
  const boss2 = { id: 'acct5', role: 'user', perms: { report: true } };
  assert.strictEqual(accounts.canViewCost(boss2), true, '有报表权限可见成本');
});

test('dataOwnerId：员工 ownerId 优先，独立账号用自身 id', () => {
  const staff = { id: 'acct6', ownerId: 'admin' };
  assert.strictEqual(accounts.dataOwnerId(staff), 'admin', '员工共用老板库');
  const solo = { id: 'acct7', ownerId: null };
  assert.strictEqual(accounts.dataOwnerId(solo), 'acct7', '独立账号用自身');
  assert.strictEqual(accounts.dataOwnerId(null), '', '空账号返回空');
});

test('sharesBossData：员工共用本店数据时 settings 归属老板，不得覆盖', () => {
  assert.strictEqual(accounts.sharesBossData({ id: 'acct8', ownerId: 'admin' }), true, '员工共用老板库');
  assert.strictEqual(accounts.sharesBossData({ id: 'acct9', ownerId: null }), false, '独立数据空间');
  assert.strictEqual(accounts.sharesBossData({ id: 'acct10' }), false, '未设 ownerId 视为独立');
  assert.strictEqual(accounts.sharesBossData(null), false, '空账号');
  assert.strictEqual(accounts.sharesBossData({ id: 'admin' }), false, '管理总控不共用');
});

test('create：新建账号默认权限全关，可传 ownerId（员工）与 perms', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.create(store, { username: 'cashier', password: '123456', shopName: '收银员', ownerId: 'admin' });
  assert.ok(r.ok, '创建成功');
  const acct = accounts.getById(accounts.load(store), r.account.id);
  assert.deepStrictEqual(acct.perms, {}, '默认权限全关');
  assert.strictEqual(acct.ownerId, 'admin', '员工共用本店数据');
  assert.strictEqual(accounts.can(acct, 'sale_bill'), false, '默认无任何权限');
});

test('create：不传 ownerId = 独立数据空间（兼容旧行为）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.create(store, { username: 'solo', password: '123456' });
  const acct = accounts.getById(accounts.load(store), r.account.id);
  assert.strictEqual(acct.ownerId, null, '独立空间');
  assert.strictEqual(accounts.dataOwnerId(acct), acct.id);
});

test('create：可携带初始 perms（管理总控建号时同步开通）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.create(store, {
    username: 'staff2', password: '123456',
    perms: { sale_bill: true, stock_read: true }
  });
  const acct = accounts.getById(accounts.load(store), r.account.id);
  assert.strictEqual(accounts.can(acct, 'sale_bill'), true);
  assert.strictEqual(accounts.can(acct, 'sale_price'), false, '未勾选仍关闭');
});

test('update：perms 手动分配可写入并可收紧', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.create(store, { username: 'staff3', password: '123456' });
  const id = r.account.id;
  let u = accounts.update(store, id, { perms: { sale_bill: true, ws_bill: true, stock_read: true } });
  assert.ok(u.ok);
  let acct = accounts.getById(accounts.load(store), id);
  assert.strictEqual(accounts.can(acct, 'sale_bill'), true);
  assert.strictEqual(accounts.can(acct, 'ws_bill'), true);
  assert.strictEqual(accounts.can(acct, 'report'), false);
  u = accounts.update(store, id, { perms: { sale_bill: true } });
  assert.ok(u.ok, '可收紧');
  acct = accounts.getById(accounts.load(store), id);
  assert.strictEqual(accounts.can(acct, 'ws_bill'), false, '移除后关闭');
  assert.strictEqual(accounts.can(acct, 'sale_bill'), true);
});

test('update：可变更数据归属 ownerId', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.create(store, { username: 'staff4', password: '123456' });
  const u = accounts.update(store, r.account.id, { ownerId: 'admin' });
  assert.ok(u.ok);
  const acct = accounts.getById(accounts.load(store), r.account.id);
  assert.strictEqual(acct.ownerId, 'admin');
  assert.strictEqual(accounts.dataOwnerId(acct), 'admin');
});

test('ensurePreset 迁移：旧账号（无 perms/ownerId）自动补全权限、ownerId=null', () => {
  const store = memStore({
    'applianceErp.accounts': JSON.stringify([
      { id: 'admin', username: 'hawsystem', shopName: '管理总控', role: 'admin', hash: 'x', scopeCategories: [] },
      { id: 'acct9', username: 'oldstaff', shopName: '老店员', role: 'user', hash: 'y', scopeCategories: [] }
    ])
  });
  const list = accounts.ensurePreset(store);
  const old = accounts.getById(list, 'acct9');
  assert.ok(old.perms, '旧账号补了 perms');
  accounts.PERMS.forEach((p) => {
    assert.strictEqual(accounts.can(old, p.id), true, '旧账号默认全权限：' + p.id);
  });
  assert.strictEqual(old.ownerId, null, '旧账号独立数据空间');
  assert.strictEqual(accounts.can(old, 'report'), true, '旧账号可看成本利润');
});

test('ensurePreset：新格式账号（perms={}）不被迁移覆盖（保持全关）', () => {
  const store = memStore({
    'applianceErp.accounts': JSON.stringify([
      { id: 'admin', username: 'hawsystem', shopName: '管理总控', role: 'admin', hash: 'x', scopeCategories: [] },
      { id: 'acct10', username: 'newstaff', shopName: '新店员', role: 'user', hash: 'y', scopeCategories: [], perms: {}, ownerId: 'admin' }
    ])
  });
  const list = accounts.ensurePreset(store);
  const staff = accounts.getById(list, 'acct10');
  assert.deepStrictEqual(staff.perms, {}, '保持全关');
  assert.strictEqual(staff.ownerId, 'admin', '保持共用老板库');
  assert.strictEqual(accounts.can(staff, 'sale_bill'), false);
});

test('strip：公开视图含 perms/ownerId，不含 hash', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.create(store, { username: 'staff5', password: '123456', ownerId: 'admin' });
  const view = r.account;
  assert.ok('perms' in view, '含 perms');
  assert.ok('ownerId' in view, '含 ownerId');
  assert.ok(!('hash' in view), '不含 hash');
  assert.deepStrictEqual(view.perms, {}, '公开视图 perms');
});

test('admin 账号 strip 后 isAdmin 与全权限保持', () => {
  const store = memStore();
  const list = accounts.ensurePreset(store);
  const admin = accounts.strip(accounts.getById(list, 'admin'));
  assert.strictEqual(accounts.isAdmin(admin), true);
  assert.strictEqual(accounts.can(admin, 'data_manage'), true);
});

test('requireActionPerm：管理总控与未登录账号放行', () => {
  assert.strictEqual(accounts.requireActionPerm(ADMIN, 'sale', 'void-sale'), true, 'admin 放行');
  assert.strictEqual(accounts.requireActionPerm(null, 'sale', 'save-sale'), true, '未登录放行（由登录态控制）');
});

test('requireActionPerm：销售开单页动作拦截', () => {
  const cashier = { id: 'acctA', role: 'user', perms: { sale_bill: true } }; // 有开单，无收款/改价/退货
  assert.strictEqual(accounts.requireActionPerm(cashier, 'sale', 'add-item'), true, '有开单可加入商品');
  assert.strictEqual(accounts.requireActionPerm(cashier, 'sale', 'save-sale'), true, '可保存单据');
  assert.strictEqual(accounts.requireActionPerm(cashier, 'sale', 'do-pay'), false, '无收款权限');
  assert.strictEqual(accounts.requireActionPerm(cashier, 'sale', 'void-sale'), false, '无退货作废权限');
  assert.strictEqual(accounts.requireActionPerm(cashier, 'sale', 'sale-price-set'), false, '无改价权限');
  assert.strictEqual(accounts.requireActionPerm(cashier, 'sale', 'goto-return'), false, '无退货权限');
  const full = { id: 'acctB', role: 'user', perms: { sale_bill: true, sale_pay: true, sale_price: true, sale_return: true } };
  assert.strictEqual(accounts.requireActionPerm(full, 'sale', 'do-pay'), true);
  assert.strictEqual(accounts.requireActionPerm(full, 'sale', 'void-sale'), true);
});

test('requireActionPerm：批发挂账/核销与销售区分', () => {
  const retailOnly = { id: 'acctC', role: 'user', perms: { sale_bill: true } };
  assert.strictEqual(accounts.requireActionPerm(retailOnly, 'sale', 'toggle-debt'), false, '无退货/批发权限不能挂账切换');
  assert.strictEqual(accounts.requireActionPerm(retailOnly, 'sale', 'select-original'), false, '不能选原单');
  const ws = { id: 'acctD', role: 'user', perms: { ws_bill: true, ws_pay: true } };
  assert.strictEqual(accounts.requireActionPerm(ws, 'sale', 'do-pay'), true, '批发收款权限可收款');
  assert.strictEqual(accounts.requireActionPerm(ws, 'sale', 'void-sale'), false, '无退货仍拦截');
});

test('requireActionPerm：档案/库存/记账/数据管理拦截', () => {
  const viewer = { id: 'acctE', role: 'user', perms: { product_read: true, stock_read: true } };
  assert.strictEqual(accounts.requireActionPerm(viewer, 'product', 'save-product'), false, '无建档权限');
  assert.strictEqual(accounts.requireActionPerm(viewer, 'product', 'export-all'), false, '无数据管理不能导出全部');
  assert.strictEqual(accounts.requireActionPerm(viewer, 'inventory', 'save-take'), false, '无盘点权限');
  assert.strictEqual(accounts.requireActionPerm(viewer, 'account', 'save-manual'), false, '无记账权限');
  const mgr = { id: 'acctF', role: 'user', perms: { data_manage: true } };
  assert.strictEqual(accounts.requireActionPerm(mgr, 'product', 'export-all'), true, '有数据管理可导出全部');
  assert.strictEqual(accounts.requireActionPerm(mgr, 'mine', 'sync-up'), true, '可同步');
  const ledger = { id: 'acctG', role: 'user', perms: { ledger: true } };
  assert.strictEqual(accounts.requireActionPerm(ledger, 'account', 'save-manual'), true);
});

test('requireActionPerm：未命中规则的动作放行（只读/导航/个人操作）', () => {
  const viewer = { id: 'acctH', role: 'user', perms: {} };
  assert.strictEqual(accounts.requireActionPerm(viewer, 'sale', 'view-note'), true, '查看备注放行');
  assert.strictEqual(accounts.requireActionPerm(viewer, 'sale', 'page-jump'), true, '分页跳转放行');
  assert.strictEqual(accounts.requireActionPerm(viewer, 'product', 'row-check'), true, '勾选行放行');
  assert.strictEqual(accounts.requireActionPerm(viewer, 'mine', 'set-password'), true, '改自己密码放行');
  assert.strictEqual(accounts.requireActionPerm(viewer, 'home', 'go'), true, '导航放行');
});
