/**
 * 问题1：电脑版销售开单页底部大片空白（收款模块下方）显示效果差。
 * 修复：desktop.css 中 .sale-three-col 列等高（align-items: stretch）+ min-height 撑满视口剩余高度，
 *       列内 .card flex:1 填满，中列「应收合计」卡保持自然高度。
 * 验证：对应 CSS 规则存在且未被移除（防回归）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const desktop = fs.readFileSync(path.join(__dirname, '..', 'css', 'desktop.css'), 'utf8');

test('开单页三栏为列等高布局（align-items: stretch）', () => {
  const block = desktop.slice(desktop.indexOf('.sale-three-col'));
  const seg = block.slice(0, block.indexOf('}'));
  assert.ok(seg.includes('align-items: stretch'), '三栏应列等高，消除列内底部空白');
  assert.ok(seg.includes('display: grid'), '保持 grid 布局');
  assert.ok(seg.includes('grid-template-columns'), '保持 3 列模板');
});

test('开单页三栏 min-height 撑满视口剩余高度', () => {
  const m = desktop.match(/\.sale-three-col\s*\{[\s\S]*?min-height:\s*calc\(100vh\s*-\s*var\(--topbar-h\)\s*-\s*124px\)/);
  assert.ok(m, '三栏应有 min-height: calc(100vh - var(--topbar-h) - 124px)，撑满可用高度消除底部空白');
});

test('列内卡片 flex:1 填满，应收合计卡保持自然高度', () => {
  assert.ok(desktop.includes('.sale-three-col > div > .card { flex: 1; }'),
    '列内 .card 应 flex:1 填满列高');
  assert.ok(desktop.includes('.sale-col-order > .card:last-child { flex: 0 0 auto; }'),
    '中列应收合计卡应保持自然高度，不拉伸');
  assert.ok(desktop.includes('.sale-three-col > div { display: flex; flex-direction: column;'),
    '列容器应为纵向 flex');
});

test('手机端不受影响：mobile.css 未定义三栏撑满规则', () => {
  const mobile = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');
  assert.ok(!mobile.includes('.sale-three-col'), '手机端为单列堆叠，不应有 three-col 撑满规则');
});
