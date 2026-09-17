/**
 * V3.64 首页横幅备份文案真实性
 *
 * Bug：首页顶部横幅副标题原先是**硬编码**的「已备份 · 今天 09:12」，
 * 于是全新设备（从未备份）会出现横幅说"已备份"、下方提醒条却说"从未备份"的自相矛盾，
 * 容易让用户误以为数据已有备份而放松警惕。
 * 修复：由 ctx.data.lastBackupAt 派生（util.backupLabel 纯函数）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

globalThis.ERP = globalThis.ERP || {};

const page = require('../js/ui/page-home.js');
const util = require('../js/core/util.js');
const { newCtx } = require('./helpers/ctx.js');

const ROOT = path.join(__dirname, '..');
const TODAY = '2026-09-17';

test('backupLabel：从未备份 → 明确未备份，不说「已备份」', () => {
  const r = util.backupLabel(null, TODAY);
  assert.strictEqual(r.backed, false);
  assert.ok(r.text.includes('尚未备份'), '文案：' + r.text);
  assert.ok(!r.text.includes('已备份'), '绝不能出现「已备份」');
  assert.strictEqual(util.backupLabel('', TODAY).backed, false);
  assert.strictEqual(util.backupLabel(undefined, TODAY).backed, false);
});

test('backupLabel：今天备份 → 已备份 + 具体时刻', () => {
  const r = util.backupLabel(TODAY + 'T09:12:33', TODAY);
  assert.strictEqual(r.backed, true);
  assert.strictEqual(r.text, '已备份 · 今天 09:12');
});

test('backupLabel：N 天前备份 → 已备份 · N 天前', () => {
  assert.strictEqual(util.backupLabel('2026-09-16T20:00:00', TODAY).text, '已备份 · 1 天前');
  assert.strictEqual(util.backupLabel('2026-09-10T08:00:00', TODAY).text, '已备份 · 7 天前');
});

test('backupLabel：超过 30 天 → 回落具体日期', () => {
  assert.strictEqual(util.backupLabel('2026-06-01T08:00:00', TODAY).text, '上次备份 · 2026-06-01');
});

test('首页横幅不再硬编码「今天 09:12」——未备份时不说已备份', () => {
  const ctx = newCtx(); // lastBackupAt 为空
  const html = page.render(ctx, page.init());
  assert.ok(!html.includes('已备份 · 今天 09:12'), '不得再出现写死的假备份时间');
  assert.ok(html.includes('尚未备份'), '未备份时横幅应说明尚未备份');
  assert.ok(html.includes('你已 从未 备份') || html.includes('从未'), '下方提醒条仍提示从未备份');
});

test('首页横幅：今天备份过则显示已备份与时刻', () => {
  const ctx = newCtx();
  ctx.data.lastBackupAt = util.today() + 'T07:05:00';
  const html = page.render(ctx, page.init());
  assert.ok(html.includes('已备份 · 今天 07:05'), '横幅显示真实备份时刻');
  assert.ok(!html.includes('尚未备份'), '已备份时不应再提示未备份');
});

test('首页横幅与提醒条不再自相矛盾（未备份场景）', () => {
  const ctx = newCtx();
  const html = page.render(ctx, page.init());
  const bannerSaysBacked = /banner-sub">[^<]*已备份/.test(html);
  const reminderSaysNever = html.includes('从未');
  assert.ok(!(bannerSaysBacked && reminderSaysNever), '横幅与提醒条不得一个说已备份一个说从未备份');
});

test('V3.74 版本号：page-mine V3.68 / sw.js v103', () => {
  const fs = require('node:fs');
  const mineSrc = fs.readFileSync(path.join(ROOT, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(mineSrc.includes('版本：V3.74'), '关于页应显示 V3.74');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v103';"), 'SW 缓存版本应为 v103');
});
