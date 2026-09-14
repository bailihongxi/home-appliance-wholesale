/**
 * js/core/excel.js —— Excel（xlsx/xls）文件解析为可导入的二维行数组
 * 依赖：SheetJS（xlsx.full.min.js）。浏览器由 vendor/xlsx.full.min.js 提供 window.XLSX；
 *       Node（单测）直接 require vendor 文件（UMD）。
 * 纯函数，可在 Node 中直接断言（issue: CSV/Excel 文件直接导入）。
 */
(function (root, factory) {
  var util = (typeof module !== 'undefined' && module.exports)
    ? require('./util.js')
    : (root.ERP && root.ERP.util);
  // Node（单测）直接 require vendor 文件（UMD）；浏览器走 V3.58 懒加载，首次调用时才注入脚本
  var XLSXStatic = (typeof module !== 'undefined' && module.exports)
    ? require('../../vendor/xlsx.full.min.js')
    : null;
  var mod = factory(util, XLSXStatic, root);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.excel = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, XLSXStatic, root) {
  'use strict';

  var api = {};

  /** 每次都重新取全局 XLSX —— 懒加载完成后即可读到，不会被加载时机的快照锁死 */
  function xlsxRef() {
    if (XLSXStatic) return XLSXStatic;
    var g = root || (typeof globalThis !== 'undefined' ? globalThis : null);
    return (g && g.XLSX) || null;
  }

  /** 是否已加载 Excel 解析库（SheetJS） */
  api.available = function available() {
    return !!xlsxRef();
  };

  /**
   * V3.58：按需加载 SheetJS（861KB）——未加载时才真正下载。
   * @returns Promise<*> 解析库对象；Node 环境下直接 resolve 已 require 的实例。
   */
  api.ensureLoaded = function ensureLoaded() {
    var now = xlsxRef();
    if (now) return Promise.resolve(now);
    var ERP = root && root.ERP;
    var lazy = ERP && ERP.lazy;
    if (!lazy || typeof lazy.load !== 'function') {
      return Promise.reject(new Error('未加载 Excel 解析库且懒加载器不可用（请检查 index.html 是否引入 js/core/lazy.js）'));
    }
    return lazy.load('xlsx', 'vendor/xlsx.full.min.js', function () {
      return xlsxRef();
    });
  };

  /**
   * 解析 Excel 二进制（ArrayBuffer），返回全部工作表：[{name, rows}]
   * 每个工作表的 rows 与 util.parseCSV 的 rows 同构（第一行为表头，空单元格为 ''）。
   * V3.22：批量导入改为读取所有工作表（此前仅第一个 sheet，多表数据被静默丢弃）。
   * @param {ArrayBuffer|Uint8Array} buf
   * @returns {Array<{name:string, rows:Array<Array<string>>}>}
   */
  api.parseAll = function parseAll(buf) {
    var XLSX = xlsxRef();
    if (!XLSX) throw new Error('未加载 Excel 解析库（xlsx.full.min.js）——请等待解析库加载完成后重试');
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
    var wb = XLSX.read(bytes, { type: 'array' });
    return (wb.SheetNames || []).map(function (name) {
      return {
        name: name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
      };
    });
  };

  /**
   * 解析 Excel 二进制（ArrayBuffer）为二维数组 rows（第一行为表头，与 util.parseCSV 的 rows 同构）。
   * 兼容旧调用：仅取第一个工作表。需要全部工作表请用 parseAll。
   * @param {ArrayBuffer|Uint8Array} buf
   * @returns {Array<Array<string>>} 二维字符串数组（空单元格为 ''）
   */
  api.parse = function parse(buf) {
    var sheets = api.parseAll(buf);
    if (!sheets.length) throw new Error('Excel 文件没有工作表');
    return sheets[0].rows;
  };

  /**
   * 二维数组 → CSV 文本（供粘贴框预览或直接进入导入流程）。
   * @param {Array<Array<string>>} rows
   * @returns {string}
   */
  api.rowsToCsv = function rowsToCsv(rows) {
    return (rows || []).map(function (r) {
      return (r || []).map(function (v) {
        return util.csvCell(v === null || v === undefined ? '' : String(v));
      }).join(',');
    }).join('\r\n');
  };

  return api;
});
