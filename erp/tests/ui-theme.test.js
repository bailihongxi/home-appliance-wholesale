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
  // 核心样式已移到 base.css（不依赖媒体查询，修复窗口 750px 时断点不匹配问题）
  const base = read('css/base.css');
  assert.ok(base.includes('background: #dc2626'), '折叠按钮红色背景醒目');
  assert.ok(base.includes('color: #fff'), '折叠按钮白色文字');
  assert.ok(base.includes('border: 2px solid #dc2626'), '折叠按钮红色加粗边框');
  assert.ok(base.includes('font-weight: 700'), '折叠按钮加粗');
  assert.ok(base.includes('.app-sidebar .side-toggle:hover { background: #b91c1c'), 'hover 红色加深');
  // desktop.css 保留 sticky 定位补充
  const desktop = read('css/desktop.css');
  assert.ok(desktop.includes('@media (min-width: 768px)'), 'desktop.css 整体在电脑端媒体查询内');
  assert.ok(desktop.includes('.app-sidebar .side-toggle'), 'desktop.css 保留 side-toggle sticky 定位补充');
});

test('V3.8-折叠按钮展开态长条红色+折叠态小方形回弹', () => {
  // 核心样式已移到 base.css（不依赖媒体查询）
  const base = read('css/base.css');
  // 展开态（默认）：width:auto 红色长条覆盖侧栏宽度，height:36px，箭头右对齐
  const expandRule = base.match(/\.app-sidebar \.side-toggle \{[\s\S]*?\}/);
  assert.ok(expandRule, '展开态 side-toggle 规则存在（base.css）');
  assert.ok(expandRule[0].includes('width: auto'), '展开态 width:auto 长条覆盖侧栏宽度');
  assert.ok(expandRule[0].includes('height: 36px'), '展开态高度 36px（参考图尺寸）');
  assert.ok(expandRule[0].includes('text-align: right'), '展开态箭头右对齐');
  // 折叠态：width:30px height:30px 正方形回弹，文字居中
  const collapseRule = base.match(/\.app-sidebar\.collapsed \.side-toggle \{[\s\S]*?\}/);
  assert.ok(collapseRule, '折叠态 side-toggle 规则存在（base.css）');
  assert.ok(collapseRule[0].includes('width: 30px'), '折叠态回弹为 30px 小方形');
  assert.ok(collapseRule[0].includes('height: 30px'), '折叠态高度 30px 正方形');
  assert.ok(collapseRule[0].includes('text-align: center'), '折叠态箭头居中');
});

test('所有 .tbl 表格默认启用斑马纹（交替行底色）', () => {
  const base = read('css/base.css');
  // 所有 .tbl 表格（不仅限 .tbl-striped）都有斑马纹规则
  assert.ok(/table\.tbl tbody tr:nth-child\(even\) \{/.test(base),
    'base.css 中存在 table.tbl tbody tr:nth-child(even) 斑马纹规则（所有表格默认启用）');
  assert.ok(base.includes('background: #f6f7f9'), '斑马纹底色为 #f6f7f9');
});

test('侧边栏折叠按钮基础样式在 base.css（不依赖媒体查询），展开态红色长条+折叠态小方形', () => {
  const base = read('css/base.css');
  // 展开态：红色长条
  const expandRule = base.match(/\.app-sidebar \.side-toggle \{[\s\S]*?\}/);
  assert.ok(expandRule, 'base.css 中存在 .app-sidebar .side-toggle 展开态规则');
  assert.ok(expandRule[0].includes('display: block'), '展开态 display:block 撑满宽度');
  assert.ok(expandRule[0].includes('width: auto'), '展开态 width:auto 长条覆盖侧栏宽度');
  assert.ok(expandRule[0].includes('height: 36px'), '展开态高度 36px');
  assert.ok(expandRule[0].includes('background: #dc2626'), '展开态红色背景 #dc2626');
  assert.ok(expandRule[0].includes('text-align: right'), '展开态箭头右对齐');
  // 折叠态：小方形回弹
  const collapseRule = base.match(/\.app-sidebar\.collapsed \.side-toggle \{[\s\S]*?\}/);
  assert.ok(collapseRule, 'base.css 中存在 .app-sidebar.collapsed .side-toggle 折叠态规则');
  assert.ok(collapseRule[0].includes('width: 30px'), '折叠态回弹为 30px 小方形');
  assert.ok(collapseRule[0].includes('height: 30px'), '折叠态高度 30px 正方形');
  assert.ok(collapseRule[0].includes('text-align: center'), '折叠态箭头居中');
});

test('侧边栏宽度与折叠态在 base.css（不依赖媒体查询，修复窗口 750px 时 desktop.css 断点不匹配问题）', () => {
  const base = read('css/base.css');
  // 展开态侧边栏宽度
  const sidebarRule = base.match(/\.app-sidebar \{[\s\S]*?\n\}/);
  assert.ok(sidebarRule, 'base.css 中存在 .app-sidebar 规则');
  assert.ok(sidebarRule[0].includes('width: var(--sidebar-w)'), '展开态宽度 var(--sidebar-w)（200px）');
  assert.ok(sidebarRule[0].includes('flex: 0 0 var(--sidebar-w)'), '展开态 flex 固定宽度');
  // 折叠态侧边栏宽度
  const collapsedRule = base.match(/\.app-sidebar\.collapsed \{[\s\S]*?\n\}/);
  assert.ok(collapsedRule, 'base.css 中存在 .app-sidebar.collapsed 规则');
  assert.ok(collapsedRule[0].includes('width: 60px'), '折叠态宽度 60px');
  assert.ok(collapsedRule[0].includes('flex: 0 0 60px'), '折叠态 flex 固定 60px');
  // desktop.css 中不应再重复定义宽度（避免冲突）
  const desktop = read('css/desktop.css');
  const desktopSidebar = desktop.match(/\.app-sidebar \{[\s\S]*?\n  \}/);
  if (desktopSidebar) {
    assert.ok(!desktopSidebar[0].includes('width: var(--sidebar-w)'), 'desktop.css 不再重复定义侧边栏宽度（已移到 base.css）');
  }
});
