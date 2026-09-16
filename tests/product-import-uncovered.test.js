/**
 * tests/product-import-uncovered.test.js —— V3.25 批量导入「未被覆盖清单」
 * 系统中存在、但本次导入文件里没有的商品（型号对不上或已淘汰），任何导入规则都处理不到，
 * 导入后它们仍在售。V3.25 在导入结果中列出，供用户手动核对（不做任何自动改动）。
 */
const test = require('node:test');
const assert = require('node:assert');
const product = require('../js/core/product.js');
const productPage = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');

const HDR = ['品牌', '型号', '类型', '单位', '成本'];

test('未覆盖清单：系统中有、导入文件中没有的商品被列出', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  product.save(ctx, { brand: '松下', model: 'NR-C31', category: '冰箱', unit: '台', cost: '3000' });
  ctx.data.products.find(p => p.model === 'NR-C31').stock = 5;

  const res = product.importFromRows([HDR, ['美的', 'BCD-200', '冰箱', '台', '1200']], ctx);
  assert.strictEqual(res.updated, 1, 'BCD-200 被更新');
  assert.strictEqual(res.uncovered.length, 1, '松下 NR-C31 未被覆盖');
  assert.strictEqual(res.uncovered[0].brand, '松下');
  assert.strictEqual(res.uncovered[0].model, 'NR-C31');
  assert.strictEqual(res.uncovered[0].stock, 5, '列出其现有库存，便于判断是否有货');
});

test('未覆盖清单：被导入更新或被合并停售的商品不算未覆盖', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  assert.ok(a.ok);

  const res = product.importFromRows([
    HDR,
    ['创维', '86Q8E', '电视', '台', '8190'],
    ['美的', 'BCD-200', '冰箱', '台', '1200']
  ], ctx);
  assert.strictEqual(res.updated, 2, '两行都被更新');
  assert.strictEqual(res.merged, 1, '酷开 86Q8E 被合并停售');
  assert.strictEqual(res.uncovered.length, 0, '所有商品都被本次导入覆盖到');
});

test('未覆盖清单：型号规范化后匹配成功的不算未覆盖', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  const res = product.importFromRows([HDR, ['美的', 'bcd- 200', '冰箱', '台', '1200']], ctx);
  assert.strictEqual(res.updated, 1, '规范化后命中并更新');
  assert.strictEqual(res.uncovered.length, 0);
});

test('未覆盖清单：空系统首次导入时为空', () => {
  const ctx = newCtx();
  const res = product.importFromRows([HDR, ['格力', 'KFR-35', '空调', '台', '1800']], ctx);
  assert.strictEqual(res.created, 1);
  assert.strictEqual(res.uncovered.length, 0, '新建的商品不属于未覆盖');
});

test('未覆盖清单：文件内缺必填导致无法导入的型号，其系统商品仍算未覆盖', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  const res = product.importFromRows([
    HDR,
    ['', 'BCD-200', '冰箱', '台', '1200']
  ], ctx);
  assert.strictEqual(res.errors.length, 1, '缺品牌，该行无法导入');
  assert.strictEqual(res.uncovered.length, 1, '系统里的 BCD-200 因此未被覆盖，如实列出');
  assert.strictEqual(res.uncovered[0].model, 'BCD-200');
});

test('UI-导入结果面板展示未覆盖清单并提示手动核对', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  product.save(ctx, { brand: '松下', model: 'NR-C31', category: '冰箱', unit: '台', cost: '3000' });
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型,单位,成本\n美的,BCD-200,冰箱,台,1200';

  productPage.actions['do-import'](ctx, state);
  const h = productPage.render(ctx, state);
  assert.ok(h.indexOf('导入结果') >= 0);
  assert.ok(h.indexOf('本次导入未覆盖到') >= 0, '提示存在未覆盖商品');
  assert.ok(h.indexOf('请手动核对') >= 0, '提示手动核对');
  assert.ok(h.indexOf('NR-C31') >= 0, '列出未覆盖商品型号');
  assert.ok(h.indexOf('松下') >= 0, '列出未覆盖商品品牌');

  const seg = h.slice(h.indexOf('本次导入未覆盖到'));
  assert.ok(seg.indexOf('NR-C31') >= 0, '未覆盖清单内含有 NR-C31');
  assert.ok(seg.indexOf('BCD-200') < 0, '已被更新的 BCD-200 不出现在未覆盖清单中');
});
