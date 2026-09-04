/**
 * tests/ui-theme.test.js —— 问题4：整体 UI 配色改为蓝色
 * 验证：主色变量（mint 系列 / primary）全部切换为蓝色系，无残留旧青绿色硬编码，
 * 首页图表 SVG 与页面 theme-color 同步为蓝色。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

test('问题4-主色变量切换为蓝色系（base.css）', () => {
  const base = read('css/base.css');
  assert.ok(base.includes('--c-mint-500: #3b82f6'), '主色 mint-500 为蓝色 #3b82f6');
  assert.ok(base.includes('--c-mint-400: #60a5fa'), 'banner 主色 mint-400 为蓝色 #60a5fa');
  assert.ok(base.includes('--c-primary: #2563eb'), 'primary 强调色为蓝色 #2563eb');
  assert.ok(base.includes('--c-primary-dark: #1d4ed8'), 'primary-dark 深蓝');
  assert.ok(base.includes('--c-primary-soft: #eff6ff'), 'primary-soft 浅蓝');
  assert.ok(base.includes('--c-mint-700: #1d4ed8'), '深色 mint-700 为蓝');
});

test('问题4-无残留旧青绿色硬编码', () => {
  const base = read('css/base.css');
  const desktop = read('css/desktop.css');
  const mobile = read('css/mobile.css');
  const idx = read('index.html');
  ['#3FB89B', '#4FB29D', '#2A9D87', '#6CC4B0', 'rgba(63, 184, 155', 'rgba(63,184,155'].forEach((old) => {
    assert.ok(!base.includes(old), 'base.css 无旧绿 ' + old);
    assert.ok(!desktop.includes(old), 'desktop.css 无旧绿 ' + old);
    assert.ok(!mobile.includes(old), 'mobile.css 无旧绿 ' + old);
    assert.ok(!idx.includes(old), 'index.html 无旧绿 ' + old);
  });
});

test('问题4-页面 theme-color 与首页图表 SVG 为蓝色', () => {
  const idx = read('index.html');
  assert.ok(idx.includes('content="#2563eb"'), '浏览器主题色为蓝色 #2563eb');
  const home = read('js/ui/page-home.js');
  assert.ok(home.includes('stop-color="#60A5FA"'), '首页趋势图渐变用蓝色');
  assert.ok(home.includes('stroke="#2563EB"'), '首页趋势图线条用蓝色');
});

test('问题1-手机端「我的」头部经营信息缩略显示（单行省略号）', () => {
  const mobile = read('css/mobile.css');
  // 限定手机端作用域（max-width: 767px）
  assert.ok(mobile.includes('@media (max-width: 767px)'), 'mobile.css 整体在手机端媒体查询内');
  // 缩略规则存在
  assert.ok(mobile.includes('.shop-info-card .sub'), '手机端存在经营信息缩略规则');
  assert.ok(mobile.includes('white-space: nowrap'), '经营信息单行不换行');
  assert.ok(mobile.includes('text-overflow: ellipsis'), '经营信息超出显示省略号');
  assert.ok(mobile.includes('overflow: hidden'), '经营信息溢出隐藏');
  // 规则应位于 @media 块内（在文件靠后位置、media 结束 } 之前）
  const mediaStart = mobile.indexOf('@media (max-width: 767px)');
  const ruleIdx = mobile.indexOf('.shop-info-card .sub');
  assert.ok(ruleIdx > mediaStart, '缩略规则位于手机端媒体查询内');
});

test('问题2-电脑版左侧导航折叠按钮红色醒目', () => {
  const desktop = read('css/desktop.css');
  // 限定电脑端作用域（min-width: 768px）
  assert.ok(desktop.includes('@media (min-width: 768px)'), 'desktop.css 整体在电脑端媒体查询内');
  const ruleIdx = desktop.indexOf('.app-sidebar .side-toggle {');
  assert.ok(ruleIdx > desktop.indexOf('@media (min-width: 768px)'), '折叠按钮规则位于电脑端媒体查询内');
  assert.ok(desktop.includes('background: #dc2626'), '折叠按钮红色背景醒目');
  assert.ok(desktop.includes('color: #fff'), '折叠按钮白色文字');
  assert.ok(desktop.includes('border: 2px solid #dc2626'), '折叠按钮红色加粗边框');
  assert.ok(desktop.includes('font-weight: 700'), '折叠按钮加粗');
  assert.ok(desktop.includes('.app-sidebar .side-toggle:hover { background: #b91c1c'), 'hover 红色加深');
});

test('V3.8-折叠按钮展开态长条红色+折叠态小方形回弹', () => {
  const desktop = read('css/desktop.css');
  // 展开态（默认）：width:auto 红色长条覆盖侧栏宽度，height:36px，箭头右对齐
  const expandRule = desktop.match(/\.app-sidebar \.side-toggle \{[\s\S]*?\}/);
  assert.ok(expandRule, '展开态 side-toggle 规则存在');
  assert.ok(expandRule[0].includes('width: auto'), '展开态 width:auto 长条覆盖侧栏宽度');
  assert.ok(expandRule[0].includes('height: 36px'), '展开态高度 36px（参考图尺寸）');
  assert.ok(expandRule[0].includes('text-align: right'), '展开态箭头右对齐');
  assert.ok(expandRule[0].includes('padding-right: 14px'), '展开态右侧内边距');
  assert.ok(expandRule[0].includes('margin: 0 8px 4px'), '展开态 margin 左右对称形成长条');
  // 折叠态：width:30px height:30px 正方形回弹，文字居中
  const collapseRule = desktop.match(/\.app-sidebar\.collapsed \.side-toggle \{[\s\S]*?\}/);
  assert.ok(collapseRule, '折叠态 side-toggle 规则存在');
  assert.ok(collapseRule[0].includes('width: 30px'), '折叠态回弹为 30px 小方形');
  assert.ok(collapseRule[0].includes('height: 30px'), '折叠态高度 30px 正方形');
  assert.ok(collapseRule[0].includes('text-align: center'), '折叠态箭头居中');
  assert.ok(collapseRule[0].includes('margin: 0 17px 4px'), '折叠态居中显示');
});

test('所有 .tbl 表格默认启用斑马纹（交替行底色）', () => {
  const base = read('css/base.css');
  // 所有 .tbl 表格（不仅限 .tbl-striped）都有斑马纹规则
  assert.ok(/table\.tbl tbody tr:nth-child\(even\) \{/.test(base),
    'base.css 中存在 table.tbl tbody tr:nth-child(even) 斑马纹规则（所有表格默认启用）');
  assert.ok(base.includes('background: #f6f7f9'), '斑马纹底色为 #f6f7f9');
});
