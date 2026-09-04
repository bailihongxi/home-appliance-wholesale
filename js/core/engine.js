/**
 * core/engine.js —— 单据事务编排层（电器版）
 * 「单据是唯一事实来源」：一张单据保存 = 库存 + 流水 + 欠款 三本账同时更新。
 * 本层只操作 ctx（纯数据），落库由 store/repo 负责，因此可在 Node 中完整测试。
 * 电器版：明细引用商品（productId），无 SKU；销售支持 批发/零售 双价（priceType）。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('./util.js') : null),
    E.schema || (isNode ? require('./schema.js') : null),
    E.docNo || (isNode ? require('./docNo.js') : null),
    E.inventory || (isNode ? require('./inventory.js') : null),
    E.ledger || (isNode ? require('./ledger.js') : null),
    E.debt || (isNode ? require('./debt.js') : null),
    E.cart || (isNode ? require('./cart.js') : null),
    E.repo || (isNode ? require('../store/repo.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.engine = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, schema, docNo, inv, ledger, debt, cart, repo, ERP) {
  'use strict';

  var engine = {};

  /** 拿到操作日志写入器（兜底顺序问题） */
  function repoRef() {
    var r = (ERP && ERP.repo) || repo;
    return (r && typeof r.log === 'function') ? r : null;
  }
  /** 写入操作日志（兜底：repo 暂未注入时不抛错，仅落 console.warn） */
  function writeLog(ctx, action, detail) {
    var r = repoRef();
    if (r && typeof r.log === 'function') { r.log(ctx, action, detail); return; }
    if (typeof console !== 'undefined') {
      console.warn('[操作日志未写入] ' + action + ' ' + (detail || ''));
    }
  }
  function err(msg) {
    return { ok: false, error: msg };
  }
  /** 按 id 取商品（延迟读 ctx，避免顺序问题） */
  function getProduct(ctx, id) {
    return (ctx.data.products || []).find(function (p) {
      return String(p.id) === String(id);
    }) || null;
  }

  /* =========================================================
   *  进货单
   * ========================================================= */

  /**
   * @param input {date, partnerId|partnerName, phone, items:[{productId, qty, costPrice}], paid, note}
   * 保存后把该商品档案成本同步更新为本次进货单价（D1 已确认）；历史单据成本走快照不受影响。
   */
  engine.savePurchase = function savePurchase(ctx, input) {
    input = input || {};
    var date = input.date || util.today();
    var items = (input.items || []).filter(function (it) {
      return it && it.productId && parseInt(it.qty, 10) > 0;
    });
    if (!items.length) return err('请至少录入一行进货明细，数量须大于 0');

    var partner = null;
    if (input.partnerId) partner = ctx.getPartner(input.partnerId);
    if (!partner && (input.partnerName || '').trim()) {
      partner = debt.ensurePartner(ctx, { name: input.partnerName, type: 'supplier', phone: input.phone });
    }
    if (!partner) return err('请选择或新建供应商');

    // 先校验，避免改了一半库存
    var checked = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var product = getProduct(ctx, it.productId);
      if (!product) return err('商品不存在：' + it.productId);
      var cost = util.parseMoney(it.costPrice);
      if (cost < 0) return err('进货单价不能为负');
      checked.push({
        productId: String(product.id),
        brand: product.brand,
        model: product.model,
        unit: product.unit,
        qty: parseInt(it.qty, 10),
        costPrice: cost,
        amount: cost * parseInt(it.qty, 10)
      });
    }

    var total = util.sum(checked, function (c) {
      return c.amount;
    });
    var paid = util.parseMoney(input.paid);
    if (paid < 0) paid = 0;
    if (paid > total) paid = total;
    var debtAmount = total - paid;

    var no = input.no || docNo.purchase(date, ctx.data.purchases);
    var doc = {
      no: no,
      date: date,
      type: schema.DOC.PURCHASE,
      partnerId: partner.id,
      partnerName: partner.name,
      items: checked,
      total: total,
      paid: paid,
      debt: debtAmount,
      note: util.cleanText(input.note || ''),
      voided: false,
      createdAt: util.nowISO()
    };

    var applied = inv.applyPurchase(ctx, doc);
    if (!applied.ok) return err((applied.errors || []).join('；') || '库存更新失败');

    ctx.data.purchases = ctx.data.purchases || [];
    ctx.data.purchases.push(doc);
    ctx.touch('purchases', doc);

    // 最新进价回写商品档案成本（库存资金占用按最新成本算）
    checked.forEach(function (c) {
      var p = getProduct(ctx, c.productId);
      if (p) {
        p.cost = c.costPrice;
        ctx.touch('products', p);
      }
    });

    ledger.fromPurchase(ctx, doc);
    debt.applyPurchase(ctx, doc);
    writeLog(ctx, '保存进货单', doc.no + ' 共 ' + util.fmtYuan(doc.total) + '，欠款 ' + util.fmtYuan(doc.debt));

    return { ok: true, doc: doc };
  };

  /** 进货单作废：库存回滚、流水作废、欠款冲回，全部留痕 */
  engine.voidPurchase = function voidPurchase(ctx, no) {
    var doc = ctx.getDoc('purchases', no);
    if (!doc) return err('单据不存在：' + no);
    if (doc.voided) return err('该单已作废');

    var rev = inv.reverseDoc(ctx, doc, schema.DOC.PURCHASE);
    if (!rev.ok) return err((rev.errors || []).join('；') || '库存回滚失败（库存可能已不足）');

    ledger.voidByRef(ctx, no);
    debt.reverseDoc(ctx, doc, schema.DOC.PURCHASE);
    doc.voided = true;
    doc.voidedAt = util.nowISO();
    ctx.touch('purchases', doc);
    writeLog(ctx, '作废进货单', doc.no + '，库存与欠款已回滚');
    return { ok: true, doc: doc };
  };

  function revertPurchaseEffects(ctx, doc) {
    inv.reverseDoc(ctx, doc, schema.DOC.PURCHASE);
    ledger.voidByRef(ctx, doc.no);
    debt.reverseDoc(ctx, doc, schema.DOC.PURCHASE);
  }

  /* =========================================================
   *  销售开单（销售 / 赠送 同一张单）
   * ========================================================= */

  /**
   * @param input {
   *   date, partnerId|partnerName, phone,
   *   items:[{productId, qty, price(元或分), priceType:'wholesale'|'retail',
   *           type:'sale'|'gift', giftReason, costSnapshot?(分)}],
   *   discount(元或分), payments:[{method, amount(元或分)}], note
   * }
   * price/discount/payments 支持「元」字符串或「分」数字，统一由 util.parseMoney 转分。
   */
  engine.saveSale = function saveSale(ctx, input) {
    input = input || {};
    var date = input.date || util.today();

    var rawItems = (input.items || []).filter(function (it) {
      return it && it.productId && parseInt(it.qty, 10) > 0;
    });
    if (!rawItems.length) return err('请至少添加一行商品（数量须大于 0）');

    var partner = null;
    if (input.partnerId) partner = ctx.getPartner(input.partnerId);
    if (!partner && (input.partnerName || '').trim()) {
      partner = debt.ensurePartner(ctx, { name: input.partnerName, type: 'customer', phone: input.phone });
    }

    // 先校验并补全明细，避免改了一半库存
    var checked = [];
    for (var i = 0; i < rawItems.length; i++) {
      var it = rawItems[i];
      var product = getProduct(ctx, it.productId);
      if (!product) return err('商品不存在：' + it.productId);
      var isGift = it.type === schema.DOC.GIFT;
      var price = isGift ? 0 : util.parseMoney(it.price);
      if (!isGift && price < 0) return err('售价不能为负');
      var priceType = it.priceType === schema.PRICE_TYPE.WHOLESALE
        ? schema.PRICE_TYPE.WHOLESALE
        : schema.PRICE_TYPE.RETAIL;
      var cost = it.costSnapshot !== undefined && it.costSnapshot !== null && it.costSnapshot !== ''
        ? Math.round(it.costSnapshot)
        : (product.cost || 0);
      checked.push({
        productId: String(product.id),
        brand: product.brand,
        model: product.model,
        unit: product.unit,
        qty: parseInt(it.qty, 10),
        price: price,
        priceType: priceType,
        costSnapshot: cost,
        type: isGift ? schema.DOC.GIFT : schema.DOC.SALE,
        giftReason: isGift ? (it.giftReason || schema.GIFT_REASONS[0]) : null
      });
    }

    var discount = util.parseMoney(input.discount);
    var payments = (input.payments || []).map(function (p) {
      return { method: p.method, amount: util.parseMoney(p.amount) };
    });
    var calc = cart.compute(checked, { discount: discount, payments: payments });

    var no = input.no || docNo.sale(date, ctx.data.sales);
    var doc = {
      no: no,
      date: date,
      type: schema.DOC.SALE,
      partnerId: partner ? partner.id : null,
      partnerName: partner ? partner.name : '',
      items: checked,
      discount: calc.discount,
      payable: calc.payable,
      received: calc.received,
      debt: calc.debt,
      payments: payments.filter(function (p) {
        return p.method !== 'debt' && p.amount > 0;
      }).map(function (p) {
        return { method: p.method, amount: p.amount };
      }),
      note: util.cleanText(input.note || ''),
      voided: false,
      createdAt: util.nowISO()
    };

    var applied = inv.applySale(ctx, doc);
    if (!applied.ok) return err((applied.errors || []).join('；') || '库存不足，无法出库');

    ctx.data.sales = ctx.data.sales || [];
    ctx.data.sales.push(doc);
    ctx.touch('sales', doc);

    ledger.fromSale(ctx, doc);
    if (partner && doc.debt) debt.applySale(ctx, doc);
    writeLog(ctx, '保存销售单', doc.no + ' 应收 ' + util.fmtYuan(doc.payable) +
      (doc.debt ? '，欠款 ' + util.fmtYuan(doc.debt) : '') +
      (doc.items.some(function (x) {
        return x.type === schema.DOC.GIFT;
      }) ? '（含赠送）' : ''));

    return { ok: true, doc: doc };
  };

  /** 销售单作废：库存回滚、流水作废、欠款冲回，全部留痕 */
  engine.voidSale = function voidSale(ctx, no) {
    var doc = ctx.getDoc('sales', no);
    if (!doc) return err('单据不存在：' + no);
    if (doc.voided) return err('该单已作废');

    var rev = inv.reverseDoc(ctx, doc, doc.type);
    if (!rev.ok) return err((rev.errors || []).join('；') || '库存回滚失败');

    ledger.voidByRef(ctx, no);
    if (doc.partnerId && doc.debt) debt.reverseDoc(ctx, doc, doc.type);
    doc.voided = true;
    doc.voidedAt = util.nowISO();
    ctx.touch('sales', doc);
    writeLog(ctx, '作废销售单', doc.no + '，库存与欠款已回滚');
    return { ok: true, doc: doc };
  };

  /**
   * 销售退货（红冲）：原单红冲生成退货单
   * @param input { originalNo, items:[{productId, qty}], note }
   */
  engine.refundSale = function refundSale(ctx, input) {
    input = input || {};
    var original = ctx.getDoc('sales', input.originalNo);
    if (!original) return err('原销售单不存在：' + input.originalNo);
    if (original.voided) return err('原单已作废，不能退货');
    if (original.type === schema.DOC.REFUND) return err('退货单不能再退货');

    // 计算每行的可退数量（原单未退部分）
    var returnedOf = {};
    (ctx.data.sales || []).forEach(function (s) {
      if (s.type !== schema.DOC.REFUND || s.voided) return;
      if (s.refNo !== original.no) return;
      s.items.forEach(function (ri) {
        returnedOf[ri.productId] = (returnedOf[ri.productId] || 0) + ri.qty;
      });
    });

    var pick = {};
    (input.items || []).forEach(function (ri) {
      var q = parseInt(ri.qty, 10);
      if (q > 0) pick[ri.productId] = q;
    });
    var hasPick = (input.items || []).length > 0;

    var items = [];
    var any = false;
    for (var i = 0; i < original.items.length; i++) {
      var oi = original.items[i];
      var maxQty = oi.qty - (returnedOf[oi.productId] || 0);
      if (maxQty <= 0) continue;
      var qty2;
      if (hasPick) {
        if (pick[oi.productId] === undefined) continue;
        qty2 = Math.min(pick[oi.productId], maxQty);
        if (qty2 <= 0) continue;
      } else {
        qty2 = maxQty;
      }
      any = true;
      items.push({
        productId: oi.productId,
        brand: oi.brand,
        model: oi.model,
        unit: oi.unit,
        qty: qty2,
        price: oi.price || 0,
        priceType: oi.priceType || schema.PRICE_TYPE.RETAIL,
        costSnapshot: oi.costSnapshot || 0,
        type: schema.DOC.SALE,
        giftReason: null
      });
    }
    if (!any) return err('没有可退的商品');

    var refundValue = items.reduce(function (t, it) {
      return t + (it.price || 0) * it.qty;
    }, 0);

    var no = docNo.sale(util.today(), ctx.data.sales);
    var doc = {
      no: no,
      date: input.date || util.today(),
      type: schema.DOC.REFUND,
      refNo: original.no,
      partnerId: original.partnerId || null,
      partnerName: original.partnerName || '',
      items: items,
      discount: 0,
      payable: refundValue,
      received: 0,
      debt: 0,
      payments: [],
      note: util.cleanText(input.note || ''),
      voided: false,
      createdAt: util.nowISO()
    };

    var applied = inv.applySale(ctx, doc);
    if (!applied.ok) return err((applied.errors || []).join('；') || '退货入库失败');

    ctx.data.sales.push(doc);
    ctx.touch('sales', doc);

    // 财务冲减：原单已收现金部分 → 退货退款（红冲收入）；原单赊账部分 → 冲减客户应收
    var cashRefund = 0;
    var debtRefund = 0;
    if (original.received > 0) {
      cashRefund = Math.min(refundValue, original.received);
      if (cashRefund > 0) {
        ledger.add(ctx, {
          date: doc.date,
          type: schema.LEDGER.REFUND_OUT,
          amount: cashRefund,
          refType: schema.DOC.REFUND,
          refNo: doc.no,
          partnerId: doc.partnerId || null,
          note: '退货退款（红冲 ' + original.no + '）',
          auto: true
        });
      }
    }
    if (original.debt > 0) {
      debtRefund = Math.min(refundValue - cashRefund, original.debt);
      if (debtRefund > 0) {
        doc.debt = debtRefund;
        debt.applyRefund(ctx, doc);
      }
    }
    doc.cashRefund = cashRefund;
    doc.debtRefund = debtRefund;
    ctx.touch('sales', doc);

    writeLog(ctx, '销售退货', doc.no + '（红冲 ' + original.no + '）退 ' +
      util.fmtYuan(refundValue) + '，入库 ' + items.reduce(function (t, it) {
        return t + it.qty;
      }, 0) + ' 件');

    return { ok: true, doc: doc };
  };

  /**
   * 销售退换（退旧 + 换新）：直接与原销售单链接
   * @param input {
   *   originalNo,
   *   returns: [{productId, qty}],
   *   replacements: [{productId, qty, price(元/分), priceType}],
   *   date, note, payments:[{method, amount}]
   * }
   */
  engine.exchange = function exchange(ctx, input) {
    input = input || {};
    var original = ctx.getDoc('sales', input.originalNo);
    if (!original) return err('原销售单不存在：' + input.originalNo);
    if (original.voided) return err('原单已作废，不能退换');
    if (original.type === schema.DOC.REFUND) return err('退货单不能再退换');

    // 计算原单每行的「还可退」数量
    var returnedOf = {};
    (ctx.data.sales || []).forEach(function (s) {
      if (s.type !== schema.DOC.REFUND || s.voided) return;
      if (s.refNo !== original.no) return;
      s.items.forEach(function (ri) {
        returnedOf[ri.productId] = (returnedOf[ri.productId] || 0) + ri.qty;
      });
    });

    var pick = {};
    (input.returns || []).forEach(function (ri) {
      var q = parseInt(ri.qty, 10);
      if (q > 0) pick[ri.productId] = q;
    });

    var returnItems = [];
    var anyReturn = false;
    var pickedFullyReturned = false;
    for (var i = 0; i < original.items.length; i++) {
      var oi = original.items[i];
      if (pick[oi.productId] === undefined) continue;
      var maxQty = oi.qty - (returnedOf[oi.productId] || 0);
      if (maxQty <= 0) { pickedFullyReturned = true; continue; }
      var rq = Math.min(pick[oi.productId], maxQty);
      if (rq <= 0) { pickedFullyReturned = true; continue; }
      anyReturn = true;
      returnItems.push({
        productId: oi.productId,
        brand: oi.brand,
        model: oi.model,
        unit: oi.unit,
        qty: rq,
        price: oi.price || 0,
        priceType: oi.priceType || schema.PRICE_TYPE.RETAIL,
        costSnapshot: oi.costSnapshot || 0,
        type: schema.DOC.SALE,
        giftReason: null
      });
    }
    if (!anyReturn) {
      if (pickedFullyReturned) return err('所选商品已无可退数量');
      return err('请先选择要退/换的商品');
    }

    var replItems = (input.replacements || []).filter(function (it) {
      return it && it.productId && parseInt(it.qty, 10) > 0;
    }).map(function (it) {
      var product = getProduct(ctx, it.productId);
      if (!product) return { error: '商品不存在：' + it.productId };
      var priceFen = util.parseMoney(it.price);
      if (priceFen < 0) return { error: '售价不能为负' };
      return {
        productId: String(product.id),
        brand: product.brand,
        model: product.model,
        unit: product.unit,
        qty: parseInt(it.qty, 10),
        priceFen: priceFen,
        priceType: it.priceType === schema.PRICE_TYPE.WHOLESALE ? schema.PRICE_TYPE.WHOLESALE : schema.PRICE_TYPE.RETAIL,
        costSnapshot: product.cost || 0,
        type: schema.DOC.SALE,
        giftReason: null
      };
    });
    var badRepl = replItems.filter(function (x) { return x.error; });
    if (badRepl.length) return err(badRepl.map(function (x) { return x.error; }).join('；'));

    // ① 先生成退货单（红冲原单、入库、冲减原单已收/欠款）
    var refundRes = engine.refundSale(ctx, {
      originalNo: original.no,
      items: returnItems.map(function (it) {
        return { productId: it.productId, qty: it.qty };
      }),
      note: input.note
    });
    if (!refundRes.ok) return refundRes;
    var refundDoc = refundRes.doc;

    // ② 若有换新商品，生成销售单
    var saleDoc = null;
    if (replItems.length) {
      var Vp = replItems.reduce(function (t, it) { return t + it.priceFen * it.qty; }, 0);
      var payments = (input.payments && input.payments.length)
        ? input.payments.map(function (p) {
          return { method: p.method, amount: util.parseMoney(p.amount) };
        })
        : [{ method: 'cash', amount: util.fenToYuan(Vp) }];

      var saleItems = replItems.map(function (it) {
        return {
          productId: it.productId,
          qty: it.qty,
          price: util.fenToYuan(it.priceFen),
          priceType: it.priceType,
          costSnapshot: it.costSnapshot,
          type: schema.DOC.SALE,
          giftReason: null
        };
      });

      var saleRes = engine.saveSale(ctx, {
        date: input.date || util.today(),
        partnerId: original.partnerId || null,
        partnerName: original.partnerName || '',
        items: saleItems,
        discount: 0,
        payments: payments,
        note: (input.note ? input.note + '；' : '') + '换货（红冲 ' + original.no + '）'
      });
      if (!saleRes.ok) {
        engine.voidSale(ctx, refundDoc.no);
        return saleRes;
      }
      saleDoc = saleRes.doc;
      saleDoc.exchangeOf = original.no;
      saleDoc.exchangeLinked = refundDoc.no;
      ctx.touch('sales', saleDoc);
    }

    refundDoc.exchangeOf = original.no;
    refundDoc.exchangeLinked = saleDoc ? saleDoc.no : null;
    ctx.touch('sales', refundDoc);

    var Vr = returnItems.reduce(function (t, it) { return t + (it.price || 0) * it.qty; }, 0);
    var VpTotal = replItems.reduce(function (t, it) { return t + (it.priceFen || 0) * it.qty; }, 0);
    writeLog(ctx, '销售退换',
      '原单 ' + original.no + '：退 ' + util.fmtYuan(Vr) + ' / ' +
      (saleDoc ? ('换 ' + util.fmtYuan(VpTotal) + '，实收差价 ' + util.fmtYuan(VpTotal - Vr)) : '仅退货'));

    return { ok: true, refund: refundDoc, sale: saleDoc, net: VpTotal - Vr };
  };

  /** 修改进货单：仅未结清（有欠款）的单可改 */
  engine.updatePurchase = function updatePurchase(ctx, no, input) {
    var doc = ctx.getDoc('purchases', no);
    if (!doc) return err('单据不存在：' + no);
    if (doc.voided) return err('已作废的单据不能修改');
    if (!doc.debt) return err('该单已结清，不能修改（可先作废后重录）');

    revertPurchaseEffects(ctx, doc);
    var idx = ctx.data.purchases.indexOf(doc);
    if (idx >= 0) ctx.data.purchases.splice(idx, 1);

    var res = engine.savePurchase(ctx, Object.assign({}, input, { no: no, date: doc.date }));
    if (!res.ok) return res;
    writeLog(ctx, '修改进货单', no);
    return res;
  };

  /* =========================================================
   *  收付款登记（供应商付款 / 客户回款）
   * ========================================================= */

  engine.settleAccount = function settleAccount(ctx, input) {
    input = input || {};
    var isSupplier = !!input.isSupplier;
    var st = debt.settle(ctx, {
      partnerId: input.partnerId,
      amount: input.amount,
      isSupplier: isSupplier,
      date: input.date
    });
    if (!st.ok) return st;
    ledger.fromSettle(ctx, {
      partnerId: input.partnerId,
      partnerName: st.partner ? st.partner.name : '',
      amount: util.parseMoney(input.amount),
      date: input.date,
      isSupplier: isSupplier,
      note: input.note
    });
    writeLog(ctx, isSupplier ? '供应商付款' : '客户回款',
      (st.partner ? st.partner.name : '') + ' ' + util.fmtYuan(st.paid) +
      (st.overpay ? '（多付 ' + util.fmtYuan(st.overpay) + '）' : ''));
    return { ok: true, settle: st };
  };

  /* =========================================================
   *  盘点
   * ========================================================= */

  /**
   * @param input {date, counts:{productId: 实盘数}, note}
   */
  engine.saveStocktake = function saveStocktake(ctx, input) {
    input = input || {};
    var date = input.date || util.today();
    var counts = input.counts || {};
    if (!Object.keys(counts).length) return err('请录入实盘数量');

    var no = docNo.stocktake(date, ctx.data.stocktakes);
    var res = inv.applyStocktake(ctx, { date: date, counts: counts, note: input.note }, no);
    if (!res.ok) return err(res.error);
    writeLog(ctx, '保存盘点单', no + ' 差异 ' + res.doc.diffQty + ' 件');
    return { ok: true, doc: res.doc };
  };

  return engine;
});
