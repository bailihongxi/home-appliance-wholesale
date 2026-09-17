/**
 * V3.76 设置页对员工收敛（用户连续反馈「员工能看到/改到老板的东西」后的系统性排查）
 *
 * 设置页原本对任何登录账号都开放全部能力，其中多项**直接改全店共享数据**：
 *  - 「店铺名称」→ 写 ctx.settings.shopName（改掉老板店名）
 *  - 「价格体系」→ 改利润率 + 「一键更新全部商品价格」（重算全店售价）
 *  - 「备份与恢复」→ 导入会**整体覆盖**全店数据
 *  - 「数据管理」→ 清空库存与档案 / 清空全部数据
 *
 * 修法：员工（非数据归属账号）→ 界面隐藏上述板块 + 动作层拦截（双保险）；
 * 打印参数（本机设备）与「打开密码」（本机）保留。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { newCtx } = require('./helpers/ctx.js');

globalThis.ERP = globalThis.ERP || {};
globalThis.ERP.app = globalThis.ERP.app || {
  toast: function () {}, saveSettings: function () {}, render: function () {}, db: null
};

const page = require('../js/ui/page-setting.js');
const branding = require('../js/core/branding.js');
globalThis.ERP.branding = branding;

function ctxAs(account) {
  const ctx = newCtx();
  ctx.settings.shopName = '电器批发管理总控';
  ctx.currentAccount = account;
  return ctx;
}

const STAFF = { id: 'emp1', ownerId: 'admin', username: 'pifa', shopName: '批发部', role: 'user' };
const BOSS = { id: 'admin', username: 'hawsystem', role: 'admin', shopName: '管理总控' };

test('P1 员工：设置页隐藏「店铺名称」输入框', () => {
  const ctx = ctxAs(STAFF);
  const html = page.render(ctx, page.init(ctx));
  assert.ok(!html.includes('data-name="shopName"'), '不得渲染店铺名称输入框');
  assert.ok(html.includes('店铺与打印'), '卡片保留（打印参数仍可用）');
  assert.ok(html.includes('data-name="widthMm"'), '标签宽仍可设置');
});

test('P2 员工：隐藏「价格体系」「备份与恢复」「数据管理」', () => {
  const ctx = ctxAs(STAFF);
  const html = page.render(ctx, page.init(ctx));
  assert.ok(!html.includes('价格体系'), '不显示价格体系');
  assert.ok(!html.includes('一键更新全部商品价格'), '不显示一键重算全部价格');
  assert.ok(!html.includes('备份与恢复'), '不显示备份与恢复');
  assert.ok(!html.includes('data-act="import-backup"'), '不显示导入备份');
  assert.ok(!html.includes('数据管理'), '不显示数据管理');
  assert.ok(!html.includes('data-act="clear-data"'), '不显示清空全部数据');
  assert.ok(!html.includes('data-act="clear-stock-products"'), '不显示清空库存与档案');
});

test('P3 员工：打印设置与打开密码保留（本机能力）', () => {
  const ctx = ctxAs(STAFF);
  const html = page.render(ctx, page.init(ctx));
  assert.ok(html.includes('data-act="save-settings"'), '打印参数可保存');
  assert.ok(html.includes('打开密码'), '打开密码保留');
  assert.ok(html.includes('操作日志'), '操作日志保留（只读）');
});

test('P4 员工：动作层兜底——改店铺名 / 价格体系 / 清空 / 导入 全部被拒', async () => {
  const ctx = ctxAs(STAFF);
  const state = page.init(ctx);
  state.shopName = '员工乱改';
  state.priceForm = { wholesaleMargin: '99', retailMargin: '99' };

  await page.actions['save-settings'](ctx, state);
  assert.strictEqual(ctx.settings.shopName, '电器批发管理总控', '员工保存设置不得改店铺名');

  const r1 = await page.actions['save-price-sys'](ctx, state);
  assert.strictEqual(r1, false, '保存利润率被拒');
  assert.notStrictEqual(ctx.settings.wholesaleMargin, 99, '利润率未被写入（仍为默认 20）');

  const r2 = await page.actions['apply-price-sys'](ctx, state);
  assert.strictEqual(r2, false, '一键重算价格被拒');

  const r3 = await page.actions['clear-data'](ctx, state);
  assert.strictEqual(r3, false, '清空全部数据被拒');

  const r4 = await page.actions['clear-stock-products'](ctx, state);
  assert.strictEqual(r4, false, '清空库存与档案被拒');

  const r5 = await page.actions['import-backup'](ctx, state, null);
  assert.strictEqual(r5, false, '导入备份被拒');
});

test('P5 老板：设置页一切照旧（店铺名 / 价格体系 / 备份 / 数据管理均在，动作可执行）', async () => {
  const ctx = ctxAs(BOSS);
  const state = page.init(ctx);
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-name="shopName"'), '老板可改店铺名');
  assert.ok(html.includes('价格体系'), '老板可改价格体系');
  assert.ok(html.includes('备份与恢复'), '老板可备份恢复');
  assert.ok(html.includes('数据管理'), '老板可清空数据');

  state.shopName = '总控新名';
  await page.actions['save-settings'](ctx, state);
  assert.strictEqual(ctx.settings.shopName, '总控新名', '老板可正常改店铺名');
});

test('P6 无账号上下文（历史/单测场景）：按老板处理，不误伤', () => {
  const ctx = newCtx();
  ctx.settings.shopName = '旧店铺';
  const html = page.render(ctx, page.init(ctx));
  assert.ok(html.includes('data-name="shopName"'), '无账号时仍渲染店铺名');
  assert.ok(html.includes('数据管理'), '无账号时保留数据管理');
});

test('P7 版本号：page-mine V3.78 / sw.js v107（三处同步，防止版本走散）', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.78'), '关于页应显示 V3.78');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v107';"), 'SW 缓存版本应为 v106');
});
