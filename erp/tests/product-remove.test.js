/**
 * product-remove.test.js —— V3.37 多选删除「未使用」商品档案
 * 覆盖：removeUnused 引用判定（进货单/销售单/盘点/库存流水）、
 *       混合删除、不存在 id、flush 物理删除（__deleted → db.del）。
 */
const test = require('node:test');
const assert = require('node:assert');
const db = require('../js/store/db.js');
const repo = require('../js/store/repo.js');
const schema = require('../js/core/schema.js');
const product = require('../js/core/product.js');
const { newCtx } = require('./helpers/ctx.js');

function seedProducts(ctx, n) {
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const r = product.save(ctx, {
      brand: '品牌' + i, model: 'MODEL-' + i, category: '冰箱', unit: '台',
      cost: '1000', priceWholesale: '1200', priceRetail: '1399'
    });
    ids.push(r.product.id);
  }
  return ids;
}

/* ---------------- 引用判定 ---------------- */

test('removeUnused：无任何引用的商品可删除（内存移除 + 返回 deleted）', () => {
  const ctx = newCtx();
  const [a, b] = seedProducts(ctx, 2);
  const res = product.removeUnused(ctx, [a, b]);
  assert.deepStrictEqual(res.deleted.sort(), [a, b].sort());
  assert.deepStrictEqual(res.blocked, []);
  assert.strictEqual(ctx.data.products.length, 0);
});

test('removeUnused：被销售单引用 → blocked 不删除', () => {
  const ctx = newCtx();
  const [a, b] = seedProducts(ctx, 2);
  ctx.data.sales.push({
    no: 'XS20260909001', date: '2026-09-09',
    items: [{ productId: a, qty: 1, price: 100 }]
  });
  const res = product.removeUnused(ctx, [a, b]);
  assert.deepStrictEqual(res.deleted, [b]);
  assert.strictEqual(res.blocked.length, 1);
  assert.strictEqual(res.blocked[0].id, a);
  assert.ok(res.blocked[0].refs.includes('sales'));
  assert.strictEqual(ctx.data.products.length, 1);
});

test('removeUnused：被进货单引用 → blocked 不删除', () => {
  const ctx = newCtx();
  const [a] = seedProducts(ctx, 1);
  ctx.data.purchases.push({
    no: 'JH20260909001', date: '2026-09-09',
    items: [{ productId: a, qty: 2, costPrice: 100 }]
  });
  const res = product.removeUnused(ctx, [a]);
  assert.strictEqual(res.deleted.length, 0);
  assert.strictEqual(res.blocked[0].refs[0], 'purchases');
});

test('removeUnused：被库存流水引用（期初/进货过）→ blocked 不删除', () => {
  const ctx = newCtx();
  const [a] = seedProducts(ctx, 1);
  ctx.data.stockLogs.push({ id: 'log1', productId: a, delta: 5 });
  const res = product.removeUnused(ctx, [a]);
  assert.strictEqual(res.deleted.length, 0);
  assert.ok(res.blocked[0].refs.includes('stockLogs'));
});

test('removeUnused：被盘点单引用 → blocked 不删除', () => {
  const ctx = newCtx();
  const [a] = seedProducts(ctx, 1);
  ctx.data.stocktakes.push({ no: 'PD20260909001', counts: {} });
  ctx.data.stocktakes[0].counts[a] = 10;
  const res = product.removeUnused(ctx, [a]);
  assert.strictEqual(res.deleted.length, 0);
  assert.ok(res.blocked[0].refs.includes('stocktakes'));
});

test('removeUnused：混合——部分被引用跳过、部分删除', () => {
  const ctx = newCtx();
  const [a, b, c] = seedProducts(ctx, 3);
  ctx.data.sales.push({ no: 'XS1', items: [{ productId: a, qty: 1 }] });
  ctx.data.stockLogs.push({ id: 'lg', productId: c, delta: 1 });
  const res = product.removeUnused(ctx, [a, b, c]);
  assert.deepStrictEqual(res.deleted, [b]);
  assert.strictEqual(res.blocked.length, 2);
  assert.strictEqual(ctx.data.products.length, 2);
});

test('removeUnused：不存在/空 id 安全忽略', () => {
  const ctx = newCtx();
  const [a] = seedProducts(ctx, 1);
  assert.deepStrictEqual(product.removeUnused(ctx, []), { deleted: [], blocked: [] });
  const res = product.removeUnused(ctx, [a, 'not-exist']);
  assert.deepStrictEqual(res.deleted, [a]);
  assert.strictEqual(ctx.data.products.length, 0);
});

/* ---------------- flush 物理删除（__deleted → db.del） ---------------- */

test('flush：__deleted 标记的商品物理删除（memory db 读回无残留）', async () => {
  const d = await db.create({ backend: db.memoryBackend() });
  const data = await repo.loadAll(d);
  const ctx = repo.createContext(data);
  const [a, b] = seedProducts(ctx, 2);
  await repo.flush(ctx, d); // 先落库 2 款
  assert.strictEqual(await d.count('products'), 2);

  const res = product.removeUnused(ctx, [a]); // 标记删除 a
  assert.deepStrictEqual(res.deleted, [a]);
  await repo.flush(ctx, d);

  const again = await repo.loadAll(d); // 模拟重启读回
  assert.strictEqual(again.products.length, 1);
  assert.strictEqual(again.products[0].id, b);
  assert.ok(!again.products[0].__deleted, '存活商品不应带 __deleted 标记');
});

test('flush：被引用商品不产生删除标记（原样保留）', async () => {
  const d = await db.create({ backend: db.memoryBackend() });
  const data = await repo.loadAll(d);
  const ctx = repo.createContext(data);
  const [a] = seedProducts(ctx, 1);
  await repo.flush(ctx, d);
  ctx.data.sales.push({ no: 'XS1', items: [{ productId: a, qty: 1 }] });

  const res = product.removeUnused(ctx, [a]);
  assert.strictEqual(res.deleted.length, 0);
  await repo.flush(ctx, d);
  const again = await repo.loadAll(d);
  assert.strictEqual(again.products.length, 1);
  assert.strictEqual(again.products[0].id, a);
});
