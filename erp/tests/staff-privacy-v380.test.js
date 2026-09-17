/**
 * V3.80 员工数据边界：① 操作日志不得下发给员工；② 员工「从云端恢复」= 先清空本机再全量拉取
 *
 * **问题 1（严重）**：操作日志（logs）逐条记录了全店每个人的每一步动作——谁什么时候
 * 进了什么货、收了谁多少钱、改了哪个价格、登录了几次。而 `schema.SHARED_STORES` 把
 * logs 归为「全员可见不过滤」，设置页的日志卡片也对员工无条件渲染 →
 * 员工能从云端把整本操作日志拉到本机并直接翻看，属于管理审计数据泄露。
 *
 * **问题 2**：员工从云端恢复走的是「记录级合并」（merge:true）。合并只按记录 upsert，
 * 员工本机此前残留的草稿、改过的价格、被老板删掉的单据会一直混在数据里，
 * 看到的库存/商品与云端不一致却毫无察觉。用户口径明确：
 * 每次恢复先删掉本机数据，再整体拉云端最新数据。
 *
 * 两条改动的**反向测试**同样重要：老板（数据归属者）的行为必须保持原样，
 * 不能因为收紧员工而误伤老板——老板本机的待上传新单绝不能被清空。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 坑（发布流程 9c）：先建 globalThis.ERP 再 require 页面模块
globalThis.ERP = globalThis.ERP || {};

const page = require('../js/ui/page-mine.js');
const setting = require('../js/ui/page-setting.js');
const sync = require('../js/core/sync.js');
const { newCtx } = require('./helpers/ctx.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 员工账号（共用老板 admin 的本店数据） */
function staffAcct() {
  return {
    id: 'emp1', ownerId: 'admin', username: 'pifa', shopName: '批发部',
    role: 'user', perms: { data_manage: true }
  };
}

/** 老板 / 管理总控（数据归属者） */
function bossAcct() {
  return { id: 'admin', username: 'hawsystem', role: 'admin' };
}

/**
 * 员工 / 老板 ctx
 * 坑（发布流程 9c）：`syncAcctId()` / `publicDown()` 读的是全局 `ERP.currentAccount`，
 * 不是 `ctx.currentAccount` —— 两个都要设，否则 ownerId 取不到。
 */
function mkCtx(acct) {
  const ctx = newCtx();
  ctx.currentAccount = acct;
  globalThis.ERP.currentAccount = acct;
  return { ctx, state: page.init(ctx) };
}

/** 设置页用的是 `setting.init()` 的 state（含 showLog），不是「我的」页那份 */
function mkSettingCtx(acct, showLog) {
  const ctx = newCtx();
  ctx.currentAccount = acct;
  globalThis.ERP.currentAccount = acct;
  const state = setting.init(ctx);
  if (showLog) state.showLog = true;
  return { ctx, state };
}

/**
 * 造一份云端快照：2 款商品 + 2 条操作日志 + 老板 1 张单 + 员工 1 张单。
 * 用于断言「员工拿到的到底少了什么」。
 */
function cloudSnapshot() {
  const src = newCtx();
  src.data.products.push(
    { id: 'p1', brand: '海尔', model: 'BCD-216', type: '冰箱', unit: '台', cost: 120000, priceWholesale: 135000, priceRetail: 159900, stock: 6, status: 'on' },
    { id: 'p2', brand: '美的', model: 'MB-80', type: '洗衣机', unit: '台', cost: 90000, priceWholesale: 101000, priceRetail: 119900, stock: 3, status: 'on' }
  );
  src.data.sales.push(
    { id: 's1', no: 'XSD001', createdBy: 'admin', at: '2026-09-17T10:00:00+08:00', total: 159900 },
    { id: 's2', no: 'XSD002', createdBy: 'emp1', at: '2026-09-17T11:00:00+08:00', total: 119900 }
  );
  src.data.logs.push(
    { id: 'l1', at: '2026-09-17T09:00:00+08:00', action: '进货入库', detail: '老板进了 10 台冰箱 成本 120000' },
    { id: 'l2', at: '2026-09-17T09:30:00+08:00', action: '收款', detail: '客户张三结清 58000' }
  );
  return sync.buildSnapshotText(src, null).text;
}

/** 替换 sync.pullSnapshotPublic，并记录 applySnapshotText 收到的 opts */
function withSyncStubs(publicImpl) {
  const calls = { public: [], merge: [] };
  const oldPublic = sync.pullSnapshotPublic;
  const oldApply = sync.applySnapshotText;
  sync.pullSnapshotPublic = function () {
    calls.public.push(Array.prototype.slice.call(arguments));
    return publicImpl ? publicImpl.apply(null, arguments) : Promise.resolve({ ok: false, error: 'NO_PHRASE' });
  };
  sync.applySnapshotText = function (ctx, text, opts) {
    calls.merge.push(opts ? !!opts.merge : undefined);
    return oldApply.apply(sync, arguments);
  };
  return {
    calls,
    restore: function () {
      sync.pullSnapshotPublic = oldPublic;
      sync.applySnapshotText = oldApply;
    }
  };
}

/* ---------------- ① 操作日志不外泄 ---------------- */

test('T1 员工拉取：操作日志整表清空（审计数据不下发），商品仍全量可见', () => {
  const text = cloudSnapshot();
  const out = JSON.parse(sync.filterSnapshotForAccount(text, staffAcct()));
  assert.strictEqual(out.logs.length, 0, '员工拿到的操作日志必须是空的');
  assert.strictEqual(out.products.length, 2, '商品目录是共享主数据，员工要能看全');
  assert.strictEqual(out.sales.length, 1, '交易类仍按经手人过滤，只剩员工自己的那一单');
  assert.strictEqual(out.sales[0].createdBy, 'emp1', '留下的确实是员工自己的单');
});

test('T2 老板拉取：行为完全不变 —— 日志、全部单据都在（回归）', () => {
  const text = cloudSnapshot();
  const out = JSON.parse(sync.filterSnapshotForAccount(text, bossAcct()));
  assert.strictEqual(out.logs.length, 2, '老板看全部操作日志');
  assert.strictEqual(out.sales.length, 2, '老板看全部单据');
  assert.strictEqual(out.products.length, 2, '老板看全部商品');
});

test('T2b 独立数据空间账号（ownerId 为空）同样是自己的归属者，日志可见', () => {
  // 独立数据空间的账号（ownerId 为空）视为数据归属者，同样看得见全本账
  const solo = { id: 'solo1', ownerId: '', username: 'solo' };
  const out = JSON.parse(sync.filterSnapshotForAccount(cloudSnapshot(), solo));
  assert.strictEqual(out.logs.length, 2, '独立空间账号是自己的归属者，日志可见');
});

test('T3 设置页：员工看不到「操作日志」卡片，也没有「查看/收起」按钮', () => {
  const { ctx, state } = mkSettingCtx(staffAcct(), true);
  try {
    ctx.data.logs.push({ id: 'lx', at: '2026-09-17T09:00:00+08:00', action: '进货入库', detail: '敏感的经营动作' });
    const html = setting.render(ctx, state);
    assert.ok(!/操作日志/.test(html), '员工设置页不得出现「操作日志」标题');
    assert.ok(!/toggle-log/.test(html), '员工设置页不得有展开日志的按钮');
    assert.ok(!/敏感的经营动作/.test(html), '存量日志内容也不能被渲染出来');
  } finally {
    delete globalThis.ERP.currentAccount;
  }
});

test('T4 设置页：老板的「操作日志」卡片照旧（回归）', () => {
  const { ctx, state } = mkSettingCtx(bossAcct(), true);
  try {
    ctx.data.logs.push({ id: 'lx', at: '2026-09-17T09:00:00+08:00', action: '进货入库', detail: '老板自己的日志' });
    const html = setting.render(ctx, state);
    assert.ok(/操作日志/.test(html), '老板要能看到日志卡片');
    assert.ok(/toggle-log/.test(html), '老板要有展开按钮');
    assert.ok(/老板自己的日志/.test(html), '日志内容正常渲染');
  } finally {
    delete globalThis.ERP.currentAccount;
  }
});

test('T5 动作层兜底：员工即便被绕过界面触发 toggle-log 也被拦住', () => {
  const { ctx, state } = mkSettingCtx(staffAcct());
  let toasted = '';
  const oldApp = globalThis.ERP.app;
  globalThis.ERP.app = { toast: (m) => { toasted = m; } };
  try {
    assert.strictEqual(state.showLog, false, '初始未展开');
    const r = setting.actions['toggle-log'](ctx, state);
    assert.strictEqual(r, false, '员工触发 → 拦截（返回 false）');
    assert.strictEqual(state.showLog, false, '状态不得被篡改');
    assert.ok(/员工账号不能查看操作日志/.test(toasted), '给出明确拒绝提示');
  } finally {
    globalThis.ERP.app = oldApp;
    delete globalThis.ERP.currentAccount;
  }
});

test('T5b 动作层：老板 toggle-log 仍可正常展开（回归）', () => {
  const { ctx, state } = mkSettingCtx(bossAcct());
  try {
    const r = setting.actions['toggle-log'](ctx, state);
    assert.strictEqual(r, true, '老板正常返回 true');
    assert.strictEqual(state.showLog, true, '展开');
  } finally {
    delete globalThis.ERP.currentAccount;
  }
});

/* ---------------- ② 员工恢复 = 先清空再全量拉取 ---------------- */

test('T6 员工恢复：走全量覆盖（merge:false），本机残留数据被清掉', async () => {
  const text = sync.filterSnapshotForAccount(cloudSnapshot(), staffAcct());
  const stub = withSyncStubs(() => Promise.resolve({ ok: true, text, at: '2026-09-17T18:00:00+08:00' }));
  try {
    const { ctx, state } = mkCtx(staffAcct());
    // 模拟员工本机的「脏残留」：自己改过的商品、老板早已删掉的单据、过去拉到的日志
    ctx.data.products.push({ id: 'p9', brand: '杂牌', model: 'OLD-1', type: '冰箱', unit: '台', cost: 1, priceWholesale: 1, priceRetail: 1, stock: 999, status: 'on' });
    ctx.data.sales.push({ id: 's9', no: 'XSD999', createdBy: 'emp1', at: '2026-09-01T10:00:00+08:00', total: 1 });
    ctx.data.logs.push({ id: 'l9', at: '2026-09-01T09:00:00+08:00', action: '历史日志', detail: '不该留在本机' });
    state.cfg = { owner: '', repo: '', branch: '', path: '', token: '', passphrase: 'test-shop-phrase' };

    page.actions['sync-down'](ctx, state);
    await sleep(30);

    assert.deepStrictEqual(stub.calls.merge, [false], '员工必须是全量覆盖（merge:false），不能合并');
    const models = ctx.data.products.map((p) => p.model).sort();
    assert.deepStrictEqual(models, ['BCD-216', 'MB-80'], '本机残留的 OLD-1 应被清掉，只剩云端两款');
    assert.strictEqual(ctx.data.sales.length, 1, '本机残留的旧单应被清掉');
    assert.strictEqual(ctx.data.sales[0].no, 'XSD002', '留下的是云端那一条');
    assert.strictEqual(ctx.data.logs.length, 0, '本机历史日志随全量替换一起清干净');
    assert.ok(/清空本机数据并从云端重新拉取/.test(state.msg), '结果提示写明是「清空后重新拉取」');
  } finally {
    stub.restore();
    delete globalThis.ERP.currentAccount;
  }
});

test('T7 老板恢复：仍是记录级合并（merge:true），本机待上传数据不被误清（回归）', async () => {
  const text = cloudSnapshot();
  const stub = withSyncStubs(() => Promise.resolve({ ok: true, text, at: '2026-09-17T18:00:00+08:00' }));
  try {
    const { ctx, state } = mkCtx(bossAcct());
    ctx.data.products.push({ id: 'pb', brand: '新货', model: 'BOSS-NEW', type: '空调', unit: '台', cost: 1, priceWholesale: 1, priceRetail: 1, stock: 1, status: 'on' });
    ctx.data.logs.push({ id: 'lb', at: '2026-09-17T20:00:00+08:00', action: '老板刚录的单', detail: '还没上传到云端' });
    state.cfg = { owner: 'x', repo: 'y', branch: 'gh-pages', path: 'd/s.json', token: '', passphrase: 'boss-phrase' };

    page.actions['sync-down'](ctx, state);
    await sleep(30);

    assert.deepStrictEqual(stub.calls.merge, [true], '老板必须保持合并，全量覆盖会毁掉未上传的数据');
    const models = ctx.data.products.map((p) => p.model).sort();
    assert.ok(models.includes('BOSS-NEW'), '老板本机新增的商品必须保住（合并语义）');
    assert.ok(models.includes('BCD-216'), '云端的商品也要合进来');
    assert.ok(ctx.data.logs.length > 0, '老板本机的操作日志不能被清');
    assert.ok(/免 Token/.test(state.msg), '老板仍走原来的合并恢复文案');
  } finally {
    stub.restore();
    delete globalThis.ERP.currentAccount;
  }
});

test('T8 员工账号判定：isStaffAcct 对三种账号的取值正确', () => {
  globalThis.ERP.currentAccount = staffAcct();
  assert.strictEqual(page.isStaffAcct(), true, '共用本店数据的员工 → true');
  globalThis.ERP.currentAccount = bossAcct();
  assert.strictEqual(page.isStaffAcct(), false, '管理总控 → false');
  globalThis.ERP.currentAccount = { id: 'solo1', ownerId: '', username: 'solo' };
  assert.strictEqual(page.isStaffAcct(), false, '独立数据空间账号是自己的归属者 → false');
  globalThis.ERP.currentAccount = null;
  assert.strictEqual(page.isStaffAcct(), false, '无账号上下文 → 保守按非员工处理（走原合并逻辑）');
  delete globalThis.ERP.currentAccount;
});

test('T9 版本号三处同步：page-mine V3.82 / sw.js v111', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.82'), '关于页应显示 V3.80');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v111';"), 'SW 缓存版本应为 v109');
});
