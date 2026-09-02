/**
 * V3-阶段1.1：多账号体系 core/accounts.js（电器版）
 * - 预置 3 账号（大家电店/小家电店/厨电店，初始密码 000000）
 * - 密码只存哈希，可校验
 * - 支持自行创建账号，最多 10 个
 * - 账号列表脱敏（不暴露哈希）
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

test('预置账号：首次 ensurePreset 创建 4 个账号（admin + 大家电/小家电/厨电）', () => {
  const store = memStore();
  const list = accounts.ensurePreset(store);
  assert.strictEqual(list.length, 4);
  assert.deepStrictEqual(accounts.getById(list, 'acct1').scopeCategories, ['冰箱', '洗衣机', '空调', '电视']);
  assert.deepStrictEqual(accounts.getById(list, 'acct2').scopeCategories, ['厨房电器', '生活小家电', '数码影音']);
  assert.deepStrictEqual(accounts.getById(list, 'acct3').scopeCategories, ['厨房电器', '生活小家电']);
  assert.strictEqual(accounts.getById(list, 'acct1').shopName, '大家电店');
  assert.strictEqual(accounts.getById(list, 'acct2').shopName, '小家电店');
  assert.strictEqual(accounts.getById(list, 'acct3').shopName, '厨电店');
});

test('管理员账号：预置 admin（管理总控），初始密码 admina1b22c333 可登录，role=admin，经营范围全部分类', () => {
  const store = memStore();
  const list = accounts.ensurePreset(store);
  const admin = accounts.getById(list, 'admin');
  assert.ok(admin, 'admin 账号存在');
  assert.strictEqual(admin.username, 'admin');
  assert.strictEqual(admin.shopName, '管理总控');
  assert.strictEqual(admin.role, 'admin', '角色为管理员');
  assert.strictEqual(accounts.verify(admin, 'admina1b22c333'), true, '初始密码可登录');
  assert.strictEqual(accounts.verify(admin, '000000'), false, '非初始密码拒绝');
  assert.deepStrictEqual(admin.scopeCategories, accounts.ALL_CATEGORIES, '经营范围=全部分类');
});

test('管理员账号：ensurePreset 幂等（admin 不重复创建）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const again = accounts.ensurePreset(store);
  assert.strictEqual(again.length, 4);
  assert.strictEqual(again.filter(a => a.id === 'admin').length, 1, 'admin 唯一');
});

test('管理员账号：删除 admin 后 ensurePreset 自动补回（系统级账号）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.remove(store, 'admin');
  assert.strictEqual(r.ok, true);
  const list = accounts.ensurePreset(store);
  assert.ok(accounts.getById(list, 'admin'), 'admin 被补回');
  assert.strictEqual(accounts.getById(list, 'admin').role, 'admin');
});

test('管理员账号：publicList/strip 透出 role，自建账号默认 user', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'normal', password: '123456', shopName: '普通店' });
  const pub = accounts.publicList(accounts.load(store));
  const adminPub = pub.find(a => a.id === 'admin');
  const userPub = pub.find(a => a.username === 'normal');
  assert.strictEqual(adminPub.role, 'admin');
  assert.strictEqual(userPub.role, 'user', '自建账号 role=user');
  assert.ok(pub.every(a => a.hash === undefined), '公开列表不含 hash');
});

test('管理员账号：update 修改店名/密码不改变 role', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.update(store, 'admin', { shopName: '管理总控中心', password: 'newpass999' });
  assert.strictEqual(r.ok, true);
  const admin = accounts.getById(accounts.load(store), 'admin');
  assert.strictEqual(admin.role, 'admin', 'role 不变');
  assert.strictEqual(admin.shopName, '管理总控中心');
  assert.strictEqual(accounts.verify(admin, 'newpass999'), true, '新密码生效');
});

test('预置账号：初始密码 000000 可校验，错误密码不可', () => {
  const store = memStore();
  const list = accounts.ensurePreset(store);
  const acct = accounts.getById(list, 'acct1');
  assert.strictEqual(accounts.verify(acct, '000000'), true, '初始密码 000000 通过');
  assert.strictEqual(accounts.verify(acct, '123456'), false, '错误密码拒绝');
  assert.ok(acct.hash && !acct.hash.includes('000000'), '密码以哈希存储，不含明文');
});

test('ensurePreset 幂等：重复调用不重复创建', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const again = accounts.ensurePreset(store);
  assert.strictEqual(again.length, 4);
});

test('自行创建账号：成功创建并可用初始密码登录；默认全部分类开放', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.create(store, { username: 'dianqi', password: 'abc123', shopName: '电器批发' });
  assert.ok(r.ok, '创建成功：' + (r.error || ''));
  const list = accounts.load(store);
  const acct = accounts.getById(list, r.account.id);
  assert.strictEqual(acct.username, 'dianqi');
  assert.strictEqual(accounts.verify(acct, 'abc123'), true);
  assert.deepStrictEqual(acct.scopeCategories, accounts.ALL_CATEGORIES, '自建账号默认全分类开放');
});

test('创建账号：校验用户名格式、重复、密码长度、上限 10 个', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  assert.strictEqual(accounts.create(store, { username: 'a', password: '1234' }).ok, false, '用户名过短');
  assert.strictEqual(accounts.create(store, { username: 'bad name', password: '1234' }).ok, false, '非法字符');
  assert.strictEqual(accounts.create(store, { username: 'appliance', password: '1234' }).ok, false, '重复用户名');
  assert.strictEqual(accounts.create(store, { username: 'ok123', password: '12' }).ok, false, '密码过短');
});

test('列表脱敏：publicList 不含 hash', () => {
  const store = memStore();
  const list = accounts.ensurePreset(store);
  const pub = accounts.publicList(list);
  assert.ok(pub.every((a) => a.hash === undefined), '公开列表不含 hash');
  assert.ok(pub[0].shopName, '含店名');
});

test('updateProfile：改店名不影响密码', () => {
  const store = memStore();
  const list = accounts.ensurePreset(store);
  const r = accounts.updateProfile(store, 'acct1', { shopName: '大家电中心' });
  assert.strictEqual(r.ok, true);
  const updated = accounts.load(store);
  assert.strictEqual(accounts.getById(updated, 'acct1').shopName, '大家电中心');
  assert.strictEqual(accounts.verify(accounts.getById(updated, 'acct1'), '000000'), true, '密码不变');
});

/* ===== 问题4：创建账号可设定头像 ===== */
test('问题4-创建账号：支持自定义头像 dataURL', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.create(store, {
    username: 'myav', password: '123456', shopName: '头像店',
    avatar: 'data:image/png;base64,AAAA'
  });
  assert.ok(r.ok, '创建成功：' + (r.error || ''));
  const acct = accounts.getById(accounts.load(store), r.account.id);
  assert.strictEqual(acct.avatar, 'data:image/png;base64,AAAA', '头像已存储');
  // publicList 也应带出头像（登录页展示）
  const pub = accounts.publicList(accounts.load(store)).find(a => a.id === r.account.id);
  assert.strictEqual(pub.avatar, 'data:image/png;base64,AAAA');
  // 未传头像默认空
  const r2 = accounts.create(store, { username: 'noav', password: '123456', shopName: '无头像店' });
  assert.strictEqual(accounts.getById(accounts.load(store), r2.account.id).avatar, '');
});

test('问题4-多店铺数据隔离：不同账号库名独立，数据不共有', () => {
  const schema = require('../js/core/schema.js');
  assert.strictEqual(schema.dbNameFor('acct1'), 'erp_acct1');
  assert.strictEqual(schema.dbNameFor('acct2'), 'erp_acct2');
  assert.notStrictEqual(schema.dbNameFor('acct1'), schema.dbNameFor('acct2'), '两账号库名不同');
  // 自建账号也有独立库名
  assert.strictEqual(schema.dbNameFor('acct_myShop'), 'erp_acct_myShop');
});

/* ===== 登录账户管理：编辑（update） ===== */
test('登录账户管理-update：修改店名/头像，密码不变', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.update(store, 'acct1', {
    shopName: '西安大家电',
    avatar: 'data:image/png;base64,CCCC'
  });
  assert.strictEqual(r.ok, true);
  const acct = accounts.getById(accounts.load(store), 'acct1');
  assert.strictEqual(acct.shopName, '西安大家电');
  assert.strictEqual(acct.avatar, 'data:image/png;base64,CCCC');
  assert.strictEqual(accounts.verify(acct, '000000'), true, '未改密码，原密码仍可登录');
});

test('登录账户管理-update：修改登录账号成功（唯一性排除自身）', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.update(store, 'acct1', { username: 'appliance2' });
  assert.strictEqual(r.ok, true, '改名成功：' + (r.error || ''));
  assert.strictEqual(accounts.getById(accounts.load(store), 'acct1').username, 'appliance2');
  // 重复用户名被拦截（占用已有其它账号）
  const dup = accounts.update(store, 'acct2', { username: 'appliance2' });
  assert.strictEqual(dup.ok, false, '用户名冲突被拦截');
  // 非法格式被拦截
  const bad = accounts.update(store, 'acct2', { username: 'x' });
  assert.strictEqual(bad.ok, false, '过短用户名被拦截');
});

test('登录账户管理-update：修改密码后旧密码失效、新密码可登录', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.update(store, 'acct2', { password: 'newpass88' });
  assert.strictEqual(r.ok, true);
  const acct = accounts.getById(accounts.load(store), 'acct2');
  assert.strictEqual(accounts.verify(acct, 'newpass88'), true, '新密码可登录');
  assert.strictEqual(accounts.verify(acct, '000000'), false, '旧密码失效');
  // 密码过短被拦截
  const short = accounts.update(store, 'acct2', { password: '12' });
  assert.strictEqual(short.ok, false, '过短密码被拦截');
});

test('登录账户管理-update：空密码=不改密码', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.update(store, 'acct1', { password: '', shopName: '只改店名' });
  assert.strictEqual(r.ok, true);
  const acct = accounts.getById(accounts.load(store), 'acct1');
  assert.strictEqual(accounts.verify(acct, '000000'), true, '空密码不修改原密码');
});

test('登录账户管理-update：可调整经营范围', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.update(store, 'acct3', { scopeCategories: ['电视', '冰箱'] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(accounts.getById(accounts.load(store), 'acct3').scopeCategories, ['电视', '冰箱']);
});

/* ===== 登录账户管理：删除（remove） ===== */
test('登录账户管理-remove：删除自建账号成功', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  accounts.create(store, { username: 'toDel', password: '123456', shopName: '待删店' });
  const list0 = accounts.load(store);
  const target = accounts.findByUsername(list0, 'toDel');
  const r = accounts.remove(store, target.id);
  assert.strictEqual(r.ok, true, '删除成功：' + (r.error || ''));
  assert.strictEqual(r.account.shopName, '待删店');
  assert.strictEqual(accounts.findByUsername(accounts.load(store), 'toDel'), null, '已从列表移除');
});

test('登录账户管理-remove：删除不存在的账号返回错误', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  const r = accounts.remove(store, 'acct999');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('不存在'));
});

test('登录账户管理-remove：删除预置账号后 ensurePreset 不再自动恢复', () => {
  const store = memStore();
  accounts.ensurePreset(store);
  assert.strictEqual(accounts.getById(accounts.load(store), 'acct3') !== null, true);
  const r = accounts.remove(store, 'acct3');
  assert.strictEqual(r.ok, true);
  // 再次 ensurePreset（模拟刷新/重渲染）不应把被删的店铺账号补回（admin 属系统账号仍保留）
  const list = accounts.ensurePreset(store);
  assert.strictEqual(accounts.getById(list, 'acct3'), null, '店铺账号删除后不被自动恢复');
  assert.strictEqual(accounts.getById(list, 'admin') !== null, true, 'admin 系统账号仍在');
  assert.strictEqual(list.length, 3, '剩余 3 个账号（admin+acct1+acct2）');
});
