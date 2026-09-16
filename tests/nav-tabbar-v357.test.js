/**
 * tests/nav-tabbar-v357.test.js —— V3.57 手机端底部导航：库存 → 商品
 *
 * 用户需求：手机主页面底部由「首页 / 库存 / 我的」改为「首页 / 商品 / 我的」，
 * 第二项由 inventory（库存管理）更换为指向商品档案页 product（图标 📦）。
 *
 * 覆盖：
 * 1) navItems() 真实返回值：三项、顺序 / 文字 / 图标均正确（非源码字符串断言，直接调真实导出）
 * 2) 第二项指向 product，且底部已不含 inventory
 * 3) product 页确实存在且可渲染 —— 防止底部指向不存在/空白的路由
 * 4) inventory 页并未被删除，只是移出底部（电脑端侧栏与「首页 / 我的」入口仍可进）
 * 5) 非底部页打开时底部高亮兜底到「我的」（既有逻辑不被本次改动破坏）
 * 6) 电脑端侧栏 desktopNavOrder 不受影响（仍含 inventory 与 product）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

require('../js/app.js'); // 挂 globalThis.ERP.app（UMD 风格，node 下可安全 require）
const app = globalThis.ERP.app;
const productPage = require('../js/ui/page-product.js');
const inventoryPage = require('../js/ui/page-inventory.js');
const { newCtx } = require('./helpers/ctx.js');

const ROOT = path.join(__dirname, '..');

test('V3.57-底部导航：恰好三项，依次为 首页 / 商品 / 我的', () => {
  const items = app.navItems();
  assert.strictEqual(items.length, 3, '手机底部导航应保持 3 项');
  assert.deepStrictEqual(
    items.map(function (i) { return i.text; }),
    ['首页', '商品', '我的'],
    '显示文字应为 首页 / 商品 / 我的'
  );
  assert.deepStrictEqual(
    items.map(function (i) { return i.name; }),
    ['home', 'product', 'mine'],
    '路由顺序应为 home / product / mine'
  );
});

test('V3.57-第二项：文字「商品」+ 图标 📦 + 指向商品档案页 product，不再是库存', () => {
  const second = app.navItems()[1];
  assert.strictEqual(second.text, '商品', '第二项文字为「商品」');
  assert.strictEqual(second.name, 'product', '第二项路由指向商品档案页 product');
  assert.strictEqual(second.icon, '📦', '图标沿用商品档案页原图标 📦');
  assert.ok(
    !app.navItems().some(function (i) { return i.name === 'inventory'; }),
    '底部已不再包含 inventory（原「库存」入口）'
  );
});

test('V3.57-底部「商品」指向的 product 页存在且能正常渲染（点进去不会空白）', () => {
  assert.strictEqual(productPage.name, 'product', 'product 页路由名正确');
  assert.strictEqual(productPage.title, '商品档案', 'product 页标题为「商品档案」');
  const html = productPage.render(newCtx(), productPage.init());
  assert.ok(html && html.length > 200, '商品档案页能渲染出内容');
  assert.ok(html.includes('商品档案'), '渲染内容含「商品档案」');
});

test('V3.57-库存管理页并未删除，仅移出底部（电脑端侧栏 / 首页 / 我的仍可进入）', () => {
  assert.strictEqual(inventoryPage.name, 'inventory', 'inventory 页仍然存在');
  // 电脑端侧栏导航顺序不受影响，库存与商品档案都在其中
  const order = app.desktopNavOrder();
  assert.ok(order.includes('inventory'), '电脑端侧栏仍含 inventory');
  assert.ok(order.includes('product'), '电脑端侧栏仍含 product');
  const html = inventoryPage.render(newCtx(), inventoryPage.init());
  assert.ok(html && html.length > 200, '库存管理页仍能正常渲染');
});

test('V3.57-打开非底部页（如库存管理）时，底部高亮兜底到「我的」（既有逻辑不变）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(
    src.includes("var active = inPrimary ? page.name : 'mine';"),
    '不在底部三项内的页面应兜底高亮「我的」'
  );
  assert.ok(
    src.includes("navItems().some(function (n) {"),
    'renderNav 仍依据 navItems() 判定当前页是否属于底部三项'
  );
});

test('V3.57-底部导航与电脑端侧栏解耦：底部改动不影响 desktopNavOrder 顺序', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const m = src.match(/\['home', 'purchase'[\s\S]*?\]/);
  assert.ok(m, '源码中应保留 desktopNavOrder 的完整12项顺序');
  const order = m[0];
  for (const name of ['home', 'purchase', 'sale', 'product', 'inventory', 'account',
    'report', 'exchange', 'supplier', 'customer', 'mine', 'admin']) {
    assert.ok(order.includes("'" + name + "'"), '侧栏顺序仍包含 ' + name);
  }
});
