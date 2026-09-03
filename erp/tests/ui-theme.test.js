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
  assert.ok(desktop.includes('width: 30px') && desktop.includes('height: 30px'), '折叠按钮适当放大（30px）');
  assert.ok(desktop.includes('.app-sidebar .side-toggle:hover { background: #b91c1c'), 'hover 红色加深');
});
