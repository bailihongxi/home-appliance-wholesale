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

/* V3.54：修复「进货明细」宽表格把整页撑破 + 强制手机端不横向溢出 + 版本缓存校验 */
test('V3.54 CSS：purchase-form-grid 用 minmax(0,1fr) 且子卡片 min-width:0（防宽表格撑破页面）', () => {
  const base = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  const block = base.slice(base.indexOf('.purchase-form-grid {'));
  assert.ok(block.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)'),
    '桌面端 grid 轨道用 minmax(0,1fr)，允许收缩到可视宽度以内');
  assert.ok(/\.purchase-form-grid\s*>\s*\.card\s*\{[^}]*min-width:\s*0/.test(block),
    'purchase-form-grid 直接子卡片 min-width: 0');

  const mobile = fs.readFileSync(path.join(__dirname, '..', 'css', 'mobile.css'), 'utf8');
  const mb = mobile.slice(mobile.indexOf('.purchase-form-grid {'));
  assert.ok(mb.includes('grid-template-columns: minmax(0, 1fr)'),
    '手机端 purchase-form-grid 单列仍用 minmax(0,1fr)');

  // 手机端主区兜底：禁止横向溢出（clip 不产生滚动容器，不影响纵向滚动）
  assert.ok(/\.app-main\s*\{[^}]*overflow-x:\s*clip/.test(mobile),
    '手机端 .app-main overflow-x: clip 兜底，防止整页横向被撑破');
});

test('V3.54 CSS：.pick-name 允许长型号换行（overflow-wrap: anywhere），不撑破卡片', () => {
  const base = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  const rule = base.match(/\.pick-name\s*\{[^}]*\}/);
  assert.ok(rule, '.pick-name 规则存在');
  assert.ok(/overflow-wrap:\s*anywhere/.test(rule[0]), '.pick-name 含 overflow-wrap: anywhere');
});

/* ==================== V3.55 ====================
 * 需求①：只要出现商品列表的模块全部使用斑马纹（电脑端表格 + 手机端卡片统一）
 * 需求②：点「加入」后该行整行灰底（比斑马纹深）+ 加入按钮转蓝，
 *         用于区分「已加入当前明细」与「未加入」的行 */

/** 把 CSS 里的十六进制色转为相对明度（0=黑，1=白），用于比较两个颜色的深浅 */
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function readBaseCss() {
  return fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
}

function cssVar(base, name) {
  const m = base.match(new RegExp('--c-' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  return m ? m[1] : null;
}

test('V3.55 斑马纹统一：电脑端 table.tbl 与手机端 .pick-item 卡片共用同一支色 --c-stripe', () => {
  const base = readBaseCss();
  const stripe = cssVar(base, 'stripe');
  assert.ok(stripe, 'base.css 定义了 --c-stripe 变量');
  // 电脑端：所有 .tbl 表格（含 .tbl-striped）都有 nth-child(even) 斑马纹
  assert.ok(/table\.tbl tbody tr:nth-child\(even\) \{\s*background:\s*var\(--c-stripe\)/.test(base),
    '电脑端 table.tbl 斑马纹使用 var(--c-stripe)');
  // 手机端：选货卡片此前完全没有斑马纹，本版补齐
  const pickRule = base.match(/\.pick-item:nth-child\(even\)\s*\{[^}]*\}/);
  assert.ok(pickRule, 'base.css 新增 .pick-item:nth-child(even) 手机卡片斑马纹规则');
  assert.ok(pickRule[0].includes('var(--c-stripe)'),
    '手机卡片斑马纹同样使用 var(--c-stripe)，与电脑端颜色一致');
});

test('V3.55 已加入底色：--c-picked 必须比斑马纹 --c-stripe 更深（用户明确要求）', () => {
  const base = readBaseCss();
  const stripe = cssVar(base, 'stripe');
  const picked = cssVar(base, 'picked');
  assert.ok(stripe && picked, '--c-stripe / --c-picked 均已定义');
  assert.ok(lum(picked) < lum(stripe),
    '已加入底色（' + picked + '）应比斑马纹（' + stripe + '）更深一眼可辨');
  // 深得看得出来，但又不至于黑块：留 ±0.05~0.6 明度差的合理区间
  const gap = lum(stripe) - lum(picked);
  assert.ok(gap > 0.03, '两者明度差应 > 0.03，实际 ' + gap.toFixed(3));
});

test('V3.55 已加入行样式：电脑端 tr.picked（含 td）与手机端 .pick-item.picked 都铺灰底', () => {
  const base = readBaseCss();
  const trRule = base.match(/table\.tbl tbody tr\.picked,\s*table\.tbl tbody tr\.picked td\s*\{[^}]*\}/);
  assert.ok(trRule, '电脑端 tr.picked 整行（含单元格）灰底规则存在');
  assert.ok(trRule[0].includes('var(--c-picked)'), '电脑端已加入行使用 --c-picked');
  assert.ok(trRule[0].includes('!important'),
    '必须 !important 才能压过 nth-child(even) 斑马纹（同特异性靠后者胜出不稳）');
  const itemRule = base.match(/\.pick-item\.picked\s*\{[^}]*\}/);
  assert.ok(itemRule, '手机端 .pick-item.picked 灰底规则存在');
  assert.ok(itemRule[0].includes('var(--c-picked)'), '手机端已加入卡片使用 --c-picked');
});

/** 把整份页面 HTML 切成「桌面段」与「手机段」，分别断言排版不受彼此影响 */
function splitLayouts(html) {
  const i = html.indexOf('class="pick-mobile"');
  return {
    desktop: i > -1 ? html.slice(0, i) : html,
    mobile: i > -1 ? html.slice(i) : html
  };
}

test('V3.55 销售开单：已加入当前订单的商品，桌面行 tr.picked + 手机卡片 picked，按钮 btn-added', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = salePage.init();
  state.tab = 'new';
  // 未加入时：不应出现任何 picked / btn-added
  let html = salePage.render(ctx, state);
  assert.ok(!html.includes('pick-item picked'), '未加入时手机卡片不应有 picked 类');
  assert.ok(!html.includes('btn-added'), '未加入时按钮不应是 btn-added');
  assert.ok(html.includes('btn btn-sm btn-orange" data-act="pick-product"'),
    '未加入时按钮仍为橘色 btn-orange');

  // 加入第一款商品后重新渲染
  state.form.items.push({
    productId: ctx.data.products[0].id, brand: '海尔', model: 'BCD-200', unit: '台',
    qty: 1, priceType: 'retail'
  });
  html = salePage.render(ctx, state);
  const parts = splitLayouts(html);
  assert.ok(parts.desktop.includes('<tr class="picked">'), '桌面端已加入行带 class="picked"');
  assert.ok(parts.mobile.includes('pick-item picked'), '手机端已加入卡片带 picked 类');
  // 按钮：只统计「加入」按钮总数不变，但已有 1 个变蓝（2 款商品 × 双布局 = 4 个，其中 2 个变蓝）
  const added = (html.match(/btn btn-sm btn-added" data-act="pick-product"/g) || []).length;
  const orange = (html.match(/btn btn-sm btn-orange" data-act="pick-product"/g) || []).length;
  assert.strictEqual(added, 2, '已加入商品在桌面+手机两处都会变蓝按钮');
  assert.strictEqual(orange, 2, '未加入商品保持橘色按钮');
  assert.ok(!html.includes('＋再加'), '按钮文案仍固定为「加入」，不再变「＋再加」');
});

test('V3.55 进货单按商品加行：已加入进货明细的商品同样灰底 + 蓝钮，桌面手机一致', () => {
  const ctx = newCtx();
  seed(ctx);
  const state = purchasePage.init();
  state.tab = 'form';
  const html = purchasePage.render(ctx, state);
  const parts = splitLayouts(html);
  // 只加第一款：另外 1 款保持原样
  state.form.items.push({ productId: ctx.data.products[0].id, qty: 1, costPrice: '1000' });
  const html2 = purchasePage.render(ctx, state);
  const p2 = splitLayouts(html2);
  assert.ok(!html.includes('<tr class="picked">'), '未加入前桌面行无 picked');
  assert.ok(p2.desktop.includes('<tr class="picked">'), '进货桌面端已加入行灰底');
  assert.ok(p2.mobile.includes('pick-item picked'), '进货手机端已加入卡片灰底');
  const added = (html2.match(/btn btn-sm btn-added" data-act="add-item"/g) || []).length;
  assert.strictEqual(added, 2, '已加入商品桌面+手机两处按钮均转蓝');
  assert.ok(!parts.mobile.includes('btn-added'), '渲染前手机段不含已加入态');
});

test('V3.55 退换货换货选货区：已加入换新商品的商品同样灰底 + 蓝钮，桌面手机一致', () => {
  const ctx = newCtx();
  const saleNo = seed(ctx);
  const state = exchangePage.init();
  state.tab = 'exchange';
  state.originalNo = saleNo;
  const html = exchangePage.render(ctx, state);
  assert.ok(!html.includes('pick-item picked'), '未加入前无 picked 行');
  // 加入第一款商品到换新列表
  state.replItems.push({ productId: ctx.data.products[0].id, qty: 1, price: 100000 });
  const html2 = exchangePage.render(ctx, state);
  const p2 = splitLayouts(html2);
  assert.ok(p2.desktop.includes('<tr class="picked">'), '换货桌面端已加入行灰底');
  assert.ok(p2.mobile.includes('pick-item picked'), '换货手机端已加入卡片灰底');
  const added = (html2.match(/btn btn-sm btn-added" data-act="repl-add"/g) || []).length;
  assert.ok(added >= 2, '换货已加入商品桌面+手机两处按钮均转蓝（实际 ' + added + '）');
});

test('V3.54 sw.js：network-first 追加 cache:"no-cache" 强制重新校验，避免部署后仍拿旧 JS/CSS', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  // 导航请求与静态资源两条 fetch 分支都应带 no-cache
  const hits = (sw.match(/fetch\(req,\s*\{\s*cache:\s*'no-cache'\s*\}\)/g) || []).length;
  assert.ok(hits >= 2, '导航与静态资源两处 fetch 均使用 cache: no-cache（实际 ' + hits + ' 处）');
  assert.ok(!/fetch\(req\)\.then/.test(sw), '不再存在旧的 fetch(req) 无 cache 选项写法');
});
