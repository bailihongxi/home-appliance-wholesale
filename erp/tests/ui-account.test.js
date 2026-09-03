/**
 * 记账中心（page-account.js）筛选区布局测试
 * 需求：筛选模块共两行——第 1 行 = 搜索框 + 全部类型；第 2 行 = 日期选择 + 记一笔（强调色按钮）
 */
const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-account.js');
const { newCtx } = require('./helpers/ctx.js');

function fresh(ctx) {
  const s = page.init();
  s.tab = 'flow';
  return s;
}

test('页面元数据', () => {
  assert.strictEqual(page.name, 'account');
  assert.strictEqual(page.title, '记账中心');
});

test('筛选区两行排布：第1行 搜索框+全部类型，第2行 日期+记一笔(强调色)', () => {
  const ctx = newCtx();
  const st = fresh(ctx);
  const html = page.render(ctx, st);

  // 第 1 行：搜索框与「全部类型」下拉同处一行（searchBar 的 filters 内）
  const sbStart = html.indexOf('data-input="keyword"');
  const typeInSb = html.indexOf('data-change="filter" data-name="type"');
  assert.ok(sbStart >= 0, '搜索框存在');
  assert.ok(typeInSb >= 0, '全部类型下拉存在');
  assert.ok(typeInSb > sbStart && typeInSb < html.indexOf('</div>', sbStart) + 400,
    '类型下拉应位于搜索框同一行（searchBar filters 内）');

  // 第 2 行：起止日期 + 记一笔（btn-primary 强调色）
  const dateRowStart = html.indexOf('data-name="from"');
  assert.ok(dateRowStart > typeInSb, '日期行在类型下拉之后（第二行）');
  assert.ok(html.includes('data-name="to"'), '结束日期存在');
  const manualBtn = html.indexOf('data-act="open-manual"');
  assert.ok(manualBtn > dateRowStart, '记一笔按钮在日期行内');
  assert.ok(html.includes('btn-primary" data-act="open-manual"'), '记一笔按钮使用强调色 btn-primary');
  assert.ok(html.includes('＋ 记一笔'), '按钮文案为记一笔');
});
