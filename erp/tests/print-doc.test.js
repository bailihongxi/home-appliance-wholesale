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

test('问题2-打印版本2（默认/带价格）：销售单含价格类型/单价/金额', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale', { withPrice: true });
  assert.ok(html.includes('<th>价格</th>'), '带价格列');
  assert.ok(html.includes('单价'), '含单价');
  assert.ok(html.includes('金额'), '含金额');
  assert.ok(html.includes('应收'), '含应收合计');
  // 默认（不传 opts）也带价格
  const htmlDefault = printDoc.buildDocHtml(ctx, saleDoc(), 'sale');
  assert.ok(htmlDefault.includes('单价'), '默认带价格');
});

test('问题2-打印版本1（不带价格）：销售单纯清单，无任何价格/金额', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale', { withPrice: false });
  assert.ok(!html.includes('<th>价格</th>'), '无价格类型列');
  assert.ok(!html.includes('单价'), '无单价列');
  assert.ok(!html.includes('金额'), '无金额列');
  assert.ok(!html.includes('应收'), '无应收合计');
  assert.ok(!html.includes('实收'), '无实收');
  assert.ok(!html.includes('欠款'), '无欠款');
  assert.ok(html.includes('共 4 件'), '保留件数合计');
  assert.ok(html.includes('海尔'), '明细保留');
  assert.ok(html.includes('BCD-200'), '型号保留');
  // 版本1 进货单：无成本列
  const ph = printDoc.buildDocHtml(ctx, purchaseDoc(), 'purchase', { withPrice: false });
  assert.ok(!ph.includes('成本'), '进货单版本1 无成本列');
  assert.ok(!ph.includes('合计'), '进货单版本1 无金额合计');
  assert.ok(ph.includes('共 15 件'), '进货单版本1 保留件数');
});

test('问题3-打印页操作栏：含「打印」与「关闭（返回）」按钮，打印时自动隐藏', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale');
  assert.ok(html.includes('class="print-toolbar"'), '打印页含操作栏');
  assert.ok(html.includes('onclick="window.print()"'), '含打印按钮（window.print）');
  assert.ok(html.includes('onclick="window.close()"'), '含关闭按钮（window.close 可返回）');
  assert.ok(html.includes('>关闭<'), '关闭按钮文案');
  assert.ok(printDoc.PRINT_CSS.includes('@media print { .print-toolbar { display: none !important; } }'),
    '打印时操作栏自动隐藏，不打印在单据上');
  assert.ok(printDoc.PRINT_CSS.includes('position: sticky'), '操作栏吸顶显示');
});
