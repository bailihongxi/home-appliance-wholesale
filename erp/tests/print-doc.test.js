/**
 * 问题3：进货单/销售单打印功能——半张 A4（A5 148×210mm）模板、列表多时分多页（每页重复表头）。
 * 验证：buildDocHtml 输出包含 A5 页面尺寸、分页重复表头 CSS、店铺/单号/明细/合计；赠送行金额为 0。
 */
const test = require('node:test');
const assert = require('node:assert');
const printDoc = require('../js/ui/print-doc.js');
const schema = require('../js/core/schema.js');
const { newCtx } = require('./helpers/ctx.js');

function saleDoc() {
  return {
    no: 'XS20260903001', date: '2026-09-03', type: 'sale',
    partnerName: '红星电器行',
    items: [
      { brand: '海尔', model: 'BCD-200', unit: '台', qty: 2, price: 139900, priceType: 'retail', type: 'sale' },
      { brand: '格力', model: 'KFR-35', unit: '台', qty: 1, price: 259900, priceType: 'wholesale', type: 'sale' },
      { brand: '美的', model: '赠品扇', unit: '台', qty: 1, price: 0, priceType: 'retail', type: 'gift', giftReason: '促销' }
    ],
    payable: 539700, received: 500000, debt: 39700, discount: 0,
    note: '货到付款', createdAt: '2026-09-03T10:00:00+08:00'
  };
}

function purchaseDoc() {
  return {
    no: 'JH20260903001', date: '2026-09-03',
    partnerName: '美的总代理',
    items: [
      { brand: '美的', model: 'M1-300', unit: '台', qty: 10, costPrice: 80000, amount: 800000 },
      { brand: '美的', model: 'M2-500', unit: '台', qty: 5, costPrice: 120000, amount: 600000 }
    ],
    total: 1400000, paid: 1400000, debt: 0,
    note: '', createdAt: '2026-09-03T11:00:00+08:00'
  };
}

test('销售单打印 HTML：A5 尺寸 + 分页重复表头', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale');
  assert.ok(html.includes('@page { size: 148mm 210mm; margin: 6mm; }'), '半张 A4（A5 148×210mm）');
  assert.ok(html.includes('thead { display: table-header-group; }'), '分页时每页重复表头');
  assert.ok(html.includes('tr { page-break-inside: avoid; }'), '行不被拆断跨页');
});

test('销售单打印 HTML：店铺名 / 单号 / 客户 / 明细 / 合计齐全', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale');
  assert.ok(html.includes('幸福家电批发'), '店铺名');
  assert.ok(html.includes('XS20260903001'), '单号');
  assert.ok(html.includes('红星电器行'), '客户');
  assert.ok(html.includes('海尔'), '明细品牌');
  assert.ok(html.includes('BCD-200'), '明细型号');
  assert.ok(html.includes('应收'), '合计应收');
  assert.ok(html.includes('实收'), '实收');
  assert.ok(html.includes('欠款'), '欠款');
  assert.ok(html.includes('货到付款'), '备注');
});

test('销售单打印 HTML：批发/零售价格类型与赠送零金额', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale');
  assert.ok(html.includes('批发'), '价格类型：批发');
  assert.ok(html.includes('零售'), '价格类型：零售');
  assert.ok(html.includes('（赠）'), '赠送行标注');
  assert.ok(html.includes('>—<'), '赠送行单价为空');
});

test('进货单打印 HTML：成本价字段与合计已付欠款', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, purchaseDoc(), 'purchase');
  assert.ok(html.includes('进货单'), '标题为进货单');
  assert.ok(html.includes('JH20260903001'), '单号');
  assert.ok(html.includes('美的总代理'), '供应商');
  assert.ok(html.includes('成本'), '含成本列');
  assert.ok(html.includes('合计'), '合计');
  assert.ok(html.includes('已付'), '已付');
  assert.ok(html.includes('欠款'), '欠款');
});
