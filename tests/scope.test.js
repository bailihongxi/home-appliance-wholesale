/**
 * V3-阶段3：经营范围过滤（schema.inScope / categoriesFor，电器版）
 * - 空 scopeCategories=未限制（全部分类可见）
 * - 账号 scope=['冰箱'] → 只可见冰箱；['厨房电器'] → 只厨房电器；['空调'] → 只空调
 */
const test = require('node:test');
const assert = require('node:assert');
const schema = require('../js/core/schema.js');

test('categoriesFor：未限制时返回全部分类', () => {
  assert.deepStrictEqual(schema.categoriesFor(null), schema.CATEGORIES);
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: [] }), schema.CATEGORIES);
  assert.deepStrictEqual(schema.categoriesFor({}), schema.CATEGORIES);
});

test('categoriesFor：按经营范围过滤', () => {
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: ['冰箱'] }), ['冰箱']);
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: ['洗衣机'] }), ['洗衣机']);
  assert.deepStrictEqual(schema.categoriesFor({ scopeCategories: ['空调', '电视'] }), ['空调', '电视']);
});

test('inScope：分类是否在本账号经营范围内', () => {
  assert.strictEqual(schema.inScope(null, '冰箱'), true);
  assert.strictEqual(schema.inScope({ scopeCategories: [] }, '电视'), true);
  const big = { scopeCategories: ['冰箱', '洗衣机', '空调'] };
  assert.strictEqual(schema.inScope(big, '冰箱'), true);
  assert.strictEqual(schema.inScope(big, '电视'), false);
  assert.strictEqual(schema.inScope(big, '厨房电器'), false);
  const kitchen = { scopeCategories: ['厨房电器'] };
  assert.strictEqual(schema.inScope(kitchen, '厨房电器'), true);
  assert.strictEqual(schema.inScope(kitchen, '冰箱'), false);
});

test('inScope 边界：分类不在经营范围时按未限制处理不崩溃', () => {
  assert.strictEqual(schema.inScope({ scopeCategories: ['冰箱'] }, ''), false);
  assert.strictEqual(schema.inScope({ scopeCategories: ['冰箱'] }, '其他'), false);
  assert.strictEqual(schema.inScope({ scopeCategories: ['冰箱', '洗衣机'] }, '空调'), false);
});
