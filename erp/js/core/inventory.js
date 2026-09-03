/**
 * core/inventory.js —— 库存增减、预警、盘点差异（电器版：商品级单一数量，无 SKU/矩阵）
 * 约束（PRD 6）：库存只能由单据派生，本模块是唯一改库存的入口。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var schema = isNode ? require('./schema.js') : root.ERP && root.ERP.schema;
  var mod = factory(util, schema);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.inventory = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema) {
  'use strict';

  var inv = {};

  /** 单个商品增减库存并写变动流水（唯一入口） */
  inv.changeStock = function changeStock(ctx, productId, delta, refType, refNo, date) {
    var product = (ctx.data.products || []).find(function (p) {
      return String(p.id) === String(productId);
    });
    if (!product) return { ok: false, error: '商品不存在：' + productId };
    var before = product.stock || 0;
    var after = before + delta;
    if (after < 0) {
      return {
        ok: false,
        error: '库存不足：' + product.brand + ' ' + product.model + ' 当前 ' + before + '，需要出库 ' + Math.abs(delta)
      };
    }
    product.stock = after;
    product.updatedAt = util.nowISO(); // 库存变动时间戳，供跨端同步按“较新”合并
    ctx.touch('products', product);

    var log = {
      id: util.uuid('sl'),
      date: date || util.today(),
      productId: String(productId),
      delta: delta,
      balance: after,
      refType: refType,
      refNo: refNo || ''
    };
    ctx.data.stockLogs = ctx.data.stockLogs || [];
    ctx.data.stockLogs.push(log);
    ctx.touch('stockLogs', log);
    return { ok: true, product: product, log: log, before: before, after: after };
  };

  /** 进货入库：每个明细 stock += qty */
  inv.applyPurchase = function applyPurchase(ctx, doc) {
    var results = [];
    for (var i = 0; i < doc.items.length; i++) {
      var it = doc.items[i];
      results.push(inv.changeStock(ctx, it.productId, it.qty, schema.DOC.PURCHASE, doc.no, doc.date));
    }
    var bad = results.filter(function (r) {
      return !r.ok;
    });
    return { ok: bad.length === 0, results: results, errors: bad.map(function (r) {
      return r.error;
    }) };
  };

  /** 销售/赠送出库、退货入库 */
  inv.applySale = function applySale(ctx, doc) {
    var results = [];
    for (var i = 0; i < doc.items.length; i++) {
      var it = doc.items[i];
      var delta = doc.type === schema.DOC.REFUND ? it.qty : -it.qty;
      var refType = doc.type === schema.DOC.REFUND
        ? schema.DOC.REFUND
        : it.type === schema.DOC.GIFT
          ? schema.DOC.GIFT
          : schema.DOC.SALE;
      results.push(inv.changeStock(ctx, it.productId, delta, refType, doc.no, doc.date));
    }
    var bad = results.filter(function (r) {
      return !r.ok;
    });
    return { ok: bad.length === 0, results: results, errors: bad.map(function (r) {
      return r.error;
    }) };
  };

  /** 单据作废：库存反向回滚，并写反向流水留痕 */
  inv.reverseDoc = function reverseDoc(ctx, doc, refType) {
    var results = [];
    for (var i = 0; i < (doc.items || []).length; i++) {
      var it = doc.items[i];
      var delta;
      if (refType === schema.DOC.PURCHASE) delta = -it.qty;
      else if (doc.type === schema.DOC.REFUND) delta = -it.qty;
      else delta = it.qty;
      results.push(inv.changeStock(ctx, it.productId, delta, 'void', doc.no, util.today()));
    }
    var bad = results.filter(function (r) {
      return !r.ok;
    });
    return { ok: bad.length === 0, results: results, errors: bad.map(function (r) {
      return r.error;
    }) };
  };

  /** 某商品的当前进价（直接用档案 cost） */
  inv.costOf = function costOf(ctx, productId) {
    var p = (ctx.data.products || []).find(function (x) {
      return String(x.id) === String(productId);
    });
    return p ? p.cost || 0 : 0;
  };

  /** 预警列表：库存低于阈值的在售商品 */
  inv.getAlerts = function getAlerts(ctx, opts) {
    opts = opts || {};
    var out = [];
    (ctx.data.products || []).forEach(function (p) {
      if (!opts.includeOff && p.status === schema.STATUS.OFF) return;
      var threshold = ctx.settings.defaultThreshold == null ? 3 : ctx.settings.defaultThreshold;
      var stock = p.stock || 0;
      if (opts.onlyEmpty ? stock <= 0 : stock < threshold) {
        out.push({
          productId: p.id,
          brand: p.brand,
          model: p.model,
          category: p.category,
          unit: p.unit,
          stock: stock,
          threshold: threshold,
          empty: stock <= 0
        });
      }
    });
    return util.sortBy(out, function (a) {
      return a.stock;
    });
  };

  /** 预警款数（首页用） */
  inv.alertStyleCount = function alertStyleCount(ctx) {
    return inv.getAlerts(ctx).length;
  };

  /**
   * 盘点：counts = { productId: 实盘数 }
   * 生成盘点单（含差异明细），库存更新到实盘数并留痕
   */
  inv.applyStocktake = function applyStocktake(ctx, input, docNoStr) {
    var date = input.date || util.today();
    var counts = input.counts || {};
    var items = [];
    var keys = Object.keys(counts);
    for (var i = 0; i < keys.length; i++) {
      var productId = keys[i];
      var p = (ctx.data.products || []).find(function (x) {
        return String(x.id) === String(productId);
      });
      if (!p) return { ok: false, error: '商品不存在：' + productId };
      var real = parseInt(counts[productId], 10);
      if (isNaN(real) || real < 0) return { ok: false, error: '实盘数不合法：' + (counts[productId] || '空') };
      var book = p.stock || 0;
      var diff = real - book;
      items.push({
        productId: String(productId),
        brand: p.brand,
        model: p.model,
        unit: p.unit,
        bookQty: book,
        realQty: real,
        diff: diff,
        costSnapshot: p.cost || 0
      });
    }

    var no = docNoStr || 'T' + util.compactDate(date) + '-' + util.pad(
      ((ctx.data.stocktakes || []).filter(function (d) {
        return String(d.no).indexOf('T' + util.compactDate(date)) === 0;
      }).length) + 1, 3
    );
    var doc = {
      no: no,
      date: date,
      type: schema.DOC.STOCKTAKE,
      items: items,
      diffCount: items.filter(function (it) {
        return it.diff !== 0;
      }).length,
      diffQty: items.reduce(function (t, it) {
        return t + it.diff;
      }, 0),
      note: input.note || '',
      voided: false,
      createdAt: util.nowISO()
    };

    var results = [];
    items.forEach(function (it) {
      if (it.diff !== 0) {
        results.push(inv.changeStock(ctx, it.productId, it.diff, schema.DOC.STOCKTAKE, no, date));
      }
    });
    var bad = results.filter(function (r) {
      return !r.ok;
    });

    ctx.data.stocktakes = ctx.data.stocktakes || [];
    ctx.data.stocktakes.push(doc);
    ctx.touch('stocktakes', doc);

    return {
      ok: bad.length === 0,
      doc: doc,
      errors: bad.map(function (r) {
        return r.error;
      })
    };
  };

  /** 库存资金占用 = Σ(当前库存 × 最新成本) */
  inv.stockValue = function stockValue(ctx) {
    var total = 0;
    (ctx.data.products || []).forEach(function (p) {
      if (p.status === schema.STATUS.OFF) return;
      total += (p.stock || 0) * (p.cost || 0);
    });
    return total;
  };

  /** 某商品的出入明细（按时间倒序） */
  inv.logsOfProduct = function logsOfProduct(ctx, productId) {
    return util.sortBy(
      (ctx.data.stockLogs || []).filter(function (l) {
        return String(l.productId) === String(productId);
      }),
      function (l) {
        return l.date + (l.id || '');
      },
      true
    );
  };

  return inv;
});
