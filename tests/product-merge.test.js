/**
 * product-merge.test.js —— V3.42 同型号商品信息合并（网页版专用）
 * 覆盖：仅型号相同即可合并（跨品牌）、主档案=库存最大、库存相加、
 *       备注拼接去重、条码合并去重、品牌/成本/价格保留主档、
 *       停售可合并、型号不一致拒绝、少于 2 个拒绝、
 *       被单据引用也可合并（物理删除，历史单据靠快照）、flush 物理删除。
 */
const test = require('node:test');
const assert = require('node:assert');
const db = require('../js/store/db.js');
const repo = require('../js/store/repo.js');
const product = require('../js/core/product.js');
const { newCtx } = require('./helpers/ctx.js');

function save(ctx, p) {
  return product.save(ctx, {
    brand: p.brand, model: p.model, category: p.category || '冰箱', unit: '台',
    cost: p.cost || '1000', priceWholesale: p.priceWholesale || '1200', priceRetail: p.priceRetail || '1399',
    note: p.note, barcodes: p.barcodes, status: p.status
  }).product;
}

test('mergeByModel：同型号合并——库存相加、备注整条去重拼接、条码合并去重', () => {
  const ctx = newCtx();
  const a = save(ctx, { brand: '海尔', model: 'BCD-200', note: '一级能效', barcodes: '6901234567892' });
  const b = save(ctx, { brand: '美的', model: 'BCD-200', note: '一级能效 送安装', barcodes: '6923456789012' });
  a.stock = 5; b.stock = 3;
  const res = product.mergeByModel(ctx, [a.id, b.id]);
  assert.ok(res.ok);
  const keep = product.getById(ctx, a.id);
  assert.strictEqual(keep.stock, 8, '库存相加');
  const lines = keep.note.split('\n');
  assert.strictEqual(lines.length, 2, '两条备注分行拼接');
  assert.ok(lines.includes('一级能效') && lines.includes('一级能效 送安装'));
  assert.strictEqual(keep.barcodes.length, 2, '条码合并去重');
  assert.strictEqual(ctx.data.products.length, 1, '副档案移除');
});

test('mergeByModel：备注完全相同只保留一条', () => {
  const ctx = newCtx();
  const a = save(ctx, { brand: '海尔', model: 'N9', note: '新款' });
  const b = save(ctx, { brand: '美的', model: 'N9', note: '新款' });
  const res = product.mergeByModel(ctx, [a.id, b.id]);
  assert.ok(res.ok);
  assert.strictEqual(product.getById(ctx, res.keep.id).note, '新款', '相同备注去重为一条');
});

test('mergeByModel：主档案=库存最大者（相同则取先勾选）', () => {
  const ctx = newCtx();
  const a = save(ctx, { brand: '海尔', model: 'X1', cost: '800' });
  const b = save(ctx, { brand: '美的', model: 'X1', cost: '1200' });
  a.stock = 2; b.stock = 9;
  const res = product.mergeByModel(ctx, [a.id, b.id]);
  assert.ok(res.ok);
  const keep = product.getById(ctx, res.keep.id);
  assert.strictEqual(keep.id, b.id, '库存大者为主档');
  assert.strictEqual(keep.brand, '美的', '品牌取主档');
  assert.strictEqual(keep.cost, 120000, '成本保留主档（分）');
  assert.strictEqual(keep.stock, 11, '库存合计');
});

test('mergeByModel：仅型号相同即可合并（跨品牌），品牌取主档', () => {
  const ctx = newCtx();
  const a = save(ctx, { brand: 'COLMO', model: '60A8S' });
  const b = save(ctx, { brand: '美的', model: '60A8S' });
  b.stock = 4;
  const res = product.mergeByModel(ctx, [a.id, b.id]);
  assert.ok(res.ok);
  assert.strictEqual(res.keep.id, b.id);
  assert.strictEqual(product.getById(ctx, b.id).brand, '美的');
});

test('mergeByModel：型号不一致拒绝（含大小写/空格归一后仍不同）', () => {
  const ctx = newCtx();
  const a = save(ctx, { brand: '海尔', model: 'BCD-200' });
  const b = save(ctx, { brand: '美的', model: 'KFR-35' });
  const res = product.mergeByModel(ctx, [a.id, b.id]);
  assert.ok(!res.ok);
  assert.ok(/型号不一致/.test(res.error));
  assert.strictEqual(ctx.data.products.length, 2, '未做任何改动');
});

test('mergeByModel：少于 2 个 / 空集合拒绝', () => {
  const ctx = newCtx();
  const a = save(ctx, { brand: '海尔', model: 'X1' });
  assert.ok(!product.mergeByModel(ctx, [a.id]).ok);
  assert.ok(!product.mergeByModel(ctx, []).ok);
  assert.ok(!product.mergeByModel(ctx, null).ok);
});

test('mergeByModel：停售商品同样可合并', () => {
  const ctx = newCtx();
  const a = save(ctx, { brand: '海尔', model: 'Y2' });
  const b = save(ctx, { brand: '美的', model: 'Y2', status: 'off' });
  a.stock = 1; b.stock = 6;
  const res = product.mergeByModel(ctx, [a.id, b.id]);
  assert.ok(res.ok, '停售不阻挡合并');
  assert.strictEqual(product.getById(ctx, res.keep.id).stock, 7);
});

test('mergeByModel：被单据引用的副档案也可合并删除（历史单据靠快照）', () => {
  const ctx = newCtx();
  const a = save(ctx, { brand: '海尔', model: 'Z3' });
  const b = save(ctx, { brand: '美的', model: 'Z3' });
  ctx.data.sales.push({ no: 'XS1', date: '2026-09-10', items: [{ productId: b.id, qty: 1, price: 100 }] });
  a.stock = 2; b.stock = 1;
  const res = product.mergeByModel(ctx, [a.id, b.id]);
  assert.ok(res.ok, '被引用副档案也能合并');
  assert.strictEqual(ctx.data.products.length, 1);
  assert.strictEqual(ctx.data.products[0].id, a.id);
  assert.strictEqual(ctx.data.products[0].stock, 3);
});

test('flush：合并后副档案物理删除（memory db 读回无残留）', async () => {
  const d = await db.create({ backend: db.memoryBackend() });
  const data = await repo.loadAll(d);
  const ctx = repo.createContext(data);
  const a = save(ctx, { brand: '海尔', model: 'W5', note: '主档备注' });
  const b = save(ctx, { brand: '美的', model: 'W5', note: '副档备注' });
  a.stock = 10; b.stock = 4; // 主档 = a（库存更大）
  await repo.flush(ctx, d);
  assert.strictEqual(await d.count('products'), 2);
  const res = product.mergeByModel(ctx, [a.id, b.id]);
  assert.ok(res.ok);
  await repo.flush(ctx, d);
  const again = await repo.loadAll(d);
  assert.strictEqual(again.products.length, 1);
  assert.strictEqual(again.products[0].id, a.id);
  assert.strictEqual(again.products[0].stock, 14, '库存相加持久化');
  assert.strictEqual(again.products[0].note, '主档备注\n副档备注', '备注合并持久化');
});
