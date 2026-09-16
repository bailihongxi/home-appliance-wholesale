/**
 * tests/product-import-multisheet.test.js —— V3.22 批量导入多工作表 + 行数去向统计
 * 背景：用户反馈「批量导入只能导入 39 条」，排查结论：
 *  1) 导入逻辑无条数上限，39 行均为「型号匹配已有商品 → 更新」；
 *  2) Excel 导入此前只解析第一个工作表，后续 sheet 数据被静默丢弃；
 *  3) 空行被静默跳过且无任何提示。
 * 本文件验证修复：excel.parseAll 读取全部工作表、product.mergeSheetRows 合并并剥离
 * 重复表头、importFromRows 返回 total/skipped 统计、导入结果面板展示完整行数去向。
 */
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('../vendor/xlsx.full.min.js');
const excel = require('../js/core/excel.js');
const product = require('../js/core/product.js');
const util = require('../js/core/util.js');
const productPage = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');

/** 用 SheetJS 在 Node 中构造多工作表 xlsx 的 ArrayBuffer */
function buildXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(function (sh) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows), sh.name);
  });
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  // 该版本 write(type:'array') 直接返回 ArrayBuffer（parseAll 同时兼容 ArrayBuffer/Uint8Array）
  return out instanceof ArrayBuffer ? out : out.buffer;
}

test('V3.22-excel.parseAll：返回全部工作表（此前 parse 只读第一个 sheet）', () => {
  const buf = buildXlsx([
    { name: '冰箱', rows: [['品牌', '型号', '类型', '单位', '成本'], ['海尔', 'BCD-200', '冰箱', '台', '1000']] },
    { name: '空调', rows: [['品牌', '型号', '类型', '单位', '成本'], ['格力', 'KFR-35', '空调', '台', '1800']] }
  ]);
  const sheets = excel.parseAll(buf);
  assert.strictEqual(sheets.length, 2, '读取到 2 个工作表');
  assert.strictEqual(sheets[0].name, '冰箱');
  assert.strictEqual(sheets[1].name, '空调');
  assert.strictEqual(sheets[1].rows[1][0], '格力', '第二个 sheet 数据可读取');
  // 兼容：parse 仍只返回第一个工作表
  const first = excel.parse(buf);
  assert.strictEqual(first.length, 2, 'parse 兼容旧行为（首个 sheet 的表头+数据）');
});

test('V3.22-mergeSheetRows：合并多表数据行，后续表的重复表头被剥离', () => {
  const merged = product.mergeSheetRows([
    { name: 's1', rows: [['品牌', '型号', '类型'], ['海尔', 'BCD-1', '冰箱'], ['海尔', 'BCD-2', '冰箱']] },
    { name: 's2', rows: [['品牌', '型号', '类型'], ['格力', 'KFR-1', '空调']] },
    { name: 's3', rows: [['品牌', '型号', '类型', '单位'], ['美的', 'MK-1', '风扇', '台']] }
  ]);
  assert.strictEqual(merged.length, 5, '1 个总表头 + 4 行数据');
  assert.strictEqual(merged[0][0], '品牌', '首行为表头');
  assert.deepStrictEqual(merged.map(r => r[1]), ['型号', 'BCD-1', 'BCD-2', 'KFR-1', 'MK-1'], '数据行按序合并、无表头混入');
});

test('V3.22-mergeSheetRows：后续表首行不是表头（<2 个已知列名）时整表保留', () => {
  const merged = product.mergeSheetRows([
    { name: 's1', rows: [['品牌', '型号', '类型'], ['海尔', 'BCD-1', '冰箱']] },
    { name: 's2', rows: [['备注说明', '其他'], ['格力', 'KFR-1']] } // 首行无法识别为表头
  ]);
  assert.strictEqual(merged.length, 4, 's2 整表保留（含其首行）');
  assert.strictEqual(merged[3][0], '格力');
});

test('V3.22-mergeSheetRows：空工作表/空入参安全', () => {
  assert.deepStrictEqual(product.mergeSheetRows([]), [], '空数组');
  assert.deepStrictEqual(product.mergeSheetRows([{ name: 's', rows: [] }]), [], '空 sheet');
  const only = product.mergeSheetRows([{ name: 's', rows: [['品牌', '型号'], ['海尔', 'X1']] }]);
  assert.strictEqual(only.length, 2, '唯一 sheet 整表保留');
});

test('V3.22-importFromRows：total/skipped 统计——空行不再静默消失', () => {
  const ctx = newCtx();
  const rows = [
    ['品牌', '型号', '类型', '单位', '成本'],
    ['海尔', 'BCD-1', '冰箱', '台', '1000'],
    ['', '', '', '', ''],          // 空行
    ['格力', 'KFR-1', '空调', '台', '1800']
  ];
  const res = product.importFromRows(rows, ctx);
  assert.strictEqual(res.total, 3, '数据行总数 3（不含表头）');
  assert.strictEqual(res.skipped, 1, '空行 1 行被计数');
  assert.strictEqual(res.created, 2, '新增 2 款');
  assert.strictEqual(res.updated, 0, '无更新');
  assert.strictEqual(res.errors.length, 0, '无错误');
});

test('V3.22-importFromRows：表头不合法时也返回 total', () => {
  const ctx = newCtx();
  const res = product.importFromRows([['随便', '列名'], ['a', 'b'], ['c', 'd']], ctx);
  assert.strictEqual(res.total, 2, 'total = 数据行数');
  assert.strictEqual(res.errors.length, 1, '表头错误');
  assert.strictEqual(res.created, 0);
});

test('V3.22-完整链路：多工作表 xlsx → parseAll → mergeSheetRows → rowsToCsv → parseCSV → 全部导入', () => {
  const buf = buildXlsx([
    { name: '冰箱', rows: [['品牌', '型号', '类型', '单位', '成本'], ['海尔', 'BCD-200', '冰箱', '台', '1000']] },
    { name: '空调', rows: [['品牌', '型号', '类型', '单位', '成本'], ['格力', 'KFR-35', '空调', '台', '1800'], ['美的', 'MK-1', '风扇', '台', '300']] }
  ]);
  const csvText = excel.rowsToCsv(product.mergeSheetRows(excel.parseAll(buf)));
  const ctx = newCtx();
  const res = product.importFromRows(util.parseCSV(csvText).rows, ctx);
  assert.strictEqual(res.created, 3, '三个 sheet 的 3 行数据全部导入');
  assert.strictEqual(res.updated, 0);
  assert.strictEqual(res.errors.length, 0);
  assert.strictEqual(ctx.data.products.length, 3, '档案共 3 款');
});

test('V3.22-导入结果面板：显示读取行数/未导入行数（每行去向可见）', () => {
  const ctx = newCtx();
  const state = productPage.init(ctx);
  state.tab = 'csv';
  // parseCSV 会先过滤全空行，故读取行数 = 1 新增 + 1 错误
  state.csvText = '品牌,型号,类型\n海尔,BCD-1,冰箱\n,,\n格力,,空调';
  productPage.actions['do-import'](ctx, state);
  const h = productPage.render(ctx, state);
  assert.ok(h.indexOf('共读取 <b>2</b> 行数据') >= 0, '显示读取行数（空行已被解析层过滤，不计入）');
  assert.ok(h.indexOf('新增 1 款') >= 0, '新增 1 款');
  assert.ok(h.indexOf('未导入 1 行') >= 0, '错误行数可见');
  assert.ok(h.indexOf('品牌和型号必填') >= 0, '错误原因可见');
});

test('V3.22-导入结果面板：有跳过空行时明确展示（直接调用 importFromRows 的场景）', () => {
  const ctx = newCtx();
  const state = productPage.init(ctx);
  state.tab = 'csv';
  // 模拟带空行的原始 rows（绕过 parseCSV 过滤，如程序化调用）
  const res = product.importFromRows([
    ['品牌', '型号', '类型'],
    ['海尔', 'BCD-1', '冰箱'],
    ['', '', ''],
    ['格力', 'KFR-1', '空调']
  ], ctx);
  state.csvResult = res;
  const h = productPage.render(ctx, state);
  assert.ok(h.indexOf('共读取 <b>3</b> 行数据') >= 0, '读取 3 行');
  assert.ok(h.indexOf('跳过空行 1 行') >= 0, '空行跳过可见');
  assert.ok(h.indexOf('新增 2 款') >= 0, '新增 2 款');
});

test('V3.22-导入页说明：提示 Excel 读取所有工作表', () => {
  const ctx = newCtx();
  const state = productPage.init(ctx);
  state.tab = 'csv';
  const h = productPage.render(ctx, state);
  assert.ok(h.indexOf('所有工作表') >= 0, '页面提示多工作表支持');
});
