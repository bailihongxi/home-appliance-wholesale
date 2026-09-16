/**
 * tests/perf.test.js —— 性能压测（电器版）
 * 造 5000 条单据，验证列表分页 / 利润汇总 / 超期扫描均在合理时间内完成。
 */
const test = require('node:test');
const assert = require('node:assert');

const { newCtx } = require('./helpers/ctx.js');
const util = require('../js/core/util.js');
const product = require('../js/core/product.js');
const profit = require('../js/core/profit.js');
const debt = require('../js/core/debt.js');

function buildBigCtx() {
  const ctx = newCtx();
  const ids = [];
  for (let i = 0; i < 50; i++) {
    const r = product.save(ctx, {
      brand: '品牌' + i, model: '型号' + i, category: '生活小家电', unit: '台',
      cost: '500', priceWholesale: '800', priceRetail: '1290'
    });
    ids.push(r.product.id);
  }
  assert.ok(ids.length === 50, '应生成 50 个商品');

  const today = util.today();
  for (let i = 0; i < 5000; i++) {
    const pid = ids[i % ids.length];
    const qty = (i % 3) + 1;
    const price = 129000;
    const payable = price * qty;
    ctx.data.sales.push({
      no: 'S' + String(i).padStart(5, '0'),
      date: today,
      type: 'sale',
      partnerId: null,
      items: [{ productId: pid, qty: qty, price: price, priceType: 'retail', costSnapshot: 50000, type: 'sale' }],
      discount: 0,
      payments: [{ method: 'cash', amount: payable }],
      received: payable,
      debt: 0,
      payable: payable,
      voided: false
    });
  }
  return ctx;
}

test('压测：5000 条单据结构正确', () => {
  const ctx = buildBigCtx();
  assert.strictEqual(ctx.data.sales.length, 5000);
  assert.strictEqual(ctx.data.products.length, 50);
});

test('压测：列表分页 < 1s 且分页计数正确', () => {
  const ctx = buildBigCtx();
  const t0 = Date.now();
  const p = util.paginate(ctx.data.sales, 1, 50);
  const dt = Date.now() - t0;
  assert.strictEqual(p.total, 5000);
  assert.strictEqual(p.pages, 100);
  assert.strictEqual(p.items.length, 50);
  assert.ok(dt < 1000, '分页耗时 ' + dt + 'ms 应 < 1000ms');
});

test('压测：利润汇总 < 2s 且营收正确', () => {
  const ctx = buildBigCtx();
  const t0 = Date.now();
  const s = profit.summary(ctx);
  const dt = Date.now() - t0;
  // 营收 = Σ qty * 129000 ; qty 循环 1,2,3 → 每 3 单合计 6 * 129000 = 774000，共 5000 单
  // Σqty = (1+2+3) * floor(5000/3) + 余数(1,2) = 6*1666 + 3 = 9999
  const expectedRevenue = 9999 * 129000;
  assert.strictEqual(s.revenue, expectedRevenue, '营收应等于 Σ(qty×单价)');
  assert.ok(dt < 2000, '利润汇总耗时 ' + dt + 'ms 应 < 2000ms');
});

test('压测：超期扫描 < 1s（无往来仍快速返回）', () => {
  const ctx = buildBigCtx();
  const t0 = Date.now();
  const list = debt.overdue(ctx, 15);
  const dt = Date.now() - t0;
  assert.ok(Array.isArray(list));
  assert.ok(dt < 1000, '超期扫描耗时 ' + dt + 'ms 应 < 1000ms');
});

test('压测：5000 商品选货提前终止 < 5ms（无关键词不全量遍历）', () => {
  const ctx = newCtx();
  for (let i = 0; i < 5000; i++) {
    product.save(ctx, {
      brand: '品牌' + (i % 500), model: 'M' + String(i).padStart(5, '0'),
      category: '生活小家电', unit: '台', cost: '500', priceWholesale: '800',
      priceRetail: '1290', barcodes: '69' + i
    });
  }
  // 无关键词：应提前终止，只取前 30 个在售商品（5000 个中前 30 个即停）
  let t0 = Date.now();
  const list = util.pickProducts(ctx.data.products, '', { limit: 30 });
  let dt = Date.now() - t0;
  assert.strictEqual(list.length, 30, '应返回前 30 个在售商品');
  assert.ok(dt < 5, '无关键词提前终止耗时 ' + dt + 'ms 应 < 5ms');

  // 有关键词：命中即停，结果与 filter().slice(0,30) 一致
  const kw = 'M00001';
  t0 = Date.now();
  const byKw = util.pickProducts(ctx.data.products, kw, { limit: 30 });
  dt = Date.now() - t0;
  assert.strictEqual(byKw.length, 1, '应命中 1 个型号 M00001');
  assert.ok(dt < 5, '关键词选货耗时 ' + dt + 'ms 应 < 5ms');

  // 行为等价性：与 filter(...).slice(0,30) 一致（含停售排除与条码匹配）
  const legacy = ctx.data.products.filter(function (p) {
    var bc = (Array.isArray(p.barcodes) ? p.barcodes : []).some(function (b) {
      return String(b || '').toUpperCase().indexOf(kw.toUpperCase()) >= 0;
    });
    if (!kw) return p.status !== 'off';
    return String(p.brand || '').toUpperCase().indexOf(kw.toUpperCase()) >= 0 ||
      String(p.model || '').toUpperCase().indexOf(kw.toUpperCase()) >= 0 ||
      String(p.category || '').toUpperCase().indexOf(kw.toUpperCase()) >= 0 || bc;
  }).slice(0, 30);
  assert.deepStrictEqual(byKw, legacy, '关键词选货结果与旧 filter 逻辑一致');
});

test('pickProductsPaged：分页正确（15/页、总数、页数、页码）+ 关键词分页', () => {
  const ctx = newCtx();
  for (let i = 0; i < 38; i++) {
    product.save(ctx, {
      brand: '品牌' + (i % 10), model: 'M' + String(i).padStart(3, '0'),
      category: '生活小家电', unit: '台', cost: '500', priceWholesale: '800',
      priceRetail: '1290', barcodes: '69' + i
    });
  }
  // 第 1 页：15 条 / 共 38 / 3 页
  let p = util.pickProductsPaged(ctx.data.products, '', { limit: 15, page: 1 });
  assert.strictEqual(p.list.length, 15);
  assert.strictEqual(p.total, 38);
  assert.strictEqual(p.pages, 3);
  assert.strictEqual(p.page, 1);
  assert.strictEqual(p.list[0].model, 'M000');
  // 第 3 页：38 - 30 = 8 条
  p = util.pickProductsPaged(ctx.data.products, '', { limit: 15, page: 3 });
  assert.strictEqual(p.list.length, 8);
  // 停售商品不参与无关键词分页计数
  ctx.data.products[0].status = 'off';
  p = util.pickProductsPaged(ctx.data.products, '', { limit: 15, page: 1 });
  assert.strictEqual(p.total, 37, '停售商品不计入总数');
  // 关键词分页：命中同品牌的所有商品
  p = util.pickProductsPaged(ctx.data.products, '品牌1', { limit: 15, page: 1 });
  assert.ok(p.total >= 3, '关键词「品牌1」命中多款');
  assert.ok(p.list.length <= 15, '每页不超过 15 条');
  // 越界页码回退安全
  p = util.pickProductsPaged(ctx.data.products, '', { limit: 15, page: 99 });
  assert.strictEqual(p.list.length, 0, '越界页码返回空列表但不抛错');
});
