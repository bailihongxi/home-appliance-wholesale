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

test('头部单行排布：标题 + 应付/应收合计 + 流水/应付/应收按钮 同一行', () => {
  const ctx = newCtx();
  const st = fresh(ctx);
  const html = page.render(ctx, st);
  assert.ok(html.includes('page-head account-head'), '记账中心头部使用单行专用布局');
  assert.ok(html.includes('account-sum'), '应付/应收合计同处 account-sum');
  // 应付/应收合计在标题之后、且比筛选区靠前（都在头部）
  const h2 = html.indexOf('记账中心');
  const sumStart = html.indexOf('account-sum');
  assert.ok(sumStart > h2, '统计合计位于标题后');
  // 流水/应付/应收 tab 使用 btn 样式（激活项 btn-primary）
  assert.ok(html.includes('class="btn btn-primary" data-act="tab" data-tab="flow"'), '当前流水 tab 高亮 btn-primary');
  assert.ok(html.includes('class="btn" data-act="tab" data-tab="payable"'), '应付 tab 用普通按钮');
  assert.ok(html.includes('class="btn" data-act="tab" data-tab="receivable"'), '应收 tab 用普通按钮');
  assert.ok(html.includes('account-tabs'), 'tab 按钮在 account-tabs 容器内');
  // 统计卡紧凑：应付/应收 用 stat（k/v 横排由 CSS 控制），位于头部而非单独卡片行
  assert.ok(html.includes('应付合计') && html.includes('应收合计'), '应付/应收合计存在');
});

test('记一笔模块默认隐藏，点击记一笔后展开，保存/取消后自动隐藏', () => {
  const ctx = newCtx();
  const st = fresh(ctx);

  // 默认隐藏
  let html = page.render(ctx, st);
  assert.ok(!html.includes('card-title">记一笔'), '默认状态下记一笔编辑模块不显示');

  // 点击记一笔按钮 → 展开
  page.actions['open-manual'](ctx, st);
  assert.strictEqual(st.manualOpen, true, 'open-manual 后 manualOpen=true');
  html = page.render(ctx, st);
  assert.ok(html.includes('card-title">记一笔'), '展开后记一笔编辑模块显示');

  // 记一笔模块在筛选区下方、列表上方
  const manualPos = html.indexOf('card-title">记一笔');
  const listPos = html.indexOf('<table class="tbl">');
  const filterPos = html.indexOf('data-act="open-manual"');
  assert.ok(manualPos > filterPos, '记一笔模块在筛选区之后');
  assert.ok(manualPos < listPos || listPos < 0, '记一笔模块在列表之前（或无列表时也在筛选区后）');

  // 点击取消 → 隐藏
  page.actions['close-manual'](ctx, st);
  assert.strictEqual(st.manualOpen, false, 'close-manual 后 manualOpen=false');
  html = page.render(ctx, st);
  assert.ok(!html.includes('card-title">记一笔'), '取消后记一笔编辑模块隐藏');

  // 再次展开后点击保存 → 隐藏
  page.actions['open-manual'](ctx, st);
  st.manual.amount = '100';
  page.actions['save-manual'](ctx, st);
  assert.strictEqual(st.manualOpen, false, 'save-manual 后 manualOpen=false');
});
