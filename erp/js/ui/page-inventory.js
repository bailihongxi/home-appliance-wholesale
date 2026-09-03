/**
 * ui/page-inventory.js —— 库存管理（电器版单层商品）
 * 三个视图：库存查询（商品库存 + 变动明细）/ 预警（低于全局阈值）/ 盘点（按商品填实盘数）。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.ui || (isNode ? require('./components.js') : null),
    E.schema || (isNode ? require('../core/schema.js') : null),
    E.inventory || (isNode ? require('../core/inventory.js') : null),
    E.engine || (isNode ? require('../core/engine.js') : null),
    E.product || (isNode ? require('../core/product.js') : null),
    E.repo || (isNode ? require('../store/repo.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.inventory = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, ui, schema, inv, engine, product, repo, ERP) {
  'use strict';

  var esc = util.escapeHtml;

  function totalQty(ctx) {
    var sum = 0;
    (ctx.data.products || []).forEach(function (p) { sum += p.stock || 0; });
    return sum;
  }

  function thresholdOf(ctx) {
    return ctx.settings.defaultThreshold == null ? 3 : ctx.settings.defaultThreshold;
  }

  var page = {
    name: 'inventory',
    title: '库存管理',
    icon: '📋',

    init: function () {
      return {
        tab: 'list',
        keyword: '',
        cat: '',
        page: 1,
        expanded: '',
        logsProduct: '',
        take: { counts: {}, keyword: '' },
        takenResult: null
      };
    },

    render: function (ctx, st) {
      var body;
      if (st.tab === 'alert') body = renderAlert(ctx, st);
      else if (st.tab === 'take') body = renderTake(ctx, st);
      else body = renderList(ctx, st);

      var h = '<div class="page-head"><h2>' + pageTitle(st) + '</h2>' +
        '<span class="desc">' + pageDesc(ctx, st) + '</span></div>' +
        (st.tab === 'list' ? desktopStats(ctx) : '') +
        desktopTabs(ctx, st) +
        '<div class="card">' + ui.searchBar({ value: st.keyword, placeholder: '搜 品牌 / 型号 / 类型 / 条码' }) +
        desktopFilters(ctx, st) +
        '</div>' +
        body;
      return h;
    },

    actions: {
      tab: function (ctx, st, el) {
        st.tab = el.getAttribute('data-tab');
      },

      keyword: function (ctx, st, el) {
        st.keyword = el.value;
        st.page = 1;
      },

      filter: function (ctx, st, el) {
        var n = el.getAttribute('data-name');
        if (n) st[n] = el.value;
        st.page = 1;
      },

      'reset-filter': function (ctx, st) {
        st.keyword = '';
        st.cat = '';
        st.page = 1;
      },

      'take-keyword': function (ctx, st, el) {
        st.take.keyword = el.value;
      },

      page: function (ctx, st, el) {
        st.page = parseInt(el.getAttribute('data-page'), 10) || 1;
      },

      'toggle-expand': function (ctx, st, el) {
        var id = el.getAttribute('data-id');
        st.expanded = st.expanded === id ? '' : id;
      },

      'show-logs': function (ctx, st, el) {
        st.logsProduct = el.getAttribute('data-id');
      },

      'close-logs': function (ctx, st) {
        st.logsProduct = '';
      },

      /** 盘点：填实盘数 */
      real: function (ctx, st, el) {
        var id = el.getAttribute('data-id');
        var v = el.value === '' ? '' : parseInt(el.value, 10);
        st.take.counts[id] = isNaN(v) ? '' : v;
      },

      'save-take': function (ctx, st) {
        var counts = {};
        Object.keys(st.take.counts).forEach(function (k) {
          if (st.take.counts[k] !== '' && st.take.counts[k] !== undefined) {
            counts[k] = parseInt(st.take.counts[k], 10);
          }
        });
        var res = engine.saveStocktake(ctx, {
          date: util.today(),
          counts: counts,
          note: ''
        });
        if (!res.ok) {
          ui.toast(res.error, 'err');
          return false;
        }
        st.takenResult = res.doc;
        st.take.counts = {};
        ui.toast('已保存盘点单 ' + res.doc.no + '，差异 ' + (res.doc.diffQty > 0 ? '+' : '') + res.doc.diffQty + ' 件', 'ok');
        return true;
      },

      'scan-input': function (ctx, st, payload) {
        var code = String((payload && payload.value) || '').trim();
        if (!code) return;
        st.keyword = code;
        var r = (ERP.scan && ERP.scan.resolve) ? ERP.scan.resolve(ctx, code) : null;
        if (r && r.found) st.expanded = r.product.id;
      },

      'scan': function (ctx, st) {
        if (!ERP.scan || !ERP.scan.start) {
          ui.toast('当前环境不支持扫码，可手动输入条码', 'err');
          return;
        }
        ERP.scan.start({
          onResult: function (code) {
            if (ERP.scan && ERP.scan.openCard) ERP.scan.openCard(ctx, code, ERP.app);
            if (ERP.app) ERP.app.render();
          },
          onError: function (msg) {
            ui.toast(msg || '扫码不可用', 'err');
          }
        });
      }
    }
  };

  /* ---------------- 片段 ---------------- */

  function pageTitle(st) {
    if (st.tab === 'alert') return '库存预警';
    if (st.tab === 'take') return '盘点';
    return '库存管理';
  }

  function pageDesc(ctx, st) {
    if (st.tab === 'alert') return '库存低于阈值 ' + thresholdOf(ctx) + ' 的商品共 ' + inv.getAlerts(ctx).length + ' 个';
    if (st.tab === 'take') return '录入实盘数 → 自动生成盘点调整单并留痕';
    var list = filterList(ctx, st);
    return list.length + ' 款 / ' + totalQty(ctx) + ' 件，资金占用 ' + ui.money(inv.stockValue(ctx));
  }

  function desktopTabs(ctx, st) {
    return '<div class="row wrap mb8">' +
      '<button class="btn' + (st.tab === 'list' ? ' btn-primary' : '') + '" data-act="tab" data-tab="list">📦 库存查询</button>' +
      '<button class="btn' + (st.tab === 'alert' ? ' btn-warn' : '') + '" data-act="tab" data-tab="alert">⚠️ 预警 ' + inv.alertStyleCount(ctx) + '</button>' +
      '<button class="btn' + (st.tab === 'take' ? ' btn-primary' : '') + '" data-act="tab" data-tab="take">🔢 盘点</button>' +
      '</div>';
  }

  function desktopStats(ctx) {
    var styleCount = (ctx.data.products || []).length;
    var qty = totalQty(ctx);
    var cap = inv.stockValue(ctx);
    var alertCount = inv.getAlerts(ctx).length;
    return (
      '<div class="stat-grid stat-grid-compact">' +
        '<div class="stat-card">' +
          '<div class="label">商品数</div>' +
          '<div class="value">' + styleCount + '</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="label">总库存</div>' +
          '<div class="value">' + fmtNum(qty) + '</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="label">资金占用</div>' +
          '<div class="value">' + ui.money(cap) + '</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="label">低库存预警</div>' +
          '<div class="value">' + fmtNum(alertCount) + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function desktopFilters(ctx, st) {
    var cats = [];
    (ctx.data.products || []).forEach(function (p) {
      if (!schema.inScope(ctx.settings, p.category)) return;
      if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category);
    });
    var opts = [{ value: '', text: '全部分类' }].concat(cats.map(function (c) {
      return { value: c, text: c };
    }));
    return (
      '<div class="row wrap mt8">' +
        ui.select({ name: 'cat', value: st.cat, on: 'filter', options: opts }) +
        '<div class="spacer"></div>' +
        '<button class="btn" data-act="reset-filter">重置</button>' +
      '</div>'
    );
  }

  function fmtNum(n) {
    return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ---------------- 业务逻辑 ---------------- */

  function filterList(ctx, st) {
    var kw = String(st.keyword || '').trim().toUpperCase();
    var cat = String(st.cat || '');
    return ctx.data.products.filter(function (p) {
      if (!schema.inScope(ctx.settings, p.category)) return false;
      if (cat && String(p.category || '') !== cat) return false;
      if (!kw) return true;
      var bc = (Array.isArray(p.barcodes) ? p.barcodes : []).some(function (b) {
        return String(b || '').toUpperCase().indexOf(kw) >= 0;
      });
      return String(p.brand || '').toUpperCase().indexOf(kw) >= 0 ||
        String(p.model || '').toUpperCase().indexOf(kw) >= 0 ||
        String(p.category || '').toUpperCase().indexOf(kw) >= 0 || bc;
    });
  }

  function renderList(ctx, st) {
    var list = util.sortBy(filterList(ctx, st), function (p) {
      return String(p.brand || '') + String(p.model || '');
    });
    var pg = util.paginate(list, st.page, 200);
    st.page = pg.page;

    if (!pg.items.length) {
      return '<div class="card">' + ui.empty('没有找到商品') + '</div>';
    }

    var h = '<div class="card"><div class="table-wrap"><table class="tbl tbl-striped"><thead><tr>' +
      '<th>品牌</th><th>型号</th><th>类型</th><th>单位</th>' +
      '<th class="num">成本</th><th class="num">批发价</th><th class="num">零售价</th>' +
      '<th class="num">库存</th><th>操作</th></tr></thead><tbody>';
    pg.items.forEach(function (p) {
      var low = (p.stock || 0) < thresholdOf(ctx);
      h += '<tr>' +
        '<td>' + esc(p.brand) + '</td>' +
        '<td>' + esc(p.model) + '</td>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td>' + esc(p.unit) + '</td>' +
        '<td class="num">' + ui.money(p.cost) + '</td>' +
        '<td class="num">' + ui.money(p.priceWholesale) + '</td>' +
        '<td class="num">' + ui.money(p.priceRetail) + '</td>' +
        '<td class="num' + (low ? ' low' : '') + '">' + (p.stock ? '<b>' + p.stock + '</b>' : '<span class="weak">0</span>') +
        (low ? ' ' + ui.badge('低', 'warn') : '') + '</td>' +
        '<td class="act"><button data-act="show-logs" data-id="' + esc(p.id) + '">明细</button></td></tr>';
    });
    h += '</tbody></table></div>' + ui.pager(pg.page, pg.pages, pg.total) + '</div>';

    if (st.logsProduct) {
      var logs = inv.logsOfProduct(ctx, st.logsProduct);
      var p = product.getById(ctx, st.logsProduct);
      h += '<div class="card"><div class="card-title">变动明细：' + esc(p ? product.displayName(p) : st.logsProduct) +
        '<button class="btn btn-sm" data-act="close-logs">关闭</button></div>';
      if (!logs.length) {
        h += ui.empty('暂无变动记录');
      } else {
        h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>日期</th><th>类型</th><th>单据号</th>' +
          '<th class="num">变动</th><th class="num">余额</th></tr></thead><tbody>';
        logs.slice(0, 100).forEach(function (l) {
          h += '<tr><td>' + esc(l.date) + '</td><td>' + esc(refLabel(l.refType)) + '</td>' +
            '<td class="mono small">' + esc(l.refNo || '') + '</td>' +
            '<td class="num" style="color:' + (l.delta > 0 ? '#16a34a' : '#dc2626') + '">' +
            (l.delta > 0 ? '+' : '') + l.delta + '</td>' +
            '<td class="num">' + l.balance + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }
      h += '</div>';
    }
    return h;
  }

  function refLabel(refType) {
    switch (refType) {
      case 'purchase': return '进货入库';
      case 'sale': return '销售出库';
      case 'gift': return '赠送出库';
      case 'refund': return '退货入库';
      case 'stocktake': return '盘点调整';
      case 'void': return '单据作废';
      default: return refType || '-';
    }
  }

  /* ---------------- 预警 ---------------- */

  function renderAlert(ctx, st) {
    var alerts = inv.getAlerts(ctx);
    if (!alerts.length) {
      return '<div class="card">' + ui.empty('库存充足，暂无预警') + '</div>';
    }
    var h = '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>品牌</th><th>型号</th><th>类型</th><th class="num">库存</th><th class="num">阈值</th></tr></thead><tbody>';
    alerts.slice(0, 300).forEach(function (a) {
      h += '<tr><td>' + esc(a.brand) + '</td><td>' + esc(a.model) + '</td>' +
        '<td>' + esc(a.category) + '</td>' +
        '<td class="num"><b style="color:' + (a.empty ? '#dc2626' : '#f59e0b') + '">' + a.stock + '</b></td>' +
        '<td class="num">' + a.threshold + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    void st;
    return h;
  }

  /* ---------------- 盘点 ---------------- */

  function renderTake(ctx, st) {
    var kw = String(st.take.keyword || '').trim().toUpperCase();
    var list = ctx.data.products.filter(function (p) {
      if (!schema.inScope(ctx.settings, p.category)) return false;
      if (!kw) return true;
      return String(p.brand || '').toUpperCase().indexOf(kw) >= 0 ||
        String(p.model || '').toUpperCase().indexOf(kw) >= 0 ||
        String(p.category || '').toUpperCase().indexOf(kw) >= 0;
    });

    var h = '<div class="card"><div class="card-title">录入实盘数' +
      '<span class="more">留空表示不盘该项</span></div>' +
      '<div class="row mb8"><input class="input" data-input="take-keyword" placeholder="搜索 品牌 / 型号 / 类型" value="' + esc(st.take.keyword) + '"></div>';

    if (!list.length) {
      h += ui.empty('没有找到商品');
    } else {
      h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>商品</th>' +
        '<th class="num">账面</th><th class="num">实盘</th></tr></thead><tbody>';
      list.forEach(function (p) {
        var val = st.take.counts[p.id] !== undefined ? st.take.counts[p.id] : '';
        h += '<tr>' +
          '<td>' + esc(p.brand) + ' <b>' + esc(p.model) + '</b><br><span class="weak small">' + esc(p.category) + ' / ' + esc(p.unit) + '</span></td>' +
          '<td class="num">' + (p.stock || 0) + '</td>' +
          '<td class="num"><input class="input" style="width:70px;text-align:right" data-change="real" data-id="' + esc(p.id) + '" inputmode="numeric" value="' + esc(val) + '"></td>' +
          '</tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="row mt8"><button class="btn btn-primary btn-block" data-act="save-take">保存盘点单</button></div>';
    }
    h += '</div>';

    var last = (ctx.data.stocktakes || []).slice(-5).reverse();
    if (last.length) {
      h += '<div class="card"><div class="card-title">最近盘点记录</div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>单号</th><th>日期</th><th class="num">差异件数</th><th class="num">差异行</th></tr></thead><tbody>';
      last.forEach(function (d) {
        h += '<tr><td class="mono">' + esc(d.no) + '</td><td>' + esc(d.date) + '</td>' +
          '<td class="num">' + (d.diffQty > 0 ? '+' : '') + d.diffQty + '</td>' +
          '<td class="num">' + d.diffCount + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
    }

    if (st.takenResult) {
      var r = st.takenResult;
      h += '<div class="notice notice-info">盘点单 ' + esc(r.no) + ' 已保存：差异 ' +
        (r.diffQty > 0 ? '+' : '') + r.diffQty + ' 件（' + r.diffCount + ' 行有差异）</div>';
    }
    return h;
  }

  return page;
});
