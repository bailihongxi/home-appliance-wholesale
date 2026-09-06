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

test('销售单打印 HTML：赠送行标注与单价为空', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale');
  assert.ok(html.includes('（赠）'), '赠送行标注');
  assert.ok(html.includes('>—<'), '赠送行单价为空');
  assert.ok(!html.includes('<th>价格</th>'), '已取消价格列（批发/零售类型）');
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

test('问题2-打印版本2（默认/带价格）：销售单含单价/金额（已取消价格列）', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale', { withPrice: true });
  assert.ok(!html.includes('<th>价格</th>'), '已取消价格列');
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

test('问题3-手机端打印按钮放大醒目：加大按钮/字号/触控高度，关闭按钮红色区分', () => {
  const html = printDoc.buildDocHtml(newCtx({ shopName: '幸福家电批发' }), saleDoc(), 'sale');
  // 关闭按钮有独立醒目 class
  assert.ok(html.includes('class="pb-close"'), '关闭按钮带 pb-close 醒目类');
  assert.ok(html.includes('class="pb-print"'), '打印按钮带 pb-print 类');
  // 按钮放大：字号 17px、加粗、min-height 48px 触控高度、加大内边距
  assert.ok(printDoc.PRINT_CSS.includes('font-size: 17px'), '按钮字号放大至 17px');
  assert.ok(printDoc.PRINT_CSS.includes('font-weight: 700'), '按钮加粗');
  assert.ok(printDoc.PRINT_CSS.includes('min-height: 48px'), '按钮最小高度 48px（移动端触控友好）');
  assert.ok(printDoc.PRINT_CSS.includes('padding: 13px 32px'), '按钮内边距加大');
  // 关闭按钮红色醒目区分
  assert.ok(printDoc.PRINT_CSS.includes('.print-toolbar .pb-close { background: #fff; color: #dc2626; border-color: #dc2626; }'),
    '关闭按钮红色边框/文字醒目');
});

test('问题4-打印表格：取消价格列、型号列放宽、所有文字居左、单价数量金额列缩窄', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale');

  // 取消价格列
  assert.ok(!html.includes('<th>价格</th>'), '销售单打印取消价格列');
  assert.ok(!html.includes('>批发<') && !html.includes('>零售<'), '取消价格类型（批发/零售）显示');

  // 型号列占剩余空间（colgroup 中型号列宽度 32.2%，明显大于品牌 10.8%）
  assert.ok(html.includes('<col style="width:32.2%">'), '型号列占剩余 32.2%');
  // V3.15 问题2：品牌列减少10%，占 3.6 汉字宽 = 10.8%
  assert.ok(html.includes('<col style="width:10.8%">'), '品牌列 10.8%（3.6 汉字宽，减少10%）');

  // 所有文字居左：表格单元格无 class="num"（右对齐类）
  assert.ok(!html.includes('class="num"'), '所有表格单元格无 num 右对齐类，全部居左');

  // 单价/数量/金额列按汉字宽分配（colgroup 设置对应宽度）
  assert.ok(html.includes('<col style="width:6%">'), '数量列 6%（2 汉字宽）');
  assert.ok(html.includes('<col style="width:15%">'), '金额列 15%（5 汉字宽）');

  // 表头列顺序：# 品牌 型号 类型 单位 单价 数量 金额（V3.15 问题2 新增类型列）
  assert.ok(html.includes('<th>#</th><th>品牌</th><th>型号</th><th>类型</th><th>单位</th><th>单价</th><th>数量</th><th>金额</th>'),
    '表头列顺序正确（类型列位于单位列前，无价格列）');
});

/** 解析 colgroup，返回各列宽度数组（如 ['6%','11.34%',...]） */
function colWidths(html) {
  const cg = html.slice(html.indexOf('<colgroup>'), html.indexOf('</colgroup>'));
  return (cg.match(/width:([0-9.]+%)/g) || []).map(function (s) { return s.replace('width:', ''); });
}

test('V3.15-问题2：打印模板列宽调整（品牌-10% 类型-20% 型号+约10%）列顺序（#2 品牌3.6 型号剩余 类型4 单位2 单价4 数量2 金额5）', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale');

  // 销售单（带价格）列宽：#(2) 品牌(3.6) 型号(剩余) 类型(4) 单位(2) 单价(4) 数量(2) 金额(5)
  assert.deepStrictEqual(colWidths(html),
    ['6%', '10.8%', '32.2%', '12%', '6%', '12%', '6%', '15%'],
    '销售单列宽：#6% 品牌10.8% 型号32.2% 类型12% 单位6% 单价12% 数量6% 金额15%');

  // V3.15 问题2：品牌减少10%(4→3.6)，类型缩小20%(5→4)，型号列(rest)自然增加
  const w = colWidths(html);
  assert.strictEqual(w[0], '6%', '# 列 2 汉字 = 6%');
  assert.strictEqual(w[1], '10.8%', '品牌列 3.6 汉字 = 10.8%（减少10%）');
  assert.strictEqual(w[2], '32.2%', '型号列占剩余空间 = 32.2%（增加约15%）');
  assert.strictEqual(w[3], '12%', '类型列 4 汉字 = 12%（缩小20%）');
  assert.strictEqual(w[4], '6%', '单位列 2 汉字 = 6%');
  assert.strictEqual(w[5], '12%', '单价列 4 汉字 = 12%');
  assert.strictEqual(w[6], '6%', '数量列 2 汉字 = 6%');
  assert.strictEqual(w[7], '15%', '金额列 5 汉字 = 15%');

  // 列顺序：类型列必须位于单位列之前
  const thOrder = html.indexOf('<th>类型</th>');
  const thUnit = html.indexOf('<th>单位</th>');
  assert.ok(thOrder > -1 && thOrder < thUnit, '表头中类型列在单位列之前');

  // 明细行输出类型数据（销售单/进货单/不带价格版均输出）
  const saleDocCat = {
    no: 'XS20260905001', date: '2026-09-05', type: 'sale', partnerName: '红星电器行',
    items: [{ brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', qty: 2, price: 139900, priceType: 'retail', type: 'sale' }],
    payable: 279800, received: 279800, debt: 0, discount: 0, note: '', createdAt: '2026-09-05T10:00:00+08:00'
  };
  const withCat = printDoc.buildDocHtml(ctx, saleDocCat, 'sale');
  assert.ok(withCat.includes('<td>冰箱</td>'), '明细行输出类型列数据');

  // 不带价格版（版本1）同样有类型列
  const noPrice = printDoc.buildDocHtml(ctx, saleDocCat, 'sale', { withPrice: false });
  assert.ok(noPrice.includes('<th>类型</th><th>单位</th>'), '不带价格版同样含类型列（单位前）');
  assert.ok(noPrice.includes('<td>冰箱</td>'), '不带价格版明细输出类型');

  // 进货单：成本列占 4 汉字 = 12%、品牌/类型/单位/型号列宽与销售单一致
  const ph = printDoc.buildDocHtml(ctx, purchaseDoc(), 'purchase');
  assert.ok(ph.includes('<th>类型</th><th>单位</th>'), '进货单表头含类型列（单位前）');
  assert.deepStrictEqual(colWidths(ph),
    ['6%', '10.8%', '32.2%', '12%', '6%', '12%', '6%', '15%'],
    '进货单列宽：成本列同为 12%（4 汉字宽），品牌10.8% 类型12%');
});

test('V3.16-问题1：历史单据（明细无 category 字段）类型列按 productId 回查商品类型，不再空白', () => {
  const product = require('../js/core/product.js');
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const r = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  assert.ok(r.ok, '商品保存成功');
  const pid = ctx.data.products[0].id;

  // 模拟历史进货单：明细没有 category 字段（V3.15 之前创建的单据）
  const oldPurchase = {
    no: 'JH20260904001', date: '2026-09-04', partnerName: '美的总代理',
    items: [{ productId: pid, brand: '海尔', model: 'BCD-200', unit: '台', qty: 5, costPrice: 100000, amount: 500000 }],
    total: 500000, paid: 100000, debt: 400000, note: ''
  };
  const ph = printDoc.buildDocHtml(ctx, oldPurchase, 'purchase');
  assert.ok(ph.includes('<td>冰箱</td>'), '历史进货单按 productId 回查到类型「冰箱」，类型列不再空白');

  // 模拟历史销售单：同样无 category
  const oldSale = {
    no: 'XS20260904001', date: '2026-09-04', type: 'sale', partnerName: '红星电器行',
    items: [{ productId: pid, brand: '海尔', model: 'BCD-200', unit: '台', qty: 1, price: 139900, priceType: 'retail', type: 'sale' }],
    payable: 139900, received: 139900, debt: 0, discount: 0, note: ''
  };
  const sh = printDoc.buildDocHtml(ctx, oldSale, 'sale');
  assert.ok(sh.includes('<td>冰箱</td>'), '历史销售单同样回查到类型');

  // 明细自带 category 时优先使用明细值（不被商品档案当前值覆盖）
  const withCat = {
    no: 'JH20260904002', date: '2026-09-04', partnerName: '美的总代理',
    items: [{ productId: pid, brand: '海尔', model: 'BCD-200', category: '展示机', unit: '台', qty: 1, costPrice: 100000, amount: 100000 }],
    total: 100000, paid: 100000, debt: 0, note: ''
  };
  const wh = printDoc.buildDocHtml(ctx, withCat, 'purchase');
  assert.ok(wh.includes('<td>展示机</td>'), '明细自带 category 时优先用明细值');

  // 既无 category 又无 productId（极旧/脏数据）→ 留空且不报错
  const noRef = {
    no: 'JH20260904003', date: '2026-09-04', partnerName: '散客',
    items: [{ brand: '杂牌', model: 'X-1', unit: '个', qty: 1, costPrice: 0, amount: 0 }],
    total: 0, paid: 0, debt: 0, note: ''
  };
  const nh = printDoc.buildDocHtml(ctx, noRef, 'purchase');
  assert.ok(!nh.includes('<td>undefined</td>'), '脏数据不输出 undefined');
});

test('V3.15-问题2：engine 单据明细携带商品类型 category（供打印模板类型列）', () => {
  const engine = require('../js/core/engine.js');
  const product = require('../js/core/product.js');
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const p = product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  assert.ok(p.ok, '商品保存成功');

  // 进货单明细携带 category
  const buy = engine.savePurchase(ctx, {
    date: '2026-09-05', partnerName: '测试供应商',
    items: [{ productId: ctx.data.products[0].id, qty: 5, costPrice: '1000' }]
  });
  assert.ok(buy.ok, '进货单保存成功');
  assert.strictEqual(ctx.data.purchases[0].items[0].category, '冰箱', '进货单明细携带 category');

  // 销售单明细携带 category
  const sale = engine.saveSale(ctx, {
    date: '2026-09-05',
    items: [{ productId: ctx.data.products[0].id, qty: 1, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'cash', amount: '1399' }]
  });
  assert.ok(sale.ok, '销售单保存成功');
  assert.strictEqual(ctx.data.sales[0].items[0].category, '冰箱', '销售单明细携带 category');
});

test('V3.16-问题1：退货单与换货单明细同样携带 category（打印类型列不空白）', () => {
  const engine = require('../js/core/engine.js');
  const product = require('../js/core/product.js');
  const ctx = newCtx({ shopName: '幸福家电批发' });
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
  product.save(ctx, {
    brand: '格力', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
  const [pOld, pNew] = ctx.data.products;

  engine.savePurchase(ctx, {
    date: '2026-09-05', partnerName: '测试供应商',
    items: [
      { productId: pOld.id, qty: 10, costPrice: '1000' },
      { productId: pNew.id, qty: 10, costPrice: '1800' }
    ], paid: '99999'
  });
  const s = engine.saveSale(ctx, {
    date: '2026-09-05',
    items: [{ productId: pOld.id, qty: 2, price: '1399', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '2798' }]
  });
  assert.ok(s.ok, '销售单保存成功');

  // 退货单：从原销售单明细复制，应沿用原明细的 category
  const ref = engine.refundSale(ctx, { originalNo: s.doc.no, items: [{ productId: pOld.id, qty: 1 }] });
  assert.ok(ref.ok, '退货单保存成功');
  assert.strictEqual(ref.doc.items[0].category, '冰箱', '退货单明细携带 category');

  // 换货单：退货部分沿用原明细 category，换新部分取商品档案 category
  const ex = engine.exchange(ctx, {
    originalNo: s.doc.no,
    returns: [{ productId: pOld.id, qty: 1 }],
    replacements: [{ productId: pNew.id, qty: 1, price: '2599', priceType: 'retail' }],
    payments: [{ method: 'wechat', amount: '1200' }]
  });
  assert.ok(ex.ok, '换货单保存成功');
  assert.strictEqual(ex.refund.items[0].category, '冰箱', '换货-退货明细携带 category');
  assert.strictEqual(ex.sale.items[0].category, '空调', '换货-换新明细携带 category');
});

test('问题4-进货单打印：成本列、无价格列、型号放宽', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, purchaseDoc(), 'purchase');
  assert.ok(!html.includes('<th>价格</th>'), '进货单无价格列');
  assert.ok(html.includes('<th>成本</th><th>数量</th><th>金额</th>'), '进货单表头：成本/数量/金额');
  assert.ok(html.includes('<col style="width:32.2%">'), '进货单型号列占剩余 32.2%');
  assert.ok(!html.includes('class="num"'), '进货单所有单元格居左');
});

test('V3.15-问题2：不带价格版（版本1）列宽——型号列占剩余更多（#6% 品牌10.8% 型号59.2% 类型12% 单位6% 数量6%）', () => {
  const ctx = newCtx({ shopName: '幸福家电批发' });
  const html = printDoc.buildDocHtml(ctx, saleDoc(), 'sale', { withPrice: false });
  assert.deepStrictEqual(colWidths(html),
    ['6%', '10.8%', '59.2%', '12%', '6%', '6%'],
    '销售单不带价格版列宽：型号列占剩余 59.2%');
  const ph = printDoc.buildDocHtml(ctx, purchaseDoc(), 'purchase', { withPrice: false });
  assert.deepStrictEqual(colWidths(ph),
    ['6%', '10.8%', '59.2%', '12%', '6%', '6%'],
    '进货单不带价格版列宽：型号列占剩余 59.2%');
  // 列顺序：品牌 → 型号 → 类型 → 单位 → 数量（无价格版无单价/金额列）
  assert.ok(html.includes('<th>品牌</th><th>型号</th><th>类型</th><th>单位</th><th>数量</th>'),
    '不带价格版表头列顺序正确（型号在品牌后、类型在单位前）');
});
