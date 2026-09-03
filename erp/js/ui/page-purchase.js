/**
 * ui/page-purchase.js —— 进货管理（电器版）
 * 搜索选品 → 「加入」按商品加行（默认带出档案成本可改）→ 批量成本 → 保存挂账。
 * 保存后最新进价同步回商品档案成本（D1）；修改 / 作废留痕。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.ui || (isNode ? require('./components.js') : null),
    E.schema || (isNode ? require('../core/schema.js') : null),
    E.engine || (isNode ? require('../core/engine.js') : null),
    E.debt || (isNode ? require('../core/debt.js') : null),
    E.product || (isNode ? require('../core/product.js') : null),
    E.repo || (isNode ? require('../store/repo.js') : null),
    E.printDoc || (isNode ? require('./print-doc.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.purchase = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, ui, schema, engine, debt, product, repo, printDoc, ERP) {
  'use strict';

  var esc = util.escapeHtml;

  function emptyForm() {
    return {
      date: util.today(),
      partnerId: '',
      newPartner: '',
      items: [],
      paid: '',
      note: '',
      keyword: '',
      pickPage: 1,
      bulkPrice: '',
      editNo: null
    };
  }

  /** 批量设置成本（原批量进价）：把 value 一次性写入全部明细行 */
  function applyBulkPrice(form, value) {
    var raw = String(value === undefined || value === null ? '' : value).trim();
    if (!raw) return { ok: false, error: '请先填写要批量应用的成本' };
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      return { ok: false, error: '成本格式不对：请填 0 或正数，最多两位小数' };
    }
    if (!form.items || !form.items.length) {
      return { ok: false, error: '还没有进货明细，先搜索并点「加入」添加' };
    }
    form.items.forEach(function (it) {
      it.costPrice = raw;
    });
    return { ok: true, count: form.items.length, price: util.parseMoney(raw), value: raw };
  }

  var page = {
    name: 'purchase',
    title: '进货管理',
    icon: '🚚',

    init: function () {
      return {
        tab: 'list',
        keyword: '',
        from: '',
        to: '',
        partnerId: '',
        page: 1,
        viewNo: null,
        form: emptyForm()
      };
    },

    render: function (ctx, state) {
      if (state.tab === 'form') return renderForm(ctx, state);
      return renderList(ctx, state);
    },

    actions: {
      'open-new': function (ctx, state) {
        state.tab = 'form';
        state.form = emptyForm();
      },

      'cancel-form': function (ctx, state) {
        state.tab = 'list';
        state.form = emptyForm();
      },

      field: function (ctx, state, el) {
        state.form[el.getAttribute('data-name')] = el.value;
      },

      'form-keyword': function (ctx, state, el) {
        state.form.keyword = el.value;
        state.form.pickPage = 1; // 搜索词变化回到选货第 1 页
      },

      'pick-page': function (ctx, state, el) {
        state.form.pickPage = parseInt(el.getAttribute('data-page'), 10) || 1;
      },

      /** 点「加入」：该商品一行，数量 +1 */
      'add-item': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var p = product.getById(ctx, id);
        if (!p) return;
        var it = state.form.items.find(function (x) {
          return x.productId === id;
        });
        if (!it) {
          var bulk = String(state.form.bulkPrice || '').trim();
          it = {
            productId: id,
            brand: p.brand,
            model: p.model,
            unit: p.unit,
            qty: 0,
            costPrice: bulk || String(p.cost ? util.fenToYuan(p.cost) : '0')
          };
          state.form.items.push(it);
        }
        it.qty += 1;
      },

      qty: function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var it = state.form.items.find(function (x) {
          return x.productId === id;
        });
        if (!it) return;
        var v = parseInt(el.value, 10);
        it.qty = isNaN(v) || v < 0 ? 0 : v;
      },

      price: function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var it = state.form.items.find(function (x) {
          return x.productId === id;
        });
        if (!it) return;
        it.costPrice = el.value;
      },

      'bulk-price': function (ctx, state, el) {
        state.form.bulkPrice = el.value;
      },

      'apply-bulk-price': function (ctx, state) {
        var r = applyBulkPrice(state.form, state.form.bulkPrice);
        if (!r.ok) {
          ui.toast(r.error, 'err');
          return false;
        }
        ui.toast('已把成本 ' + ui.money(r.price) + ' 应用到全部 ' + r.count + ' 行明细', 'ok');
        return true;
      },

      'del-item': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        state.form.items = state.form.items.filter(function (x) {
          return x.productId !== id;
        });
      },

      'clear-items': function (ctx, state) {
        state.form.items = [];
      },

      'quick-paid': function (ctx, state, el) {
        state.form.paid = util.fenToYuan(total(state.form));
      },

      'save-purchase': function (ctx, state) {
        var form = state.form;
        var res = engine.savePurchase(ctx, {
          date: form.date,
          partnerId: form.partnerId,
          partnerName: form.newPartner,
          items: form.items,
          paid: form.paid,
          note: form.note
        });
        if (!res.ok) {
          ui.toast(res.error, 'err');
          return false;
        }
        var qty = util.sum(res.doc.items, function (it) {
          return it.qty;
        });
        var debtTip = res.doc.debt > 0
          ? '，欠款 ' + ui.money(res.doc.debt)
          : '，已付清';
        ui.toast('进货单 ' + res.doc.no + ' 已保存，已入库 ' + qty + ' 件' + debtTip + '，库存已更新', 'ok');
        state.tab = 'list';
        state.form = emptyForm();
        state.lastSavedNo = res.doc.no;
        return true;
      },

      'edit-purchase': function (ctx, state, el) {
        var no = el.getAttribute('data-no');
        var doc = ctx.getDoc('purchases', no);
        if (!doc) return;
        state.tab = 'form';
        state.form = {
          date: doc.date,
          partnerId: doc.partnerId || '',
          newPartner: '',
          items: doc.items.map(function (it) {
            return {
              productId: it.productId,
              brand: it.brand,
              model: it.model,
              unit: it.unit,
              qty: it.qty,
              costPrice: util.fenToYuan(it.costPrice)
            };
          }),
          paid: util.fenToYuan(doc.paid),
          note: doc.note || '',
          keyword: '',
          bulkPrice: '',
          editNo: no
        };
      },

      'update-purchase': function (ctx, state) {
        var form = state.form;
        var res = engine.updatePurchase(ctx, form.editNo, {
          date: form.date,
          partnerId: form.partnerId,
          partnerName: form.newPartner,
          items: form.items,
          paid: form.paid,
          note: form.note
        });
        if (!res.ok) {
          ui.toast(res.error, 'err');
          return false;
        }
        ui.toast('已更新 ' + res.doc.no, 'ok');
        state.tab = 'list';
        state.form = emptyForm();
        return true;
      },

      'void-purchase': function (ctx, state, el) {
        var no = el.getAttribute('data-no');
        var doc = ctx.getDoc('purchases', no);
        if (!doc) return;
        if (!ui.confirm) {
          voidDoc(ctx, no);
          return;
        }
        ui.confirm('作废进货单', '作废后库存与欠款将自动回滚，且不可恢复。<br>单号：' + esc(no)).then(function (yes) {
          if (yes) {
            voidDoc(ctx, no);
            if (ERP.app) ERP.app.render();
          }
        });
        return false;
      },

      'view-doc': function (ctx, state, el) {
        state.viewNo = el.getAttribute('data-no');
      },

      'close-view': function (ctx, state) {
        state.viewNo = null;
      },

      'print-doc': function (ctx, state, el) {
        var no = el.getAttribute('data-no');
        var doc = ctx.getDoc('purchases', no);
        if (!doc) return;
        var html = printDoc.buildDocHtml(ctx, doc, 'purchase');
        printDoc.openPrint(html);
      },

      filter: function (ctx, state, el) {
        state[el.getAttribute('data-name')] = el.value;
        state.page = 1;
      },

      keyword: function (ctx, state, el) {
        state.keyword = el.value;
        state.page = 1;
      },

      page: function (ctx, state, el) {
        state.page = parseInt(el.getAttribute('data-page'), 10) || 1;
      },

      'pay-supplier': function (ctx, state, el) {
        if (ERP.app) ERP.app.go('account', { pay: el.getAttribute('data-id') });
      }
    }
  };

  function voidDoc(ctx, no) {
    var r = engine.voidPurchase(ctx, no);
    if (!r.ok) ui.toast(r.error, 'err');
    else ui.toast('已作废 ' + no + '，库存与欠款已回滚', 'ok');
    return r;
  }

  function total(form) {
    return form.items.reduce(function (t, it) {
      return t + util.parseMoney(it.costPrice) * (parseInt(it.qty, 10) || 0);
    }, 0);
  }

  /* ---------------- 列表 ---------------- */

  function renderList(ctx, state) {
    var list = ctx.data.purchases.filter(function (d) {
      if (state.from && d.date < state.from) return false;
      if (state.to && d.date > state.to) return false;
      if (state.partnerId && d.partnerId !== state.partnerId) return false;
      if (state.keyword) {
        var kw = String(state.keyword).toUpperCase();
        var hit = String(d.no).toUpperCase().indexOf(kw) >= 0 ||
          String(d.partnerName || '').toUpperCase().indexOf(kw) >= 0;
        if (!hit) {
          hit = (d.items || []).some(function (it) {
            return String(it.brand || '').toUpperCase().indexOf(kw) >= 0 ||
              String(it.model || '').toUpperCase().indexOf(kw) >= 0;
          });
        }
        if (!hit) return false;
      }
      return true;
    });
    list = util.sortBy(list, function (d) {
      return d.no;
    }, true);

    var pg = util.paginate(list, state.page, 300);
    state.page = pg.page;

    var totals = list.reduce(
      function (t, d) {
        t.total += d.total || 0;
        t.debt += d.voided ? 0 : d.debt || 0;
        return t;
      },
      { total: 0, debt: 0 }
    );

    var h = '<div class="page-head"><h2>进货管理</h2>' +
      '<span class="desc">' + list.length + ' 张单，未结 ' + ui.money(totals.debt) + '</span>' +
      '<div class="actions"><button class="btn btn-primary" data-act="open-new">＋ 新建进货单</button></div></div>';

    // 搜索模块重排（参考记账中心）：第 1 行 = 搜索框 + 供应商下拉；第 2 行 = 起止日期
    h += '<div class="card">' + ui.searchBar({
      value: state.keyword, placeholder: '搜索单号 / 供应商 / 品牌 / 型号', scan: false,
      filters: ui.select({
        name: 'partnerId',
        value: state.partnerId,
        on: 'filter',
        options: [{ value: '', text: '全部供应商' }].concat(
          debt.list(ctx, 'supplier').map(function (p) {
            return { value: p.id, text: p.name };
          })
        )
      })
    });
    h += '<div class="row">' +
      '<input class="input" type="date" data-change="filter" data-name="from" value="' + esc(state.from) + '">' +
      '<input class="input" type="date" data-change="filter" data-name="to" value="' + esc(state.to) + '">' +
      '</div></div>';

    if (!pg.items.length) {
      h += '<div class="card">' + ui.empty('暂无进货单') + '</div>';
      return h;
    }

    h += '<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>单号</th><th>日期</th><th>供应商</th><th class="num">数量</th><th class="num">金额</th>' +
      '<th class="num">已付</th><th class="num">欠款</th><th>状态</th><th>操作</th></tr></thead><tbody>';
    pg.items.forEach(function (d) {
      var qty = util.sum(d.items, function (it) {
        return it.qty;
      });
      h += '<tr' + (d.voided ? ' style="opacity:.5"' : '') + '>' +
        '<td class="mono">' + esc(d.no) + '</td>' +
        '<td>' + esc(d.date) + '</td>' +
        '<td>' + esc(d.partnerName || '-') + '</td>' +
        '<td class="num">' + qty + '</td>' +
        '<td class="num">' + ui.money(d.total) + '</td>' +
        '<td class="num">' + ui.money(d.paid) + '</td>' +
        '<td class="num">' + (d.debt ? '<b style="color:#dc2626">' + ui.money(d.debt) + '</b>' : '—') + '</td>' +
        '<td>' + (d.voided ? ui.badge('已作废', 'off') : d.debt ? ui.badge('未结清', 'warn') : ui.badge('已结清', 'on')) + '</td>' +
        '<td class="act">' +
        '<button data-act="view-doc" data-no="' + esc(d.no) + '">查看</button>' +
        (d.voided ? '' : '<button data-act="edit-purchase" data-no="' + esc(d.no) + '">修改</button>' +
          '<button data-act="void-purchase" data-no="' + esc(d.no) + '">作废</button>') +
        '</td></tr>';
    });
    h += '</tbody></table></div>' + ui.pager(pg.page, pg.pages, pg.total) + '</div>';

    if (state.viewNo) {
      var doc = ctx.getDoc('purchases', state.viewNo);
      if (doc) h += docModal(ctx, doc);
    }
    return h;
  }

  function docModal(ctx, doc) {
    var qty = util.sum(doc.items, function (it) {
      return it.qty;
    });
    var h = '<div class="card"><div class="card-title">进货单 ' + esc(doc.no) +
      '<span class="more">' + esc(doc.date) + ' · ' + esc(doc.partnerName || '') + '</span></div>' +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>商品</th>' +
      '<th class="num">数量</th><th class="num">成本</th><th class="num">小计</th></tr></thead><tbody>';
    doc.items.forEach(function (it) {
      h += '<tr><td>' + esc(it.brand || '') + ' <b>' + esc(it.model || '') + '</b>' +
        (it.unit ? ' <span class="weak small">' + esc(it.unit) + '</span>' : '') + '</td>' +
        '<td class="num">' + it.qty + '</td><td class="num">' + ui.money(it.costPrice) + '</td>' +
        '<td class="num">' + ui.money(it.amount) + '</td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="row between mt8"><span class="muted">合计 ' + qty + ' 件 · ' + ui.money(doc.total) +
      '（已付 ' + ui.money(doc.paid) + '，欠款 ' + ui.money(doc.debt) + '）</span>' +
      '<button class="btn btn-sm" data-act="print-doc" data-no="' + esc(doc.no) + '">打印</button>' +
      '<button class="btn btn-sm" data-act="close-view">关闭</button></div></div>';
    return h;
  }

  /* ---------------- 表单 ---------------- */

  function renderForm(ctx, state) {
    var form = state.form;
    var suppliers = debt.list(ctx, 'supplier');
    var h = '<div class="page-head"><h2>' + (form.editNo ? '修改进货单 ' + esc(form.editNo) : '新建进货单') + '</h2>' +
      '<span class="desc">保存后最新成本将同步到商品档案</span></div>';

    h += '<div class="card">';
    h += '<div class="grid grid-2">' +
      '<div class="field"><label class="req">日期</label>' +
      '<input class="input" type="date" data-change="field" data-name="date" value="' + esc(form.date) + '"></div>' +
      '<div class="field"><label class="req">供应商</label>' +
      ui.select({
        name: 'partnerId',
        value: form.partnerId,
        on: 'field',
        options: [{ value: '', text: '选择供应商' }].concat(
          suppliers.map(function (p) {
            return { value: p.id, text: p.name + (p.balance ? '（欠 ' + ui.money(p.balance) + '）' : '') };
          })
        )
      }) + '</div></div>';
    h += '<div class="field"><label>或即时新建供应商</label>' +
      '<input class="input" data-input="field" data-name="newPartner" placeholder="输入新供应商名称" value="' + esc(form.newPartner) + '"></div>';
    h += '</div>';

    /* 选品加行 */
    h += '<div class="card"><div class="card-title">按商品加行' +
      '<span class="more">点「加入」数量 +1</span></div>' +
      '<div class="row mb8"><input class="input" data-input="form-keyword" data-name="keyword" data-live="1" data-debounce="1" placeholder="搜索 品牌 / 型号 / 类型 / 条码" value="' + esc(form.keyword) + '"></div>';

    var kw = String(form.keyword || '').trim().toUpperCase();
    // 大数据量优化：默认每页 15 条 + 斑马纹 + 分页（避免一次性加载过多商品拉慢速度）
    var pick = util.pickProductsPaged(ctx.data.products, kw, {
      limit: 15,
      page: form.pickPage || 1,
      offStatus: schema.STATUS.OFF
    });

    if (!pick.list.length) {
      h += ui.empty('没有找到商品，先在「商品档案」建档');
    } else {
      h += '<div class="table-wrap"><table class="tbl tbl-striped"><thead><tr>' +
        '<th>商品</th><th class="num">档案成本</th><th class="num">库存</th><th></th>' +
        '</tr></thead><tbody>';
      pick.list.forEach(function (p) {
        var has = state.form.items.some(function (it) {
          return it.productId === p.id;
        });
        h += '<tr>' +
          '<td>' + esc(p.brand) + ' <b>' + esc(p.model) + '</b><br><span class="weak small">' + esc(p.category) + ' / ' + esc(p.unit) + '</span></td>' +
          '<td class="num">' + ui.money(p.cost) + '</td>' +
          '<td class="num">' + (p.stock || 0) + '</td>' +
          '<td class="act"><button class="btn btn-sm btn-primary" data-act="add-item" data-id="' + esc(p.id) + '">' +
          (has ? '＋ 再加' : '加入') + '</button></td>' +
          '</tr>';
      });
      h += '</tbody></table></div>' + ui.pager(pick.page, pick.pages, pick.total, 'pick-page');
    }
    h += '</div>';

    /* 明细 */
    var t = total(form);
    h += '<div class="card"><div class="card-title">进货明细（' + form.items.length + ' 行）' +
      (form.items.length ? '<button class="btn btn-sm" data-act="clear-items">清空</button>' : '') + '</div>';

    h += '<div class="row mb8" style="align-items:center;gap:6px;flex-wrap:wrap">' +
      '<span class="small muted">批量成本</span>' +
      '<input class="input" style="width:110px;text-align:right" data-input="bulk-price" data-name="bulkPrice" ' +
      'inputmode="decimal" placeholder="如 1000" value="' + esc(form.bulkPrice || '') + '">' +
      '<span class="small muted">元</span>' +
      '<button class="btn btn-sm btn-primary" data-act="apply-bulk-price">应用到全部明细</button>' +
      '<span class="small weak">填一次，下面每行都同步；单行也能再改</span>' +
      '</div>';

    if (!form.items.length) {
      h += ui.empty('还没有明细，点上方「加入」添加商品');
    } else {
      h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>商品</th>' +
        '<th class="num">数量</th><th class="num">成本（元）</th><th class="num">小计</th><th></th></tr></thead><tbody>';
      form.items.forEach(function (it) {
        h += '<tr>' +
          '<td>' + esc(it.brand) + ' <b>' + esc(it.model) + '</b><br><span class="weak small">' + esc(it.unit) + '</span></td>' +
          '<td class="num"><input class="input" style="width:70px;text-align:right" data-change="qty" data-id="' + esc(it.productId) + '" inputmode="numeric" value="' + it.qty + '"></td>' +
          '<td class="num"><input class="input" style="width:90px;text-align:right" data-change="price" data-id="' + esc(it.productId) + '" inputmode="decimal" value="' + esc(it.costPrice) + '"></td>' +
          '<td class="num">' + ui.money(util.parseMoney(it.costPrice) * (parseInt(it.qty, 10) || 0)) + '</td>' +
          '<td class="act"><button data-act="del-item" data-id="' + esc(it.productId) + '">删除</button></td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="row between mt8"><span class="strong">合计 ' + ui.money(t) + '</span>' +
        '<button class="btn btn-sm" data-act="quick-paid">已付 = 合计</button></div>';
    }
    h += '</div>';

    var paid = util.parseMoney(form.paid);
    h += '<div class="card">' +
      '<div class="field"><label>已付金额（元）</label>' +
      '<input class="input" data-input="field" data-name="paid" data-live="1" inputmode="decimal" placeholder="0" value="' + esc(form.paid) + '"></div>' +
      '<div class="row between"><span class="muted">本次欠款</span>' +
      '<span class="strong" style="color:' + (t - paid > 0 ? '#dc2626' : '#16a34a') + '">' + ui.money(t - paid) + '</span></div>' +
      '<div class="field mt8"><label>备注</label>' +
      '<input class="input" data-input="field" data-name="note" placeholder="选填" value="' + esc(form.note) + '"></div>' +
      '</div>';

    h += '<div class="row">' +
      '<button class="btn" data-act="cancel-form">取消</button>' +
      '<div class="spacer"></div>' +
      (form.editNo
        ? '<button class="btn btn-primary" data-act="update-purchase">保存修改</button>'
        : '<button class="btn btn-primary" data-act="save-purchase">保存进货单</button>') +
      '</div>';
    return h;
  }

  // 暴露纯函数便于单测
  page.applyBulkPrice = applyBulkPrice;
  page.emptyForm = emptyForm;

  return page;
});
