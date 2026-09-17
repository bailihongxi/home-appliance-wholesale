/**
 * V3.79 「从云端恢复」免 Token 公开通道（补全员工新设备取数的最后一环）
 *
 * **背景（断链）**：`sync.pullSnapshotPublic()` 从 V3.65 起就存在，注释明确写着
 * 「员工端没有 Token 也能取数（读公开文件不需要写权限）」，但**从未被任何代码调用**；
 * 而 `sync.syncDown()` 在 `validateConfig` 里强制要求 Token。
 * 于是员工换新手机 / 老板换新电脑后（本机没有 Token）点「从云端恢复」，
 * 得到的是「请填写 GitHub Token（仅存本机）」——而员工的「我的」页按 V3.73 需求
 * 没有同步设置入口，用户被卡死在最后一步，V3.69「零配置自助取数」并未真正闭环。
 *
 * 本版：校验只缺 Token 时改走公开静态快照（GitHub Pages）+ 已认领的取数口令解密。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 坑（发布流程 9c）：先建 globalThis.ERP 再 require 页面模块
globalThis.ERP = globalThis.ERP || {};

const page = require('../js/ui/page-mine.js');
const sync = require('../js/core/sync.js');
const { newCtx } = require('./helpers/ctx.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 员工账号（共用本店数据） */
function staffAcct() {
  return {
    id: 'emp1', ownerId: 'admin', username: 'pifa', shopName: '批发部',
    role: 'user', perms: { data_manage: true }
  };
}

/**
 * 员工 ctx（数据空间归属 admin）
 * 坑（发布流程 9c）：`syncAcctId()` / `publicDown()` 读的是 `ERP.currentAccount`
 * 这个全局，而不是 `ctx.currentAccount` —— 两个都要设。
 */
function staffCtx() {
  const ctx = newCtx();
  const acct = staffAcct();
  ctx.currentAccount = acct;
  globalThis.ERP.currentAccount = acct;
  return { ctx, state: page.init(ctx) };
}

/**
 * 新设备的本机同步配置：owner/repo 可由网址推断、口令由 V3.69 取数凭证自动写入，
 * 但 **Token 一定为空**（Token 只存在于老板原来的设备里）。
 */
function devicelessCfg(over) {
  return Object.assign({
    owner: 'bailihongxi',
    repo: 'home-appliance-wholesale',
    branch: 'gh-pages',
    path: 'data/admin/erp-snapshot.json',
    token: '',
    passphrase: 'test-shop-phrase'
  }, over || {});
}

/** 造一份真实的云端明文快照（含 1 款商品），用于断言恢复结果 */
function snapshotText() {
  const src = newCtx();
  src.data.products.push({
    id: 'p1', brand: '海尔', model: 'BCD-216', type: '冰箱', unit: '台',
    cost: 120000, priceWholesale: 135000, priceRetail: 159900, stock: 6, status: 'on'
  });
  return sync.buildSnapshotText(src, null).text;
}

/** 替换 sync.pullSnapshotPublic / sync.syncDown，返回调用记录与复原函数 */
function withSyncStubs(publicImpl, downImpl) {
  const calls = { public: [], down: [] };
  const oldPublic = sync.pullSnapshotPublic;
  const oldDown = sync.syncDown;
  sync.pullSnapshotPublic = function (store, ownerId, phrase, fetchImpl, account) {
    calls.public.push({ store, ownerId, phrase, fetchImpl, account });
    return publicImpl ? publicImpl.apply(null, arguments) : Promise.resolve({ ok: false, error: 'NO_PHRASE' });
  };
  sync.syncDown = function () {
    calls.down.push(Array.prototype.slice.call(arguments));
    return downImpl ? downImpl.apply(null, arguments) : Promise.resolve({ ok: true, skipped: true, reason: '本地与云端一致' });
  };
  return {
    calls,
    restore: function () {
      sync.pullSnapshotPublic = oldPublic;
      sync.syncDown = oldDown;
    }
  };
}

test('T1 校验判定：只有「缺 Token」才算可走公开通道', () => {
  assert.strictEqual(page.onlyMissingToken(['请填写 GitHub Token（仅存本机）']), true, '只缺 Token → true');
  assert.strictEqual(page.onlyMissingToken([]), false, '无错误 → false');
  assert.strictEqual(page.onlyMissingToken(null), false, '空 → false');
  assert.strictEqual(
    page.onlyMissingToken(['请填写 GitHub Token（仅存本机）', '请设置同步口令（用于加密，换设备恢复要用同一口令）']),
    false, '同时缺口令 → 不算（口令是解密的必要条件）'
  );
  assert.strictEqual(page.onlyMissingToken(['请填写仓库名（repo）']), false, '缺 repo → false');
});

test('T2 失败文案：把技术错误码转成「找谁做什么」的可执行动作', () => {
  const noPhrase = page.publicDownHint('NO_PHRASE');
  assert.ok(/取数口令/.test(noPhrase) && /重新保存一次你的密码/.test(noPhrase), '缺口令 → 指引找管理总控重发凭证');
  assert.ok(/管理总控/.test(noPhrase), '指明找谁');
  assert.ok(!/Token/.test(noPhrase), '不能再提 Token（员工无从填写）');

  assert.ok(/GitHub Pages 在线地址/.test(page.publicDownHint('NO_CFG_PUBLIC')), '无法推断地址 → 指引用在线地址打开');
  assert.ok(/同步到云端/.test(page.publicDownHint('NO_SNAPSHOT')), '云端无快照 → 指引让总控先上传');
  assert.ok(/重新发放取数凭证/.test(page.publicDownHint('BAD_PHRASE')), '口令错 → 指引重发凭证');
  assert.ok(/从云端恢复失败：网络超时/.test(page.publicDownHint('网络超时')), '未知错误原样透出');

  const h1 = page.staffSyncHint(['请设置同步口令（用于加密，换设备恢复要用同一口令）']);
  assert.ok(/取数口令/.test(h1) && !/Token/.test(h1), '员工缺口令 → 取数口令指引（不含 Token）');
  const h2 = page.staffSyncHint(['请填写 GitHub 用户名（owner）']);
  assert.ok(/在线地址/.test(h2) && /管理总控/.test(h2) && !/Token/.test(h2), '员工缺地址 → 在线地址 + 找总控');
});

test('T3 员工新设备（无 Token、有口令）点「从云端恢复」→ 走公开通道并真正恢复数据', async () => {
  const text = snapshotText();
  const stub = withSyncStubs(() => Promise.resolve({ ok: true, text, at: '2026-09-17T18:00:00+08:00' }));
  try {
    const { ctx, state } = staffCtx();
    state.cfg = devicelessCfg();
    const r = page.actions['sync-down'](ctx, state);
    assert.strictEqual(r, false, '异步进行中（内部有确认框）：不触发框架 afterAction');
    await sleep(30);

    assert.strictEqual(stub.calls.public.length, 1, '必须调用公开通道一次');
    assert.strictEqual(stub.calls.down.length, 0, '不得调用需要 Token 的 syncDown');
    const c = stub.calls.public[0];
    assert.strictEqual(c.ownerId, 'admin', '按数据归属账号取快照（共用本店数据 → admin）');
    assert.strictEqual(c.phrase, 'test-shop-phrase', '用本机已认领的取数口令解密');
    assert.ok(c.account && c.account.id === 'emp1', '带上当前账号（core 层据此按权限过滤）');

    assert.strictEqual(ctx.data.products.length, 1, '云端商品已落到本机 ctx');
    assert.strictEqual(ctx.data.products[0].model, 'BCD-216', '恢复的是云端那份数据');
    // V3.80：员工恢复口径改为「清空本机 → 整体拉取」，成功提示随之改述（仍是免 Token 的公开通道）
    assert.ok(/清空本机数据并从云端重新拉取/.test(state.msg), '员工成功提示写明「清空后重新拉取」');
    assert.ok(!/请填写 GitHub Token/.test(state.msg), '全程不需要 Token');
    assert.ok(/⬇️/.test(state.msg), '成功提示带恢复图标');
  } finally {
    stub.restore();
    delete globalThis.ERP.currentAccount;
  }
});

test('T4 公开通道缺「取数口令」→ 给出可执行指引，而不是无法执行的 Token 提示', async () => {
  const stub = withSyncStubs(() => Promise.resolve({ ok: false, error: 'NO_PHRASE' }));
  try {
    const { ctx, state } = staffCtx();
    state.cfg = devicelessCfg();
    page.actions['sync-down'](ctx, state);
    await sleep(30);
    assert.strictEqual(stub.calls.public.length, 1, '仍走公开通道（只是口令缺失）');
    assert.ok(/取数口令/.test(state.msg), '提示缺取数口令');
    assert.ok(/重新保存一次你的密码/.test(state.msg), '给出员工可以转告老板的动作');
    assert.strictEqual(state.msgType, 'err', '以错误样式呈现');
  } finally {
    stub.restore();
    delete globalThis.ERP.currentAccount;
  }
});

test('T5 公开通道云端无快照 / 无法推断地址 → 各自的可执行提示', async () => {
  for (const err of ['NO_SNAPSHOT', 'NO_CFG_PUBLIC']) {
    const stub = withSyncStubs(() => Promise.resolve({ ok: false, error: err }));
    try {
      const { ctx, state } = staffCtx();
      state.cfg = devicelessCfg();
      page.actions['sync-down'](ctx, state);
      await sleep(30);
      assert.ok(state.msg && state.msg.length > 8, err + ' → 必须有提示');
      assert.ok(/管理总控|在线地址/.test(state.msg), err + ' → 提示要指明下一步动作');
    } finally {
      stub.restore();
    }
  }
});

test('T6 员工缺口令（本机无法自解）→ 给可执行指引，绝不出现「请填写 Token」', async () => {
  const stub = withSyncStubs();
  try {
    const { ctx, state } = staffCtx();
    // 员工新设备：owner/repo 由网址推断、口令未认领到、Token 必然为空
    state.cfg = devicelessCfg({ token: '', passphrase: '' });
    const r = page.actions['sync-down'](ctx, state);
    assert.strictEqual(r, true, '同步返回');
    await sleep(20);
    assert.strictEqual(stub.calls.public.length, 0, '配置不完整时不误走公开通道');
    assert.ok(/取数口令/.test(state.msg), '提示缺取数口令');
    assert.ok(/重新保存一次你的密码/.test(state.msg), '给出员工可转告老板的动作');
    assert.ok(!/Token/.test(state.msg), '员工看不到无从填写的 Token 提示');
    assert.strictEqual(state.syncOpen, false, '员工页没有同步设置面板，不应展开');
  } finally {
    stub.restore();
    delete globalThis.ERP.currentAccount;
  }
});

test('T6b 老板缺口令（本机可自解）→ 保持原行为：展开同步设置面板 + 原样报错（回归）', async () => {
  const stub = withSyncStubs();
  try {
    const ctx = newCtx();
    ctx.currentAccount = { id: 'admin', username: 'hawsystem', role: 'admin' };
    globalThis.ERP.currentAccount = ctx.currentAccount;
    const state = page.init(ctx);
    state.cfg = devicelessCfg({ token: 'ghp_dummy', passphrase: '' });
    const r = page.actions['sync-down'](ctx, state);
    assert.strictEqual(r, true, '同步返回（走原逻辑）');
    await sleep(20);
    assert.strictEqual(stub.calls.public.length, 0, '不得误走公开通道');
    assert.ok(/同步口令/.test(state.msg), '仍按原样报配置错误');
    assert.strictEqual(state.syncOpen, true, '老板展开同步设置面板自助修复');
  } finally {
    stub.restore();
    delete globalThis.ERP.currentAccount;
  }
});

test('T7 老板（Token 齐全）仍走 Token 通道（回归：不改变原有行为）', async () => {
  const stub = withSyncStubs(null, () => Promise.resolve({ ok: true, skipped: true, reason: '本地与云端一致，无需恢复' }));
  try {
    const ctx = newCtx();
    ctx.currentAccount = { id: 'admin', username: 'hawsystem', role: 'admin' };
    globalThis.ERP.currentAccount = ctx.currentAccount;
    const state = page.init(ctx);
    state.cfg = devicelessCfg({ token: 'ghp_dummy', passphrase: 'boss-phrase' });
    page.actions['sync-down'](ctx, state);
    await sleep(30);
    assert.strictEqual(stub.calls.down.length, 1, '老板仍走 syncDown（Contents API）');
    assert.strictEqual(stub.calls.public.length, 0, '不降级到公开通道');
  } finally {
    stub.restore();
    delete globalThis.ERP.currentAccount;
  }
});

test('T7a 校验判定：缺的是不是「取数口令」（公开通道唯一必需依赖）', () => {
  assert.strictEqual(page.needPhraseError(['请设置同步口令（用于加密，换设备恢复要用同一口令）']), true, '缺口令 → true');
  assert.strictEqual(page.needPhraseError(['同步口令至少 6 位']), true, '口令太短也算缺');
  assert.strictEqual(page.needPhraseError([]), false, '无错误 → false');
  assert.strictEqual(page.needPhraseError(null), false, '空 → false');
  assert.strictEqual(
    page.needPhraseError([
      '请填写 GitHub 用户名（owner）',
      '请填写分支名（branch）',
      '请填写 GitHub Token（仅存本机）'
    ]),
    false,
    'owner/branch/token 全缺但口令在 → false（这些都不是公开通道的必需品）'
  );
});

test('T7b 员工新设备「完全零配置」（owner/repo/branch/path/token 全缺、只有口令）→ 仍免 Token 拉取', async () => {
  // 最真实的新手机场景：员工从没配过任何同步设置，只有登录时认领到的取数口令。
  // 公开快照是 GitHub Pages 上的静态文件：读它不需要 Token，地址也可从在线网址推断，
  // 所以「口令在手」就应该拉得到——这正是「不需用 GitHub Token 员工才能拉数据」的口径。
  const text = snapshotText();
  const stub = withSyncStubs(() => Promise.resolve({ ok: true, text, at: '2026-09-17T18:00:00+08:00' }));
  try {
    const { ctx, state } = staffCtx();
    state.cfg = {
      owner: '', repo: '', branch: '', path: '', token: '',
      passphrase: 'test-shop-phrase'
    };
    const r = page.actions['sync-down'](ctx, state);
    assert.strictEqual(r, false, '异步进行中（内部有确认框）：不触发框架 afterAction');
    await sleep(30);

    assert.strictEqual(stub.calls.public.length, 1, '零配置也必须走公开通道（不能只在「只差 Token」那一档降级）');
    assert.strictEqual(stub.calls.down.length, 0, '不得调用需要 Token 的 syncDown');
    assert.strictEqual(stub.calls.public[0].ownerId, 'admin', '按数据归属账号取快照');
    assert.strictEqual(stub.calls.public[0].phrase, 'test-shop-phrase', '用本机取数口令解密');

    assert.strictEqual(ctx.data.products.length, 1, '云端商品已落到本机 ctx');
    assert.strictEqual(ctx.data.products[0].model, 'BCD-216', '恢复的是云端那份数据');
    assert.ok(/清空本机数据并从云端重新拉取/.test(state.msg), '员工走「清空本机后整体拉取」');
    assert.ok(!/请填写 GitHub Token/.test(state.msg), '员工绝不看到无从填写的 Token 提示');
  } finally {
    stub.restore();
    delete globalThis.ERP.currentAccount;
  }
});

test('T7c 老板「零配置 + 有口令」→ 行为不变：仍展开同步设置面板自助补齐（回归）', async () => {
  const stub = withSyncStubs();
  try {
    const ctx = newCtx();
    ctx.currentAccount = { id: 'admin', username: 'hawsystem', role: 'admin' };
    globalThis.ERP.currentAccount = ctx.currentAccount;
    const state = page.init(ctx);
    state.cfg = { owner: '', repo: '', branch: '', path: '', token: '', passphrase: 'boss-phrase' };
    const r = page.actions['sync-down'](ctx, state);
    assert.strictEqual(r, true, '同步返回（走原逻辑）');
    await sleep(20);
    assert.strictEqual(stub.calls.public.length, 0, '老板有同步设置面板，不替他降级');
    assert.strictEqual(state.syncOpen, true, '展开面板让他自己补齐 owner/repo');
    assert.ok(/owner|repo|Token|分支|路径/.test(state.msg), '按原样报出缺失项');
  } finally {
    stub.restore();
    delete globalThis.ERP.currentAccount;
  }
});

test('T8 版本号三处同步：page-mine V3.83 / sw.js v112', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.83'), '关于页应显示 V3.79');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v112';"), 'SW 缓存版本应为 v108');
});
