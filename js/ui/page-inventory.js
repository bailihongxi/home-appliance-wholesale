/**
 * ui/page-inventory.js —— 库存管理（电器版单层商品）
 * 三个视图：库存查询（商品库存 + 变动明细）/ 预警（低于全局阈值）/ 盘点（按商品填实盘数）。
 *
 * V3.56 性能专项（问题1：预警/盘点切换卡顿、无分页、闪屏并跳回页面顶部）：
 *   1) 三个标签全部接入分页：库存查询 200/页（沿用）、预警 200/页、盘点 100/页（每行一个实盘输入框，
 *      因此页容量减半）。此前预警固定渲染前 300 行、盘点一次性渲染「全部商品 + 等量 input」，
 *      几千个输入框让切页/搜索/改数都要重建整页 DOM —— 这是卡顿与闪屏的根因。
 *   2) 区块化 + 局部刷新：整页拆成 head / tabs / search / body 四个区块，update(ctx, st) 只替换
 *      真正变化的区块（按字符串比对，未变则完全不动 DOM）；app.render 在同路由重渲染时优先调用
 *      update —— 不整页重建（不闪屏）、不调用 scrollTo（滚动位置天然保持，不跳回顶部）。
 *   3) 同一渲染周期内 getAlerts / 商品过滤结果各只计算一次（此前一帧内最多重复算 3 次）。
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

  /** 每页条数：预警 200、盘点 100（每行带实盘输入框，减半以压低 DOM 规模）；
   *  库存查询沿用 200（util.paginate(list, st.page, 200)，见 renderList） */
  var PAGE_ALERT = 200;
  var PAGE_TAKE = 100;

  function totalQty(ctx) {
    var sum = 0;
    (ctx.data.products || []).forEach(function (p) { sum += p.stock || 0; });
    return sum;
  }

  function thresholdOf(ctx) {
    return ctx.settings.defaultThreshold == null ? 3 : ctx.settings.defaultThreshold;
  }

  /* ---------------- 单渲染周期缓存 ---------------- */
  // 同一次 render/update 内 getAlerts（预警列表）与 filterList（商品过滤+排序）各只算一次。
  var memo = null;
  function resetMemo() {
    memo = { alerts: null, list: null, listKey: null };
  }
  function ensureMemo() {
    if (!memo) resetMemo();
    return memo;
  }
  function alertsOf(ctx) {
    var m = ensureMemo();
    if (!m.alerts) m.alerts = inv.getAlerts(ctx);
    return m.alerts;
  }
  function listOf(ctx, st) {
    var m = ensureMemo();
    var key = String(st.keyword || '') + '||' + String(st.cat || '');
    if (!m.list || m.listKey !== key) {
      m.list = util.sortBy(filterList(ctx, st), function (p) {
        return String(p.brand || '') + String(p.model || '');
      });
      m.listKey = key;
    }
    return m.list;
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
        alertPage: 1, // V3.56：预警独立页码
        takePage: 1,  // V3.56：盘点独立页码
        expanded: '',
        logsProduct: '',
        take: { counts: {}, keyword: '' },
        takenResult: null
      };
    },

    /**
     * 整页渲染（进入页面 / 整页重建时用）。
     * V3.56：按区块生成，并把各区块字符串记入 lastRegions，供 update() 首次比对使用。
     */
    render: function (ctx, st) {
      resetMemo();
      var head = headHtml(ctx, st);
      var tabsInner = tabsInnerHtml(ctx, st);
      var searchInner = searchInnerHtml(ctx, st);
      var body = bodyHtml(ctx, st);
      lastRegions = { head: head, tabs: tabsInner, search: searchInner, body: body };
      return '<div class="inv-root">' +
        '<div id="inv-head">' + head + '</div>' +
        '<div class="inv-tabs">' + tabsInner + '</div>' +
        '<div class="card" id="inv-search">' + searchInner + '</div>' +
        '<div id="inv-body">' + body + '</div>' +
        '</div>';
    },

    /**
     * V3.56：局部刷新（同路由重渲染时由 app.render 优先调用）。
     * 只替换真正变化的区块，未变化的区块完全不动 DOM —— 不闪屏；
     * 且全程不触碰 window.scrollTo —— 滚动位置天然保持，不会跳回页面顶部。
     * 返回 true 表示已局部更新（调用方跳过整页重建）；false 表示不可用，请走整页渲染。
     */
    update: function (ctx, st) {
      if (typeof document === 'undefined' || !document.querySelector) return false;
      resetMemo();
      var wrap = document.querySelector('.inv-root');
      if (!wrap) return false;
      var head = wrap.querySelector('#inv-head');
      var tabs = wrap.querySelector('.inv-tabs');
      var search = wrap.querySelector('#inv-search');
      var body = wrap.querySelector('#inv-body');
      if (!head || !tabs || !search || !body) return false;

      var act = document.activeElement;
      var focusKey = null;
      var caret = null;
      if (act && act.getAttribute) {
        var attr = act.getAttribute('data-change') !== null ? 'data-change'
          : (act.getAttribute('data-input') !== null ? 'data-input' : '');
        if (attr) {
          var fname = act.getAttribute(attr);
          var fid = act.getAttribute('data-id');
          if (fname) {
            focusKey = '[' + attr + '="' + fname + '"]' + (fid ? '[data-id="' + fid + '"]' : '');
          }
        }
        try { caret = act.selectionStart != null ? act.selectionStart : null; } catch (e) { caret = null; }
      }

      // 基线：上一次 render/update 写入 DOM 的区块串（用于首次比对，避免无谓替换）
      var base = lastRegions;
      var headNew = headHtml(ctx, st);
      var tabsNew = tabsInnerHtml(ctx, st);
      var searchNew = searchInnerHtml(ctx, st);
      var bodyNew = bodyHtml(ctx, st);
      lastRegions = { head: headNew, tabs: tabsNew, search: searchNew, body: bodyNew };

      setRegion(head, 'head', headNew, base);
      setRegion(tabs, 'tabs', tabsNew, base);
      setRegion(search, 'search', searchNew, base);
      setRegion(body, 'body', bodyNew, base);

      // 局部替换后恢复焦点与光标（盘点页实盘数输入框等）
      if (focusKey) {
        try {
          var next = document.querySelector(focusKey);
          if (next) {
            next.focus();
            if (caret !== null && next.setSelectionRange) {
              try { next.setSelectionRange(caret, caret); } catch (e2) { /* 部分输入类型不支持 */ }
            }
          }
        } catch (e3) { /* 焦点恢复失败不影响渲染 */ }
      }
      return true;
    },

    actions: {
      tab: function (ctx, st, el) {
        st.tab = el.getAttribute('data-tab');
      },

      keyword: function (ctx, st, el) {
        st.keyword = el.value;
        st.page = 1;
        st.alertPage = 1;
      },

      filter: function (ctx, st, el) {
        var n = el.getAttribute('data-name');
        if (n) st[n] = el.value;
        st.page = 1;
        st.alertPage = 1;
      },

      'reset-filter': function (ctx, st) {
        st.keyword = '';
        st.cat = '';
        st.page = 1;
        st.alertPage = 1;
      },

      'take-keyword': function (ctx, st, el) {
        st.take.keyword = el.value;
        st.takePage = 1;
      },

      /** V3.56：翻页按当前标签分流到各自的页码字段 */
      page: function (ctx, st, el) {
        var v = parseInt(el.getAttribute('data-page'), 10) || 1;
        if (st.tab === 'take') st.takePage = v;
        else if (st.tab === 'alert') st.alertPage = v;
        else st.page = v;
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

  /* ---------------- 区块：局部刷新时按块比对 ---------------- */

  var lastRegions = null;

  /** 区块内 HTML 相同则完全不动 DOM（避免无谓重排与输入框失焦） */
  function setRegion(node, key, html, base) {
    if (!node) return;
    if (node.__invHtml === undefined) {
      // 首次局部刷新：DOM 由上一次 render() 生成，用当时记录的区块串做基线
      node.__invHtml = (base && base[key] !== undefined) ? base[key] : node.innerHTML;
    }
    if (node.__invHtml === html) return;
    node.innerHTML = html;
    node.__invHtml = html;
  }

  /* ---------------- 片段 ---------------- */

  function pageTitle(st) {
    if (st.tab === 'alert') return '库存预警';
    if (st.tab === 'take') return '盘点';
    return '库存管理';
  }

  function pageDesc(ctx, st) {
    if (st.tab === 'alert') return '库存低于阈值 ' + thresholdOf(ctx) + ' 的商品共 ' + alertsOf(ctx).length + ' 个';
    if (st.tab === 'take') return '录入实盘数 → 自动生成盘点调整单并留痕';
    var list = listOf(ctx, st);
    return list.length + ' 款 / ' + totalQty(ctx) + ' 件，资金占用 ' + ui.money(inv.stockValue(ctx));
  }

  /** 区块1：页头 + 统计卡（仅库存查询显示统计卡） */
  function headHtml(ctx, st) {
    return '<div class="page-head"><h2>' + pageTitle(st) + '</h2>' +
      '<span class="desc">' + pageDesc(ctx, st) + '</span></div>' +
      (st.tab === 'list' ? desktopStats(ctx) : '');
  }

  /** 区块2：标签按钮（V3.15 专用类 inv-tabs，上下留空隙） */
  function tabsInnerHtml(ctx, st) {
    return '<button class="btn' + (st.tab === 'list' ? ' btn-primary' : '') + '" data-act="tab" data-tab="list">📦 库存查询</button>' +
      '<button class="btn' + (st.tab === 'alert' ? ' btn-warn' : '') + '" data-act="tab" data-tab="alert">⚠️ 预警 ' + alertsOf(ctx).length + '</button>' +
      '<button class="btn' + (st.tab === 'take' ? ' btn-primary' : '') + '" data-act="tab" data-tab="take">🔢 盘点</button>';
  }

  /** 区块3：搜索/筛选（盘点页用自带的实盘搜索框） */
  function searchInnerHtml(ctx, st) {
    if (st.tab === 'take') {
      var filled = Object.keys(st.take.counts || {}).filter(function (k) {
        return st.take.counts[k] !== '' && st.take.counts[k] !== undefined;
      }).length;
      return '<div class="card-title">录入实盘数' +
        '<span class="more">留空表示不盘该项' + (filled ? ' · 已填 ' + filled + ' 项' : '') + '</span></div>' +
        '<div class="row mb8"><input class="input" type="search" data-input="take-keyword" data-live="1" data-debounce="1" placeholder="搜索 品牌 / 型号 / 类型" value="' + esc(st.take.keyword) + '"></div>';
    }
    return ui.searchBar({
      value: st.keyword, placeholder: '搜 品牌 / 型号 / 类型 / 条码', scan: false,
      filters: desktopFilters(ctx, st)
    });
  }

  /** 区块4：列表主体 */
  function bodyHtml(ctx, st) {
    if (st.tab === 'alert') return renderAlert(ctx, st);
    if (st.tab === 'take') return renderTake(ctx, st);
    return renderList(ctx, st);
  }

  function desktopStats(ctx) {
    var styleCount = (ctx.data.products || []).length;
    var qty = totalQty(ctx);
    var cap = inv.stockValue(ctx);
    var alertCount = alertsOf(ctx).length;
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
      if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category);
    });
    var opts = [{ value: '', text: '全部分类' }].concat(cats.map(function (c) {
      return { value: c, text: c };
    }));
    // V3.17：分类下拉与重置按钮包进 .search-bar-filters——
    // 手机端该容器整行换行，内部 select 与重置按钮并排同一行（此前 select 独占一行、重置被挤到第三行）
    return (
      '<div class="search-bar-filters">' +
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

  function upper(s) {
    return String(s == null ? '' : s).trim().toUpperCase();
  }

  function filterList(ctx, st) {
    var kw = upper(st.keyword);
    var cat = String(st.cat || '');
    return ctx.data.products.filter(function (p) {
      if (cat && String(p.category || '') !== cat) return false;
      if (!kw) return true;
      var bc = (Array.isArray(p.barcodes) ? p.barcodes : []).some(function (b) {
        return upper(b).indexOf(kw) >= 0;
      });
      return upper(p.brand).indexOf(kw) >= 0 ||
        upper(p.model).indexOf(kw) >= 0 ||
        upper(p.category).indexOf(kw) >= 0 || bc;
    });
  }

  function renderList(ctx, st) {
    var list = listOf(ctx, st);
    var pg = util.paginate(list, st.page, 200);
    st.page = pg.page;

    if (!pg.items.length) {
      return '<div class="card">' + ui.empty('没有找到商品') + '</div>';
    }

    var h = '';

    // 变动明细模块：移到库存明细表上方，点击关闭后自动隐藏（logsProduct 为空时不渲染）
    if (st.logsProduct) {
      var logs = inv.logsOfProduct(ctx, st.logsProduct);
      var p = product.getById(ctx, st.logsProduct);
      h += '<div class="card"><div class="card-title">变动明细：' + esc(p ? product.displayName(p) : st.logsProduct) +
        '<button class="btn btn-sm btn-danger" data-act="close-logs">关闭</button></div>';
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

    h += '<div class="card"><div class="table-wrap"><table class="tbl tbl-striped"><thead><tr>' +
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

  /** V3.56：预警支持关键词/分类筛选 + 分页（此前固定渲染前 300 行、且搜索框对它无效） */
  function filterAlerts(ctx, st) {
    var kw = upper(st.keyword);
    var cat = String(st.cat || '');
    if (!kw && !cat) return alertsOf(ctx);
    return alertsOf(ctx).filter(function (a) {
      if (cat && String(a.category || '') !== cat) return false;
      if (!kw) return true;
      return upper(a.brand).indexOf(kw) >= 0 ||
        upper(a.model).indexOf(kw) >= 0 ||
        upper(a.category).indexOf(kw) >= 0;
    });
  }

  function renderAlert(ctx, st) {
    var alerts = filterAlerts(ctx, st);
    if (!alerts.length) {
      var msg = (String(st.keyword || '').trim() || st.cat) ? '没有找到匹配的预警商品' : '库存充足，暂无预警';
      return '<div class="card">' + ui.empty(msg) + '</div>';
    }
    var pg = util.paginate(alerts, st.alertPage, PAGE_ALERT);
    st.alertPage = pg.page;

    var h = '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>品牌</th><th>型号</th><th>类型</th><th class="num">库存</th><th class="num">阈值</th></tr></thead><tbody>';
    pg.items.forEach(function (a) {
      h += '<tr><td>' + esc(a.brand) + '</td><td>' + esc(a.model) + '</td>' +
        '<td>' + esc(a.category) + '</td>' +
        '<td class="num"><b style="color:' + (a.empty ? '#dc2626' : '#f59e0b') + '">' + a.stock + '</b></td>' +
        '<td class="num">' + a.threshold + '</td></tr>';
    });
    h += '</tbody></table></div>' + ui.pager(pg.page, pg.pages, pg.total) + '</div>';
    return h;
  }

  /* ---------------- 盘点 ---------------- */

  /** V3.56：盘点列表按关键词过滤 + 分页（此前一次性渲染全部商品，几千个 input 直接卡死） */
  function renderTake(ctx, st) {
    var kw = upper(st.take.keyword);
    var list = ctx.data.products.filter(function (p) {
      if (!kw) return true;
      return upper(p.brand).indexOf(kw) >= 0 ||
        upper(p.model).indexOf(kw) >= 0 ||
        upper(p.category).indexOf(kw) >= 0;
    });

    var pg = util.paginate(list, st.takePage, PAGE_TAKE);
    st.takePage = pg.page;

    var h = '';
    if (!pg.items.length) {
      h += '<div class="card">' + ui.empty('没有找到商品') + '</div>';
    } else {
      h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>商品</th>' +
        '<th class="num">账面</th><th class="num">实盘</th></tr></thead><tbody>';
      pg.items.forEach(function (p) {
        var val = st.take.counts[p.id] !== undefined ? st.take.counts[p.id] : '';
        h += '<tr>' +
          '<td>' + esc(p.brand) + ' <b>' + esc(p.model) + '</b><br><span class="weak small">' + esc(p.category) + ' / ' + esc(p.unit) + '</span></td>' +
          '<td class="num">' + (p.stock || 0) + '</td>' +
          '<td class="num"><input class="input" style="width:70px;text-align:right" data-change="real" data-id="' + esc(p.id) + '" inputmode="numeric" value="' + esc(val) + '"></td>' +
          '</tr>';
      });
      h += '</tbody></table></div>' + ui.pager(pg.page, pg.pages, pg.total) +
        '<div class="row mt8"><button class="btn btn-primary btn-block" data-act="save-take">保存盘点单</button></div></div>';
    }

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
