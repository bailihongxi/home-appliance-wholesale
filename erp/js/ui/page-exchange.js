/**
 * ui/page-exchange.js —— 退换货（电器版）
 * 与「原销售单」直接链接：先选原单 → 退货（红冲）/ 换货（退旧 + 换新收差价）。
 * 退/换都会生成与原单双向关联的单据。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.ui || (isNode ? require('./components.js') : null),
    E.schema || (isNode ? require('../core/schema.js') : null),
    E.cart || (isNode ? require('../core/cart.js') : null),
    E.engine || (isNode ? require('../core/engine.js') : null),
    E.product || (isNode ? require('../core/product.js') : null),
    E.repo || (isNode ? require('../store/repo.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.exchange = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, ui, schema, cart, engine, product, repo, ERP) {
  'use strict';

  var esc = util.escapeHtml;
  var D = schema.DOC;
  var PAY = schema.PAY_METHODS;
  var PRICE = schema.PRICE_TYPE;

  function emptyState() {
    return {
      tab: 'pick',          // pick | return | exchange
      originalNo: null,
      keyword: '',
      returnQty: {},        // 退货：productId -> 数量
      exchReturnQty: {},    // 换货：productId -> 退出的数量
      replKeyword: '',      // 换货商品搜索
      replItems: [],        // 换货迷你购物车
      replPay: { wechat: '', cash: '', alipay: '' }
    };
  }

  /** 原单已退数量（按 productId 汇总其所有退货单） */
  function returnedOf(ctx, originalNo) {
    var map = {};
    (ctx.data.sales || []).forEach(function (s) {
      if (s.type !== D.REFUND || s.voided) return;
      if (s.refNo !== originalNo) return;
      s.items.forEach(function (ri) {
        map[ri.productId] = (map[ri.productId] || 0) + ri.qty;
      });
    });
    return map;
  }

  var page = {
    name: 'exchange',
    title: '退换货',
    icon: '🔁',
    hideInNav: false,

    init: function () {
      return emptyState();
    },

    render: function (ctx, state) {
      if (state.tab === 'return') return renderReturn(ctx, state);
      if (state.tab === 'exchange') return renderExchange(ctx, state);
      return renderPick(ctx, state);
    },

    actions: {
      field: function (ctx, state, el) {
        var n = el.getAttribute('data-name');
        if (!n) return;
        if (n.indexOf('.') >= 0) {
          var parts = n.split('.');
          var obj = state;
          for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
          obj[parts[parts.length - 1]] = el.value;
        } else {
          state[n] = el.value;
        }
      },

      'select-original': function (ctx, state, el) {
        state.originalNo = el.getAttribute('data-no');
        state.returnQty = {};
        state.exchReturnQty = {};
        state.replItems = [];
        state.replKeyword = '';
        state.replPay = { wechat: '', cash: '', alipay: '' };
        state.tab = 'return';
      },
      'back-pick': function (ctx, state) {
        state.tab = 'pick';
        state.originalNo = null;
      },
      'goto-exchange': function (ctx, state) {
        state.tab = 'exchange';
      },
      'goto-return': function (ctx, state) {
        state.tab = 'return';
      },

      /* 退货流程 */
      'return-qty': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var v = parseInt(el.value, 10);
        state.returnQty[id] = isNaN(v) || v < 0 ? 0 : v;
      },
      'do-return': function (ctx, state) {
        var no = state.originalNo;
        if (!no) { ui.toast('请先选择原销售单', 'err'); return false; }
        syncQtyFromDom(state, 'return-qty', 'returnQty');
        var items = Object.keys(state.returnQty || {})
          .filter(function (k) { return state.returnQty[k] > 0; })
          .map(function (k) { return { productId: k, qty: state.returnQty[k] }; });
        if (!items.length) { ui.toast('请填写要退的商品数量', 'err'); return false; }
        var r = engine.refundSale(ctx, { originalNo: no, items: items });
        if (!r.ok) { ui.toast(r.error, 'err'); return false; }
        ui.toast('退货成功 ' + r.doc.no + '，入库 ' +
          r.doc.items.reduce(function (t, it) { return t + it.qty; }, 0) + ' 件', 'ok');
        state.tab = 'pick';
        state.originalNo = null;
        state.returnQty = {};
        return true;
      },

      /* 换货流程 */
      'exch-return-qty': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var v = parseInt(el.value, 10);
        state.exchReturnQty[id] = isNaN(v) || v < 0 ? 0 : v;
      },
      'repl-add': function (ctx, state, el) {
        addRepl(ctx, state, el.getAttribute('data-id'));
      },
      'repl-qty': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var it = findRepl(state, id);
        if (!it) return;
        var v = parseInt(el.value, 10);
        it.qty = isNaN(v) || v < 1 ? 1 : v;
      },
      'repl-price': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var it = findRepl(state, id);
        if (!it) return;
        it.price = util.parseMoney(el.value);
      },
      'repl-price-type': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var it = findRepl(state, id);
        if (!it) return;
        var p = product.getById(ctx, id);
        if (!p) return;
        if (it.priceType === PRICE.WHOLESALE) {
          it.priceType = PRICE.RETAIL;
          it.price = p.priceRetail || 0;
        } else {
          it.priceType = PRICE.WHOLESALE;
          it.price = p.priceWholesale || 0;
        }
      },
      'repl-del': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        state.replItems = state.replItems.filter(function (x) { return x.productId !== id; });
      },
      'repl-clear': function (ctx, state) {
        state.replItems = [];
      },
      'do-exchange': function (ctx, state) {
        var no = state.originalNo;
        if (!no) { ui.toast('请先选择原销售单', 'err'); return false; }
        syncQtyFromDom(state, 'exch-return-qty', 'exchReturnQty');
        var returns = Object.keys(state.exchReturnQty || {})
          .filter(function (k) { return state.exchReturnQty[k] > 0; })
          .map(function (k) { return { productId: k, qty: state.exchReturnQty[k] }; });
        if (!returns.length) { ui.toast('请填写要退/换出的商品数量', 'err'); return false; }

        var replacements = state.replItems.map(function (it) {
          return { productId: it.productId, qty: it.qty, price: util.fenToYuan(it.price), priceType: it.priceType };
        });
        if (!replacements.length) { ui.toast('请添加换货的新商品', 'err'); return false; }

        var payments = [];
        PAY.forEach(function (m) {
          var amt = util.parseMoney(state.replPay[m]);
          if (amt > 0) payments.push({ method: m, amount: amt });
        });

        var r = engine.exchange(ctx, {
          originalNo: no,
          returns: returns,
          replacements: replacements,
          payments: payments
        });
        if (!r.ok) { ui.toast(r.error, 'err'); return false; }

        var msg = '退 ' + util.fenToYuan(r.refund.payable) + ' 元';
        if (r.sale) msg += '，换 ' + util.fenToYuan(r.sale.payable) + ' 元，应收差价 ' + util.fenToYuan(r.net) + ' 元';
        ui.toast('退换成功：' + msg, 'ok');
        state.tab = 'pick';
        state.originalNo = null;
        state.exchReturnQty = {};
        state.replItems = [];
        state.replKeyword = '';
        state.replPay = { wechat: '', cash: '', alipay: '' };
        return true;
      },

      /** 扫码定位原单（支持单号 / 条码 / 品牌型号） */
      'scan-input': function (ctx, state, payload) {
        var code = String((payload && payload.value) || '').trim().toUpperCase();
        if (!code) return;
        var hit = (ctx.data.sales || []).find(function (s) {
          if (s.voided || s.type === D.REFUND) return false;
          return String(s.no).toUpperCase() === code ||
            String(s.partnerName || '').toUpperCase().indexOf(code) >= 0;
        });
        if (!hit) {
          hit = (ctx.data.sales || []).find(function (s) {
            if (s.voided || s.type === D.REFUND) return false;
            return (s.items || []).some(function (it) {
              return String(it.brand || '').toUpperCase().indexOf(code) >= 0 ||
                String(it.model || '').toUpperCase().indexOf(code) >= 0;
            });
          });
        }
        if (hit) {
          state.keyword = hit.no;
          ui.toast('已定位原单：' + hit.no, 'ok');
        } else {
          ui.toast('未找到原单：' + code, 'err');
        }
      }
    }
  };

  /* ---------------- 工具 ---------------- */

  function findRepl(state, productId) {
    return state.replItems.find(function (x) { return x.productId === productId; });
  }

  function syncQtyFromDom(state, dataChangeName, stateKey) {
    if (typeof document === 'undefined' || !state[stateKey]) return;
    var inputs = document.querySelectorAll('input[data-change="' + dataChangeName + '"]');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var id = el.getAttribute('data-id');
      if (!id) continue;
      var v = parseInt(el.value, 10);
      state[stateKey][id] = isNaN(v) || v < 0 ? 0 : v;
    }
  }

  function addRepl(ctx, state, productId) {
    var p = product.getById(ctx, productId);
    if (!p) return;
    var it = findRepl(state, p.id);
    if (it) { it.qty += 1; return; }
    state.replItems.push({
      productId: p.id,
      brand: p.brand,
      model: p.model,
      unit: p.unit,
      qty: 1,
      price: p.priceRetail || 0,
      priceType: PRICE.RETAIL,
      costSnapshot: p.cost || 0
    });
  }

  /* ---------------- 选原单 ---------------- */

  function renderPick(ctx, state) {
    var kw = String(state.keyword || '').toUpperCase();
    var list = (ctx.data.sales || []).filter(function (d) {
      if (d.voided) return false;
      if (d.type === D.REFUND) return false;
      if (!kw) return true;
      return String(d.no).toUpperCase().indexOf(kw) >= 0 ||
        String(d.partnerName || '').toUpperCase().indexOf(kw) >= 0 ||
        (d.items || []).some(function (it) {
          return String(it.brand || '').toUpperCase().indexOf(kw) >= 0 ||
            String(it.model || '').toUpperCase().indexOf(kw) >= 0;
        });
    });
    list = util.sortBy(list, function (d) { return d.no; }, true).slice(0, 60);

    var h = '<div class="page-head"><h2>退换货</h2>' +
      '<span class="desc">先选「原销售单」，再退或换</span></div>';

    h += '<div class="card">' + ui.searchBar({ value: state.keyword, placeholder: '搜索单号 / 客户 / 品牌 / 型号', scan: false }) + '</div>';

    if (!list.length) {
      h += '<div class="card">' + ui.empty('没有可退换的销售单') + '</div>';
      return h;
    }

    h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>单号</th><th>日期</th><th>客户</th><th class="num">数量</th><th class="num">应收</th><th>操作</th>' +
      '</tr></thead><tbody>';
    list.forEach(function (d) {
      var qty = util.sum(d.items, function (it) { return it.qty; });
      h += '<tr><td class="mono">' + esc(d.no) + '</td><td>' + esc(d.date) + '</td>' +
        '<td>' + esc(d.partnerName || '散客') + '</td>' +
        '<td class="num">' + qty + '</td>' +
        '<td class="num">' + ui.money(d.payable) + '</td>' +
        '<td class="act"><button class="btn btn-sm btn-primary" data-act="select-original" data-no="' + esc(d.no) + '">选为原单</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  /* ---------------- 原单卡片 ---------------- */

  function originalCard(ctx, original) {
    var ret = returnedOf(ctx, original.no);
    var h = '<div class="notice notice-info"><span>已关联原销售单 <b class="mono">' + esc(original.no) +
      '</b> · ' + esc(original.date) + ' · ' + esc(original.partnerName || '散客') + '</span></div>';
    h += '<div class="card"><div class="card-title">原单明细</div><div class="table-wrap"><table class="tbl">' +
      '<thead><tr><th>商品</th><th class="num">数量</th><th class="num">单价</th><th class="num">已退</th><th class="num">可退</th></tr></thead><tbody>';
    original.items.forEach(function (it) {
      var maxQty = it.qty - (ret[it.productId] || 0);
      h += '<tr><td>' + esc(it.brand || '') + ' <b>' + esc(it.model || '') + '</b>' +
        (it.unit ? ' <span class="weak small">' + esc(it.unit) + '</span>' : '') + '</td>' +
        '<td class="num">' + it.qty + '</td><td class="num">' + ui.money(it.price) + '</td>' +
        '<td class="num">' + (ret[it.productId] || 0) + '</td>' +
        '<td class="num">' + (maxQty > 0 ? maxQty : '—') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  /* ---------------- 退货 ---------------- */

  function renderReturn(ctx, state) {
    if (!state.originalNo) {
      return '<div class="card">' + ui.empty('请先在「选原单」中选一张销售单') +
        '<div class="row"><button class="btn" data-act="back-pick">去选原单</button></div></div>';
    }
    var original = ctx.getDoc('sales', state.originalNo);
    if (!original) {
      state.originalNo = null; state.tab = 'pick';
      return '<div class="card">' + ui.empty('原单不存在，请重新选择') + '</div>';
    }
    var ret = returnedOf(ctx, original.no);

    var h = '<div class="page-head"><h2>退货</h2><span class="desc">红冲原单并入库</span></div>';
    h += originalCard(ctx, original);

    h += '<div class="card"><div class="card-title">选择要退的商品</div><div class="table-wrap"><table class="tbl">' +
      '<thead><tr><th>商品</th><th class="num">可退</th><th class="num">退几件</th></tr></thead><tbody>';
    original.items.forEach(function (it) {
      var maxQty = it.qty - (ret[it.productId] || 0);
      if (maxQty <= 0) return;
      var def = state.returnQty[it.productId] !== undefined ? state.returnQty[it.productId] : maxQty;
      h += '<tr><td>' + esc(it.brand || '') + ' <b>' + esc(it.model || '') + '</b>' +
        (it.unit ? ' <span class="weak small">' + esc(it.unit) + '</span>' : '') + '</td>' +
        '<td class="num">' + maxQty + '</td>' +
        '<td class="num"><input class="input" style="width:60px;text-align:right" data-change="return-qty" data-live="1" data-id="' + esc(it.productId) + '" inputmode="numeric" value="' + def + '"></td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="row mt8"><button class="btn" data-act="back-pick">重新选单</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn" data-act="goto-exchange">改为换货</button>' +
      '<button class="btn btn-primary" data-act="do-return">确认退货</button></div></div>';
    return h;
  }

  /* ---------------- 换货 ---------------- */

  function renderExchange(ctx, state) {
    if (!state.originalNo) {
      return '<div class="card">' + ui.empty('请先在「选原单」中选一张销售单') +
        '<div class="row"><button class="btn" data-act="back-pick">去选原单</button></div></div>';
    }
    var original = ctx.getDoc('sales', state.originalNo);
    if (!original) {
      state.originalNo = null; state.tab = 'pick';
      return '<div class="card">' + ui.empty('原单不存在，请重新选择') + '</div>';
    }
    var ret = returnedOf(ctx, original.no);

    var h = '<div class="page-head"><h2>换货</h2><span class="desc">退旧 + 换新收差价</span></div>';
    h += originalCard(ctx, original);

    /* 退出的商品 */
    h += '<div class="card"><div class="card-title">① 要退/换出的原单商品</div><div class="table-wrap"><table class="tbl">' +
      '<thead><tr><th>商品</th><th class="num">可退</th><th class="num">退几件</th></tr></thead><tbody>';
    original.items.forEach(function (it) {
      var maxQty = it.qty - (ret[it.productId] || 0);
      if (maxQty <= 0) return;
      var def = state.exchReturnQty[it.productId] !== undefined ? state.exchReturnQty[it.productId] : maxQty;
      h += '<tr><td>' + esc(it.brand || '') + ' <b>' + esc(it.model || '') + '</b>' +
        (it.unit ? ' <span class="weak small">' + esc(it.unit) + '</span>' : '') + '</td>' +
        '<td class="num">' + maxQty + '</td>' +
        '<td class="num"><input class="input" style="width:60px;text-align:right" data-change="exch-return-qty" data-live="1" data-id="' + esc(it.productId) + '" inputmode="numeric" value="' + def + '"></td></tr>';
    });
    h += '</tbody></table></div></div>';

    /* 换新商品选择 */
    h += '<div class="card"><div class="card-title">② 选换新商品</div>';
    h += '<div class="row mb8"><input class="input" data-input="field" data-name="replKeyword" data-live="1" data-debounce="1" placeholder="搜索 品牌 / 型号 / 类型 / 条码" value="' + esc(state.replKeyword) + '"></div>';
    var kw = String(state.replKeyword || '').trim().toUpperCase();
    var styles = ctx.data.products.filter(function (p) {
      var bc = (Array.isArray(p.barcodes) ? p.barcodes : []).some(function (b) {
        return String(b || '').toUpperCase().indexOf(kw) >= 0;
      });
      if (!kw) return p.status !== schema.STATUS.OFF;
      return String(p.brand || '').toUpperCase().indexOf(kw) >= 0 ||
        String(p.model || '').toUpperCase().indexOf(kw) >= 0 ||
        String(p.category || '').toUpperCase().indexOf(kw) >= 0 || bc;
    }).slice(0, 30);
    if (styles.length) {
      h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>商品</th>' +
        '<th class="num">批发</th><th class="num">零售</th><th class="num">库存</th><th></th></tr></thead><tbody>';
      styles.forEach(function (p) {
        h += '<tr>' +
          '<td>' + esc(p.brand) + ' <b>' + esc(p.model) + '</b><br><span class="weak small">' + esc(p.category) + ' / ' + esc(p.unit) + '</span></td>' +
          '<td class="num">' + ui.money(p.priceWholesale) + '</td>' +
          '<td class="num">' + ui.money(p.priceRetail) + '</td>' +
          '<td class="num">' + (p.stock || 0) + '</td>' +
          '<td class="act"><button class="btn btn-sm btn-primary" data-act="repl-add" data-id="' + esc(p.id) + '">加入</button></td>' +
          '</tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    /* 换货迷你购物车 */
    var vp = 0;
    h += '<div class="card"><div class="card-title">换货清单（' + state.replItems.length + ' 行）' +
      (state.replItems.length ? '<button class="btn btn-sm" data-act="repl-clear" id="repl-clear-btn">清空</button>' : '') + '</div>';
    if (!state.replItems.length) {
      h += ui.empty('还没有换新商品，先搜索并点「加入」');
    } else {
      h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>商品</th><th class="num">数量</th><th class="num">单价</th><th>价格</th><th class="num">小计</th><th></th></tr></thead><tbody>';
      state.replItems.forEach(function (it) {
        var line = it.price * it.qty;
        vp += line;
        var isWholesale = it.priceType === PRICE.WHOLESALE;
        h += '<tr><td>' + esc(it.brand) + ' <b>' + esc(it.model) + '</b><br><span class="weak small">' + esc(it.unit) + '</span></td>' +
          '<td class="num"><input class="input" style="width:54px;text-align:right" data-change="repl-qty" data-id="' + esc(it.productId) + '" inputmode="numeric" value="' + it.qty + '"></td>' +
          '<td class="num"><input class="input" style="width:72px;text-align:right" data-change="repl-price" data-id="' + esc(it.productId) + '" inputmode="decimal" value="' + esc(util.fenToYuan(it.price)) + '"></td>' +
          '<td><button class="btn btn-sm ' + (isWholesale ? 'btn-primary' : '') + '" data-act="repl-price-type" data-id="' + esc(it.productId) + '">' +
          (isWholesale ? '批发' : '零售') + '</button></td>' +
          '<td class="num">' + ui.money(line) + '</td>' +
          '<td class="act"><button data-act="repl-del" data-id="' + esc(it.productId) + '">删除</button></td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '</div>';

    /* 收款 + 差价 */
    var vr = 0;
    original.items.forEach(function (it) {
      var maxQty = it.qty - (ret[it.productId] || 0);
      var q = state.exchReturnQty[it.productId] !== undefined
        ? Math.min(state.exchReturnQty[it.productId], maxQty > 0 ? maxQty : 0)
        : (maxQty > 0 ? maxQty : 0);
      vr += (it.price || 0) * (q > 0 ? q : 0);
    });
    var net = vp - vr;

    h += '<div class="card">';
    h += '<div class="row between"><span class="muted">退货额</span><span class="strong">' + ui.money(vr) + '</span></div>';
    h += '<div class="row between"><span class="muted">换新额</span><span class="strong">' + ui.money(vp) + '</span></div>';
    h += '<div class="row between"><span class="muted">应收差价（顾客实付，退货红冲已冲抵）</span>' +
      '<span class="strong big" style="color:' + (net < 0 ? '#16a34a' : '#dc2626') + '">' + ui.money(net) + '</span></div>';

    h += '<div class="field mt8"><label>收款（元，不填默认收全款）</label><div class="grid grid-3">';
    PAY.forEach(function (m) {
      h += '<div><div class="small muted mb2">' + (schema.PAY_METHOD_LABEL[m] || m) + '</div>' +
        '<input class="input" data-input="field" data-name="replPay.' + m + '" data-live="1" inputmode="decimal" placeholder="0" value="' + esc(state.replPay[m]) + '"></div>';
    });
    h += '</div></div>';

    h += '<div class="row mt8"><button class="btn" data-act="back-pick">重新选单</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn" data-act="goto-return">改为退货</button>' +
      '<button class="btn btn-primary" data-act="do-exchange">确认换货</button></div></div>';
    return h;
  }

  return page;
});
