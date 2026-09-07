/**
 * tests/product-import-retire.test.js —— V3.25 未覆盖清单「一键停售」
 * 导入后，系统中型号对不上/已淘汰的旧商品（多为型号标错的历史档案）仍在售。
 * 本能力让用户在导入结果里一键将其置为停售：
 * 绝不删除商品、不动库存、不碰单据与库存流水，可随时恢复。
 */
const test = require('node:test');
const assert = require('node:assert');
const product = require('../js/core/product.js');
const productPage = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');

const HDR = ['品牌', '型号', '类型', '单位', '成本'];

/** 构造：系统里 1 个型号标错的旧商品 + 导入文件里的正确型号 */
function setup() {
  const ctx = newCtx();
  const old = product.save(ctx, { brand: '海尔', model: 'BCD-300', category: '冰箱', unit: '台', cost: '2000' });
  ctx.data.products.find(p => p.id === old.product.id).stock = 3;
  return { ctx, old };
}

test('retireProducts：批量置为停售，返回停售数量', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '海尔', model: 'A-1', category: '冰箱', unit: '台', cost: '1000' });
  const b = product.save(ctx, { brand: '海尔', model: 'A-2', category: '冰箱', unit: '台', cost: '1000' });
  const c = product.save(ctx, { brand: '海尔', model: 'A-3', category: '冰箱', unit: '台', cost: '1000' });

  const res = product.retireProducts(ctx, [a.product.id, b.product.id]);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.retired, 2, '停售 2 个');
  assert.strictEqual(ctx.data.products.find(p => p.id === a.product.id).status, 'off');
  assert.strictEqual(ctx.data.products.find(p => p.id === b.product.id).status, 'off');
  assert.strictEqual(ctx.data.products.find(p => p.id === c.product.id).status, 'on', '未列入的不受影响');
});

test('retireProducts：只停售不删除商品，库存原样保留', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '海尔', model: 'A-1', category: '冰箱', unit: '台', cost: '1000' });
  ctx.data.products.find(p => p.id === a.product.id).stock = 7;
  const before = ctx.data.products.length;

  const res = product.retireProducts(ctx, [a.product.id]);
  assert.strictEqual(res.retired, 1);
  assert.strictEqual(ctx.data.products.length, before, '商品未被删除');
  const p = ctx.data.products.find(x => x.id === a.product.id);
  assert.strictEqual(p.stock, 7, '库存未变动');
  assert.strictEqual(p.cost, 100000, '成本等档案信息完整保留');
});

test('retireProducts：有库存的商品被统计出来，已停售的不重复计数', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '海尔', model: 'A-1', category: '冰箱', unit: '台', cost: '1000' });
  const b = product.save(ctx, { brand: '海尔', model: 'A-2', category: '冰箱', unit: '台', cost: '1000' });
  ctx.data.products.find(p => p.id === a.product.id).stock = 4; // 有库存
  product.setStatus(ctx, b.product.id, 'off'); // 已停售

  const res = product.retireProducts(ctx, [a.product.id, b.product.id]);
  assert.strictEqual(res.retired, 1, '已是停售的不重复计数');
  assert.strictEqual(res.withStock, 1, '统计出 1 个有库存，便于提示用户另行盘点');
});

test('retireProducts：不存在的商品 id 计入 missing，不报错', () => {
  const ctx = newCtx();
  const res = product.retireProducts(ctx, ['not-exist-1', 'not-exist-2']);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.retired, 0);
  assert.strictEqual(res.missing, 2, '不存在的不静默吞掉');
});

test('retireProducts：空入参安全，不改动任何数据', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'A-1', category: '冰箱', unit: '台', cost: '1000' });
  assert.strictEqual(product.retireProducts(ctx, []).retired, 0);
  assert.strictEqual(product.retireProducts(ctx, null).retired, 0);
  assert.strictEqual(product.retireProducts(ctx, undefined).retired, 0);
  assert.strictEqual(ctx.data.products[0].status, 'on', '未受影响');
});

test('UI：未覆盖清单提供「全部停售」按钮，并提示不删除不动库存', () => {
  const { ctx } = setup();
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型,单位,成本\n美的,BCD-200,冰箱,台,1200';
  productPage.actions['do-import'](ctx, state);
  assert.strictEqual(state.csvResult.uncovered.length, 1, '旧商品 BCD-300 未覆盖');

  const h = productPage.render(ctx, state);
  assert.ok(h.includes('retire-uncovered'), '提供一键停售按钮');
  assert.ok(h.includes('全部停售'), '按钮文案明确');
  assert.ok(h.includes('不删除商品'), '提示不删除商品');
  assert.ok(h.includes('不动库存'), '提示不动库存');
  assert.ok(h.includes('其中 <b>1</b> 个仍有库存'), '提示有库存需另行盘点');
});

test('UI：执行一键停售后商品置为停售、清单清空且面板给出结果', () => {
  const { ctx, old } = setup();
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型,单位,成本\n美的,BCD-200,冰箱,台,1200';
  productPage.actions['do-import'](ctx, state);

  productPage.actions['retire-uncovered'](ctx, state);

  const p = ctx.data.products.find(x => x.id === old.product.id);
  assert.strictEqual(p.status, 'off', '旧商品已停售');
  assert.strictEqual(p.stock, 3, '库存仍在，未丢失');
  assert.strictEqual(ctx.data.products.length, 2, '商品未被删除（旧商品 + 新导入商品）');
  assert.strictEqual(state.csvResult.retired, 1, '记录停售数量');
  assert.strictEqual(state.csvResult.uncovered.length, 0, '清单已清空');

  const h = productPage.render(ctx, state);
  assert.ok(h.includes('已将 <b>1</b> 个未覆盖商品置为停售'), '面板显示停售结果');
  assert.ok(!h.includes('retire-uncovered'), '清单空后不再显示按钮');
});

test('UI：清单为空时执行停售是安全的空操作', () => {
  const ctx = newCtx();
  const state = productPage.init(ctx);
  state.csvResult = { created: 1, updated: 0, total: 1, skipped: 0, deduplicated: 0, merged: 0, errors: [], uncovered: [] };
  productPage.actions['retire-uncovered'](ctx, state);
  assert.strictEqual(state.csvResult.retired, undefined, '未产生停售记录');
});
