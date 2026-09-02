const test = require('node:test');
const assert = require('node:assert');
const db = require('../js/store/db.js');
const repo = require('../js/store/repo.js');
const schema = require('../js/core/schema.js');

async function boot() {
  const d = await db.create({ backend: db.memoryBackend() });
  const data = await repo.loadAll(d);
  return { db: d, ctx: repo.createContext(data) };
}

test('loadAll：空库得到默认设置（电器店）', async () => {
  const { ctx } = await boot();
  assert.strictEqual(ctx.settings.shopName, '我的电器店');
  assert.strictEqual(ctx.data.products.length, 0);
  assert.strictEqual(ctx.data.lastBackupAt, null);
  assert.strictEqual(ctx.data.skus, undefined, '不再加载 skus');
});

test('loadAll：能读回已保存的设置与最后备份时间', async () => {
  const d = await db.create({ backend: db.memoryBackend() });
  await repo.saveSettings(d, { shopName: '大家电中心', defaultThreshold: 5 });
  await repo.setMeta(d, schema.META_LAST_BACKUP_KEY, '2026-09-01');
  const data = await repo.loadAll(d);
  assert.strictEqual(data.settings.shopName, '大家电中心');
  assert.strictEqual(data.settings.defaultThreshold, 5);
  assert.strictEqual(data.lastBackupAt, '2026-09-01');
});

test('touch + flush：只落库被标记的记录', async () => {
  const { db: d, ctx } = await boot();
  const p1 = { id: 'p1', brand: '海尔', model: 'BCD-200' };
  const p2 = { id: 'p2', brand: '格力', model: 'KFR-35' };
  ctx.data.products.push(p1, p2);
  ctx.touch('products', p1);
  ctx.touch('products', p2);
  ctx.touch('products', p1); // 重复标记应去重
  assert.deepStrictEqual(ctx.dirtyKeys(), ['products']);

  const counts = await repo.flush(ctx, d);
  assert.strictEqual(counts.products, 2);
  assert.strictEqual(await d.count('products'), 2);
  assert.deepStrictEqual(ctx.dirtyKeys(), []);
});

test('flush：未标记的记录不会被写入', async () => {
  const { db: d, ctx } = await boot();
  ctx.data.products.push({ id: 'p1', brand: '海尔' });
  const counts = await repo.flush(ctx, d);
  assert.strictEqual(counts.products, undefined);
  assert.strictEqual(await d.count('products'), 0);
});

test('flush 后数据可再次 loadAll 读回（模拟重启）', async () => {
  const { db: d, ctx } = await boot();
  const product = require('../js/core/product.js');
  const r = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  await repo.flush(ctx, d);
  const again = await repo.loadAll(d);
  assert.strictEqual(again.products.length, 1);
  assert.strictEqual(again.products[0].brand, '海尔');
  assert.strictEqual(again.products[0].id, r.product.id);
});

test('查询助手：商品 / 条码 / 往来单位 / 单据', async () => {
  const { ctx } = await boot();
  ctx.data.products.push(
    { id: 'p1', brand: '海尔', model: 'BCD-200', barcodes: ['6901234567892'] },
    { id: 'p2', brand: '格力', model: 'KFR-35', barcodes: ['6923456789012', 'ABC123'] }
  );
  ctx.data.partners.push({ id: 'sup1', name: '格力经销商', type: 'supplier' });
  ctx.data.sales.push({ no: 'S20260901-001', date: '2026-09-01' });

  assert.strictEqual(ctx.getProduct('p1').brand, '海尔');
  assert.strictEqual(ctx.getProduct('p999'), null);
  assert.strictEqual(ctx.getProductByCode('6901234567892').id, 'p1');
  assert.strictEqual(ctx.getProductByCode('abc123').id, 'p2', '大小写不敏感');
  assert.strictEqual(ctx.getProductByCode('NONE'), null);
  assert.strictEqual(ctx.getPartner('sup1').name, '格力经销商');
  assert.strictEqual(ctx.getDoc('sales', 'S20260901-001').date, '2026-09-01');
  assert.strictEqual(ctx.getDoc('sales', 'NONE'), null);
});

test('操作日志：写入并标记落库', async () => {
  const { db: d, ctx } = await boot();
  const rec = repo.log(ctx, '建档', '新增品牌型号 海尔 BCD-200');
  assert.strictEqual(ctx.data.logs.length, 1);
  assert.strictEqual(rec.action, '建档');
  assert.ok(rec.at);
  const counts = await repo.flush(ctx, d);
  assert.strictEqual(counts.logs, 1);
});
