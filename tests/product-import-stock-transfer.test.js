/**
 * tests/product-import-stock-transfer.test.js —— V3.25 合并时库存转移（留痕）
 * 规则4 合并保留：保留一个商品用导入信息全量更新，其余置为停售；
 * V3.25 新增：其余商品名下的库存通过盘点调整单转入保留商品，避免库存“消失”在停售商品上。
 * 全程不删除任何商品/单据/库存流水，库存总数守恒。
 */
const test = require('node:test');
const assert = require('node:assert');
const product = require('../js/core/product.js');
const schema = require('../js/core/schema.js');
const productPage = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');

const HDR = ['品牌', '型号', '类型', '单位', '成本'];

function stockOf(ctx, brand, model) {
  const p = ctx.data.products.find(x => x.brand === brand && x.model === model);
  return p ? (p.stock || 0) : null;
}

test('合并-库存转入保留商品：停售商品归零，保留商品累加', () => {
  const ctx = newCtx();
  const kai = product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  ctx.data.products.find(p => String(p.id) === String(kai.product.id)).stock = 3;
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });

  const res = product.importFromRows([HDR, ['创维', '86Q8E', '电视', '台', '8190']], ctx);

  assert.strictEqual(res.merged, 1, '酷开被合并停售');
  assert.strictEqual(res.transferred, 3, '转入 3 件库存');
  assert.strictEqual(stockOf(ctx, '创维', '86Q8E'), 3, '保留商品库存变为 3');
  assert.strictEqual(stockOf(ctx, '酷开', '86Q8E'), 0, '停售商品库存归零');
  const kaiRec = ctx.data.products.find(p => p.brand === '酷开');
  assert.strictEqual(kaiRec.status, schema.STATUS.OFF, '酷开已停售');
});

test('合并-库存转移生成盘点调整单（可追溯）', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  ctx.data.products.find(p => String(p.id) === String(a.product.id)).stock = 2;
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  const before = (ctx.data.stocktakes || []).length;

  product.importFromRows([HDR, ['创维', '86Q8E', '电视', '台', '8190']], ctx);

  const after = (ctx.data.stocktakes || []).length;
  assert.strictEqual(after, before + 1, '生成 1 张盘点调整单');
  const doc = ctx.data.stocktakes[after - 1];
  assert.ok(doc.note.indexOf('批量导入合并同型号商品') >= 0, '单据备注说明原因');
  assert.ok(doc.items.some(it => it.diff > 0), '含一条入库差异');
  assert.ok(doc.items.some(it => it.diff < 0), '含一条出库差异');
});

test('合并-库存总数守恒：转移前后总库存不变', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  const b = product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  ctx.data.products.find(p => String(p.id) === String(a.product.id)).stock = 4;
  ctx.data.products.find(p => String(p.id) === String(b.product.id)).stock = 1;
  const before = ctx.data.products.reduce((t, p) => t + (p.stock || 0), 0);

  product.importFromRows([HDR, ['创维', '86Q8E', '电视', '台', '8190']], ctx);

  const after = ctx.data.products.reduce((t, p) => t + (p.stock || 0), 0);
  assert.strictEqual(after, before, '总库存不变');
  assert.strictEqual(stockOf(ctx, '创维', '86Q8E'), 5, '1 + 4 全部归入保留商品');
});

test('合并-无库存时不生成盘点单，也不报错', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  const before = (ctx.data.stocktakes || []).length;

  const res = product.importFromRows([HDR, ['创维', '86Q8E', '电视', '台', '8190']], ctx);

  assert.strictEqual(res.merged, 1, '仍然合并停售');
  assert.strictEqual(res.transferred, 0, '无库存可转');
  assert.strictEqual(res.errors.length, 0, '无报错');
  assert.strictEqual((ctx.data.stocktakes || []).length, before, '不生成多余盘点单');
});

test('合并-商品与历史数据均未被删除', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  ctx.data.products.find(p => String(p.id) === String(a.product.id)).stock = 3;
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  const n0 = ctx.data.products.length;

  product.importFromRows([HDR, ['创维', '86Q8E', '电视', '台', '8190']], ctx);

  assert.strictEqual(ctx.data.products.length, n0, '商品数量不变，未删除任何商品');
  const kai = ctx.data.products.find(p => p.brand === '酷开');
  assert.ok(kai, '被合并的商品仍在档案中');
  assert.strictEqual(kai.cost, 500000, '其成本等历史字段原样保留');
});

test('UI-预演报告提示将转移的库存数量', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  ctx.data.products.find(p => String(p.id) === String(a.product.id)).stock = 3;
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型,单位,成本\n创维,86Q8E,电视,台,8190';

  productPage.actions['do-preview'](ctx, state);
  const h = productPage.render(ctx, state);
  assert.ok(h.indexOf('件库存将转入保留商品') >= 0, '预演提示将转移库存');
  assert.ok(h.indexOf('<b>3</b> 件库存将转入') >= 0, '提示具体数量 3 件');
});

test('UI-导入结果提示已转移库存并生成盘点单', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  ctx.data.products.find(p => String(p.id) === String(a.product.id)).stock = 3;
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型,单位,成本\n创维,86Q8E,电视,台,8190';

  productPage.actions['do-import'](ctx, state);
  const h = productPage.render(ctx, state);
  assert.ok(h.indexOf('件库存已转入保留商品') >= 0, '结果提示已转移库存');
  assert.ok(h.indexOf('盘点调整单') >= 0, '提示生成盘点调整单可追溯');
});
