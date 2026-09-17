/**
 * V3.75 展示身份统一：顶栏 / 侧栏 / 首页 banner 一律按当前账号显示
 *
 * 用户反馈：员工登录后「首页右上角仍然是总控的用户名和头像」——
 * 根因是 app.js 顶栏与 page-home.js banner 都读共享的 ctx.settings（老板店铺资料）。
 * 修法：branding.identity(settings, account) —— 员工（非数据归属账号）显示
 * 自己的 account.shopName || username + account.avatar；老板与无账号场景照旧。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const branding = require('../js/core/branding.js');
const home = require('../js/ui/page-home.js');

const ROOT = path.join(__dirname, '..');
const BOSS_SETTINGS = { shopName: '电器批发管理总控', avatar: 'data:image/png;base64,BOSS' };

/** 员工账号：带 ownerId 且不等于自身 id（无 sync/accounts 模块时的退化判定） */
const STAFF = { id: 'emp1', ownerId: 'admin', username: 'pifa', shopName: '批发部', avatar: 'data:image/png;base64,STAFF' };
const BOSS = { id: 'admin', username: 'hawsystem', shopName: '管理总控', role: 'admin' };

test('I1 员工：identity 返回员工自己的账号名与头像', () => {
  const r = branding.identity(BOSS_SETTINGS, STAFF);
  assert.strictEqual(r.isStaff, true, '识别为员工');
  assert.strictEqual(r.name, '批发部', '显示员工账号名');
  assert.strictEqual(r.logo, 'data:image/png;base64,STAFF', '显示员工头像');
});

test('I2 老板（数据归属）：identity 仍返回店铺资料', () => {
  const r = branding.identity(BOSS_SETTINGS, BOSS);
  assert.strictEqual(r.isStaff, false);
  assert.strictEqual(r.name, '电器批发管理总控');
  assert.strictEqual(r.logo, 'data:image/png;base64,BOSS');
});

test('I3 无账号上下文：回退店铺资料（不影响单测等无账号场景）', () => {
  const r = branding.identity(BOSS_SETTINGS, null);
  assert.strictEqual(r.isStaff, false);
  assert.strictEqual(r.name, '电器批发管理总控');
});

test('I4 员工无头像 / 无店名：头像回退默认图标，名字回退登录名', () => {
  const bare = branding.identity(BOSS_SETTINGS, { id: 'e2', ownerId: 'admin', username: 'xiaozhang' });
  assert.strictEqual(bare.name, 'xiaozhang', '用登录名');
  assert.strictEqual(bare.logo, 'assets/favicon.png', '回退默认图标');
  const anon = branding.identity(BOSS_SETTINGS, { id: 'e3', ownerId: 'admin' });
  assert.strictEqual(anon.name, '员工账号', '兜底文案');
});

test('I5 首页 banner：员工视角不出现老板店名，出现员工账号名', () => {
  const ctx = {
    settings: BOSS_SETTINGS,
    currentAccount: STAFF,
    data: { products: [], sales: [], purchases: [], accounts: [], categories: [] }
  };
  const html = home.render(ctx, home.init(ctx));
  assert.ok(html.includes('批发部'), 'banner 显示员工账号名');
  assert.ok(!html.includes('电器批发管理总控'), 'banner 不得出现老板店名');
});

test('I6 源码：app.js 顶栏改用 identity；applyAccountToSettings 不再把员工档案写进共享 settings', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(src.includes('ERP.branding.identity'), '顶栏走 identity');
  assert.ok(src.includes('isStaffAccount(account)'), 'applyAccountToSettings 对员工跳过写入');
  assert.ok(!/s\.shopName\s*=\s*account\.shopName/.test(src.split('if (ERP.branding && ERP.branding.isStaffAccount')[0] || '')
    || src.indexOf('isStaffAccount(account)') < src.indexOf('s.shopName = account.shopName'),
    '员工跳过判断须在写入之前');
});

test('I7 版本号：page-mine V3.75 / sw.js v106（三处同步，防止版本走散）', () => {
  const mine = fs.readFileSync(path.join(ROOT, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.77'), '关于页应显示 V3.77');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v106';"), 'SW 缓存版本应为 v106');
});
