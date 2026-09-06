/**
 * ui/print-doc.js —— 单据打印（销售单 / 进货单）
 * 需求：使用正常打印机打印，只需半张 A4 大小（A5 竖版 148×210mm），
 * 明细列表多时自动分多页，每页重复表头。
 * 通过独立打印窗口输出，不干扰现有 40×30mm 条码标签打印（print.css）。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.schema || (isNode ? require('../core/schema.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.printDoc = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema, ERP) {
  'use strict';

  var esc = util.escapeHtml;

  /** A5（半张 A4）打印样式：表格分页重复表头 */
  var PRINT_CSS = [
    '@page { size: 148mm 210mm; margin: 6mm; }',
    '* { box-sizing: border-box; }',
    'html, body { margin: 0; padding: 0; background: #fff; color: #000; }',
    'body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; font-size: 12px; }',
    '.doc { width: 100%; }',
    '.doc-head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1.6px solid #000; padding-bottom: 4px; }',
    '.doc-shop { font-size: 16px; font-weight: 700; }',
    '.doc-title { font-size: 15px; font-weight: 700; }',
    '.doc-meta { display: flex; justify-content: space-between; font-size: 11px; margin: 6px 0 8px; }',
    'table { width: 100%; border-collapse: collapse; font-size: 11px; }',
    'th, td { border: 1px solid #000; padding: 3px 5px; text-align: left; vertical-align: top; }',
    'th { background: #f2f2f2; font-weight: 700; }',
    'th.num, td.num { text-align: right; }',
    'thead { display: table-header-group; } /* 分页时每页重复表头 */',
    'tr { page-break-inside: avoid; }',
    '.doc-total { margin-top: 8px; font-size: 12px; }',
    '.doc-note { margin-top: 6px; font-size: 11px; }',
    '.doc-sign { margin-top: 18px; display: flex; justify-content: space-between; font-size: 11px; }',
    '.doc-sign .sg { width: 90px; }',
    '.doc-foot { margin-top: 4px; text-align: right; font-size: 10px; color: #555; }',
    '/* 屏幕预览操作栏：提供打印与关闭（关闭可返回上一页），打印时自动隐藏；手机端按钮加大醒目便于触控 */',
    '.print-toolbar { position: sticky; top: 0; background: #eef2f7; padding: 10px 8px; text-align: center; z-index: 9; border-bottom: 1px solid #d0d7de; }',
    '.print-toolbar button { margin: 0 8px; padding: 13px 32px; font-size: 17px; font-weight: 700; min-height: 48px; border: 2px solid #888; border-radius: 8px; background: #fff; cursor: pointer; }',
    '.print-toolbar .pb-print { background: #1f6feb; color: #fff; border-color: #1f6feb; }',
    '.print-toolbar .pb-close { background: #fff; color: #dc2626; border-color: #dc2626; }',
    '@media print { .print-toolbar { display: none !important; } }'
  ].join('\n');

  /**
   * 取明细行的商品类型。
   * 背景：单据明细的 category 字段是 v3.15 才写入的，**历史单据（改动前创建）的明细没有该字段**，
   * 直接读 it.category 会让打印出来的类型列一片空白。因此这里做兜底：
   * ① 明细自带 category 优先；② 否则按 productId 回查商品档案取其类型；③ 都取不到才留空。
   */
  function itemCategory(ctx, it) {
    if (it && it.category) return it.category;
    var id = String((it && it.productId) || '');
    if (!id) return '';
    var list = (ctx && ctx.data && ctx.data.products) || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === id) return list[i].category || '';
    }
    return '';
  }

  /** 生成单据打印 HTML
   *  @param opts {withPrice:boolean} withPrice===false 输出“版本1 不带价格”纯清单；默认 true 输出“版本2 带价格”完整单据
   */
  function buildDocHtml(ctx, doc, kind, opts) {
    var settings = (ctx && ctx.settings) || {};
    var withPrice = !opts || opts.withPrice !== false;
    var shop = settings.shopName || '家电批发';
    var isSale = kind === 'sale';
    var title = isSale ? '销售单' : '进货单';
    var partnerLabel = isSale ? '客户' : '供应商';
    var qty = util.sum(doc.items, function (it) { return it.qty; });

    var h = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + ' ' + esc(doc.no) + '</title>' +
      '<style>' + PRINT_CSS + '</style></head><body>';
    // 屏幕操作栏：打印 + 关闭（返回），手机端避免打印页占满屏幕无法退出
    h += '<div class="print-toolbar">' +
      '<button class="pb-print" onclick="window.print()">打印</button>' +
      '<button class="pb-close" onclick="window.close()">关闭</button>' +
      '</div>';
    h += '<div class="doc">';
    h += '<div class="doc-head"><span class="doc-shop">' + esc(shop) + '</span>' +
      '<span class="doc-title">' + esc(title) + '</span>' +
      '<span class="doc-no">No. ' + esc(doc.no) + '</span></div>';
    h += '<div class="doc-meta"><span>日期：' + esc(doc.date) + '</span>' +
      '<span>' + partnerLabel + '：' + esc(doc.partnerName || '散客') + '</span>' +
      '<span>共 ' + qty + ' 件</span></div>';

    // V3.17 问题2：列宽按汉字个数分配（每个汉字 3% 宽），型号列占剩余空间。
    // 列顺序：#(2汉字) 品牌(4) 型号(剩余) 类型(5) 单位(2) [单价/成本(4) 数量(2) 金额(5)]
    // 不带价格版（版本1）去掉单价/成本与金额，仅保留 数量(2)，型号列吃掉更多剩余宽度。
    var UNIT_PCT = 3.0;
    var cols = [
      { head: '#', chars: 2 },
      { head: '品牌', chars: 4 },
      { head: '型号', rest: true },
      { head: '类型', chars: 5 },
      { head: '单位', chars: 2 }
    ];
    if (withPrice) {
      cols.push({ head: isSale ? '单价' : '成本', chars: 4 });
      cols.push({ head: '数量', chars: 2 });
      cols.push({ head: '金额', chars: 5 });
    } else {
      cols.push({ head: '数量', chars: 2 });
    }
    var fixedPct = 0;
    cols.forEach(function (c) { if (!c.rest) fixedPct += c.chars * UNIT_PCT; });
    var restPct = Math.round((100 - fixedPct) * 10) / 10;
    var colgroup = '';
    var thRow = '';
    cols.forEach(function (c) {
      var w = c.rest ? restPct : (Math.round(c.chars * UNIT_PCT * 10) / 10);
      colgroup += '<col style="width:' + w + '%">';
      thRow += '<th>' + c.head + '</th>';
    });
    h += '<table><colgroup>' + colgroup + '</colgroup><thead><tr>' + thRow + '</tr></thead><tbody>';

    doc.items.forEach(function (it, i) {
      var isGift = isSale && it.type === schema.DOC.GIFT;
      var amount = isGift ? 0 : (it.price || 0) * it.qty;
      h += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(it.brand || '') + '</td>' +
        '<td>' + esc(it.model || '') + (isGift ? '（赠）' : '') + '</td>' +
        '<td>' + esc(itemCategory(ctx, it)) + '</td>' +
        '<td>' + esc(it.unit || '') + '</td>';
      if (withPrice) {
        if (isSale) {
          h += '<td>' + (isGift ? '—' : util.fmtYuan(it.price)) + '</td>' +
            '<td>' + it.qty + '</td>' +
            '<td>' + util.fmtYuan(amount) + '</td>';
        } else {
          h += '<td>' + util.fmtYuan(it.costPrice) + '</td>' +
            '<td>' + it.qty + '</td>' +
            '<td>' + util.fmtYuan(it.amount) + '</td>';
        }
      } else {
        h += '<td>' + it.qty + '</td>';
      }
      h += '</tr>';
    });
    h += '</tbody></table>';

    // 合计
    if (withPrice) {
      if (isSale) {
        h += '<div class="doc-total">应收：<b>' + util.fmtYuan(doc.payable) + '</b>' +
          (doc.discount ? '（折扣 ' + util.fmtYuan(doc.discount) + '）' : '') +
          '　实收：' + util.fmtYuan(doc.received) + '　欠款：' + util.fmtYuan(doc.debt) + '</div>';
        if (doc.note) h += '<div class="doc-note">备注：' + esc(doc.note) + '</div>';
      } else {
        h += '<div class="doc-total">合计：<b>' + util.fmtYuan(doc.total) + '</b>' +
          '　已付：' + util.fmtYuan(doc.paid) + '　欠款：' + util.fmtYuan(doc.debt) + '</div>';
        if (doc.note) h += '<div class="doc-note">备注：' + esc(doc.note) + '</div>';
      }
    } else {
      h += '<div class="doc-total">共 ' + qty + ' 件</div>';
      if (doc.note) h += '<div class="doc-note">备注：' + esc(doc.note) + '</div>';
    }

    var who = (ctx && ctx.currentAccount && ctx.currentAccount.username) ? ctx.currentAccount.username : '';
    var now = new Date();
    var ts = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') +
      ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    h += '<div class="doc-sign"><span>制单：' + esc(who) + '</span><span class="sg">经手：</span><span class="sg">客户签字：</span></div>';
    h += '<div class="doc-foot">打印时间：' + ts + '</div>';
    h += '</div></body></html>';
    return h;
  }

  /** 打开独立打印窗口并触发打印 */
  function openPrint(html) {
    if (typeof window === 'undefined' || typeof window.open !== 'function') return false;
    var w = window.open('', '_blank', 'width=820,height=640');
    if (!w) return false;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function () {
      try { w.print(); } catch (e) { /* 忽略 */ }
    }, 300);
    return true;
  }

  return {
    buildDocHtml: buildDocHtml,
    openPrint: openPrint,
    PRINT_CSS: PRINT_CSS
  };
});
