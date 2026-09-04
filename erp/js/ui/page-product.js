/**
 * ui/page-product.js —— 商品档案（电器版单层商品）
 * 字段：品牌 / 型号 / 类型 / 单位 / 成本 / 批发价 / 零售价 / 库存(只读) / 备注 / 原厂条码 / 期初库存(仅新建)
 * 支持 CSV / Excel 批量导入；品牌+型号 唯一。
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP;
  var mod = factory(
    ERP.product || (isNode ? require('../core/product.js') : null),
    ERP.ui || (isNode ? require('./components.js') : null),
    ERP.util || (isNode ? require('../core/util.js') : null),
    ERP.schema || (isNode ? require('../core/schema.js') : null),
    ERP.repo || (isNode ? require('../store/repo.js') : null),
    ERP.excel || (isNode ? require('../core/excel.js') : null),
    ERP
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.product = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (product, ui, util, schema, repo, excel, ERP) {
  'use strict';

  var esc = util.escapeHtml;

  function emptyForm() {
    var cats = (ERP.app && ERP.app.ctx && ERP.app.ctx.settings)
      ? schema.categoriesFor(ERP.app.ctx.settings)
      : schema.CATEGORIES.slice();
    return {
      id: null,
      brand: '',
      model: '',
      category: (cats && cats.length ? cats[0] : '其他'),
      unit: '台',
      cost: '',
      priceWholesale: '',
      priceRetail: '',
      note: '',
      barcodes: '',
      openingStock: ''
    };
  }

  var page = {
    name: 'product',
    title: '商品档案',
    navTitle: '档案管理', // 侧栏导航显示名（页面标题仍为「商品档案」）
    icon: '📦',

    init: function () {
      return {
        tab: 'list',
        keyword: '',
        filterStatus: 'all',
        page: 1,
        form: emptyForm(),
        editing: null,
        csvText: '',
        csvResult: null
      };
    },

    /* ---------------- 渲染入口 ---------------- */

    render: function (ctx, state) {
      if (state.tab === 'new') return renderForm(ctx, state);
      if (state.tab === 'csv') return renderCsv(ctx, state);
      return renderList(ctx, state);
    },

    /* ---------------- 动作 ---------------- */

    actions: {
      'open-new': function (ctx, state) {
        state.tab = 'new';
        state.editing = null;
        state.form = emptyForm();
        state._priceTouchedW = false;
        state._priceTouchedR = false;
      },

      'cancel-form': function (ctx, state) {
        state.tab = 'list';
        state.form = emptyForm();
        state.editing = null;
        state._priceTouchedW = false;
        state._priceTouchedR = false;
      },

      /** 成本输入联动（V3.5）：只填成本，批发/零售自动按整体利润率填充（取整到元）；用户手动改过则不再覆盖 */
      'cost-field': function (ctx, state, el) {
        state.form.cost = el.value;
        var costFen = util.parseMoney(el.value);
        var auto = product.autoPrices(ctx, costFen);
        if (!state._priceTouchedW) {
          state.form.priceWholesale = util.fenToYuan(auto.priceWholesale);
          if (typeof document !== 'undefined' && document) {
            var wInp = document.querySelector('[data-input="field"][data-name="priceWholesale"]');
            if (wInp) wInp.value = util.fenToYuan(auto.priceWholesale);
          }
        }
        if (!state._priceTouchedR) {
          state.form.priceRetail = util.fenToYuan(auto.priceRetail);
          if (typeof document !== 'undefined' && document) {
            var rInp = document.querySelector('[data-input="field"][data-name="priceRetail"]');
            if (rInp) rInp.value = util.fenToYuan(auto.priceRetail);
          }
        }
      },

      field: function (ctx, state, el) {
        var name = el.getAttribute('data-name');
        if (name) state.form[name] = el.value;
        // 用户手动编辑过批发/零售 → 标记为自定义，成本联动不再覆盖
        if (name === 'priceWholesale') state._priceTouchedW = true;
        if (name === 'priceRetail') state._priceTouchedR = true;
      },

      'save-product': function (ctx, state) {
        return save(ctx, state);
      },

      'edit-product': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var p = product.getById(ctx, id);
        if (!p) return;
        state.editing = id;
        state.tab = 'new';
        state.form = {
          id: p.id,
          brand: p.brand || '',
          model: p.model || '',
          category: p.category || '其他',
          unit: p.unit || '台',
          cost: p.cost ? util.fenToYuan(p.cost) : '',
          priceWholesale: p.priceWholesale ? util.fenToYuan(p.priceWholesale) : '',
          priceRetail: p.priceRetail ? util.fenToYuan(p.priceRetail) : '',
          note: p.note || '',
          barcodes: Array.isArray(p.barcodes) ? p.barcodes.join('\n') : '',
          openingStock: ''
        };
      },

      'toggle-status': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var p = product.getById(ctx, id);
        if (!p) return;
        var next = p.status === schema.STATUS.ON ? schema.STATUS.OFF : schema.STATUS.ON;
        product.setStatus(ctx, id, next);
        repo.log(ctx, next === schema.STATUS.ON ? '商品上架' : '商品停售', product.displayName(p));
        if (ERP.app && ERP.app.render) ERP.app.render();
      },

      /** 蓝牙打印商品标签（凝优P50等CPCL标签机） */
      'print-label': function (ctx, state, el) {
        var id = el.getAttribute('data-id');
        var p = product.getById(ctx, id);
        if (!p) return;
        if (!ERP.btLabel) {
          if (ERP.app && ERP.app.toast) ERP.app.toast('蓝牙打印模块未加载', 'err');
          return;
        }
        if (!ERP.btLabel.isSupported()) {
          var help = ERP.btLabel.getHelpInfo();
          if (ERP.app && ERP.app.toast) {
            ERP.app.toast(help.title + '：' + (help.platform === 'ios' ? 'iPhone请用Bluefy浏览器' : '请用Chrome/Edge浏览器打开') + '，已复制链接', 'err');
          }
          if (ERP.btLabel.copyLink) ERP.btLabel.copyLink().catch(function () {});
          return;
        }
        if (!ERP.btLabel.getState().connected) {
          if (ERP.app && ERP.app.toast) ERP.app.toast('请先在「我的 → 设置」中连接蓝牙打印机', 'err');
          return;
        }
        var labelCfg = (ctx.settings && ctx.settings.label) || {};
        var printCfg = (ctx.settings && ctx.settings.print) || {};
        ERP.btLabel.printProductLabel(p, {
          widthMm: labelCfg.widthMm || 40,
          heightMm: labelCfg.heightMm || 30,
          dpi: labelCfg.dpi || 203,
          density: printCfg.density || 8,
          copies: 1
        }, { showPrice: 'retail' })
          .then(function () {
            if (ERP.app && ERP.app.toast) ERP.app.toast('已发送打印：' + product.displayName(p), 'ok');
          })
          .catch(function (err) {
            if (ERP.app && ERP.app.toast) ERP.app.toast('打印失败：' + (err.message || err), 'err');
          });
      },

      filter: function (ctx, state, el) {
        var key = el.getAttribute('data-name');
        state[key] = el.value;
        state.page = 1;
      },

      keyword: function (ctx, state, el) {
        state.keyword = el.value;
        state.page = 1;
      },

      page: function (ctx, state, el) {
        state.page = parseInt(el.getAttribute('data-page'), 10) || 1;
      },

      'open-csv': function (ctx, state) {
        state.tab = 'csv';
        state.csvResult = null;
      },

      'csv-text': function (ctx, state, el) {
        state.csvText = el.value;
      },

      'do-import': function (ctx, state) {
        var parsed = util.parseCSV(state.csvText);
        var res = product.importFromRows(parsed.rows, ctx);
        state.csvResult = res;
        repo.log(ctx, 'CSV 导入', '新增 ' + res.created + ' 款 / 更新 ' + res.updated + ' 款');
        if (res.errors.length === 0) state.csvText = '';
      },

      /** 选择文件直接导入：CSV 读取文本，Excel(xlsx/xls) 解析首个工作表并转为 CSV 填入粘贴框 */
      'pick-import-file': function (ctx, state, el) {
        if (typeof window === 'undefined' || !window.FileReader) return false;
        var file = el && el.files && el.files[0];
        if (!file) return false;
        var name = String(file.name || '').toLowerCase();
        var isCsv = name.slice(-4) === '.csv' || String(file.type || '').indexOf('csv') >= 0;
        var reader = new FileReader();
        var finish = function (text) {
          state.csvText = text;
          if (window.ERP && ERP.app && ERP.app.render) ERP.app.render();
          ui.toast('已读取「' + file.name + '」，请确认后点「开始导入」', 'ok');
        };
        reader.onload = function () {
          try {
            if (isCsv) {
              finish(String(reader.result || ''));
            } else {
              finish(excel.rowsToCsv(excel.parse(reader.result)));
            }
          } catch (e) {
            ui.toast('解析文件失败：' + (e && e.message ? e.message : e), 'err');
          }
        };
        reader.onerror = function () {
          ui.toast('读取文件失败，请重试', 'err');
        };
        if (isCsv) reader.readAsText(file);
        else reader.readAsArrayBuffer(file);
        return false;
      },

      'download-template': function (ctx, state, el) {
        if (!ERP.app || !ERP.app.download) return;
        // V3.5：模板只体现成本，批发价/零售价留空 → 导入后按整体利润率自动生成（取整到元）
        var csv = util.toCSV(
          ['品牌', '型号', '类型', '单位', '成本', '备注', '原厂条码', '期初库存'],
          [
            ['海尔', 'BCD-200', '冰箱', '台', '1000', '风冷', '6901234567892', ''],
            ['格力', 'KFR-35', '空调', '台', '1800', '', '6923456789012', '5']
          ]
        );
        ERP.app.download('商品导入模板.csv', csv, 'text/csv');
      },

      'scan-input': function (ctx, state, payload) {
        var code = String((payload && payload.value) || '').trim();
        if (!code) return;
        state.keyword = code;
        state.page = 1;
      },

      /** 扫码：三级降级（实时摄像头 / 拍照 / 手输），识别后自动搜索商品 */
      'scan': function (ctx, state) {
        if (!ERP.scan || !ERP.scan.start) {
          ui.toast('当前环境不支持扫码，可手动输入条码', 'err');
          return;
        }
        ERP.scan.start({
          onResult: function (code) {
            state.keyword = code;
            state.page = 1;
            if (ERP.app) ERP.app.render();
            ui.toast('已识别：' + code, 'ok');
          },
          onError: function (msg) {
            ui.toast(msg || '扫码不可用', 'err');
          }
        });
      }
    }
  };

  /* ---------------- 保存 ---------------- */

  /** 账号内商品已用过的类型（去重，用于类型下拉建议） */
  function usedCategories(ctx) {
    var set = {};
    (ctx.data.products || []).forEach(function (p) {
      if (p && p.category) set[p.category] = 1;
    });
    return Object.keys(set);
  }

  function save(ctx, state) {
    var form = state.form;
    var input = {
      id: state.editing || null,
      brand: form.brand,
      model: form.model,
      category: form.category,
      unit: form.unit,
      cost: form.cost,
      priceWholesale: form.priceWholesale,
      priceRetail: form.priceRetail,
      note: form.note,
      barcodes: form.barcodes,
      openingStock: state.editing ? undefined : form.openingStock
    };
    var res = product.save(ctx, input);
    if (!res.ok) {
      ui.toast(res.error || '保存失败', 'err');
      return false;
    }
    repo.log(ctx, state.editing ? '修改商品' : '新建商品', product.displayName(res.product));
    var msg = product.displayName(res.product) + ' 已保存';
    if (res.openingWarning) msg += '（期初库存写入失败：' + res.openingWarning + '）';
    if (res.autoPriced) msg += '（已按系统利润率自动生成批发/零售价，取整到元）';
    ui.toast(msg, 'ok');
    state.tab = 'list';
    state.editing = null;
    state.form = emptyForm();
    // 若保存时类型自动并入经营范围，则持久化设置（保证刷新后依旧显示与建议）
    if (ERP.app && ERP.app.saveSettings) {
      ERP.app.saveSettings().catch(function () {});
    }
    return true;
  }

  /* ---------------- 列表 ---------------- */

  function renderList(ctx, state) {
    // 显示本账号全部商品（用户已创建的商品必须可见；自定义类型也一并显示）
    var list = (ctx.data.products || []).slice();
    var kw = String(state.keyword || '').trim().toUpperCase();
    if (kw) {
      list = list.filter(function (p) {
        var bc = (Array.isArray(p.barcodes) ? p.barcodes : []).some(function (b) {
          return String(b || '').toUpperCase().indexOf(kw) >= 0;
        });
        return String(p.brand || '').toUpperCase().indexOf(kw) >= 0 ||
          String(p.model || '').toUpperCase().indexOf(kw) >= 0 ||
          String(p.category || '').toUpperCase().indexOf(kw) >= 0 ||
          String(p.note || '').toUpperCase().indexOf(kw) >= 0 ||
          bc;
      });
    }
    if (state.filterStatus !== 'all') {
      list = list.filter(function (p) {
        return (p.status || schema.STATUS.ON) === state.filterStatus;
      });
    }
    list = util.sortBy(list, function (p) {
      return String(p.brand || '') + String(p.model || '');
    });

    var pg = util.paginate(list, state.page, 200);
    state.page = pg.page;

    var h = '';
    h += '<div class="page-head"><h2>商品档案</h2>' +
      '<span class="desc">共 ' + ctx.data.products.length + ' 款商品</span>' +
      '<div class="actions">' +
      '<button class="btn" data-act="open-csv">📥 批量导入</button>' +
      '<button class="btn btn-primary" data-act="open-new">＋ 新建商品</button>' +
      '</div></div>';

    h += '<div class="card">' + ui.searchBar({
      value: state.keyword, placeholder: '搜索 品牌 / 型号 / 类型 / 条码',
      filters: ui.select({
        name: 'filterStatus',
        value: state.filterStatus,
        on: 'filter',
        options: [
          { value: 'all', text: '全部状态' },
          { value: 'on', text: '在售' },
          { value: 'off', text: '停售' }
        ]
      })
    }) + '</div>';

    if (!pg.items.length) {
      h += '<div class="card">' + ui.empty('没有匹配的商品，点右上角「新建商品」添加') + '</div>';
      return h;
    }

    h += '<div class="card"><div class="table-wrap"><table class="tbl tbl-striped"><thead><tr>' +
      '<th>品牌</th><th>型号</th><th>类型</th><th>单位</th>' +
      '<th class="num">成本</th><th class="num">批发价</th><th class="num">零售价</th>' +
      '<th class="num">库存</th><th>备注</th><th>状态</th><th>操作</th>' +
      '</tr></thead><tbody>';
    pg.items.forEach(function (p) {
      var stock = p.stock || 0;
      var threshold = ctx.settings.defaultThreshold == null ? 3 : ctx.settings.defaultThreshold;
      var stockCls = stock <= 0 ? ' num zero' : (stock < threshold ? ' num low' : ' num');
      h += '<tr>' +
        '<td>' + esc(p.brand) + '</td>' +
        '<td>' + esc(p.model) + '</td>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td>' + esc(p.unit) + '</td>' +
        '<td class="num">' + ui.money(p.cost) + '</td>' +
        '<td class="num">' + ui.money(p.priceWholesale) + '</td>' +
        '<td class="num">' + ui.money(p.priceRetail) + '</td>' +
        '<td class="' + stockCls + '">' + stock + '</td>' +
        '<td class="small weak cell-note" title="' + esc(p.note || '') + '">' + esc(p.note || '-') + '</td>' +
        '<td>' + ui.badge(p.status === schema.STATUS.OFF ? '停售' : '在售', p.status === schema.STATUS.OFF ? 'off' : 'on') + '</td>' +
        '<td class="act">' +
        '<button data-act="edit-product" data-id="' + esc(p.id) + '">编辑</button>' +
        '<button data-act="print-label" data-id="' + esc(p.id) + '" title="蓝牙打印标签">🏷️标签</button>' +
        '<button data-act="toggle-status" data-id="' + esc(p.id) + '">' +
        (p.status === schema.STATUS.OFF ? '上架' : '停售') + '</button>' +
        '</td></tr>';
    });
    h += '</tbody></table></div>' + ui.pager(pg.page, pg.pages, pg.total) + '</div>';
    return h;
  }

  /* ---------------- 建档表单 ---------------- */

  /* ---------------- 新建 / 编辑表单（V3.5：只填成本，批发/零售自动填充） ---------------- */

  function renderForm(ctx, state) {
    var form = state.form;
    var editing = !!state.editing;

    var h = '<div class="page-head"><h2>' + (editing ? '编辑商品' : '新建商品') + '</h2>' +
      '<span class="desc">品牌 + 型号 唯一；库存由进货/销售/盘点单据自动变动</span></div>';

    h += '<div class="card">';
    h += '<div class="grid grid-2">' +
      '<div class="field"><label class="req">品牌</label>' +
      '<input class="input" data-input="field" data-name="brand" data-live="1" placeholder="如：海尔" value="' + esc(form.brand) + '"></div>' +
      '<div class="field"><label class="req">型号</label>' +
      '<input class="input" data-input="field" data-name="model" data-live="1" placeholder="如：BCD-200" value="' + esc(form.model) + '"></div>' +
      '</div>';
    h += '<div class="grid grid-2">' +
      '<div class="field"><label class="req">类型</label>' +
      '<input class="input" data-input="field" data-name="category" list="category-datalist" placeholder="选择或输入类型（如：冰箱 / 净水器）" value="' + esc(form.category) + '">' +
      '<datalist id="category-datalist">' +
      schema.categoriesFor(ctx.settings).concat(usedCategories(ctx)).map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('') +
      '</datalist>' +
      '<div class="small muted mt4">可从预设选择，也可直接输入自定义类型</div></div>' +
      '<div class="field"><label>单位</label>' +
      '<input class="input" data-input="field" data-name="unit" placeholder="如：台" value="' + esc(form.unit) + '"></div>' +
      '</div>';
    h += '<div class="grid grid-3">' +
      '<div class="field"><label>成本（元）</label>' +
      '<input class="input" data-input="cost-field" data-name="cost" inputmode="decimal" placeholder="如 1000" value="' + esc(form.cost) + '">' +
      '<div class="small muted mt4">只填成本，批发/零售按整体利润率自动生成</div></div>' +
      '<div class="field"><label>批发价（元）<span class="muted">（自动）</span></label>' +
      '<input class="input" data-input="field" data-name="priceWholesale" inputmode="decimal" placeholder="留空按利润率自动" value="' + esc(form.priceWholesale) + '"></div>' +
      '<div class="field"><label>零售价（元）<span class="muted">（自动）</span></label>' +
      '<input class="input" data-input="field" data-name="priceRetail" inputmode="decimal" placeholder="留空按利润率自动" value="' + esc(form.priceRetail) + '"></div>' +
      '</div>';
    h += '<div class="field"><label>备注</label>' +
      '<input class="input" data-input="field" data-name="note" placeholder="选填，如：一级能效" value="' + esc(form.note) + '"></div>';
    h += '<div class="field"><label>原厂条码 / 二维码内容（选填，可多条）</label>' +
      '<textarea class="input" data-input="field" data-name="barcodes" style="min-height:56px" placeholder="粘贴机身条码或二维码内容，多条用逗号或换行分隔">' +
      esc(form.barcodes) + '</textarea>' +
      '<div class="small muted mt4">录入后可用「扫码」快速定位该商品，也可在开单时扫码加行。</div></div>';
    if (!editing) {
      h += '<div class="field"><label>期初库存（选填，仅新建时生效）</label>' +
        '<input class="input" data-input="field" data-name="openingStock" inputmode="numeric" placeholder="如 10" value="' + esc(form.openingStock) + '"></div>';
    }
    h += '</div>';

    h += '<div class="row">' +
      '<button class="btn" data-act="cancel-form">取消</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-primary" data-act="save-product">保存</button>' +
      '</div>';
    return h;
  }

  /* ---------------- CSV 导入 ---------------- */

  function renderCsv(ctx, state) {
    var h = '<div class="page-head"><h2>批量导入商品</h2>' +
      '<span class="desc">必填：品牌、型号、类型；成本可选——<b>批发价/零售价无需填写，导入后按整体利润率自动生成（取整到元）</b>；还支持：单位、备注、原厂条码、期初库存</span></div>';
    h += '<div class="card">' +
      '<div class="field"><label>① 直接选择文件导入（支持 CSV / Excel .xlsx .xls）</label>' +
      '<input class="input" type="file" accept=".csv,.xlsx,.xls,text/csv" data-change="pick-import-file">' +
      '<div class="small muted mt4">选择本地 CSV 或 Excel 文件，内容将自动填入下方粘贴框，可修改后点「开始导入」。</div></div>' +
      '<div class="field"><label>② 或粘贴 CSV 内容（Excel 另存为 CSV 后全选复制）</label>' +
      '<textarea class="input" data-input="csv-text" style="min-height:160px" placeholder="品牌,型号,类型,单位,成本">' +
      esc(state.csvText) + '</textarea>' +
      '<div class="small muted mt4">示例：海尔,BCD-200,冰箱,台,1000（批发/零售留空，导入后自动按利润率生成）</div></div>' +
      '<div class="row">' +
      '<button class="btn" data-act="download-template">下载模板</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn" data-act="cancel-form">返回</button>' +
      '<button class="btn btn-primary" data-act="do-import">开始导入</button>' +
      '</div></div>';

    if (state.csvResult) {
      var r = state.csvResult;
      h += '<div class="card"><div class="card-title">导入结果</div>' +
        '<p class="mb8">新增 ' + r.created + ' 款，更新 ' + r.updated + ' 款。</p>';
      if (r.errors.length) {
        h += '<div class="notice notice-warn">有 ' + r.errors.length + ' 行未导入：</div>';
        h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>行号</th><th>原因</th></tr></thead><tbody>';
        r.errors.forEach(function (e) {
          h += '<tr><td>' + e.row + '</td><td>' + esc(e.msg) + '</td></tr>';
        });
        h += '</tbody></table></div>';
      } else {
        h += '<div class="notice notice-info">全部导入成功</div>';
      }
      h += '</div>';
    }
    return h;
  }

  return page;
});
