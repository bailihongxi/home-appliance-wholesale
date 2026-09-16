/**
 * tests/product-import-preview.test.js —— V3.25 批量导入「预演体检」
 * 规则：previewImport 只计算不写库；报告包含
 *   将新增 creates / 将更新 updates（含新旧值对比）/ 文件内去重 deduplicated /
 *   将合并停售 merges / 未被本次导入覆盖 uncovered / 无法导入 errors。
 * UI：点「预演体检」出报告（商品数不变），点「确认执行导入」才真正写入。
 */
const test = require('node:test');
const assert = require('node:assert');
const product = require('../js/core/product.js');
const productPage = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');

const HDR = ['品牌', '型号', '类型', '单位', '成本'];

test('预演-不写库：生成报告后系统商品数量与内容均不变', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  const before = JSON.stringify(ctx.data.products);

  const plan = product.previewImport([
    HDR,
    ['美的', 'BCD-300', '冰箱', '台', '2200'],
    ['美的', 'BCD-200', '冰箱', '台', '1200']
  ], ctx);

  assert.strictEqual(plan.creates.length, 1, '预演出 1 个新增');
  assert.strictEqual(plan.updates.length, 1, '预演出 1 个更新');
  assert.strictEqual(JSON.stringify(ctx.data.products), before, '预演未修改任何商品档案');
});

test('预演-新增清单：包含型号与按利润率自动算出的批发价/零售价', () => {
  const ctx = newCtx();
  const plan = product.previewImport([
    HDR,
    ['格力', 'KFR-35', '空调', '台', '1800']
  ], ctx);
  assert.strictEqual(plan.creates.length, 1);
  const c = plan.creates[0];
  assert.strictEqual(c.model, 'KFR-35');
  assert.strictEqual(c.rowNo, 2, '记录文件行号');
  assert.strictEqual(c.cost, 180000, '成本 1800 元 → 180000 分');
  assert.strictEqual(c.priceWholesale, 216000, '默认批发利润率 20% → 2160 元');
  assert.strictEqual(c.priceRetail, 243000, '默认零售利润率 35% → 2430 元');
});

test('预演-更新清单：列出品牌/成本/价格的新旧值对比', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  const plan = product.previewImport([
    HDR,
    ['美的', 'BCD-200', '冰箱', '台', '1200']
  ], ctx);
  assert.strictEqual(plan.updates.length, 1);
  const u = plan.updates[0];
  const map = {};
  u.changes.forEach(c => { map[c.label] = c; });
  assert.ok(map['品牌'], '列出品牌变更');
  assert.strictEqual(map['品牌'].from, '海尔');
  assert.strictEqual(map['品牌'].to, '美的');
  assert.ok(map['成本'], '列出成本变更');
  assert.strictEqual(map['成本'].from, '1000');
  assert.strictEqual(map['成本'].to, '1200');
  assert.ok(map['批发价'], '列出批发价变更');
});

test('预演-更新清单：无变化的商品变更明细为空数组', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  const plan = product.previewImport([
    HDR,
    ['海尔', 'BCD-200', '冰箱', '台', '1000']
  ], ctx);
  assert.strictEqual(plan.updates.length, 1, '仍计入更新');
  assert.strictEqual(plan.updates[0].changes.length, 0, '内容一致，无变更明细');
});

test('预演-合并清单：列出将被停售的同型号商品及其库存', () => {
  const ctx = newCtx();
  const other = product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  ctx.data.products.find(p => String(p.id) === String(other.product.id)).stock = 3;
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });

  const plan = product.previewImport([HDR, ['创维', '86Q8E', '电视', '台', '8190']], ctx);
  assert.strictEqual(plan.merges.length, 1, '预演出 1 个将被合并的商品');
  assert.strictEqual(plan.merges[0].brand, '酷开');
  assert.strictEqual(plan.merges[0].stock, 3, '报告其现有库存');
  assert.strictEqual(plan.updates[0].keepBrand, '创维', '保留品牌与导入一致的商品');
});

test('预演-未覆盖清单：系统中有、导入文件中没有的商品被列出', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  product.save(ctx, { brand: '松下', model: 'NR-C31', category: '冰箱', unit: '台', cost: '3000' });

  const plan = product.previewImport([HDR, ['美的', 'BCD-200', '冰箱', '台', '1200']], ctx);
  assert.strictEqual(plan.uncovered.length, 1, '松下 NR-C31 未被覆盖');
  assert.strictEqual(plan.uncovered[0].model, 'NR-C31');
  assert.strictEqual(plan.uncovered[0].brand, '松下');
});

test('预演-未覆盖清单：型号大小写/空格不同仍视为已覆盖', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  // 规范化规则：去空白 + 转大写（连字符保留），'BCD- 200' 与 'BCD-200' 视为同一型号
  const plan = product.previewImport([HDR, ['美的', 'bcd- 200', '冰箱', '台', '1200']], ctx);
  assert.strictEqual(plan.uncovered.length, 0, '规范化后匹配成功，不算未覆盖');
  assert.strictEqual(plan.updates.length, 1);
});

test('预演-去重与错误行统计与正式导入一致', () => {
  const ctx = newCtx();
  const rows = [
    HDR,
    ['创维', '86Q8E', '电视', '台', '7000'],
    ['创维', '86Q8E', '电视', '台', '8190'],
    ['', 'NOBRAND', '电视', '台', '1000']
  ];
  const plan = product.previewImport(rows, ctx);
  assert.strictEqual(plan.total, 3, '读取 3 行');
  assert.strictEqual(plan.deduplicated, 1, '去重 1 行');
  assert.strictEqual(plan.errors.length, 1, '缺品牌 1 行报错');

  const res = product.importFromRows(rows, newCtx());
  assert.strictEqual(res.deduplicated, plan.deduplicated, '去重统计一致');
  assert.strictEqual(res.errors.length, plan.errors.length, '错误统计一致');
  assert.strictEqual(res.created, plan.creates.length, '新增数量一致');
});

test('预演-表头不可用时返回错误', () => {
  const ctx = newCtx();
  const plan = product.previewImport([['姓名', '年龄'], ['张三', '30']], ctx);
  assert.strictEqual(plan.errors.length, 1);
  assert.ok(plan.errors[0].msg.indexOf('表头') >= 0);
  assert.strictEqual(plan.creates.length, 0);
});

test('UI-预演体检生成报告且未写入，点确认才真正导入', () => {
  const ctx = newCtx();
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型,单位,成本\n海尔,BCD-200,冰箱,台,1000';

  productPage.actions['do-preview'](ctx, state);
  assert.ok(state.csvPlan, '生成体检报告');
  assert.strictEqual(ctx.data.products.length, 0, '预演阶段未写入任何商品');

  let h = productPage.render(ctx, state);
  assert.ok(h.indexOf('导入前体检报告') >= 0, '显示体检报告卡片');
  assert.ok(h.indexOf('尚未写入系统') >= 0, '提示尚未写入');
  assert.ok(h.indexOf('确认执行导入') >= 0, '提供确认执行按钮');
  assert.ok(h.indexOf('将新增 <b>1</b> 款') >= 0, '报告新增数量');

  productPage.actions['do-import'](ctx, state);
  assert.strictEqual(ctx.data.products.length, 1, '确认后才写入');
  assert.strictEqual(state.csvPlan, null, '执行后清除体检报告');

  h = productPage.render(ctx, state);
  assert.ok(h.indexOf('导入结果') >= 0, '改为显示导入结果');
});

test('UI-预演报告展示变更明细与未覆盖清单', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  product.save(ctx, { brand: '松下', model: 'NR-C31', category: '冰箱', unit: '台', cost: '3000' });
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型,单位,成本\n美的,BCD-200,冰箱,台,1200';

  productPage.actions['do-preview'](ctx, state);
  const h = productPage.render(ctx, state);
  assert.ok(h.indexOf('品牌：海尔 → 美的') >= 0, '展示品牌新旧值');
  assert.ok(h.indexOf('成本：1000 → 1200') >= 0, '展示成本新旧值');
  assert.ok(h.indexOf('本次导入覆盖不到') >= 0, '提示未覆盖商品');
  assert.ok(h.indexOf('NR-C31') >= 0, '列出未覆盖商品型号');

  productPage.actions['cancel-preview'](ctx, state);
  assert.strictEqual(state.csvPlan, null, '取消后清除报告');
  assert.strictEqual(ctx.data.products[0].brand, '海尔', '取消不改动任何数据');
});
