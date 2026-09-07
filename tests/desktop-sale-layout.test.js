/**
 * 问题1：电脑版销售开单页布局——收款模块移到网页底部（选货区与当前订单的下边，非最右侧）。
 * 修复：desktop.css 中 .sale-top-col（上部两列：选货+订单，列等高+撑满视口）+ .sale-bottom-pay（底部收款横排）。
 * 验证：对应 CSS 规则存在且未被移除（防回归）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const desktop = fs.readFileSync(path.join(__dirname, '..', 'css', 'desktop.css'), 'utf8');

test('开单页上部两列（选货+订单）为列等高、等宽 grid 布局', () => {
  const block = desktop.slice(desktop.indexOf('.sale-top-col'));
  const seg = block.slice(0, block.indexOf('}'));
  assert.ok(seg.includes('.sale-top-col'), '存在上部两列容器 .sale-top-col');
  assert.ok(seg.includes('align-items: stretch'), '两列列等高');
  assert.ok(seg.includes('display: grid'), 'grid 布局');
  assert.ok(seg.includes('grid-template-columns'), '保持列模板');
  assert.ok(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(desktop),
    '选货区与当前订单等宽（1fr 1fr）');
});

test('开单页上部两列 min-height 撑满视口剩余高度', () => {
  const m = desktop.match(/\.sale-top-col\s*\{[\s\S]*?min-height:\s*calc\(100vh\s*-\s*var\(--topbar-h\)\s*-\s*124px\)/);
  assert.ok(m, '上部两列应有 min-height: calc(100vh - var(--topbar-h) - 124px)，撑满可用高度');
});

test('收款模块在底部横排（.sale-bottom-pay）', () => {
  assert.ok(desktop.includes('.sale-bottom-pay { margin-top: 16px; grid-column: 1 / -1; }'),
    '底部收款容器 grid-column 横跨两列铺满整行');
  assert.ok(desktop.includes('.sale-bottom-pay .pay-grid { display: flex; flex-direction: column; gap: 12px; }'),
    '收款模块内为纵向两行布局（第1行输入框+指标+按钮，第2行备注）');
  assert.ok(desktop.includes('.sale-bottom-pay .pay-row1 { display: flex;'),
    '第1行 .pay-row1：收款方式/指标/按钮横向排布');
  assert.ok(desktop.includes('.sale-bottom-pay .pay-methods { display: flex;'),
    '收款方式（微信/现金/支付宝）横向排布');
  assert.ok(desktop.includes('.sale-bottom-pay .pay-stats { display: flex;'),
    '实收/余款处理/欠款一行排布（非三行堆叠，降低高度）');
  assert.ok(desktop.includes('.sale-bottom-pay .pm-input { flex: 1 1 0; min-width: 110px; }'),
    '收款方式输入框 flex 均分并加宽（随页面宽度拉长）');
  assert.ok(desktop.includes('.sale-bottom-pay .pay-note { display: flex; align-items: flex-end; gap: 12px; width: 100%; min-width: 0; }'),
    '第2行备注独占整行（width:100%），备注框随页面宽度加长');
  assert.ok(desktop.includes('.sale-bottom-pay .pay-note .pm-note { flex: 1 1 0; min-width: 0; }'),
    '备注输入框撑满备注行剩余空间');
});

test('列内卡片 flex:1 填满，应收合计卡保持自然高度', () => {
  assert.ok(desktop.includes('.sale-top-col > div > .card { flex: 1; }'),
    '列内 .card 应 flex:1 填满列高');
  assert.ok(desktop.includes('.sale-col-order > .card:last-child { flex: 0 0 auto; }'),
    '中列应收合计卡应保持自然高度，不拉伸');
});

test('手机端不受影响：mobile.css 未定义上部两列撑满规则', () => {
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');
  assert.ok(!mobile.includes('.sale-top-col'), '手机端为单列堆叠，不应有 top-col 撑满规则');
});
