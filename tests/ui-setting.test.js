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

test('clear-data 源码中直接调用 db.clear（不再使用 touchAll 标记空列表）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'page-setting.js'), 'utf8');
  const clearAction = src.match(/'clear-data': function[\s\S]*?\n      \}/);
  assert.ok(clearAction, '找到 clear-data action');
  assert.ok(clearAction[0].includes('db.clear'), 'clear-data 直接调用 db.clear 清空 IndexedDB');
  assert.ok(!clearAction[0].includes('ctx.touchAll(name)'), 'clear-data 不再调用 touchAll（旧 bug 根因：空列表被 flush 跳过）');
});
