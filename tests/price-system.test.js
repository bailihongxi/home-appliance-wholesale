/**
 * tests/price-system.test.js —— V3.5 价格体系：
 * 系统整体利润率（settings.wholesaleMargin / retailMargin）在系统设置中统一配置；
 * 只填成本时，批发价/零售价自动按 成本×(1+利润率) 生成并取整到元（不含小数）；
 * 用户自定义批发/零售价时保留自定义；一键应用系统价格可让全部商品价格统一重算。
 */
const test = require('node:test');
const assert = require('node:assert');
const productPage = require('../js/ui/page-product.js');
const settingPage = require('../js/ui/page-setting.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const schema = require('../js/core/schema.js');

function fresh() {
  const ctx = newCtx();
  const state = productPage.init(ctx);
  return { ctx, state };
}

test('默认设置含整体利润率：批发 20% / 零售 35%', () => {
  const st = schema.defaultSettings();
  assert.strictEqual(st.wholesaleMargin, 20, '默认批发利润率 20%');
  assert.strictEqual(st.retailMargin, 35, '默认零售利润率 35%');
});

test('autoPrices：按整体利润率生成批发/零售价，取整到元（不含小数）', () => {
  const ctx = newCtx(); // 默认利润率 20 / 35
  // 成本 1000 元 → 批发 1200、零售 1350（整元）
  let a = product.autoPrices(ctx, 100000);
  assert.strictEqual(a.priceWholesale, 120000, '批发价 1000×1.2=1200 元');
  assert.strictEqual(a.priceRetail, 135000, '零售价 1000×1.35=1350 元');
  // 成本 850 元 → 批发 1020；零售 1147.5 → 四舍五入取整到元 1148
  a = product.autoPrices(ctx, 85000);
  assert.strictEqual(a.priceWholesale, 102000, '批发价 850×1.2=1020 元');
  assert.strictEqual(a.priceRetail, 114800, '零售价 850×1.35=1147.5 取整为 1148 元（不含小数）');
  // 成本为 0 / 未填 → 价格为 0（不自动生成负价或空价）
  a = product.autoPrices(ctx, 0);
  assert.strictEqual(a.priceWholesale, 0);
  assert.strictEqual(a.priceRetail, 0);
});

test('autoPrices：跟随系统设置的整体利润率', () => {
  const ctx = newCtx();
  ctx.settings.wholesaleMargin = 30;
  ctx.settings.retailMargin = 50;
  const a = product.autoPrices(ctx, 100000);
  assert.strictEqual(a.priceWholesale, 130000, '批发价按 30% 利润率 = 1300 元');
  assert.strictEqual(a.priceRetail, 150000, '零售价按 50% 利润率 = 1500 元');
});

test('save：只填成本、批发/零售留空 → 自动按利润率生成（取整到元）', () => {
  const ctx = newCtx();
  const res = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000'
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.autoPriced, true, '标记为自动定价');
  assert.strictEqual(res.product.priceWholesale, 120000, '批发价自动生成 1200 元');
  assert.strictEqual(res.product.priceRetail, 135000, '零售价自动生成 1350 元');
});

test('save：用户自定义批发/零售价 → 保留自定义，不覆盖', () => {
  const ctx = newCtx();
  const res = product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2250', priceRetail: '2699'
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.autoPriced, false, '未自动定价');
  assert.strictEqual(res.product.priceWholesale, 225000, '保留自定义批发价 2250 元');
  assert.strictEqual(res.product.priceRetail, 269900, '保留自定义零售价 2699 元');
});

test('save：仅零售价留空 → 批发保留自定义、零售自动生成', () => {
  const ctx = newCtx();
  const res = product.save(ctx, {
    brand: '美的', model: 'MG80', category: '洗衣机', unit: '台',
    cost: '1200', priceWholesale: '1450'
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.autoPriced, true, '有字段自动定价');
  assert.strictEqual(res.product.priceWholesale, 145000, '自定义批发价保留');
  assert.strictEqual(res.product.priceRetail, 162000, '零售价按 1200×1.35=1620 自动生成');
});

test('价格体系位于 我的→设置 页面：含利润率设置与一键应用按钮', () => {
  const ctx = newCtx();
  const state = settingPage.init(ctx);
  const html = settingPage.render(ctx, state);
  assert.ok(html.includes('价格体系（整体利润率）'), '设置页含价格体系卡片');
  assert.ok(html.includes('批发利润率（%）'), '批发利润率输入');
  assert.ok(html.includes('零售利润率（%）'), '零售利润率输入');
  assert.ok(html.includes('save-price-sys'), '保存利润率按钮');
  assert.ok(html.includes('apply-price-sys'), '一键应用系统价格按钮');
  assert.ok(html.includes('取整到元'), '提示取整到元');
});

test('价格体系已从商品档案页移除：不再含价格体系按钮/页面', () => {
  const { ctx, state } = fresh();
  const html = productPage.render(ctx, state);
  assert.ok(!html.includes('open-price-sys'), '商品档案列表页无价格体系按钮');
  assert.ok(!html.includes('价格体系'), '商品档案页不含价格体系页面');
  state.tab = 'price';
  const html2 = productPage.render(ctx, state);
  assert.ok(!html2.includes('批发利润率'), 'price tab 已不存在（回退列表）');
});

test('一键应用系统价格：全部商品批发/零售统一按利润率重算并取整到元', () => {
  const ctx = newCtx();
  const state = settingPage.init(ctx);
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399' // 自定义将被统一重算
  });
  product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
  settingPage.actions['apply-price-sys'](ctx, state);
  const list = ctx.data.products;
  assert.strictEqual(list.length, 2);
  const p1 = list.find(p => p.brand === '海尔');
  const p2 = list.find(p => p.brand === '格力');
  // 默认利润率 20/35：1000→1200/1350；1800→2160/2430（全部整元）
  assert.strictEqual(p1.priceWholesale, 120000, '商品1 批发 1200 元');
  assert.strictEqual(p1.priceRetail, 135000, '商品1 零售 1350 元');
  assert.strictEqual(p2.priceWholesale, 216000, '商品2 批发 2160 元');
  assert.strictEqual(p2.priceRetail, 243000, '商品2 零售 2430 元');
});

test('一键应用系统价格：跟随最新利润率设置', () => {
  const ctx = newCtx();
  const state = settingPage.init(ctx);
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  // 设置新的整体利润率后一键应用
  ctx.settings.wholesaleMargin = 25;
  ctx.settings.retailMargin = 40;
  settingPage.actions['apply-price-sys'](ctx, state);
  const p = ctx.data.products[0];
  assert.strictEqual(p.priceWholesale, 125000, '批发 1000×1.25=1250 元');
  assert.strictEqual(p.priceRetail, 140000, '零售 1000×1.4=1400 元');
});

test('设置页-保存利润率：写入系统设置并返回成功', () => {
  const ctx = newCtx();
  const state = settingPage.init(ctx);
  state.priceForm.wholesaleMargin = '30';
  state.priceForm.retailMargin = '45';
  const r = settingPage.actions['save-price-sys'](ctx, state);
  assert.strictEqual(r, true, '保存成功');
  assert.strictEqual(ctx.settings.wholesaleMargin, 30);
  assert.strictEqual(ctx.settings.retailMargin, 45);
});

/* ---------------- 问题2：新建/导入只填成本，批发/零售自动生成 ---------------- */

test('问题2-新建表单：成本联动字段 + 批发/零售「自动」提示（无需手动填价格）', () => {
  const { ctx, state } = fresh();
  productPage.actions['open-new'](ctx, state);
  const html = productPage.render(ctx, state);
  assert.ok(html.includes('data-input="cost-field"'), '成本输入走 cost-field 联动');
  assert.ok(html.includes('批发价（元）<span class="muted">（自动）</span>'), '批发价标「自动」');
  assert.ok(html.includes('零售价（元）<span class="muted">（自动）</span>'), '零售价标「自动」');
  assert.ok(html.includes('留空按利润率自动'), '批发/零售 placeholder 提示自动');
  assert.ok(html.includes('只填成本，批发/零售按整体利润率自动生成'), '成本提示文案');
});

test('问题2-cost-field 联动：填成本自动填充批发/零售（按整体利润率，取整到元）', () => {
  const { ctx, state } = fresh();
  productPage.actions['open-new'](ctx, state);
  productPage.actions['cost-field'](ctx, state, { value: '1000' });
  assert.strictEqual(state.form.cost, '1000');
  assert.strictEqual(state.form.priceWholesale, 1200, '批发自动填 1000×1.2=1200');
  assert.strictEqual(state.form.priceRetail, 1350, '零售自动填 1000×1.35=1350');
  // 改成本再联动
  productPage.actions['cost-field'](ctx, state, { value: '1800' });
  assert.strictEqual(state.form.priceWholesale, 2160, '批发 1800×1.2=2160');
  assert.strictEqual(state.form.priceRetail, 2430, '零售 1800×1.35=2430');
});

test('问题2-用户手动修改批发/零售后，成本联动不再覆盖', () => {
  const { ctx, state } = fresh();
  productPage.actions['open-new'](ctx, state);
  productPage.actions['cost-field'](ctx, state, { value: '1000' });
  assert.strictEqual(state.form.priceWholesale, 1200);
  // 用户手动改批发价为自定义值
  state._priceTouchedW = true;
  productPage.actions['field'](ctx, state, { getAttribute: () => 'priceWholesale', value: '1555' });
  productPage.actions['cost-field'](ctx, state, { value: '2000' });
  assert.strictEqual(state.form.priceWholesale, '1555', '自定义批发价保留');
  assert.strictEqual(state.form.priceRetail, 2700, '零售仍自动 2000×1.35=2700');
});

test('问题2-导入模板只体现成本：不含批发价/零售价列', () => {
  let downloaded = null;
  const oldApp = globalThis.ERP && globalThis.ERP.app;
  if (globalThis.ERP && globalThis.ERP.app) {
    globalThis.ERP.app.download = (name, csv) => { downloaded = csv; };
  }
  const { ctx, state } = fresh();
  // mock app.download 以便捕获
  productPage.render(ctx, state); // 确保 page 模块就绪
  const orig = globalThis.ERP.app;
  globalThis.ERP.app = { download: (n, c) => { downloaded = c; } };
  try {
    productPage.actions['download-template'](ctx, state);
  } finally {
    globalThis.ERP.app = orig;
  }
  assert.ok(downloaded, '模板已生成');
  assert.ok(downloaded.includes('品牌,型号,类型,单位,成本'), '表头含成本列');
  assert.ok(!downloaded.includes('批发价'), '模板不含批发价列');
  assert.ok(!downloaded.includes('零售价'), '模板不含零售价列');
});

test('问题2-导入仅含成本的 CSV：批发/零售自动按利润率生成（取整到元）', () => {
  const ctx = newCtx();
  const rows = [
    ['品牌', '型号', '类型', '单位', '成本'],
    ['海尔', 'BCD-200', '冰箱', '台', '1000'],
    ['格力', 'KFR-35', '空调', '台', '1800']
  ];
  const res = product.importFromRows(rows, ctx);
  assert.strictEqual(res.created, 2, '导入 2 款');
  assert.strictEqual(res.errors.length, 0, '无错误');
  const p1 = ctx.data.products.find(p => p.brand === '海尔');
  const p2 = ctx.data.products.find(p => p.brand === '格力');
  assert.strictEqual(p1.priceWholesale, 120000, '批发自动 1200 元');
  assert.strictEqual(p1.priceRetail, 135000, '零售自动 1350 元');
  assert.strictEqual(p2.priceWholesale, 216000, '批发自动 2160 元');
  assert.strictEqual(p2.priceRetail, 243000, '零售自动 2430 元');
});
