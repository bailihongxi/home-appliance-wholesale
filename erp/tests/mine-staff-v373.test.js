/**
 * V3.73 员工「我的」页精简（用户反馈：员工登录后页面还是老板的样子）
 *
 * 用户原话要点：
 *  - 账号名称还显示「电器批发管理总控」（老板店名）→ 员工必须显示自己的账号名
 *  - 不显示备注、不同步设置按钮及同步信息
 *  - 员工「我的」页只留权限模块（常用入口）+「从云端恢复」按钮
 *  - 其余注释/提醒信息全部隐藏（含「关于」卡片）
 */
const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-mine.js');
const fs = require('node:fs');
const path = require('node:path');
const { newCtx } = require('./helpers/ctx.js');

/** 员工账号（共用本店数据：带 ownerId） */
function staffCtx() {
  const ctx = newCtx();
  ctx.settings.shopName = '电器批发管理总控';
  ctx.settings.scopeCategories = ['冰箱', '洗衣机'];
  ctx.currentAccount = {
    id: 'emp1', ownerId: 'admin', username: 'pifa',
    shopName: '批发部', role: 'user',
    perms: { data_manage: true }
  };
  const state = page.init(ctx);
  return { ctx, state };
}

/** 老板账号（数据归属） */
function ownerCtx() {
  const ctx = newCtx();
  ctx.settings.shopName = '电器批发管理总控';
  ctx.currentAccount = { id: 'admin', username: 'hawsystem', role: 'admin', shopName: '管理总控' };
  const state = page.init(ctx);
  return { ctx, state };
}

test('S1 员工头部：显示员工自己的账号名，不显示老板店名与经营范围', () => {
  const { ctx, state } = staffCtx();
  const html = page.render(ctx, state);
  assert.ok(html.includes('>批发部<'), '应显示员工账号名「批发部」');
  assert.ok(!html.includes('电器批发管理总控'), '不得出现老板店名「电器批发管理总控」');
  assert.ok(!html.includes('经营：'), '不显示老板的经营范围');
});

test('S2 员工头部：无编辑入口（不可改老板店铺资料）', () => {
  const { ctx, state } = staffCtx();
  const html = page.render(ctx, state);
  assert.ok(!html.includes('data-act="toggle-shop-edit"'), '头部卡片不得带编辑动作');
  assert.ok(!html.includes('店铺资料'), '不渲染店铺资料编辑面板');
});

test('S3 员工云同步卡片：只显示「从云端恢复」按钮', () => {
  const { ctx, state } = staffCtx();
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-act="sync-down"'), '保留从云端恢复按钮');
  assert.ok(!html.includes('data-act="sync-up"'), '不显示同步到云端按钮（含只读占位）');
  assert.ok(!html.includes('同步到云端'), '不出现「同步到云端」字样');
  assert.ok(!html.includes('data-act="toggle-sync-cfg"'), '不显示同步设置按钮');
});

test('S4 员工云同步卡片：备注 / 数据空间 / 上次同步等说明全部隐藏', () => {
  const { ctx, state } = staffCtx();
  const html = page.render(ctx, state);
  assert.ok(!html.includes('只读拉取'), '不显示只读备注');
  assert.ok(!html.includes('数据空间'), '不显示数据空间说明');
  assert.ok(!html.includes('上次同步'), '不显示上次同步时间');
  assert.ok(!html.includes('GitHub Pages'), '不显示 (GitHub Pages) 副标题');
});

test('S5 员工视图：隐藏「关于」卡片（含检查更新）', () => {
  const { ctx, state } = staffCtx();
  const html = page.render(ctx, state);
  assert.ok(!html.includes('>关于<'), '不显示关于卡片');
  assert.ok(!html.includes('check-update'), '不显示检查更新按钮');
});

test('S6 员工视图：保留权限模块（常用入口，按权限过滤）', () => {
  const { ctx, state } = staffCtx();
  const html = page.render(ctx, state);
  assert.ok(html.includes('常用入口'), '保留常用入口（权限模块）');
});

test('S7 老板视图：一切照旧（同步设置 / 上传 / 数据空间 / 关于均在）', () => {
  const { ctx, state } = ownerCtx();
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-act="sync-up"'), '老板保留上传按钮');
  assert.ok(html.includes('data-act="toggle-sync-cfg"'), '老板保留同步设置按钮');
  assert.ok(html.includes('>关于<'), '老板保留关于卡片');
  assert.ok(html.includes('电器批发管理总控'), '老板显示自己店铺名');
});

test('S8 版本号：page-mine V3.79 / sw.js v108（三处同步，防止版本走散）', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.79'), '关于页应显示 V3.79');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v108';"), 'SW 缓存版本应为 v106');
});

test('S9 V3.74 新版本自动生效：index.html 含 controllerchange 自动刷新守卫（员工无检查更新按钮，靠它换版）', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes("addEventListener('controllerchange'"), '须监听 controllerchange');
  assert.ok(html.includes('swRefreshing'), '须有防重复刷新标记（避免循环刷新）');
  assert.ok(html.includes('navigator.serviceWorker.controller'), '须以 controller 存在为前提（首次打开不刷新）');
  assert.ok(html.includes('location.reload()'), '接管后刷新页面加载新代码');
});

test('S10 V3.76 动作层兜底：员工调 save-shop 不得改共享店铺资料（防控制台绕过）', async () => {
  const { ctx, state } = staffCtx();
  state.shopNameEdit = '员工乱改';
  state.avatarDataUrl = 'data:image/png;base64,STAFFAV';
  const r = await page.actions['save-shop'](ctx, state);
  assert.strictEqual(r, false, '员工保存店铺资料被拒');
  assert.strictEqual(ctx.settings.shopName, '电器批发管理总控', '共享店名未被改掉');
  assert.ok(!ctx.settings.avatar || ctx.settings.avatar !== 'data:image/png;base64,STAFFAV', '共享头像未被改掉');
});
