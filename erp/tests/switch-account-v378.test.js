/**
 * V3.79 切换账号入口（用户反馈：「新设备只能登录一个号码吗？有没有切换的入口」）
 *
 * 背景：此前全站唯一的「切换账号」入口藏在「我的 → 店铺资料」二级编辑面板里，
 * 员工账号的「我的」页被 V3.73 精简后连该面板都没有 → 换账号只能清浏览器会话 / 换浏览器。
 *
 * 需求（用户选择）：
 *  - 入口放在「我的」页（老板与员工都要有，一眼可见）
 *  - 点「切换账号」= 退出登录回登录页，账号框不预填任何内容
 *  - 退出前必须先落库，避免刚录入的数据随会话丢失
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 坑（发布流程 9c）：必须先建 globalThis.ERP，再 require 页面模块，
// 否则页面闭包拿到的 ERP 与 globalThis.ERP 不是同一个对象，注入的假 app 读不到。
globalThis.ERP = globalThis.ERP || {};

const page = require('../js/ui/page-mine.js');
const ui = require('../js/ui/components.js');
const login = require('../js/ui/page-login.js');
const { newCtx } = require('./helpers/ctx.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 老板（数据归属账号，管理总控） */
function ownerCtx() {
  const ctx = newCtx();
  ctx.settings.shopName = '电器批发管理总控';
  ctx.currentAccount = { id: 'admin', username: 'hawsystem', role: 'admin', shopName: '管理总控' };
  return { ctx, state: page.init(ctx) };
}

/** 员工（共用本店数据：带 ownerId） */
function staffCtx() {
  const ctx = newCtx();
  ctx.settings.shopName = '电器批发管理总控';
  ctx.currentAccount = {
    id: 'emp1', ownerId: 'admin', username: 'pifa', shopName: '批发部',
    role: 'user', perms: { data_manage: true }
  };
  return { ctx, state: page.init(ctx) };
}

/** 独立数据空间的普通账号（无 ownerId、非 admin） */
function plainCtx() {
  const ctx = newCtx();
  ctx.currentAccount = { id: 'acct9', username: 'dianpu9', role: 'user', perms: {} };
  return { ctx, state: page.init(ctx) };
}

/** 假 app：记录调用顺序 */
function fakeApp(calls) {
  return {
    commit: function () { calls.push('commit'); return Promise.resolve(null); },
    logout: function () { calls.push('logout'); }
  };
}

test('T1 老板「我的」页：有可见的「切换账号」入口，且不重复', () => {
  const { ctx, state } = ownerCtx();
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-act="switch-account"'), '应渲染切换账号入口');
  assert.ok(html.includes('切换账号'), '按钮文案应为「切换账号」');
  assert.ok(html.includes('当前登录账号'), '应显示当前登录账号卡片');
  assert.ok(html.includes('@hawsystem'), '显示当前登录名');
  assert.strictEqual(typeof page.actions['switch-account'], 'function', '动作已注册');

  // 展开店铺资料面板后，页面上不应新增切换入口（已从该面板移出，不再重复）
  // 注：render() 同时输出手机端与电脑端两份标记，所以计数用「开面板前后相等」来断言
  const nClosed = html.split('data-act="switch-account"').length - 1;
  state.editShop = true;
  const html2 = page.render(ctx, state);
  const nOpen = html2.split('data-act="switch-account"').length - 1;
  assert.ok(nClosed >= 1, '默认（面板未展开）就能看到切换入口');
  assert.strictEqual(nOpen, nClosed, '展开编辑面板后切换入口数量不变（面板里已不再重复放）');
});

test('T2 员工「我的」页：也有「切换账号」入口（此前完全没有）', () => {
  const { ctx, state } = staffCtx();
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-act="switch-account"'), '员工页应渲染切换账号入口');
  // V3.73 精简约定不得被破坏
  assert.ok(!html.includes('data-act="toggle-sync-cfg"'), '仍不显示同步设置按钮');
  assert.ok(!html.includes('同步到云端'), '仍不出现「同步到云端」字样');
  assert.ok(!html.includes('>关于<'), '仍不显示关于卡片');
  assert.ok(!html.includes('店铺资料'), '仍不显示店铺资料面板');
  assert.ok(!html.includes('电器批发管理总控'), '仍不显示老板店名');
});

test('T3 独立数据空间的普通账号：入口同样可见（不受角色 / 权限影响）', () => {
  const { ctx, state } = plainCtx();
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-act="switch-account"'), '普通账号也应能切换账号');
  assert.ok(html.includes('@dianpu9'), '显示当前登录名');
  assert.ok(!html.includes('权限管理'), '普通账号仍不显示权限管理入口');
});

test('T4 动作：确认框选「取消」→ 既不落库也不登出', async () => {
  const calls = [];
  globalThis.ERP.app = fakeApp(calls);
  const old = ui.confirm;
  ui.confirm = () => Promise.resolve(false);
  try {
    const { ctx, state } = ownerCtx();
    const r = await page.actions['switch-account'](ctx, state);
    await sleep(10);
    assert.strictEqual(r, false, '返回 false 以跳过框架 afterAction 重渲染');
    assert.deepStrictEqual(calls, [], '取消后既不 commit 也不 logout');
  } finally {
    ui.confirm = old;
    delete globalThis.ERP.app;
  }
});

test('T5 动作：确认后「先落库、再退出登录」（避免刚录入的数据丢失）', async () => {
  const calls = [];
  globalThis.ERP.app = fakeApp(calls);
  const old = ui.confirm;
  ui.confirm = () => Promise.resolve(true);
  try {
    const { ctx, state } = ownerCtx();
    await page.actions['switch-account'](ctx, state);
    await sleep(10);
    assert.deepStrictEqual(calls, ['commit', 'logout'], '必须先 commit 再 logout');
  } finally {
    ui.confirm = old;
    delete globalThis.ERP.app;
  }
});

test('T6 动作：无确认框可用时（老环境）也要能退出，不能卡住', async () => {
  const calls = [];
  globalThis.ERP.app = fakeApp(calls);
  const old = ui.confirm;
  delete ui.confirm;
  try {
    const { ctx, state } = staffCtx();
    await page.actions['switch-account'](ctx, state);
    await sleep(10);
    assert.deepStrictEqual(calls, ['commit', 'logout'], '无确认框时直接落库并退出');
  } finally {
    ui.confirm = old;
    delete globalThis.ERP.app;
  }
});

test('T7 动作：无 app / logout 时安全返回，不抛错', () => {
  delete globalThis.ERP.app;
  const { ctx, state } = ownerCtx();
  assert.strictEqual(page.actions['switch-account'](ctx, state), false, '无 app 时返回 false 且不抛错');
});

test('T8 登录页：切换后不预填任何账号（用户口径：只退出，什么都不预填）', () => {
  const mem = {};
  const store = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
  };
  const st = login.init(null, store);
  assert.strictEqual(st.username, '', '登录页初始账号为空');
  assert.strictEqual(st.pwd, '', '登录页初始密码为空');
  const html = login.render(null, st);
  assert.ok(html.includes('value=""'), '账号输入框不得预填内容');
  assert.ok(!html.includes('hawsystem') && !html.includes('pifa'), '登录页不展示账号列表 / 上次账号');
});

test('T9 版本号三处同步：page-mine V3.82 / sw.js v111', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.82'), '关于页应显示 V3.79');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v111';"), 'SW 缓存版本应为 v107');
});
