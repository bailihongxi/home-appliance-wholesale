const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const salePage = require('../js/ui/page-sale.js');
const purchasePage = require('../js/ui/page-purchase.js');
const exchangePage = require('../js/ui/page-exchange.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const engine = require('../js/core/engine.js');

function seed(ctx) {
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '100000', priceWholesale: '120000', priceRetail: '139900'
  });
  product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '180000', priceWholesale: '220000', priceRetail: '259900'
  });
  // 给首款商品补库存，否则保存销售单会因「库存不足」被拒
  ctx.data.products[0].stock = 5;
  // 建一张销售单，供退换货选原单使用
  const sale = engine.saveSale(ctx, {
    date: '2026-09-01',
    items: [{ productId: ctx.data.products[0].id, qty: 1, price: '139900', priceType: 'retail', costSnapshot: 100000 }],
    payments: [{ method: 'cash', amount: '139900' }]
  });
  return sale.doc.no;
}

test('V3.52 销售开单选货区：双布局（桌面 .pick-desktop 表格 + 手机 .pick-mobile 卡片）', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = salePage.init();
  state.tab = 'new';
  const html = salePage.render(ctx, state);
  // 桌面端（≥600px）：V3.49 5 列横向表格
  assert.ok(html.includes('class="pick-desktop"'), '桌面端使用 pick-desktop 包装');
  assert.ok(html.includes('tbl tbl-striped'), '桌面端表格仍为 tbl-striped（V3.49 风格）');
  assert.ok(html.includes('<th>商品</th><th class="num">批发</th><th class="num">零售</th>'), '桌面端表头含 商品/批发/零售');
  // 手机端（≤599px）：V3.51 两行卡片
  assert.ok(html.includes('class="pick-mobile"'), '手机端使用 pick-mobile 包装');
  assert.ok(html.includes('class="pick-list"'), '手机端使用 pick-list 容器');
  assert.ok(html.includes('class="pick-item"'), '每个商品一个 pick-item 卡片');
  assert.ok(html.includes('class="pick-name"'), '第一行为品牌+型号');
  assert.ok(html.includes('class="pick-sub"'), '第二行存在');
  assert.ok(html.includes('批:'), '第二行含批发价');
  assert.ok(html.includes('零:'), '第二行含零售价');
});

test('V3.52 进货单按商品加行：双布局（桌面表格 + 手机卡片，第二行显示成本）', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = purchasePage.init();
  state.tab = 'form';
  const html = purchasePage.render(ctx, state);
  assert.ok(html.includes('class="pick-desktop"'), '进货选货区桌面端使用 pick-desktop');
  assert.ok(html.includes('tbl tbl-striped'), '进货桌面端表格 tbl-striped');
  assert.ok(html.includes('<th class="num">档案成本</th>'), '进货桌面端表头含档案成本');
  assert.ok(html.includes('class="pick-mobile"'), '进货选货区手机端使用 pick-mobile');
  assert.ok(html.includes('class="pick-list"'), '进货手机端 pick-list 容器');
  assert.ok(html.includes('class="pick-sub"'), '进货第二行存在');
  assert.ok(html.includes('成本:'), '进货第二行含档案成本');
});

test('V3.52 退换货换货选货区：双布局（桌面表格 + 手机卡片，批/零内联）', () => {
  const ctx = newCtx();
  const saleNo = seed(ctx);
  const state = exchangePage.init();
  state.tab = 'exchange';
  state.originalNo = saleNo;
  const html = exchangePage.render(ctx, state);
  assert.ok(html.includes('class="pick-desktop"'), '换货选货区桌面端使用 pick-desktop');
  assert.ok(html.includes('<th>商品</th>'), '换货桌面端表头含商品');
  assert.ok(html.includes('class="pick-mobile"'), '换货选货区手机端使用 pick-mobile');
  assert.ok(html.includes('class="pick-list"'), '换货手机端 pick-list 容器');
  assert.ok(html.includes('批:'), '换货第二行含批发价');
  assert.ok(html.includes('零:'), '换货第二行含零售价');
});

test('V3.53 进货单选货区：无论商品是否已在明细中，加入按钮始终显示「加入」，不再变为「＋再加」', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = purchasePage.init();
  state.tab = 'form';
  // 先把第一款商品加入进货明细，模拟「已加入过」的状态
  state.form.items.push({ productId: ctx.data.products[0].id, qty: 2, costPrice: '1000' });
  const html = purchasePage.render(ctx, state);
  // 电脑端表格按钮文本
  assert.ok(!html.includes('＋再加'), '桌面端选货按钮不应出现「＋再加」');
  assert.ok(!html.includes('+再加'), '桌面端选货按钮不应出现「+再加」');
  // 手机端卡片按钮文本（pick-mobile 在 pick-desktop 之后）
  const mobileMatch = html.match(/class="pick-desktop"[\s\S]*?class="pick-mobile"([\s\S]*?)ui-pager/);
  const mobileHtml = mobileMatch ? mobileMatch[1] : html;
  assert.ok(!mobileHtml.includes('＋再加'), '手机端选货按钮不应出现「＋再加」');
  assert.ok(!mobileHtml.includes('+再加'), '手机端选货按钮不应出现「+再加」');
  // 确认「加入」按钮数量正确（seed 建 2 款商品 × 桌面+手机双渲染 = 4）
  const joinCount = (html.match(/data-act="add-item"/g) || []).length;
  assert.strictEqual(joinCount, 4, '每条商品保留一个「加入」按钮（2 款商品 × 双布局）');
});

test('V3.50 CSS：定义 pick-list / pick-item / pick-sub 两行卡片样式', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  assert.ok(css.includes('.pick-list'), 'CSS 含 .pick-list');
  assert.ok(css.includes('.pick-item'), 'CSS 含 .pick-item');
  assert.ok(css.includes('.pick-sub'), 'CSS 含 .pick-sub');
  assert.ok(css.includes('.pick-stock'), 'CSS 含 .pick-stock');
});

test('V3.52 CSS：默认（桌面 ≥600px）显示 .pick-desktop 表格，隐藏 .pick-mobile', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  assert.ok(/\.pick-desktop\s*\{\s*display:\s*block/.test(css),
    'base.css 默认 .pick-desktop display: block');
  assert.ok(/\.pick-mobile\s*\{\s*display:\s*none/.test(css),
    'base.css 默认 .pick-mobile display: none');
});

test('V3.52 mobile.css：≤599px 反转显示 .pick-mobile 卡片，隐藏 .pick-desktop 表格', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');
  const mediaMatch = css.match(/@media\s*\(\s*max-width:\s*599px\s*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(mediaMatch, 'mobile.css 含 @media (max-width: 599px) 块');
  const inner = mediaMatch[0];
  assert.ok(/\.pick-desktop\s*\{\s*display:\s*none\s*!important/.test(inner),
    '手机端 .pick-desktop display: none !important');
  assert.ok(/\.pick-mobile\s*\{\s*display:\s*block\s*!important/.test(inner),
    '手机端 .pick-mobile display: block !important');
});

test('V3.51 手机端 CSS：选货区右侧库存前置 + 加入按钮竖排文字（更窄更高）', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');
  // 必须在 @media (max-width: 599px) 内部
  const mediaMatch = css.match(/@media\s*\(\s*max-width:\s*599px\s*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(mediaMatch, 'mobile.css 含 @media (max-width: 599px) 块');
  const inner = mediaMatch[0];
  // pick-side 在手机端改为 row + center（库存左，按钮右）+ gap
  assert.ok(/\.pick-side\s*\{[\s\S]*?flex-direction:\s*row[\s\S]*?\}/.test(inner),
    '手机端 .pick-side 改 flex-direction: row（库存左、按钮右）');
  // pick-stock order 0（前置），btn order 1（在后）
  assert.ok(/\.pick-side\s+\.pick-stock\s*\{\s*order:\s*0/.test(inner),
    '手机端 .pick-side .pick-stock order: 0（库存前置）');
  // 按钮宽度 ≈30px（基础 .btn-sm 默认宽约 44px，-30% ≈ 30px），高度 45px（30px + 50%）
  const btnRule = inner.match(/\.pick-side\s+\.btn\s*\{[\s\S]*?\}/);
  assert.ok(btnRule, '手机端 .pick-side .btn 规则存在');
  assert.ok(/width:\s*30px/.test(btnRule[0]), '加入按钮宽度 30px（收缩30%）');
  assert.ok(/height:\s*45px/.test(btnRule[0]), '加入按钮高度 45px（+50%）');
  // 「加入」两个汉字改竖排
  assert.ok(/writing-mode:\s*vertical-rl/.test(btnRule[0]), '加入按钮文字竖排（writing-mode: vertical-rl）');
  assert.ok(/text-orientation:\s*upright/.test(btnRule[0]), '加入按钮文字保持正立（text-orientation: upright）');
});
