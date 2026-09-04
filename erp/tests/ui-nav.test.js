/**
 * tests/ui-nav.test.js —— 电脑端侧栏：可折叠（收起仅保留图标）+ 导航顺序重排 + 导航显示名
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

require('../js/app.js');
const app = globalThis.ERP && globalThis.ERP.app;
const product = require('../js/ui/page-product.js');

test('侧栏导航顺序：按用户指定（首页→进货→销售→档案→库存→记账→报表→退换→供应商→客户→我的→账户权限）', () => {
  const order = app.desktopNavOrder();
  assert.deepStrictEqual(order, [
    'home', 'purchase', 'sale', 'product', 'inventory',
    'account', 'report', 'exchange', 'supplier', 'customer', 'mine', 'admin'
  ]);
});

test('商品档案导航显示名 = 档案管理（navTitle）', () => {
  assert.strictEqual(product.navTitle, '档案管理');
});

test('折叠/展开 action 已注册（toggle-side）', () => {
  assert.ok(app.actions && typeof app.actions['toggle-side'] === 'function');
  assert.ok(typeof app.toggleSidebar === 'function');
  assert.ok(typeof app.applySidebarState === 'function');
});

test('侧栏折叠 CSS：收窄 + 隐藏文字 + 折叠按钮', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'desktop.css'), 'utf8');
  assert.ok(css.includes('.app-sidebar.collapsed { width: 60px'), '折叠后收窄至 60px');
  assert.ok(css.includes('.app-sidebar.collapsed .brand span { display: none; }'), '折叠后隐藏店名文字');
  assert.ok(css.includes('.app-sidebar.collapsed .nav-item span:not(.ico) { display: none; }'),
    '折叠后隐藏菜单文字仅留图标');
  assert.ok(css.includes('.app-sidebar .side-toggle'), '折叠按钮样式存在');
});

test('侧栏 HTML：折叠按钮挂载于侧栏内（data-act="toggle-side"）', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('class="side-toggle" data-act="toggle-side"'), '折叠按钮 data-act=toggle-side');
  assert.ok(html.includes('<nav class="nav-list"></nav>'), '导航列表容器存在');
});

test('手机端搜索模块：搜索框一行、筛选下拉换行第二行（改回多行样式）', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');
  assert.ok(css.includes('.search-bar { flex-wrap: wrap; }'), '搜索栏手机端允许换行');
  assert.ok(css.includes('.search-bar .select { flex: 1 1 100%; margin-top: 4px; }'),
    '筛选下拉在手机端换行到第二行（整行显示）');
  const base = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  assert.ok(base.includes('.search-bar { display: flex;'), 'search-bar 基础样式存在');
});

test('问题1-账户权限管理菜单仅管理总控可见（app.isAdmin）', () => {
  // 管理总控 → 可见
  globalThis.ERP.currentAccount = { id: 'admin', username: 'hawsystem', role: 'admin', shopName: '管理总控' };
  assert.strictEqual(app.isAdmin(), true, '管理总控可见账户权限管理菜单');
  // 管理总控新建的普通账户 → 不可见
  globalThis.ERP.currentAccount = { id: 'acct9', username: 'myshop', role: 'user', shopName: '我的电器行' };
  assert.strictEqual(app.isAdmin(), false, '普通账户无权限看到账户权限管理菜单');
  // 未登录 → 不可见
  globalThis.ERP.currentAccount = null;
  assert.strictEqual(app.isAdmin(), false, '未登录不可见');
  // 还原
  globalThis.ERP.currentAccount = null;
});
