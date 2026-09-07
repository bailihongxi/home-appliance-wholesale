const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const page = require('../js/ui/page-home.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const engine = require('../js/core/engine.js');

test('页面元数据与初始渲染', () => {
  assert.strictEqual(page.name, 'home');
  const ctx = newCtx();
  const html = page.render(ctx, page.init());
  assert.ok(html.includes('经营概览'));
  assert.ok(html.includes('快捷入口'));
});

test('首页含今日营收/毛利/预警统计', () => {
  const ctx = newCtx();
  const r = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  engine.savePurchase(ctx, {
    date: '2026-09-01', partnerName: '西安电器批发',
    items: [{ productId: r.product.id, qty: 5, costPrice: '1000' }], paid: '99999'
  });
  engine.saveSale(ctx, {
    date: require('../js/core/util.js').today(),
    items: [{ productId: r.product.id, qty: 1, price: '1399', priceType: 'retail', costSnapshot: 100000 }],
    payments: [{ method: 'cash', amount: '1399' }]
  });
  const html = page.render(ctx, page.init());
  assert.ok(html.includes('今日营收'));
  assert.ok(html.includes('今日单数'));
  assert.ok(html.includes('今日毛利'));
  assert.ok(html.includes('海尔'), '热销 TOP 含商品名');
});

test('备份提醒：从未备份时出现提示', () => {
  const ctx = newCtx();
  const html = page.render(ctx, page.init());
  assert.ok(html.includes('未备份'), '有备份提醒');
});

test('右上角图标已取消：手机版与桌面版首页均无铃铛/头像按钮', () => {
  const ctx = newCtx();
  const html = page.render(ctx, page.init());
  assert.ok(html.includes('page-banner'), 'banner 保留');
  assert.ok(!html.includes('banner-action'), '无 banner 铃铛按钮(手机版+桌面版)');
  assert.ok(!html.includes('🔔'), '无铃铛图标');
  // index.html 顶栏：铃铛 + 头像按钮已移除
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!indexHtml.includes('class="bell"'), '顶栏无铃铛按钮');
  assert.ok(!indexHtml.includes('top-avatar'), '顶栏无头像按钮');
  assert.ok(!indexHtml.includes('top-bell-dot'), '无铃铛红点元素');
  assert.ok(indexHtml.includes('top-shop-name'), '顶栏店名保留');
});
