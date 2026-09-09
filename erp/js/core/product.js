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
  /**
   * 批量停售（V3.25）：用于导入后处理「未覆盖清单」中型号标错/已淘汰的旧商品。
   * 只置为停售，绝不删除商品、不动库存、不碰单据与库存流水。
   * @param {Array<string|number>} ids 商品 id 列表
   * @returns {ok, retired, withStock, missing} retired=本次新停售数；withStock=其中有库存的商品数
   */
  api.retireProducts = function retireProducts(ctx, ids) {
    var retired = 0;
    var withStock = 0;
    var missing = 0;
    (ids || []).forEach(function (id) {
      var p = api.getById(ctx, id);
      if (!p) {
        missing += 1;
        return;
      }
      if ((Number(p.stock) || 0) > 0) withStock += 1;
      if (p.status !== schema.STATUS.OFF) {
        api.setStatus(ctx, p.id, schema.STATUS.OFF);
        retired += 1;
      }
    });
    return { ok: true, retired: retired, withStock: withStock, missing: missing };
  };

  api.setStatus = function setStatus(ctx, id, status) {
    var p = api.getById(ctx, id);
    if (!p) return err('商品不存在：' + id);
    p.status = status === schema.STATUS.OFF ? schema.STATUS.OFF : schema.STATUS.ON;
    ctx.touch('products', p);
    return { ok: true, product: p };
  };

  /**
   * 批量删除「未使用」的商品档案（V3.37）：仅删除未被任何单据/库存流水引用的商品；
   * 被进货单/销售单/盘点单/库存流水引用过的商品不可删除（避免破坏历史单据与库存追溯）。
   * @param ctx 上下文
   * @param ids {Array<string|number>} 拟删除的商品 id
   * @returns {{deleted: string[], blocked: Array<{id:string, model:string, refs:string[]}>}}
   */
  api.removeUnused = function removeUnused(ctx, ids) {
    var idList = (ids || []).map(function (x) { return String(x); }).filter(Boolean);
    if (!idList.length) return { deleted: [], blocked: [] };
    var has = {};
    idList.forEach(function (id) { has[id] = true; });

    // 引用扫描：进货单 / 销售单 items[].productId、盘点单 counts 键、库存流水 productId
    var refs = {};
    function ref(id, store) {
      id = String(id);
      if (has[id]) {
        if (!refs[id]) refs[id] = [];
        if (refs[id].indexOf(store) < 0) refs[id].push(store);
      }
    }
    ['purchases', 'sales'].forEach(function (store) {
      (ctx.data[store] || []).forEach(function (doc) {
        (doc.items || []).forEach(function (it) {
          if (it && it.productId !== undefined && it.productId !== null) ref(it.productId, store);
        });
      });
    });
    (ctx.data.stocktakes || []).forEach(function (doc) {
      var counts = doc.counts || {};
      Object.keys(counts).forEach(function (pid) { ref(pid, 'stocktakes'); });
    });
    (ctx.data.stockLogs || []).forEach(function (log) {
      if (log && log.productId !== undefined && log.productId !== null) ref(log.productId, 'stockLogs');
    });

    var list = ctx.data.products || [];
    var deleted = [];
    var blocked = [];
    idList.forEach(function (id) {
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === id) { idx = i; break; }
      }
      if (idx < 0) return; // 不存在，忽略
      if (refs[id] && refs[id].length) {
        blocked.push({ id: id, model: list[idx].model || '', refs: refs[id] });
        return;
      }
      var rec = list[idx];
      list.splice(idx, 1);
      rec.__deleted = true; // 持久层标记删除（flush 识别后走 db.del）
      ctx.touch('products', rec);
      deleted.push(id);
    });
    return { deleted: deleted, blocked: blocked };
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
    var pre = prepareRows(rows);
    var result = {
      created: 0, updated: 0, total: pre.base.total, skipped: pre.base.skipped,
      deduplicated: pre.base.deduplicated, merged: 0, errors: pre.base.errors,
      uncovered: [], transferred: 0
    };
    if (!pre.map || !pre.cell) return result;
    var cell = pre.cell;
    var order = pre.order;
    var picked = pre.picked;
    var importKeys = {};

    // —— 规则2/3/4：按去重后的行逐条导入（纯型号匹配） ——
    order.forEach(function (key) {
      var entry = picked[key];
      var row = entry.row;
      var rowNo = entry.rowNo;
      importKeys[key] = true;
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
      var keep = pickKeep(same, brand);

      input.id = keep.id;
      input.status = schema.STATUS.ON; // 导入即视为有效商品，恢复在售
      var r2 = api.save(ctx, input);
      if (!r2.ok) {
        result.errors.push({ row: rowNo, msg: r2.error });
        return;
      }
      result.updated += 1;

      // 其余同型号商品：置为停售（绝不删除商品/单据/库存流水），
      // V3.25：其名下库存通过盘点调整单转入保留商品，避免库存“消失”在停售商品上。
      var transfer = 0;
      var fromIds = [];
      same.forEach(function (p) {
        if (String(p.id) === String(keep.id)) return;
        if (p.status !== schema.STATUS.OFF) api.setStatus(ctx, p.id, schema.STATUS.OFF);
        var qty = Number(p.stock) || 0;
        if (qty > 0) {
          transfer += qty;
          fromIds.push(String(p.id));
        }
        result.merged += 1;
      });
      if (transfer > 0) {
        var counts = {};
        counts[String(keep.id)] = (Number(keep.stock) || 0) + transfer;
        fromIds.forEach(function (id) { counts[id] = 0; });
        var st = inv.applyStocktake(ctx, {
          date: util.today(),
          counts: counts,
          note: '批量导入合并同型号商品，库存转入保留商品（' + brand + ' ' + model + '）'
        }, undefined);
        if (st && st.ok !== false) result.transferred += transfer;
        else result.errors.push({
          row: rowNo,
          msg: '库存转入失败（商品已导入，库存未转移）：' + ((st && st.error) || '未知原因')
        });
      }
    });

    // V3.25：系统中未被本次导入覆盖的商品（型号对不上或已淘汰）——
    // 它们不会被任何规则处理，导入后仍在售，列出供用户手动核对。
    (ctx.data.products || []).forEach(function (p) {
      if (importKeys[api.normModelKey(p.model)]) return;
      result.uncovered.push({
        id: p.id, brand: p.brand, model: p.model,
        category: p.category || '', stock: p.stock || 0, status: p.status
      });
    });

    return result;
  };

  /* ---------------- 批量导入：共用预解析 / 预演（V3.25） ---------------- */

  /**
   * 导入预解析：表头映射 + 文件内去重，供 importFromRows 与 previewImport 共用。
   * @returns {base:{total,skipped,deduplicated,errors}, map, cell, picked, order}
   *          map/cell 为 null 时表示表头不可用，调用方直接返回 base 结果。
   */
  function prepareRows(rows) {
    var base = { total: 0, skipped: 0, deduplicated: 0, errors: [] };
    var out = { base: base, map: null, cell: null, picked: {}, order: [] };
    if (!rows || !rows.length) return out;
    base.total = rows.length - 1; // 数据行总数（不含表头）
    var map = api.mapHeaders(rows[0]);
    if (Object.keys(map).length === 0) {
      base.errors.push({ row: 1, msg: '表头需包含 品牌、型号、类型 等列' });
      return out;
    }
    out.map = map;
    out.cell = function cell(row, field) {
      var idx = null;
      Object.keys(map).forEach(function (i) {
        if (map[i] === field) idx = parseInt(i, 10);
      });
      if (idx === null) return '';
      return row[idx] === null || row[idx] === undefined ? '' : String(row[idx]).trim();
    };

    // 规则1：文件内按型号去重，同一型号保留最后一行
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.every(function (v) { return v === '' || v === null || v === undefined; })) {
        base.skipped += 1; // 空行：明确计数，不再静默消失
        continue;
      }
      var b = out.cell(row, 'brand');
      var m = out.cell(row, 'model');
      if (!b || !m) {
        base.errors.push({ row: i + 1, msg: '品牌和型号必填' });
        continue;
      }
      var key = api.normModelKey(m);
      if (out.picked[key]) base.deduplicated += 1; // 文件内重复行（后一行覆盖前一行）
      else out.order.push(key);
      out.picked[key] = { row: row, rowNo: i + 1 };
    }
    return out;
  }

  /**
   * 同型号多个商品时选择保留哪一个：
   * 优先保留「品牌+型号」与导入完全一致的商品，否则保留最早建档的那个。
   */
  function pickKeep(same, brand) {
    var target = String(brand || '').trim().toUpperCase();
    for (var k = 0; k < same.length; k++) {
      if (String(same[k].brand || '').trim().toUpperCase() === target) return same[k];
    }
    return same[0];
  }

  /**
   * 计算导入行的最终金额（与 save 内部逻辑一致）：
   * 成本 parseMoney；批发/零售价留空时按系统利润率自动生成（取整到元）。
   * @returns {cost, priceWholesale, priceRetail} 单位「分」
   */
  api.resolveImportPrices = function resolveImportPrices(ctx, costStr, wStr, rStr) {
    var cost = util.parseMoney(costStr);
    var hasW = !(wStr === undefined || wStr === null || String(wStr).trim() === '');
    var hasR = !(rStr === undefined || rStr === null || String(rStr).trim() === '');
    var w = hasW ? util.parseMoney(wStr) : 0;
    var r = hasR ? util.parseMoney(rStr) : 0;
    if (!hasW || !hasR) {
      var auto = api.autoPrices(ctx, cost);
      if (!hasW) w = auto.priceWholesale;
      if (!hasR) r = auto.priceRetail;
    }
    return { cost: cost, priceWholesale: w, priceRetail: r };
  };

  /**
   * 导入预演（V3.25）：**不写库**，仅计算本次导入会产生什么变化，供用户在执行前核对。
   * @param rows 二维数组（第一行为表头）
   * @returns {total, skipped, deduplicated, creates:[], updates:[], merges:[], uncovered:[], errors:[]}
   *          creates  {rowNo, brand, model, category, unit, cost, priceWholesale, priceRetail, openingStock}
   *          updates  {rowNo, productId, brand, model, changes:[{label, from, to}]}
   *          merges   {productId, brand, model, stock, status} 将被置为停售的同型号商品
   *          uncovered{id, brand, model, category, stock, status} 系统中未被本次导入覆盖的商品
   */
  api.previewImport = function previewImport(rows, ctx) {
    var plan = {
      total: 0, skipped: 0, deduplicated: 0,
      creates: [], updates: [], merges: [], uncovered: [], errors: []
    };
    var pre = prepareRows(rows);
    plan.total = pre.base.total;
    plan.skipped = pre.base.skipped;
    plan.deduplicated = pre.base.deduplicated;
    plan.errors = pre.base.errors.slice();
    if (!pre.map || !pre.cell) return plan;
    var cell = pre.cell;
    var importKeys = {};

    pre.order.forEach(function (key) {
      var entry = pre.picked[key];
      var row = entry.row;
      var rowNo = entry.rowNo;
      var brand = cell(row, 'brand');
      var model = cell(row, 'model');
      importKeys[key] = true;
      var category = cell(row, 'category') || '其他';
      var unit = cell(row, 'unit') || '台';
      var prices = api.resolveImportPrices(
        ctx, cell(row, 'cost'), cell(row, 'priceWholesale'), cell(row, 'priceRetail')
      );

      var same = api.findAllByModel(ctx, model);

      // 规则3：系统中无此型号 → 新建
      if (same.length === 0) {
        plan.creates.push({
          rowNo: rowNo, brand: brand, model: model, category: category, unit: unit,
          cost: prices.cost, priceWholesale: prices.priceWholesale, priceRetail: prices.priceRetail,
          openingStock: parseInt(cell(row, 'openingStock'), 10) || 0
        });
        return;
      }

      // 规则2/4：系统已有此型号 → 计算变更明细 + 其余合并停售
      var keep = pickKeep(same, brand);
      var changes = [];
      function chg(label, from, to) {
        var a = String(from === null || from === undefined ? '' : from);
        var b = String(to === null || to === undefined ? '' : to);
        if (a !== b) changes.push({ label: label, from: a, to: b });
      }
      chg('品牌', keep.brand, brand);
      chg('类型', keep.category, category);
      chg('单位', keep.unit, unit);
      chg('成本', util.fenToYuan(keep.cost || 0), util.fenToYuan(prices.cost));
      chg('批发价', util.fenToYuan(keep.priceWholesale || 0), util.fenToYuan(prices.priceWholesale));
      chg('零售价', util.fenToYuan(keep.priceRetail || 0), util.fenToYuan(prices.priceRetail));
      var note = cell(row, 'note');
      if (note) chg('备注', keep.note || '', note);
      var bc = cell(row, 'barcodes');
      if (bc) {
        chg('原厂条码', (keep.barcodes || []).join(','),
          api.normBarcodes(typeof bc === 'string' ? [bc] : (bc || [])).join(','));
      }

      plan.updates.push({
        rowNo: rowNo, productId: keep.id, brand: brand, model: model,
        keepBrand: keep.brand, changes: changes
      });

      same.forEach(function (p) {
        if (String(p.id) === String(keep.id)) return;
        plan.merges.push({
          productId: p.id, brand: p.brand, model: p.model,
          stock: p.stock || 0, status: p.status
        });
      });
    });

    // 系统中未被本次导入覆盖的商品（型号对不上或已淘汰），由用户手动核对
    (ctx.data.products || []).forEach(function (p) {
      if (importKeys[api.normModelKey(p.model)]) return;
      plan.uncovered.push({
        id: p.id, brand: p.brand, model: p.model,
        category: p.category || '', stock: p.stock || 0, status: p.status
      });
    });

    return plan;
  };

  return api;
});
