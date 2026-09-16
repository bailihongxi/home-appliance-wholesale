/**
 * tests/account-note-clip.test.js —— V3.26 记账中心列表备注截断与完整查看
 * 列表备注最多显示 30 个汉字，超出以「...」截断；点击截断的备注可弹出完整记账信息
 * （日期 / 类型 / 金额 / 往来单位 / 单据号 / 完整备注）。
 */
const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-account.js');
const ledger = require('../js/core/ledger.js');
const schema = require('../js/core/schema.js');
const { newCtx } = require('./helpers/ctx.js');

const NOTE_MAX = 30;

function fresh(ctx) {
  const s = page.init();
  s.tab = 'flow';
  return s;
}

/** 记一笔支出流水，返回流水记录 */
function addFlow(ctx, note) {
  ledger.add(ctx, {
    date: '2026-09-08',
    type: schema.LEDGER.EXPENSE,
    category: '运费',
    amount: 12000,
    note: note,
    auto: false
  });
  return ctx.data.ledgers[ctx.data.ledgers.length - 1];
}

test('备注不超过 30 个字时原样显示，不加省略号', () => {
  const ctx = newCtx();
  const short = '运费支出';
  addFlow(ctx, short);

  const html = page.render(ctx, fresh(ctx));
  assert.ok(html.includes(short), '短备注原样显示');
  assert.ok(!html.includes(short + '...'), '未截断的不加省略号');
  assert.ok(!html.includes('data-act="view-note"'), '未截断的不可点击');
});

test('备注超过 30 个字时截断为 30 字 + ...', () => {
  const ctx = newCtx();
  const long = '这是一条很长的备注信息用于测试截断功能abcdefghijklmnopqrstuvwxyz';
  assert.ok(long.length > NOTE_MAX, '构造的备注确实超过 30 字');
  addFlow(ctx, long);

  const html = page.render(ctx, fresh(ctx));
  const clipped = long.slice(0, NOTE_MAX) + '...';
  assert.ok(html.includes(clipped), '显示前 30 字 + ...');
  assert.ok(!html.includes(long), '完整长备注不再出现在列表');
});

test('截断的备注可点击，带 view-note 动作与流水 id', () => {
  const ctx = newCtx();
  const rec = addFlow(ctx, '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十额外内容');
  assert.ok(rec.note.length > NOTE_MAX);

  const html = page.render(ctx, fresh(ctx));
  assert.ok(html.includes('data-act="view-note"'), '备注带点击查看动作');
  assert.ok(html.includes('data-id="' + rec.id + '"'), '备注携带流水 id');
  assert.ok(html.includes('点击查看完整记账信息'), '有提示 title');
});

test('点击备注后弹出完整记账信息，含全部字段与未截断备注', () => {
  const ctx = newCtx();
  const long = '客户要求送货上门并安装调试，另加收远程地区运费一百元整，已与王师傅确认无误';
  const rec = addFlow(ctx, long);
  assert.ok(long.length > NOTE_MAX);

  const st = fresh(ctx);
  page.actions['view-note'](ctx, st, { getAttribute: () => rec.id });
  assert.strictEqual(st.viewNoteId, rec.id, '记录查看的流水 id');

  const html = page.render(ctx, st);
  assert.ok(html.includes('data-act="close-note"'), '弹窗可关闭');
  assert.ok(html.includes(long), '显示完整未截断备注');
  assert.ok(html.includes('2026-09-08'), '显示日期');
  assert.ok(html.includes('往来单位'), '显示往来单位');
  assert.ok(html.includes('单据号'), '显示单据号');
});

test('关闭后弹窗消失，列表恢复截断显示', () => {
  const ctx = newCtx();
  const long = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十这是一段补充';
  const rec = addFlow(ctx, long);

  const st = fresh(ctx);
  page.actions['view-note'](ctx, st, { getAttribute: () => rec.id });
  assert.ok(page.render(ctx, st).includes('data-act="close-note"'));

  page.actions['close-note'](ctx, st);
  assert.strictEqual(st.viewNoteId, null, '已清空查看状态');
  const html = page.render(ctx, st);
  assert.ok(!html.includes('data-act="close-note"'), '弹窗已关闭');
  assert.ok(html.includes(long.slice(0, NOTE_MAX) + '...'), '列表仍显示截断备注');
});

test('备注恰好 30 个字时不截断', () => {
  const ctx = newCtx();
  const exact = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十';
  assert.strictEqual(exact.length, NOTE_MAX, '恰好 30 字');
  addFlow(ctx, exact);

  const html = page.render(ctx, fresh(ctx));
  assert.ok(html.includes(exact), '30 字原样显示');
  assert.ok(!html.includes(exact + '...'), '不追加省略号');
});

test('备注为空时列表正常，不出现 undefined 或省略号', () => {
  const ctx = newCtx();
  addFlow(ctx, '');
  const html = page.render(ctx, fresh(ctx));
  assert.ok(!html.includes('undefined'), '不显示 undefined');
  assert.ok(!html.includes('data-act="view-note"'), '空备注不可点击');
});
