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

test('预置账号：首次 ensurePreset 创建 3 个账号（大家电/小家电/厨电）', () => {
  const store = memStore();
  const list = accounts.ensurePreset(store);
  assert.strictEqual(list.length, 3);
  assert.deepStrictEqual(accounts.getById(list, 'acct1').scopeCategories, ['冰箱', '洗衣机', '空调', '电视']);
  assert.deepStrictEqual(accounts.getById(list, 'acct2').scopeCategories, ['厨房电器', '生活小家电', '数码影音']);
  assert.deepStrictEqual(accounts.getById(list, 'acct3').scopeCategories, ['厨房电器', '生活小家电']);
  assert.strictEqual(accounts.getById(list, 'acct1').shopName, '大家电店');
  assert.strictEqual(accounts.getById(list, 'acct2').shopName, '小家电店');
  assert.strictEqual(accounts.getById(list, 'acct3').shopName, '厨电店');
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
  assert.strictEqual(again.length, 3);
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
