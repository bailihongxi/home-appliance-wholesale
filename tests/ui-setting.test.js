/**
 * ui-setting.test.js —— 设置页面测试
 * 重点：clear-data 清空数据后必须直接清空 IndexedDB，不能依赖 flush（空列表会被 flush 跳过）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const schema = require('../js/core/schema.js');

test('clear-data 直接调用 db.clear 清空每张表（不依赖 flush，避免空列表被跳过）', async () => {
  // 必须在 require page-setting 之前设置好 ERP.app
  globalThis.ERP = globalThis.ERP || {};
  const cleared = [];
  const mockApp = {
    db: { clear: async function (store) { cleared.push(store); }, bulkPut: async function () {}, put: async function () {} },
    commit: async function () { return {}; },
    saveSettings: async function () { return {}; },
    toast: function () {},
    render: function () {}
  };
  globalThis.ERP.app = mockApp;

  // 清除 require 缓存，确保 page-setting 使用当前的 ERP.app
  delete require.cache[require.resolve('../js/ui/page-setting.js')];
  const page = require('../js/ui/page-setting.js');

  // 构造 ctx：每张表都有旧数据
  const ctx = { data: {}, settings: {}, touch: function () {}, touchAll: function () {}, takeDirty: function () { return {}; } };
  schema.DATA_STORES.forEach(function (n) { ctx.data[n] = [{ id: 'old_' + n }]; });
  ctx.data.settings = { shopName: '旧店铺' };
  ctx.data.lastBackupAt = '2026-01-01';
  ctx.settings = ctx.data.settings;

  const state = page.init();
  const result = await page.actions['clear-data'](ctx, state);

  // 验证每张表都被 db.clear
  schema.DATA_STORES.forEach(function (name) {
    assert.ok(cleared.includes(name), '表 ' + name + ' 被 db.clear 清空（实际清空的表: ' + cleared.join(',') + '）');
  });
  assert.strictEqual(cleared.length, schema.DATA_STORES.length, '所有数据表都被清空');

  // 验证内存数据被清空
  schema.DATA_STORES.forEach(function (name) {
    assert.strictEqual(ctx.data[name].length, 0, '内存中 ' + name + ' 已清空');
  });
  assert.strictEqual(ctx.data.lastBackupAt, null, 'lastBackupAt 已清空');
});



/* ---------------- V3.46：清空库存与档案（保留单据） ---------------- */

function freshSetting() {
  const cleared = [];
  const mockApp = {
    db: { clear: async function (store) { cleared.push(store); }, bulkPut: async function () {}, put: async function () {} },
    commit: async function () { return {}; },
    saveSettings: async function () { return {}; },
    toast: function () {},
    render: function () {}
  };
  globalThis.ERP = globalThis.ERP || {};
  globalThis.ERP.app = mockApp;
  delete require.cache[require.resolve('../js/ui/page-setting.js')];
  const page = require('../js/ui/page-setting.js');
  const ctx = { data: {}, settings: {}, touch: function () {}, touchAll: function () {}, takeDirty: function () { return {}; } };
  schema.DATA_STORES.forEach(function (n) { ctx.data[n] = [{ id: 'old_' + n }]; });
  ctx.data.settings = { shopName: '旧店铺' };
  ctx.settings = ctx.data.settings;
  const state = page.init();
  return { page, ctx, state, cleared };
}

test('设置页数据管理卡包含「清空库存与档案」按钮且位于清空全部数据前', () => {
  const { page, ctx } = freshSetting();
  const html = page.render(ctx, page.init());
  const a = html.indexOf('data-act="clear-stock-products"');
  const b = html.indexOf('data-act="clear-data"');
  assert.ok(a >= 0, '存在清空库存与档案按钮');
  assert.ok(b >= 0, '存在清空全部数据按钮');
  assert.ok(a < b, '清空库存与档案在前');
});

test('clear-stock-products 仅清空 products/stockLogs/stocktakes，保留单据/记账/客户/日志/设置', async () => {
  const { page, ctx, cleared } = freshSetting();
  await page.actions['clear-stock-products'](ctx, page.init());
  // db.clear 只对三张表
  assert.deepStrictEqual(cleared.sort(), ['products', 'stockLogs', 'stocktakes'].sort(), '仅清空三张表');
  // 内存：三张表清空
  ['products', 'stockLogs', 'stocktakes'].forEach(function (n) {
    assert.strictEqual(ctx.data[n].length, 0, n + ' 已清空');
  });
  // 保留：单据/记账/客户/日志/设置
  ['purchases', 'sales', 'ledgers', 'partners'].forEach(function (n) {
    assert.strictEqual(ctx.data[n].length, 1, n + ' 保留原数据');
  });
  assert.ok(ctx.data.logs.length >= 1, 'logs 保留且新增操作日志');
  const hasLog = ctx.data.logs.some(l => String(l.action || '').indexOf('清空库存与档案') >= 0);
  assert.ok(hasLog, '写入了清空库存与档案操作日志');
  assert.strictEqual(ctx.data.settings.shopName, '旧店铺', '设置保留');
});

test('clear-stock-products 取消确认时不清空任何数据', async () => {
  const { page, ctx, cleared } = freshSetting();
  // C.confirm 返回 false → 取消
  const origConfirm = globalThis.ERP.app;
  // 注入 confirm 桩：返回 false（通过 ERP.ui 不可达，改用 C.confirm 前拦截：app.commit 存在时走 confirm 分支，
  // 而 C.confirm 来自 ui 模块；此处直接把 C.confirm 替换）
  const uiMod = require('../js/ui/components.js');
  const origC = uiMod.confirm;
  uiMod.confirm = function () { return Promise.resolve(false); };
  try {
    const r = await page.actions['clear-stock-products'](ctx, page.init());
    assert.strictEqual(r, false, '返回 false');
  } finally {
    uiMod.confirm = origC;
  }
  assert.strictEqual(cleared.length, 0, '未调用 db.clear');
  assert.strictEqual(ctx.data.products.length, 1, 'products 未清空');
  assert.strictEqual(ctx.data.stockLogs.length, 1, 'stockLogs 未清空');
});

test('clear-stock-products 源码只清三张表（products/stockLogs/stocktakes）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-setting.js'), 'utf8');
  const m = src.match(/'clear-stock-products': function[\s\S]*?\n      \},\n/);
  assert.ok(m, '找到 clear-stock-products action');
  assert.ok(m[0].includes("['products', 'stockLogs', 'stocktakes']"), '清空清单为三张表');
  assert.ok(m[0].includes('db.clear'), '直接调用 db.clear 清空 IndexedDB');
  assert.ok(!m[0].includes("schema.DATA_STORES.forEach"), '不遍历全部数据表');
});
test('clear-data 源码中直接调用 db.clear（不再使用 touchAll 标记空列表）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-setting.js'), 'utf8');
  const clearAction = src.match(/'clear-data': function[\s\S]*?\n      \}/);
  assert.ok(clearAction, '找到 clear-data action');
  assert.ok(clearAction[0].includes('db.clear'), 'clear-data 直接调用 db.clear 清空 IndexedDB');
  assert.ok(!clearAction[0].includes('ctx.touchAll(name)'), 'clear-data 不再调用 touchAll（旧 bug 根因：空列表被 flush 跳过）');
});
