/**
 * ui/page-customer.js —— 客户管理
 *
 * 把「客户」从「开单时的即时新建」升级为可独立管理：
 *   - 列表：名称 / 电话 / 备注 / 应收余额，支持搜索；
 *   - 新增 / 编辑：名称（必填、按名称+类型去重）、电话、备注；
 *   - 删除：有未结清往来余额或已有销售记录的客户禁止删除，避免账目断裂；
 *   - 收款：跳转记账中心对该客户收款（复用既有挂账能力）。
 * 入口：电脑端左侧列表「客户」+ 手机端「我的 → 常用入口」。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP || {};
  var util = isNode ? require('../core/util.js') : (ERP.util || null);
  var ui = isNode ? require('./components.js') : (ERP.ui || null);
  var debt = isNode ? require('../core/debt.js') : (ERP.debt || null);
  var repo = isNode ? require('../store/repo.js') : (ERP.repo || null);
  var mod = factory(ERP, util, ui, debt, repo);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.customer = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP, util, ui, debt, repo) {
  'use strict';

  var C = ui;
  var esc = util.escapeHtml;

  function emptyForm() {
    return { id: '', name: '', phone: '', note: '' };
  }

  /** 应收余额文案：>0 客户欠我（应收）；<0 我方多收；=0 已结清 */
  function balanceLabel(fen) {
    var v = fen || 0;
    if (v > 0) return { cls: 'warn', text: '应收 ' + C.money(v) };
    if (v < 0) return { cls: 'ok', text: '我方多收 ' + C.money(-v) };
    return { cls: '', text: '已结清' };
  }

  function hasSale(ctx, name) {
    return (ctx.data.sales || []).some(function (d) {
      return d.partnerName === name && !d.voided;
    });
  }

  var page = {
    name: 'customer',
    title: '客户',
    icon: '🤝',

    init: function () {
      return { keyword: '', editing: null, form: emptyForm(), error: '' };
    },

    actions: {
      'open-new': function (ctx, state) {
        state.editing = 'new';
        state.form = emptyForm();
        state.error = '';
        return true;
      },

      'field': function (ctx, state, el) {
        var name = el.getAttribute('data-name');
        if (!name) return;
        state.form[name] = el.value;
      },

      'edit-customer': function (ctx, state, el) {
        var p = ctx.getPartner(el.getAttribute('data-id'));
        if (!p) return false;
        state.editing = p.id;
        state.form = { id: p.id, name: p.name || '', phone: p.phone || '', note: p.note || '' };
        state.error = '';
        return true;
      },

      'cancel-form': function (ctx, state) {
        state.editing = null;
        state.form = emptyForm();
        state.error = '';
        return true;
      },

      'save-customer': function (ctx, state) {
        var name = util.cleanText(state.form.name);
        if (!name) {
          state.error = '请填写客户名称';
          ui.toast('请填写客户名称', 'err');
          return false;
        }
        var dup = (ctx.data.partners || []).find(function (p) {
          return p.type === 'customer' &&
            util.cleanText(p.name).toUpperCase() === name.toUpperCase() &&
            p.id !== state.form.id;
        });
        if (state.form.id) {
          var p = ctx.getPartner(state.form.id);
          if (!p) return false;
          p.name = name;
          p.phone = util.cleanText(state.form.phone);
          p.note = util.cleanText(state.form.note || '');
          ctx.touch('partners', p);
          repo.log(ctx, '编辑客户', name);
          state.editing = null;
          ui.toast('已保存客户：' + name, 'ok');
          return true;
        }
        if (dup) {
          state.error = '已存在同名客户：' + name;
          ui.toast('已存在同名客户：' + name, 'err');
          return false;
        }
        var partner = {
          id: util.uuid('cus'),
          name: name,
          phone: util.cleanText(state.form.phone),
          type: 'customer',
          balance: 0,
          lastDealAt: null,
          createdAt: util.nowISO(),
          note: util.cleanText(state.form.note || '')
        };
        ctx.data.partners = ctx.data.partners || [];
        ctx.data.partners.push(partner);
        ctx.touch('partners', partner);
        repo.log(ctx, '新增客户', name);
        state.editing = null;
        ui.toast('已新增客户：' + name, 'ok');
        return true;
      },

      'delete-customer': function (ctx, state, el) {
        var p = ctx.getPartner(el.getAttribute('data-id'));
        if (!p) return false;
        if ((p.balance || 0) !== 0) {
          ui.toast('该客户还有往来余额（' + C.money(p.balance) + '），请先结清再删除', 'err');
          return false;
        }
        if (hasSale(ctx, p.name)) {
          ui.toast('该客户已有销售记录，无法删除', 'err');
          return false;
        }
        ctx.data.partners = (ctx.data.partners || []).filter(function (x) {
          return x.id !== p.id;
        });
        // 真正从本地库删除（浏览器有 db；Node 测试无 db，仅内存移除）
        var appRef = ERP.app;
        if (appRef && appRef.db && appRef.db.del) {
          try { appRef.db.del('partners', p.id); } catch (e) { /* 忽略 */ }
        }
        repo.log(ctx, '删除客户', p.name);
        ui.toast('已删除客户：' + p.name, 'ok');
        return true;
      },

      /** 收款：跳转记账中心对该客户收款（复用既有挂账能力） */
      'collect': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var appRef = ERP.app;
        if (appRef && appRef.go) {
          appRef.go('account', { collect: id });
          return false;
        }
        if (ERP.router && ERP.router.go) {
          ERP.router.go('account', { collect: id });
          return false;
        }
        return false;
      }
    },

    render: function (ctx, state) {
      if (state.editing) return renderForm(state);
      return renderList(ctx, state);
    }
  };

  function renderList(ctx, state) {
    var list = debt.list(ctx, 'customer');
    var kw = (state.keyword || '').trim().toUpperCase();
    if (kw) {
      list = list.filter(function (p) {
        return (p.name || '').toUpperCase().indexOf(kw) >= 0 ||
          (p.phone || '').toUpperCase().indexOf(kw) >= 0;
      });
    }

    var rows = list.length ? list.map(function (p) {
      var b = balanceLabel(p.balance);
      return '<div class="card mb8 supplier-row">' +
        '<div class="row" style="align-items:flex-start;gap:10px">' +
        '<div class="grow">' +
        '<div class="strong">' + esc(p.name) + '</div>' +
        (p.phone ? '<div class="small muted">📞 ' + esc(p.phone) + '</div>' : '') +
        (p.note ? '<div class="small weak">' + esc(p.note) + '</div>' : '') +
        '</div>' +
        '<div class="col" style="text-align:right;gap:2px">' +
        '<span class="tag ' + (b.cls || '') + '">' + b.text + '</span>' +
        '</div>' +
        '</div>' +
        '<div class="row mt8" style="gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" data-act="collect" data-id="' + esc(p.id) + '">收款</button>' +
        '<button class="btn btn-sm" data-act="edit-customer" data-id="' + esc(p.id) + '">编辑</button>' +
        '<button class="btn btn-sm btn-danger" data-act="delete-customer" data-id="' + esc(p.id) + '">删除</button>' +
        '</div>' +
        '</div>';
    }).join('') : '<div class="card muted small">还没有客户，点下方「＋ 新增客户」添加。</div>';

    return (
      '<div class="page-head"><h2>客户</h2>' +
      '<button class="btn btn-primary btn-sm" data-act="open-new">＋ 新增客户</button></div>' +
      C.searchBar({ value: state.keyword, placeholder: '搜索客户名称 / 电话', scan: false }) +
      '<div class="mt8">' + rows + '</div>'
    );
  }

  function renderForm(state) {
    var f = state.form;
    var err = state.error ? '<div class="notice notice-danger mt8">' + esc(state.error) + '</div>' : '';
    return (
      '<div class="page-head"><h2>' + (f.id ? '编辑客户' : '新增客户') + '</h2></div>' +
      '<div class="card mb8">' +
      '<div class="field"><label class="req">名称</label>' +
      '<input class="input" data-input="field" data-name="name" placeholder="如：西安红星家电城" value="' + esc(f.name) + '"></div>' +
      '<div class="field"><label>电话</label>' +
      '<input class="input" data-input="field" data-name="phone" placeholder="选填" value="' + esc(f.phone) + '"></div>' +
      '<div class="field"><label>备注</label>' +
      '<textarea class="input" data-input="field" data-name="note" placeholder="选填，如：月结客户">' + esc(f.note) + '</textarea></div>' +
      err +
      '<div class="row mt8" style="gap:8px">' +
      '<button class="btn btn-primary" data-act="save-customer">保存</button>' +
      '<button class="btn" data-act="cancel-form">取消</button>' +
      '</div></div>'
    );
  }

  /** 导出测试/复用辅助 */
  page.emptyForm = emptyForm;
  page.balanceLabel = balanceLabel;
  page.hasSale = hasSale;

  return page;
});
