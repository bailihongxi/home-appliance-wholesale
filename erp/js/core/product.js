/**
 * core/product.js —— 商品档案纯逻辑（电器版单层商品）
 * 字段：id, brand, model, category, unit, cost, priceWholesale, priceRetail,
 *       stock(由单据驱动), note, barcodes[], status, createdAt, updatedAt
 * 金额一律「分」；成本/批发价/零售价由调用方先用 util.parseMoney 转「分」。
 * 不碰 DOM / IndexedDB，可在 Node 中完整测试。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : (root.ERP && root.ERP.util);
  var schema = isNode ? require('./schema.js') : (root.ERP && root.ERP.schema);
  var inv = isNode ? require('./inventory.js') : (root.ERP && root.ERP.inventory);
  var mod = factory(util, schema, inv);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.product = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema, inv) {
  'use strict';

  var api = {};

  function err(msg) {
    return { ok: false, error: msg };
  }

  /** 归一化原厂条码数组：拆分分隔（逗号/换行/分号）、去空白、转大写、去空 */
  api.normBarcodes = function normBarcodes(list) {
    var out = [];
    (list || []).forEach(function (b) {
      String(b == null ? '' : b)
        .split(/[\s,，;；\n\r]+/)
        .forEach(function (piece) {
          var p = String(piece).trim().toUpperCase();
          if (p) out.push(p);
        });
    });
    // 去重
    return out.filter(function (v, i) {
      return out.indexOf(v) === i;
    });
  };

  /** 生成下一个商品自增 id（p1, p2, …） */
  api.nextId = function nextId(ctx) {
    var max = 0;
    (ctx.data.products || []).forEach(function (p) {
      var m = /^p(\d+)$/.exec(String(p.id));
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    });
    return 'p' + (max + 1);
  };

  /** 品牌+型号 查重（排除 id=excludeId 的商品）；返回重复商品或 null */
  api.findDuplicate = function findDuplicate(ctx, brand, model, excludeId) {
    var b = String(brand || '').trim().toUpperCase();
    var m = String(model || '').trim().toUpperCase();
    if (!b || !m) return null;
    return (ctx.data.products || []).find(function (p) {
      if (excludeId && String(p.id) === String(excludeId)) return false;
      return String(p.brand || '').trim().toUpperCase() === b &&
        String(p.model || '').trim().toUpperCase() === m;
    }) || null;
  };

  /** 按型号查商品（仅型号匹配，不分品牌；批量导入更新用），返回第一个或 null */
  api.findByModel = function findByModel(ctx, model) {
    var m = String(model || '').trim().toUpperCase();
    if (!m) return null;
    return (ctx.data.products || []).find(function (p) {
      return String(p.model || '').trim().toUpperCase() === m;
    }) || null;
  };

  /**
   * 型号规范化键：去掉所有空白 + 转大写。
   * 用于批量导入的匹配与去重——忽略空格与大小写差异
   *（如 86Q8E / 86Q8 E / 86q8e 视为同一型号），避免同一产品重复建档。
   */
  api.normModelKey = function normModelKey(model) {
    return String(model == null ? '' : model).replace(/\s+/g, '').toUpperCase();
  };

  /** 按型号查所有同型号商品（规范化匹配，不分品牌）；返回数组，无则 [] */
  api.findAllByModel = function findAllByModel(ctx, model) {
    var key = api.normModelKey(model);
    if (!key) return [];
    return (ctx.data.products || []).filter(function (p) {
      return api.normModelKey(p.model) === key;
    });
  };

  /** 按商品 id 取商品 */
  api.getById = function getById(ctx, id) {
    return (ctx.data.products || []).find(function (p) {
      return String(p.id) === String(id);
    }) || null;
  };

  /**
   * 保存商品（新建或编辑）
   * @param ctx 工作上下文
   * @param input {
   *   id?, brand, model, category, unit,
   *   cost, priceWholesale, priceRetail,  // 「元」字符串或数字，内部 parseMoney 转分
   *   note?, barcodes?(数组或字符串), openingStock?(期初库存，仅新建时生效), status?
   * }
   * 期初库存：走盘点调整（stocktake）写入库存流水，库存由单据派生（D2 已确认）。
   */
  /**
   * 价格体系：按系统整体利润率（settings.wholesaleMargin / retailMargin，%）生成批发价/零售价。
   * costFen 为成本（分）。结果取整到元（无小数），返回 { priceWholesale, priceRetail }（分）。
   * 成本为空/为 0 时返回 0。
   */
  api.autoPrices = function autoPrices(ctx, costFen) {
    var st = (ctx && ctx.settings) || {};
    var w = st.wholesaleMargin == null ? 20 : Number(st.wholesaleMargin);
    var r = st.retailMargin == null ? 35 : Number(st.retailMargin);
    function calc(margin) {
      var c = Number(costFen) || 0;
      if (!(c > 0)) return 0;
      var yuan = Math.round(c * (1 + margin / 100) / 100); // 元取整（不含小数点）
      return Math.max(0, yuan) * 100; // 转分
    }
    return { priceWholesale: calc(w), priceRetail: calc(r) };
  };

  api.save = function save(ctx, input) {
    input = input || {};
    var brand = util.cleanText(input.brand);
    var model = util.cleanText(input.model);
    var category = util.cleanText(input.category);
    var unit = util.cleanText(input.unit) || '台';
    if (!brand) return err('请填写品牌');
    if (!model) return err('请填写型号');
    if (!category) return err('请选择类型');

    var cost = util.parseMoney(input.cost);
    // 未自定义价格（留空/未填）→ 按系统利润率自动生成（取整到元）；已填则保留用户自定义
    var hasCustomW = !(input.priceWholesale === undefined || input.priceWholesale === null || String(input.priceWholesale).trim() === '');
    var hasCustomR = !(input.priceRetail === undefined || input.priceRetail === null || String(input.priceRetail).trim() === '');
    var priceWholesale = hasCustomW ? util.parseMoney(input.priceWholesale) : 0;
    var priceRetail = hasCustomR ? util.parseMoney(input.priceRetail) : 0;
    if (!hasCustomW || !hasCustomR) {
      var auto = api.autoPrices(ctx, cost);
      if (!hasCustomW) priceWholesale = auto.priceWholesale;
      if (!hasCustomR) priceRetail = auto.priceRetail;
    }
    var autoPriced = !hasCustomW || !hasCustomR;
    if (cost < 0) return err('成本不能为负');
    if (priceWholesale < 0) return err('批发价不能为负');
    if (priceRetail < 0) return err('零售价不能为负');

    var isNew = !input.id;
    var dup = api.findDuplicate(ctx, brand, model, input.id);
    if (dup) return err('该品牌型号已存在（' + dup.brand + ' ' + dup.model + '）');

    var rec;
    if (isNew) {
      rec = {
        id: api.nextId(ctx),
        brand: brand,
        model: model,
        category: category,
        unit: unit,
        cost: cost,
        priceWholesale: priceWholesale,
        priceRetail: priceRetail,
        stock: 0,
        note: util.cleanText(input.note || ''),
        barcodes: api.normBarcodes(
          typeof input.barcodes === 'string' ? [input.barcodes] : (input.barcodes || [])
        ),
        status: input.status === schema.STATUS.OFF ? schema.STATUS.OFF : schema.STATUS.ON,
        createdAt: util.nowISO()
      };
      ctx.data.products = ctx.data.products || [];
      ctx.data.products.push(rec);
    } else {
      rec = api.getById(ctx, input.id);
      if (!rec) return err('商品不存在：' + input.id);
      rec.brand = brand;
      rec.model = model;
      rec.category = category;
      rec.unit = unit;
      rec.cost = cost;
      rec.priceWholesale = priceWholesale;
      rec.priceRetail = priceRetail;
      if (input.note !== undefined) rec.note = util.cleanText(input.note || '');
      if (input.barcodes !== undefined && input.barcodes !== null) {
        rec.barcodes = api.normBarcodes(
          typeof input.barcodes === 'string' ? [input.barcodes] : (input.barcodes || [])
        );
      }
      if (input.status === schema.STATUS.OFF || input.status === schema.STATUS.ON) {
        rec.status = input.status;
      }      rec.updatedAt = util.nowISO();
    }
    ctx.touch('products', rec);

    // 期初库存（仅新建时提供）：生成盘点调整单写入库存
    if (isNew) {
      var open = parseInt(input.openingStock, 10);
      if (!isNaN(open) && open > 0) {
        var st = inv.applyStocktake(ctx, {
          date: util.today(),
          counts: (function () {
            var c = {};
            c[rec.id] = open;
            return c;
          })(),
          note: '期初库存'
        }, undefined);
        if (!st.ok) {
          // 期初失败不应阻断建档，但给出提示（正常不会发生）
          return { ok: true, product: rec, openingWarning: (st.errors || []).join('；') || '期初库存写入失败' };
        }
      }
    }

    // 问题2：新类型自动并入账号经营范围，保证列表可见且下拉建议持续包含该类型
    ensureScopeCategory(ctx, category);

    return { ok: true, product: rec, isNew: isNew, autoPriced: autoPriced };
  };

  /** 若类型不在账号经营范围（scope 非空时），自动并入 scopeCategories */
  function ensureScopeCategory(ctx, category) {
    if (!ctx || !ctx.settings || !category) return false;
    var sc = ctx.settings.scopeCategories;
    if (!sc || !sc.length) return false; // 空 scope=不限制，无需并入
    if (sc.indexOf(category) >= 0) return false;
    sc.push(category);
    return true;
  }

  /** 停售 / 恢复在售（不删除数据） */
  api.setStatus = function setStatus(ctx, id, status) {
    var p = api.getById(ctx, id);
    if (!p) return err('商品不存在：' + id);
    p.status = status === schema.STATUS.OFF ? schema.STATUS.OFF : schema.STATUS.ON;
    ctx.touch('products', p);
    return { ok: true, product: p };
  };

  /** 商品对外展示名：品牌 + 型号 */
  api.displayName = function displayName(p) {
    if (!p) return '';
    return [p.brand, p.model].filter(function (s) {
      return String(s || '').trim();
    }).join(' ');
  };

  /** 按关键字搜索商品（品牌/型号/备注/类型） */
  api.search = function search(ctx, keyword) {
    var k = String(keyword || '').trim().toUpperCase();
    if (!k) return (ctx.data.products || []).slice();
    return (ctx.data.products || []).filter(function (p) {
      return String(p.brand || '').toUpperCase().indexOf(k) >= 0 ||
        String(p.model || '').toUpperCase().indexOf(k) >= 0 ||
        String(p.note || '').toUpperCase().indexOf(k) >= 0 ||
        String(p.category || '').toUpperCase().indexOf(k) >= 0;
    });
  };

  /** CSV 表头列名映射（兼容中英文） */
  var CSV_HEADERS = {
    brand: ['品牌', 'brand'],
    model: ['型号', 'model'],
    category: ['类型', '类别', 'category'],
    unit: ['单位', 'unit'],
    cost: ['成本', '进价', '进货价', 'cost'],
    priceWholesale: ['批发价', '批发', 'pricewholesale'],
    priceRetail: ['零售价', '零售', '售价', 'priceretail'],
    note: ['备注', 'note'],
    barcodes: ['原厂条码', '条码', 'barcode', 'barcodes'],
    openingStock: ['期初库存', '期初', 'openingstock']
  };

  /** 表头行 → 列名映射 {csvHeaderLower: field} */
  api.mapHeaders = function mapHeaders(headers) {
    var map = {};
    (headers || []).forEach(function (h, idx) {
      var key = String(h || '').trim().toLowerCase();
      if (!key) return;
      var matched = null;
      Object.keys(CSV_HEADERS).forEach(function (f) {
        if (matched) return;
        if (CSV_HEADERS[f].indexOf(key) >= 0) matched = f;
      });
      if (matched) map[idx] = matched;
    });
    return map;
  };

  /**
   * 合并多个工作表的行（V3.22 多表导入用）：
   * 第一个工作表整表保留（含表头）；后续工作表若首行能识别为表头（≥2 个已知列名）则剥离后追加。
   * @param sheets [{name, rows}]（excel.parseAll 输出）
   * @returns 合并后的二维数组（首行为表头）
   */
  api.mergeSheetRows = function mergeSheetRows(sheets) {
    var out = [];
    (sheets || []).forEach(function (sh) {
      var rows = (sh && sh.rows) || [];
      if (!rows.length) return;
      if (out.length === 0) {
        out = rows.slice();
        return;
      }
      var isHeader = Object.keys(api.mapHeaders(rows[0])).length >= 2;
      out = out.concat(isHeader ? rows.slice(1) : rows);
    });
    return out;
  };

  /**
   * CSV 行导入（电器版）：表头 + 数据行 → 商品
   * 导入规则（V3.24 用户确认）：
   *   匹配模式：仅按「型号」匹配（不使用 品牌+型号）；型号规范化后忽略空格与大小写差异。
   *   规则1 去重：文件内同一型号出现多行时去重，保留最后一行（后出现的为准）。
   *   规则2 更新：系统已存在该型号 → 以导入信息为准更新 品牌/类型/单位/成本/备注；
   *              备注与原厂条码单元格为空时保留系统已有值（不误清空）；不改动现有库存。
   *   规则3 新建：系统无该型号 → 正常导入本行全量信息（含期初库存）。
   *   规则4 合并：同一型号在系统中存在多个商品（不同品牌/价格）→ 合并保留：
   *              保留一个用导入信息全量更新（并恢复在售），其余仅置为「停售」；
   *              绝不删除商品/单据/库存流水，也不改动任何库存数据。
   * @param rows 二维数组（第一行为表头），与 util.parseCSV 输出同构
   * @returns {created, updated, total, skipped, deduplicated, merged, errors:[{row,msg}]}
   *          total=数据行总数（不含表头）；skipped=空行数；
   *          deduplicated=文件内去重行数；merged=被合并停售的同型号商品数
   */
  api.importFromRows = function importFromRows(rows, ctx) {
    var result = {
      created: 0, updated: 0, total: 0, skipped: 0,
      deduplicated: 0, merged: 0, errors: []
    };
    if (!rows || !rows.length) return result;
    result.total = rows.length - 1; // 数据行总数（不含表头）
    var map = api.mapHeaders(rows[0]);
    var hasKey = Object.keys(map).length > 0;
    if (!hasKey) {
      result.errors.push({ row: 1, msg: '表头需包含 品牌、型号、类型 等列' });
      return result;
    }
    function cell(row, field) {
      var idx = null;
      Object.keys(map).forEach(function (i) {
        if (map[i] === field) idx = parseInt(i, 10);
      });
      if (idx === null) return '';
      return row[idx] === null || row[idx] === undefined ? '' : String(row[idx]).trim();
    }

    // —— 规则1：文件内按型号去重，同一型号保留最后一行 ——
    var order = [];
    var picked = {};
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.every(function (v) { return v === '' || v === null || v === undefined; })) {
        result.skipped += 1; // 空行：明确计数，不再静默消失
        continue;
      }
      var b = cell(row, 'brand');
      var m = cell(row, 'model');
      if (!b || !m) {
        result.errors.push({ row: i + 1, msg: '品牌和型号必填' });
        continue;
      }
      var key = api.normModelKey(m);
      if (picked[key]) result.deduplicated += 1; // 文件内重复行（后一行覆盖前一行）
      else order.push(key);
      picked[key] = { row: row, rowNo: i + 1 };
    }

    // —— 规则2/3/4：按去重后的行逐条导入（纯型号匹配） ——
    order.forEach(function (key) {
      var entry = picked[key];
      var row = entry.row;
      var rowNo = entry.rowNo;
      var brand = cell(row, 'brand');
      var model = cell(row, 'model');

      var input = {
        brand: brand,
        model: model,
        category: cell(row, 'category') || '其他',
        unit: cell(row, 'unit') || '台',
        cost: cell(row, 'cost'),
        priceWholesale: cell(row, 'priceWholesale'),
        priceRetail: cell(row, 'priceRetail'),
        openingStock: cell(row, 'openingStock')
      };
      // 备注/条码：单元格为空时保留系统已有值，避免误清空（影响扫码与已有备注）
      var note = cell(row, 'note');
      if (note) input.note = note;
      var bc = cell(row, 'barcodes');
      if (bc) input.barcodes = bc;

      var same = api.findAllByModel(ctx, model);

      // 规则3：系统中无此型号 → 新建，导入本行全量信息（含期初库存）
      if (same.length === 0) {
        var r = api.save(ctx, input);
        if (r.ok) result.created += 1;
        else result.errors.push({ row: rowNo, msg: r.error });
        return;
      }

      // 规则2/4：系统已有此型号 → 合并保留
      // 保留策略：优先保留「品牌+型号」与导入完全一致的商品，否则保留最早建档的那个。
      // 这样既以导入信息为准，又不会与其余同型号商品撞上品牌+型号查重而报错。
      var keep = null;
      for (var k = 0; k < same.length; k++) {
        if (String(same[k].brand || '').trim().toUpperCase() === String(brand || '').trim().toUpperCase()) {
          keep = same[k];
          break;
        }
      }
      if (!keep) keep = same[0];

      input.id = keep.id;
      input.status = schema.STATUS.ON; // 导入即视为有效商品，恢复在售
      var r2 = api.save(ctx, input);
      if (!r2.ok) {
        result.errors.push({ row: rowNo, msg: r2.error });
        return;
      }
      result.updated += 1;

      // 其余同型号商品：仅置为停售，绝不删除商品/单据/库存流水，也不改动库存
      same.forEach(function (p) {
        if (String(p.id) === String(keep.id)) return;
        if (p.status !== schema.STATUS.OFF) api.setStatus(ctx, p.id, schema.STATUS.OFF);
        result.merged += 1;
      });
    });

    return result;
  };

  return api;
});
