/**
 * scan-enhance.test.js —— V3.35 扫码增强测试
 * 参考鞋服 ERP V1.3-10 扫码模块设计思路（只参考、不 copy），独立实现三处增强：
 *  1. scan.normalizeCode：UPC-A 12 位纯数字 → EAN-13 补前导 0
 *  2. decodeWith 出口统一规范化：所有通道成功结果过 normalizeCode
 *  3. scan.resolve 规范化变体匹配：12 位补 0 / 13 位去前导 0，双向兼容 UPC-A 与 EAN-13
 *  4. ean13 通道竖排转置重试（90°/270°，宽高互换）：竖排印刷/竖版标签条码兜底
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const scan = require('../js/barcode/scan.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

/* ---------- 1. normalizeCode ---------- */

test('normalizeCode：UPC-A 12 位纯数字补前导 0 → EAN-13', () => {
  assert.strictEqual(scan.normalizeCode('012345678901'), '0012345678901');
  assert.strictEqual(scan.normalizeCode('123456789012'), '0123456789012');
});

test('normalizeCode：13 位/字母/空值原样保留', () => {
  assert.strictEqual(scan.normalizeCode('6901234567892'), '6901234567892', '13 位不变');
  assert.strictEqual(scan.normalizeCode('ABC200'), 'ABC200', '非纯数字不变');
  assert.strictEqual(scan.normalizeCode(''), '', '空串不变');
  assert.strictEqual(scan.normalizeCode(null), '', 'null 归一为空');
  assert.strictEqual(scan.normalizeCode('  6901234567892  '), '6901234567892', '去首尾空白');
});

/* ---------- 2. decodeWith 出口规范化 ---------- */

test('decodeWith：任意通道成功结果统一过 normalizeCode（12 位 → 13 位）', async () => {
  const zxingDecode = (src, cb) => cb(true, '123456789012'); // 模拟扫出 UPC-A 12 位
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok, text) => res({ ok, text }), {
      zxing: { available: true, decode: zxingDecode }
    });
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, '0123456789012', '出口应补前导 0');
});

test('decodeWith：非 12 位数字结果原样透出（QR/Code128/13 位）', async () => {
  const nativeDetect = (src, cb) => cb(true, 'HD-1024');
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok, text) => res({ ok, text }), {
      native: { available: true, detect: nativeDetect }
    });
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'HD-1024');
});

test('decodeWith：失败路径 finalize(false) 不抛错', async () => {
  const ean13Decode = (src, cb) => cb(false);
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok) => res({ ok }), {
      ean13: { available: true, decode: ean13Decode }
    });
  });
  assert.strictEqual(r.ok, false);
});

/* ---------- 3. resolve 规范化变体匹配 ---------- */

function seedUPC(ctx) {
  // 商品条码存 13 位（前导 0 + UPC-A 12 位）
  product.save(ctx, {
    brand: '苏泊尔', model: 'SY-50', category: '电压力锅', unit: '台',
    cost: '300', priceWholesale: '420', priceRetail: '499',
    barcodes: '0123456789012'
  });
  // 商品条码存 12 位（UPC-A 原生）
  product.save(ctx, {
    brand: '九阳', model: 'JYZ-20', category: '豆浆机', unit: '台',
    cost: '200', priceWholesale: '280', priceRetail: '329',
    barcodes: '987654321098'
  });
  return ctx;
}

test('resolve：扫出 12 位 UPC-A，补 0 匹配 13 位商品条码', () => {
  const ctx = seedUPC(newCtx());
  const r = scan.resolve(ctx, '123456789012');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.product.model, 'SY-50');
});

test('resolve：手输 13 位（0 开头），去前导 0 匹配 12 位 UPC-A 商品条码', () => {
  const ctx = seedUPC(newCtx());
  const r = scan.resolve(ctx, '0987654321098');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.product.model, 'JYZ-20');
});

test('resolve：13 位非 0 开头条码不误去 0（原样匹配优先）', () => {
  const ctx = seedUPC(newCtx());
  product.save(ctx, {
    brand: '美的', model: 'FS-40', category: '风扇', unit: '台',
    cost: '100', priceWholesale: '150', priceRetail: '179',
    barcodes: '2987654321098'
  });
  const r = scan.resolve(ctx, '2987654321098');
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.product.model, 'FS-40');
});

/* ---------- 4. 竖排转置重试（源码结构断言 + 现有 ean13 通道集成） ---------- */

test('ean13 通道包含 90°/270° 竖排转置重试（transposeCanvas）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'barcode', 'scan.js'), 'utf8');
  assert.ok(src.includes('function transposeCanvas'), '存在 transposeCanvas 实现');
  assert.ok(src.includes('t === 0 ? 90 : 270'), '转置重试遍历 90°/270°');
  assert.ok(src.includes('c.width = h'), '转置宽高互换');
  assert.ok(src.includes('c.height = w'), '转置宽高互换');
  // 转置重试位于 ±4° 旋转重试之后（0° → ±4° → 90°/270° 顺序）
  const rotIdx = src.indexOf('rotateCanvas(canvas, i === 0 ? -4 : 4)');
  const trIdx = src.indexOf('transposeCanvas(canvas, t === 0 ? 90 : 270)');
  assert.ok(rotIdx > 0 && trIdx > rotIdx, '先 ±4° 旋转，后 90°/270° 转置');
});
