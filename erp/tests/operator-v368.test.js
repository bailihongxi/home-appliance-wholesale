/**
 * V3.68：经手人（createdBy 归属）—— 销售 / 进货 / 记账 / 盘点四张表单
 *
 * 背景：V3.65 做了「记录级同步」，员工从云端只拉自己名下的单（按 createdBy 过滤）。
 * 但记录归属只能「谁登录归谁」——老板替员工开的单会记在老板名下，员工永远拉不到。
 * V3.68 补上「经手人」下拉：老板开单时可改派给员工，记录 createdBy 随之落到员工名下。
 *
 * 约束：
 * - 只有**数据归属账号（老板）**能看到并改派；员工看不到下拉（也看不到全店人员名单）。
 * - 独立数据空间的账号自成一本账，不会混进别人的候选里。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

globalThis.ERP = globalThis.ERP || {};

const accounts = require('../js/core/accounts.js');
const { newCtx } = require('./helpers/ctx.js');
const salePage = require('../js/ui/page-sale.js');
const purchasePage = require('../js/ui/page-purchase.js');
const accountPage = require('../js/ui/page-account.js');
const inventoryPage = require('../js/ui/page-inventory.js');

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

const BOSS = { id: 'admin', username: 'hawsystem', shopName: '管理总控', role: 'admin' };

/** 播种：admin（老板）+ emp1（共用本店数据的员工）+ solo（独立数据空间） */
function seed() {
  const s = memStore();
  accounts.ensurePreset(s);
  accounts.create(s, { username: 'emp1', password: '1234', shopName: '员工甲', ownerId: 'admin' });
  accounts.create(s, { username: 'solo', password: '1234', shopName: '独立店' }); // 不传 ownerId = 独立
  return s;
}

function idOf(store, username) {
  const a = accounts.load(store).find((x) => x.username === username);
  return a ? a.id : null;
}

/* ---------------- operatorChoices ---------------- */

test('isDataOwner：老板 / 独立账号 为归属方，带 ownerId 的员工不是', () => {
  assert.strictEqual(accounts.isDataOwner({ id: 'admin' }), true, '老板');
  assert.strictEqual(accounts.isDataOwner({ id: 'x1' }), true, '独立账号（无 ownerId）');
  assert.strictEqual(accounts.isDataOwner({ id: 'acct1', ownerId: 'admin' }), false, '员工');
  assert.strictEqual(accounts.isDataOwner(null), false, '空');
});

test('operatorChoices：老板看到 本人 + 共用本店数据的员工', () => {
  const s = seed();
  const ops = accounts.operatorChoices(s, BOSS);
  const ids = ops.map((o) => o.id);
  assert.ok(ids.includes('admin'), '含老板本人');
  assert.ok(ids.includes(idOf(s, 'emp1')), '含共用本店数据的员工 emp1');
  assert.ok(ops.every((o) => o.name), '每项都有显示名');
});

test('operatorChoices：不含独立数据空间的账号（各是一本账）', () => {
  const s = seed();
  const ids = accounts.operatorChoices(s, BOSS).map((o) => o.id);
  assert.ok(!ids.includes(idOf(s, 'solo')), '独立账号不出现在老板的经手人候选里');
});

test('operatorChoices：员工返回空数组（不渲染下拉，也不能改派给别人）', () => {
  const s = seed();
  const emp = { id: idOf(s, 'emp1'), username: 'emp1', ownerId: 'admin', shopName: '员工甲' };
  assert.deepStrictEqual(accounts.operatorChoices(s, emp), [], '员工无经手人候选');
});

/* ---------------- createdBy 落库 ---------------- */

test('无 operatorOverride 时 createdBy = 当前登录账号', () => {
  const ctx = newCtx();
  ctx.currentAccount = { id: 'admin' };
  const rec = { no: 'S-NO-OVERRIDE' };
  ctx.touch('sales', rec);
  assert.strictEqual(rec.createdBy, 'admin');
});

test('operatorOverride 生效：记录落到指定经手人名下', () => {
  const ctx = newCtx();
  ctx.currentAccount = { id: 'admin' };
  ctx.operatorOverride = 'acct1';
  const rec = { no: 'S-WITH-OVERRIDE' };
  ctx.touch('sales', rec);
  assert.strictEqual(rec.createdBy, 'acct1', '改派给员工 acct1');
});

test('已归属的记录不被覆盖（导入/恢复/更新安全）', () => {
  const ctx = newCtx();
  ctx.currentAccount = { id: 'admin' };
  ctx.operatorOverride = 'acct1';
  const rec = { no: 'S-KEEP', createdBy: 'acct9' };
  ctx.touch('sales', rec);
  assert.strictEqual(rec.createdBy, 'acct9', '已有归属不覆盖');
});

/* ---------------- 四个表单 ---------------- */

function renderAs(user, fn) {
  const s = seed();
  globalThis.localStorage = s;
  globalThis.ERP.currentAccount = user;
  return fn(newCtx());
}

test('销售表单：老板可见「经手人」下拉', () => {
  renderAs(BOSS, (ctx) => {
    const st = salePage.init(ctx);
    st.tab = 'new';
    const html = salePage.render(ctx, st);
    assert.ok(html.includes('经手人'), '含经手人标签');
    assert.ok(html.includes('data-name="operatorId"'), '含经手人下拉');
  });
});

test('进货表单：老板可见「经手人」下拉', () => {
  renderAs(BOSS, (ctx) => {
    const st = purchasePage.init(ctx);
    st.tab = 'form'; // 进货页用 'form' 表示新建态
    const html = purchasePage.render(ctx, st);
    assert.ok(html.includes('备注'), '确实渲染到了新建表单（否则下面的断言是假通过）');
    assert.ok(html.includes('经手人'), '含经手人标签');
    assert.ok(html.includes('data-name="operatorId"'), '含经手人下拉');
  });
});

test('记账（记一笔）：老板可见「经手人」下拉', () => {
  renderAs(BOSS, (ctx) => {
    const st = accountPage.init(ctx);
    st.manualOpen = true;
    const html = accountPage.render(ctx, st);
    assert.ok(html.includes('经手人'), '含经手人标签');
    assert.ok(html.includes('data-name="operatorId"'), '含经手人下拉');
  });
});

test('盘点：take-operator 动作记录所选经手人', () => {
  renderAs(BOSS, (ctx) => {
    const st = inventoryPage.init(ctx);
    assert.strictEqual(st.take.operatorId, '', '初始为空（= 本人）');
    inventoryPage.actions['take-operator'](ctx, st, { value: 'acct1' });
    assert.strictEqual(st.take.operatorId, 'acct1', '选择后记录经手人');
  });
});

test('员工登录：三张表单都不渲染经手人下拉（不能改派，也看不到全店名单）', () => {
  const s = seed();
  renderAs({ id: idOf(s, 'emp1'), username: 'emp1', ownerId: 'admin', shopName: '员工甲' }, (ctx) => {
    const sst = salePage.init(ctx); sst.tab = 'new';
    assert.ok(!salePage.render(ctx, sst).includes('data-name="operatorId"'), '销售：员工无下拉');

    const pst = purchasePage.init(ctx); pst.tab = 'form';
    assert.ok(purchasePage.render(ctx, pst).includes('备注'), '进货表单确实渲染了（否则断言假通过）');
    assert.ok(!purchasePage.render(ctx, pst).includes('data-name="operatorId"'), '进货：员工无下拉');

    const ast = accountPage.init(ctx); ast.manualOpen = true;
    assert.ok(!accountPage.render(ctx, ast).includes('data-name="operatorId"'), '记账：员工无下拉');
  });
});

test('V3.68 版本号：page-mine V3.68 / sw.js v97', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.68'), '关于页 V3.68');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v97';"), 'SW 缓存版本 v97');
});
