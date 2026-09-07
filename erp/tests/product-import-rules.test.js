/**
 * tests/product-import-rules.test.js —— V3.24 批量导入规则（用户确认版）
 * 匹配模式：仅按「型号」匹配（不使用 品牌+型号）；型号规范化后忽略空格与大小写。
 * 规则1 文件内同型号去重，保留最后一行。
 * 规则2 系统已有该型号 → 以导入信息为准更新 品牌/类型/单位/成本/备注；
 *       备注与原厂条码留空时保留原值；不改动现有库存。
 * 规则3 系统无该型号 → 新建，导入本行全量信息（含期初库存）。
 * 规则4 同一型号在系统中存在多个商品 → 合并保留：保留一个用导入信息全量更新
 *       并恢复在售，其余仅置为停售；绝不删除商品/单据/库存流水，也不动库存。
 */
const test = require('node:test');
const assert = require('node:assert');
const product = require('../js/core/product.js');
const schema = require('../js/core/schema.js');
const productPage = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');

const HDR = ['品牌', '型号', '类型', '单位', '成本', '备注', '原厂条码', '期初库存'];

test('规则1-文件内同型号去重：只导入一次，保留最后一行数据', () => {
  const ctx = newCtx();
  const res = product.importFromRows([
    ['品牌', '型号', '类型', '单位', '成本'],
    ['创维', '86Q8E', '电视', '台', '7000'],
    ['创维', '86Q8E', '电视', '台', '7500'],
    ['创维', '86Q8E', '电视', '台', '8190']
  ], ctx);
  assert.strictEqual(res.total, 3, '读取 3 行');
  assert.strictEqual(res.deduplicated, 2, '去重 2 行');
  assert.strictEqual(res.created, 1, '只新建 1 款');
  assert.strictEqual(res.updated, 0);
  assert.strictEqual(ctx.data.products.length, 1, '档案只有 1 款');
  assert.strictEqual(ctx.data.products[0].cost, 819000, '以最后一行 8190 为准');
});

test('规则2-型号已存在：以导入信息更新 品牌/类型/单位/成本/备注', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', note: '旧备注' });
  const res = product.importFromRows([
    ['品牌', '型号', '类型', '单位', '成本', '备注'],
    ['美的', 'BCD-200', '冰柜', '件', '1200', '新备注']
  ], ctx);
  assert.strictEqual(res.updated, 1, '更新 1 款');
  assert.strictEqual(res.created, 0, '不新建');
  const p = ctx.data.products.find(x => x.model === 'BCD-200');
  assert.strictEqual(p.brand, '美的', '品牌以导入为准');
  assert.strictEqual(p.category, '冰柜', '类型以导入为准');
  assert.strictEqual(p.unit, '件', '单位以导入为准');
  assert.strictEqual(p.cost, 120000, '成本以导入为准');
  assert.strictEqual(p.note, '新备注', '备注以导入为准');
});

test('规则2-备注/条码单元格为空：保留系统已有值（不误清空）', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', note: '原备注', barcodes: '6901234567890' });
  product.importFromRows([
    HDR,
    ['海尔', 'BCD-200', '冰箱', '台', '1200', '', '', '']
  ], ctx);
  const p = ctx.data.products.find(x => x.model === 'BCD-200');
  assert.strictEqual(p.note, '原备注', '空备注不清空');
  assert.deepStrictEqual(p.barcodes, ['6901234567890'], '空条码不清空');
  assert.strictEqual(p.cost, 120000, '成本已更新');
});

test('规则2-更新已有型号：不改动现有库存（期初库存既不覆盖也不累加）', () => {
  const ctx = newCtx();
  const s = product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  ctx.data.products.find(p => p.id === s.product.id).stock = 7; // 模拟已有库存
  product.importFromRows([
    HDR,
    ['海尔', 'BCD-200', '冰箱', '台', '1200', '', '', '99']
  ], ctx);
  const p = ctx.data.products.find(x => x.id === s.product.id);
  assert.strictEqual(p.stock, 7, '现有库存 7 保持不变（导入的期初库存 99 不覆盖也不累加）');
});

test('规则3-系统无此型号：新建并导入全量信息（含期初库存）', () => {
  const ctx = newCtx();
  const res = product.importFromRows([
    ['品牌', '型号', '类型', '单位', '成本', '备注', '原厂条码', '期初库存'],
    ['格力', 'KFR-35', '空调', '台', '1800', '旗舰款', '6900000000001', '5']
  ], ctx);
  assert.strictEqual(res.created, 1, '新建 1 款');
  assert.strictEqual(res.updated, 0);
  const p = ctx.data.products[0];
  assert.strictEqual(p.brand, '格力');
  assert.strictEqual(p.cost, 180000);
  assert.strictEqual(p.note, '旗舰款', '备注写入');
  assert.deepStrictEqual(p.barcodes, ['6900000000001'], '条码写入');
  assert.strictEqual(p.stock, 5, '期初库存写入');
});

test('规则4-同型号多商品：合并保留，保留的一个全量更新，其余停售且不删除', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  const exact = product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  const before = ctx.data.products.length;

  const res = product.importFromRows([
    ['品牌', '型号', '类型', '单位', '成本'],
    ['创维', '86Q8E', '电视', '台', '8190']
  ], ctx);

  assert.strictEqual(res.errors.length, 0, '无报错');
  assert.strictEqual(res.updated, 1, '更新 1 款');
  assert.strictEqual(res.merged, 1, '合并停售 1 个');
  assert.strictEqual(ctx.data.products.length, before, '商品总数不变——绝不删除任何商品');

  const kai = ctx.data.products.find(p => p.brand === '酷开');
  const cw = ctx.data.products.find(p => String(p.id) === String(exact.product.id));
  assert.strictEqual(cw.brand, '创维');
  assert.strictEqual(cw.cost, 819000, '保留的商品以导入信息全量更新');
  assert.strictEqual(cw.status, schema.STATUS.ON, '恢复在售');
  assert.strictEqual(kai.status, schema.STATUS.OFF, '其余同型号商品置为停售（未删除）');
  assert.strictEqual(kai.cost, 500000, '停售商品原有数据完整保留');
});

test('规则4-合并时其余商品的库存原样保留（不转移、不清零）', () => {
  const ctx = newCtx();
  const a = product.save(ctx, { brand: '酷开', model: '86Q8E', category: '电视', unit: '台', cost: '5000' });
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  ctx.data.products.find(p => p.id === a.product.id).stock = 3; // 酷开有 3 台库存

  product.importFromRows([
    ['品牌', '型号', '类型', '单位', '成本'],
    ['创维', '86Q8E', '电视', '台', '8190']
  ], ctx);

  const kai = ctx.data.products.find(p => p.id === a.product.id);
  assert.strictEqual(kai.stock, 3, '被停售商品的库存仍为 3，未被清零或转移');
});

test('型号匹配忽略空格与大小写（避免同一产品重复建档）', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '创维', model: '86Q8E', category: '电视', unit: '台', cost: '7000' });
  const res = product.importFromRows([
    ['品牌', '型号', '类型', '单位', '成本'],
    ['创维', '86q8 e', '电视', '台', '8190'] // 空格 + 小写
  ], ctx);
  assert.strictEqual(res.created, 0, '识别为同一型号，不重复建档');
  assert.strictEqual(res.updated, 1, '更新已有商品');
  assert.strictEqual(ctx.data.products.length, 1);
  assert.strictEqual(ctx.data.products[0].cost, 819000);
});

test('纯型号匹配：系统里是别的品牌也视为同一产品，品牌以导入为准', () => {
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000' });
  const res = product.importFromRows([
    ['品牌', '型号', '类型', '单位', '成本'],
    ['美的', 'BCD-200', '冰箱', '台', '1100']
  ], ctx);
  assert.strictEqual(res.created, 0, '仅按型号匹配，不新建');
  assert.strictEqual(res.updated, 1);
  assert.strictEqual(ctx.data.products.length, 1, '仍是同一款');
  assert.strictEqual(ctx.data.products[0].brand, '美的', '品牌以导入为准');
});

test('导入结果面板：展示文件去重与合并停售数量', () => {
  const ctx = newCtx();
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvResult = {
    created: 5, updated: 10, total: 20,
    deduplicated: 3, merged: 2, skipped: 0, errors: []
  };
  const h = productPage.render(ctx, state);
  assert.ok(h.includes('共读取 <b>20</b> 行数据'), '显示读取行数');
  assert.ok(h.includes('文件内去重 3 行'), '显示去重行数');
  assert.ok(h.includes('合并停售同型号 2 个'), '显示合并停售数量');
  assert.ok(h.includes('置为「停售」保留'), '提示未删除、保留历史');
});
