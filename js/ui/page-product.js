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
        sel: {}, // V3.37：勾选删除的商品 id 集合
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

      /* ---- V3.37：多选删除未使用商品档案 ---- */
      /* V3.43：勾选/全选改为局部刷新选择区（refreshSelUI，见模块级函数），不再整页重渲染 */

      /** 表头全选/取消全选（当前页全部商品，与列表渲染同一分页管道） */
      'toggle-all-check': function (ctx, state, el) {
        var pg = computePage(ctx, state); // 与渲染完全一致：过滤 → 排序 → 分页
        var curIds = pg.items.map(function (p) { return String(p.id); });
        var allOn = curIds.every(function (id) { return state.sel[id]; });
        state.sel = state.sel || {};
        var next = !allOn;
        curIds.forEach(function (id) {
          if (next) state.sel[id] = true;
          else delete state.sel[id];
        });
        // V3.43：局部更新当前页行勾选 + 按钮，不整页重渲染 → 滚动位置保持
        if (typeof document !== 'undefined' && document.querySelectorAll) {
          document.querySelectorAll('tbody input.row-check[data-act="row-check"]').forEach(function (cb) {
            var rid = cb.getAttribute('data-id');
            cb.checked = !!(state.sel[rid]);
          });
        }
        refreshSelUI(ctx, state);
      },

      /** 单行勾选/取消 */
      'row-check': function (ctx, state, el) {
        var id = String(el.getAttribute('data-id') || '');
        if (!id) return;
        state.sel = state.sel || {};
        if (state.sel[id]) delete state.sel[id];
        else state.sel[id] = true;
        // V3.43：局部刷新选择区，不整页重渲染 → 长列表多选不再跳回顶部
        refreshSelUI(ctx, state);
      },

      /** 删除选中（仅删未使用的商品档案；被单据/库存引用自动跳过） */
      'del-selected': function (ctx, state) {
        var ids = Object.keys(state.sel || {}).filter(function (k) { return state.sel[k]; });
        if (!ids.length) return false;
        var doDelete = function () {
          var res = product.removeUnused(ctx, ids);
          if (res.deleted.length) {
            repo.log(ctx, '批量删除商品', '删除 ' + res.deleted.length + ' 款' +
              (res.blocked.length ? '，跳过被引用 ' + res.blocked.length + ' 款' : ''));
            ui.toast('已删除 ' + res.deleted.length + ' 款商品' +
              (res.blocked.length ? '；' + res.blocked.length + ' 款被单据/库存引用，已跳过' : ''), res.blocked.length ? 'warn' : 'ok');
          } else if (res.blocked.length) {
            ui.toast('所选 ' + res.blocked.length + ' 款商品均被单据/库存引用，不可删除', 'err');
          } else {
            ui.toast('没有可删除的商品（可能已被删除）', 'warn');
          }
          state.sel = {};
          if (ERP.app) {
            if (ERP.app.commit) ERP.app.commit().then(function () { ERP.app.render(); }).catch(function () { ERP.app.render(); });
            else if (ERP.app.render) ERP.app.render();
          }
        };
        if (ui.confirm) {
          ui.confirm('删除选中商品',
            '将删除选中的 <b>' + ids.length + '</b> 个商品档案。<br>' +
            '仅删除<b>未被任何单据/库存流水引用</b>的商品；被进货单/销售单/盘点/库存引用过的会自动跳过，不受影响。<br>' +
            '删除不可恢复，确定继续？', '确认删除').then(function (yes) {
            if (yes) doDelete();
          });
          return false;
        }
        doDelete();
      },

      /** V3.42：同型号商品信息合并（仅网页版；手机端按钮 desktop-only 隐藏） */
      'merge-selected': function (ctx, state) {
        var ids = Object.keys(state.sel || {}).filter(function (k) { return state.sel[k]; });
        if (ids.length < 2) {
          ui.toast('请至少勾选 2 个同型号商品再合并', 'warn');
          return false;
        }
        // 预校验：型号一致（忽略首尾空格与大小写）
        var modelKeys = ids.map(function (id) {
          var p = product.getById(ctx, id);
          return p ? String(p.model || '').trim().toUpperCase() : '';
        });
        for (var i = 1; i < modelKeys.length; i++) {
          if (modelKeys[i] !== modelKeys[0]) {
            ui.toast('所选商品型号不一致，无法合并（仅支持同型号合并）', 'err');
            return false;
          }
        }
        // 主档案 = 库存最大者（与核心层一致）
        var keepP = null;
        ids.forEach(function (id) {
          var p = product.getById(ctx, id);
          if (!p) return;
          if (!keepP || (p.stock || 0) > (keepP.stock || 0)) keepP = p;
        });
        if (!keepP) return false;
        var stockTotal = ids.reduce(function (sum, id) {
          var p = product.getById(ctx, id);
          return sum + (p ? (p.stock || 0) : 0);
        }, 0);
        var doMerge = function () {
          var res = product.mergeByModel(ctx, ids);
          if (!res.ok) {
            ui.toast(res.error || '合并失败', 'err');
            state.sel = {};
            if (ERP.app) {
              if (ERP.app.commit) ERP.app.commit().then(function () { ERP.app.render(); }).catch(function () { ERP.app.render(); });
              else if (ERP.app.render) ERP.app.render();
            }
            return;
          }
          repo.log(ctx, '合并商品档案',
            product.displayName(res.keep) + ' 并入 ' + res.merged.length + ' 款同型号，库存合计 ' + res.stockTotal);
          ui.toast('已合并 ' + (res.merged.length + 1) + ' 款 → 保留「' + product.displayName(res.keep) + '」，库存合计 ' + res.stockTotal, 'ok');
          state.sel = {};
          if (ERP.app) {
            if (ERP.app.commit) ERP.app.commit().then(function () { ERP.app.render(); }).catch(function () { ERP.app.render(); });
            else if (ERP.app.render) ERP.app.render();
          }
        };
        if (ui.confirm) {
          ui.confirm('合并同型号商品',
            '将合并勾选的 <b>' + ids.length + '</b> 款<b>同型号</b>商品：<br>' +
            '· 保留档案：<b>' + esc(product.displayName(keepP)) + '</b>（库存最大者）<br>' +
            '· 库存相加（合计 <b>' + stockTotal + '</b>）、备注拼接、条码合并<br>' +
            '· 品牌/成本/价格/类型/单位/状态保留主档案<br>' +
            '· 其余 ' + (ids.length - 1) + ' 款档案将<b>删除</b>，历史单据不受影响<br>' +
            '合并不可恢复，确定继续？', '确认合并').then(function (yes) {
            if (yes) doMerge();
          });
          return false;
        }
        doMerge();
      },

      filter: function (ctx, state, el) {
        var key = el.getAttribute('data-name');
        state[key] = el.value;
        state.page = 1;
        state.sel = {}; // V3.40：筛选变化后清空勾选，删除计数与可见勾选保持一致
      },

      keyword: function (ctx, state, el) {
        state.keyword = el.value;
        state.page = 1;
        state.sel = {}; // V3.40：搜索词变化后清空勾选
      },

      page: function (ctx, state, el) {
        state.page = parseInt(el.getAttribute('data-page'), 10) || 1;
        state.sel = {}; // V3.40：翻页后清空勾选，避免跨页计数错乱
      },

      'open-csv': function (ctx, state) {
        state.tab = 'csv';
        state.csvResult = null;
      },

      'csv-text': function (ctx, state, el) {
        state.csvText = el.value;
      },

      /** V3.25：预演体检——只计算不写库，生成体检报告供用户核对后再执行 */
      'do-preview': function (ctx, state) {
        var parsed = util.parseCSV(state.csvText);
        state.csvPlan = product.previewImport(parsed.rows, ctx);
        state.csvResult = null;
      },

      'cancel-preview': function (ctx, state) {
        state.csvPlan = null;
      },

      'do-import': function (ctx, state) {
        var parsed = util.parseCSV(state.csvText);
        var res = product.importFromRows(parsed.rows, ctx);
        state.csvPlan = null;
        state.csvResult = res;
        repo.log(ctx, 'CSV 导入', '读取 ' + res.total + ' 行：新增 ' + res.created + ' 款 / 更新 ' + res.updated + ' 款' +
          (res.deduplicated ? ' / 去重 ' + res.deduplicated + ' 行' : '') +
          (res.merged ? ' / 合并停售 ' + res.merged + ' 个' : '') +
          (res.transferred ? ' / 转入库存 ' + res.transferred + ' 件' : '') +
          (res.skipped ? ' / 跳过空行 ' + res.skipped + ' 行' : '') +
          (res.uncovered && res.uncovered.length ? ' / 未覆盖 ' + res.uncovered.length + ' 个' : '') +
          (res.errors.length ? ' / 未导入 ' + res.errors.length + ' 行' : ''));
        if (res.errors.length === 0) state.csvText = '';
      },

      /**
       * 导入后处理：将「未覆盖清单」中的旧商品（型号标错/已淘汰）批量停售。
       * 仅置停售，不删除商品、不动库存、不碰单据，可随时恢复。
       */
      'retire-uncovered': function (ctx, state) {
        var list = (state.csvResult && state.csvResult.uncovered) || [];
        if (!list.length) return;
        var res = product.retireProducts(ctx, list.map(function (u) { return u.id; }));
        state.csvResult.retired = (state.csvResult.retired || 0) + res.retired;
        state.csvResult.uncovered = [];
        repo.log(ctx, '导入后停售', '未覆盖清单停售 ' + res.retired + ' 个' +
          (res.withStock ? '（其中 ' + res.withStock + ' 个有库存）' : '') +
          (res.missing ? '，' + res.missing + ' 个商品不存在' : ''));
        ui.toast('已将 ' + res.retired + ' 个商品置为停售（未删除，可恢复）' +
          (res.withStock ? '，其中 ' + res.withStock + ' 个有库存' : ''), 'ok');
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
            // V3.22：读取全部工作表并合并（后续表的重复表头自动剥离）
            var sheets = excel.parseAll(reader.result);
            var merged = product.mergeSheetRows(sheets);
            finish(excel.rowsToCsv(merged));
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
        state.sel = {}; // V3.40：扫码搜索同样清空勾选
      },

      /** 新建/编辑商品：扫码填写原厂条码/二维码（去重追加，多条换行分隔） */
      'scan-barcode': function (ctx, state) {
        if (!ERP.scan || !ERP.scan.start) {
          ui.toast('当前环境不支持扫码，可手动输入条码', 'err');
          return;
        }
        ERP.scan.start({
          onResult: function (code) {
            var list = String(state.form.barcodes || '').split(/[,，\n\r]+/).map(function (s) {
              return s.trim();
            }).filter(Boolean);
            if (list.indexOf(code) < 0) list.push(code);
            state.form.barcodes = list.join('\n');
            ui.toast('已填入条码：' + code, 'ok');
            if (ERP.app) ERP.app.render();
          },
          onError: function (msg) {
            ui.toast(msg || '扫码不可用', 'err');
          }
        });
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
            state.sel = {}; // V3.40：扫码搜索同样清空勾选
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

  /**
   * V3.43：局部刷新选择区（删除/合并按钮计数与禁用、表头全选状态），
   * 不整页重渲染 → 长列表多选时滚动位置不再跳回顶部。
   */
  function refreshSelUI(ctx, state) {
    if (typeof document === 'undefined' || !document.querySelector) return;
    var selCount = 0;
    Object.keys(state.sel || {}).forEach(function (k) { if (state.sel[k]) selCount++; });
    var del = document.querySelector('[data-act="del-selected"]');
    if (del) {
      del.textContent = '🗑 删除选中' + (selCount ? '（' + selCount + '）' : '');
      del.disabled = !selCount;
    }
    var mg = document.querySelector('[data-act="merge-selected"]');
    if (mg) {
      mg.textContent = '🔀 合并选中' + (selCount >= 2 ? '（' + selCount + '）' : '');
      mg.disabled = selCount < 2;
    }
    var all = document.querySelector('[data-act="toggle-all-check"]');
    if (all) {
      var curIds = computePage(ctx, state).items.map(function (p) { return String(p.id); });
      all.checked = curIds.length > 0 && curIds.every(function (id) { return state.sel[id]; });
    }
  }

  /**
   * V3.41：列表统一分页管道（过滤 → 品牌+型号排序 → 分页）。
   * 渲染与全选必须走同一管道，否则排序前后第 N 页的 id 集合不一致，
   * 会出现「删除选中（200）但行未勾选」（大库存 6198 款场景实测）。
   */
  function computePage(ctx, state) {
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
    return pg;
  }

  function renderList(ctx, state) {
    var pg = computePage(ctx, state);

    var h = '';
    var selCount = Object.keys(state.sel || {}).filter(function (k) { return state.sel[k]; }).length;
    h += '<div class="page-head"><h2>商品档案</h2>' +
      '<span class="desc">共 ' + ctx.data.products.length + ' 款商品</span>' +
      '<div class="actions">' +
      '<button class="btn" data-act="open-csv">📥 批量导入</button>' +
      '<button class="btn btn-danger desktop-only" data-act="del-selected"' + (selCount ? '' : ' disabled') + '>🗑 删除选中' + (selCount ? '（' + selCount + '）' : '') + '</button>' +
      '<button class="btn btn-orange desktop-only" data-act="merge-selected"' + (selCount >= 2 ? '' : ' disabled') + ' title="仅型号相同的商品可合并，保留库存最大者，库存/备注/条码合并">🔀 合并选中' + (selCount >= 2 ? '（' + selCount + '）' : '') + '</button>' +
      '<button class="btn btn-primary" data-act="open-new">＋ 新建商品</button>' +
      '</div></div>';

    h += '<div class="card">' + ui.searchBar({
      cls: 'search-bar-product',
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

    // V3.37：全选 = 当前页全部商品均已勾选
    var allChecked = pg.items.length > 0 && pg.items.every(function (p) {
      return !!(state.sel || {})[String(p.id)];
    });
    h += '<div class="card"><div class="table-wrap"><table class="tbl tbl-striped"><thead><tr>' +
      '<th class="sel desktop-only" style="width:34px"><input type="checkbox" class="row-check" data-act="toggle-all-check"' + (allChecked ? ' checked' : '') + ' title="全选本页"></th>' +
      '<th>品牌</th><th>型号</th><th>类型</th><th>单位</th>' +
      '<th class="num">成本</th><th class="num">批发价</th><th class="num">零售价</th>' +
      '<th class="num">库存</th><th>备注</th><th>状态</th><th>操作</th>' +
      '</tr></thead><tbody>';
    pg.items.forEach(function (p) {
      var checked = !!(state.sel || {})[String(p.id)];
      var stock = p.stock || 0;
      var threshold = ctx.settings.defaultThreshold == null ? 3 : ctx.settings.defaultThreshold;
      var stockCls = stock <= 0 ? ' num zero' : (stock < threshold ? ' num low' : ' num');
      h += '<tr' + (checked ? ' class="sel-on"' : '') + '>' +
        '<td class="sel desktop-only"><input type="checkbox" class="row-check" data-act="row-check" data-id="' + esc(p.id) + '"' + (checked ? ' checked' : '') + '></td>' +
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
    h += '<div class="field"><label>原厂条码 / 二维码内容（选填，可多条）' +
      '<button class="btn btn-sm" data-act="scan-barcode" title="扫码自动填写">📷 扫码</button></label>' +
      '<textarea class="input" data-input="field" data-name="barcodes" style="min-height:56px" placeholder="粘贴机身条码或二维码内容，多条用逗号或换行分隔">' +
      esc(form.barcodes) + '</textarea>' +
      '<div class="small muted mt4">可扫码自动填入；录入后可用「扫码」快速定位该商品，也可在开单时扫码加行。</div></div>';
    if (!editing) {
      h += '<div class="field"><label>期初库存（选填，仅新建时生效）</label>' +
        '<input class="input" data-input="field" data-name="openingStock" inputmode="numeric" placeholder="如 10" value="' + esc(form.openingStock) + '"></div>';
    }
    h += '</div>';

    h += '<div class="row">' +
      '<button class="btn btn-danger" data-act="cancel-form">取消</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-primary" data-act="save-product">保存</button>' +
      '</div>';
    return h;
  }

  /* ---------------- CSV 导入 ---------------- */

  function renderCsv(ctx, state) {
    var h = '<div class="page-head"><h2>批量导入商品</h2>' +
      '<span class="desc">必填：品牌、型号、类型；成本可选——<b>批发价/零售价无需填写，导入后按整体利润率自动生成（取整到元）</b>；还支持：单位、备注、原厂条码、期初库存。<b>导入规则（V3.25）：仅按「型号」匹配（忽略空格与大小写）；文件内同型号重复行去重、保留最后一行；系统已有该型号则以导入信息为准更新品牌/类型/单位/成本/备注（备注与条码留空时保留原值，不改动现有库存）；系统无该型号则新建；同一型号在系统中存在多个商品时合并保留——保留一个全量更新，其余仅置为停售并把库存转入保留商品（不删除任何商品与历史单据）。<b>V3.25 新增：导入前先点「预演体检」，可看到将新增/将更新（含新旧值对比）/将合并/覆盖不到的商品清单，确认无误再执行导入。</b></span></div>';
    h += '<div class="card">' +
      '<div class="field"><label>① 直接选择文件导入（支持 CSV / Excel .xlsx .xls）</label>' +
      '<input class="input" type="file" accept=".csv,.xlsx,.xls,text/csv" data-change="pick-import-file">' +
      '<div class="small muted mt4">选择本地 CSV 或 Excel 文件，内容将自动填入下方粘贴框，可修改后点「开始导入」。<b>Excel 会读取所有工作表的数据（各表首行表头自动识别）。</b></div></div>' +
      '<div class="field"><label>② 或粘贴 CSV 内容（Excel 另存为 CSV 后全选复制）</label>' +
      '<textarea class="input" data-input="csv-text" style="min-height:160px" placeholder="品牌,型号,类型,单位,成本">' +
      esc(state.csvText) + '</textarea>' +
      '<div class="small muted mt4">示例：海尔,BCD-200,冰箱,台,1000（批发/零售留空，导入后自动按利润率生成）</div></div>' +
      // V3.27：体检报告很长，原「取消 / 确认执行导入」在报告末尾需下滚才能点到。
      // 现在两个按钮与「预演体检（不写入）」同排、靠最右端，报告再长也能随手点。
      '<div class="row import-actions">' +
      '<button class="btn" data-act="download-template">下载模板</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn btn-danger" data-act="cancel-form">返回</button>' +
      '<button class="btn btn-primary" data-act="do-preview">预演体检（不写入）</button>' +
      (state.csvPlan
        ? '<button class="btn btn-danger" data-act="cancel-preview">取消</button>' +
          '<button class="btn btn-primary" data-act="do-import">确认执行导入</button>'
        : '') +
      '</div></div>';

    if (state.csvPlan) {
      var p = state.csvPlan;
      h += '<div class="card"><div class="card-title">导入前体检报告（尚未写入系统）</div>' +
        '<p class="mb8">共读取 <b>' + (p.total || 0) + '</b> 行数据：将新增 <b>' + p.creates.length + '</b> 款，将更新 <b>' + p.updates.length + '</b> 款' +
        (p.deduplicated ? '，文件内去重 ' + p.deduplicated + ' 行' : '') +
        (p.merges.length ? '，将合并停售 ' + p.merges.length + ' 个' : '') +
        (p.skipped ? '，跳过空行 ' + p.skipped + ' 行' : '') +
        (p.errors.length ? '，无法导入 ' + p.errors.length + ' 行' : '') + '。</p>';

      if (p.creates.length) {
        h += '<div class="small muted mt4">将新增（系统中无此型号）：</div>' +
          '<div class="table-wrap"><table class="tbl"><thead><tr><th>行号</th><th>品牌</th><th>型号</th><th>类型</th><th>成本</th><th>批发价</th><th>零售价</th></tr></thead><tbody>';
        p.creates.forEach(function (c) {
          h += '<tr><td>' + c.rowNo + '</td><td>' + esc(c.brand) + '</td><td>' + esc(c.model) + '</td><td>' + esc(c.category) + '</td><td>' +
            util.fenToYuan(c.cost) + '</td><td>' + util.fenToYuan(c.priceWholesale) + '</td><td>' + util.fenToYuan(c.priceRetail) + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }

      if (p.updates.length) {
        h += '<div class="small muted mt4">将更新（系统已有此型号，以导入信息为准）：</div>' +
          '<div class="table-wrap"><table class="tbl"><thead><tr><th>行号</th><th>型号</th><th>变更明细</th></tr></thead><tbody>';
        p.updates.forEach(function (u) {
          var detail = u.changes.length
            ? u.changes.map(function (c) {
              return esc(c.label) + '：' + (c.from ? esc(c.from) : '空') + ' → ' + (c.to ? esc(c.to) : '空');
            }).join('；')
            : '<span class="muted">无变化</span>';
          h += '<tr><td>' + u.rowNo + '</td><td>' + esc(u.model) + '</td><td>' + detail + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }

      if (p.merges.length) {
        var willTransfer = p.merges.reduce(function (t, m) { return t + (Number(m.stock) || 0); }, 0);
        h += '<div class="notice notice-info">以下 ' + p.merges.length + ' 个同型号商品将被合并（保留一个，其余置为「停售」，不删除、不丢历史）' +
          (willTransfer ? '，其名下共 <b>' + willTransfer + '</b> 件库存将转入保留商品并生成盘点调整单。' : '。') + '</div>' +
          '<div class="table-wrap"><table class="tbl"><thead><tr><th>品牌</th><th>型号</th><th>现有库存</th></tr></thead><tbody>';
        p.merges.forEach(function (m) {
          h += '<tr><td>' + esc(m.brand) + '</td><td>' + esc(m.model) + '</td><td>' + m.stock + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }

      if (p.uncovered.length) {
        h += '<div class="notice notice-warn">系统中还有 <b>' + p.uncovered.length + '</b> 个商品本次导入覆盖不到（型号对不上或已淘汰），导入后它们仍在售，请手动核对：</div>' +
          '<div class="table-wrap"><table class="tbl"><thead><tr><th>品牌</th><th>型号</th><th>类型</th><th>库存</th></tr></thead><tbody>';
        p.uncovered.forEach(function (u) {
          h += '<tr><td>' + esc(u.brand) + '</td><td>' + esc(u.model) + '</td><td>' + esc(u.category) + '</td><td>' + u.stock + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }

      if (p.errors.length) {
        h += '<div class="notice notice-warn">有 ' + p.errors.length + ' 行无法导入：</div>' +
          '<div class="table-wrap"><table class="tbl"><thead><tr><th>行号</th><th>原因</th></tr></thead><tbody>';
        p.errors.forEach(function (e) {
          h += '<tr><td>' + e.row + '</td><td>' + esc(e.msg) + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }

      // V3.27：按钮已上移到「预演体检（不写入）」同排最右端（见上方 import-actions），
      // 此处不再重复渲染，避免报告过长时需要下滚才能确认导入。
      h += '</div>';
    }

    if (state.csvResult) {
      var r = state.csvResult;
      h += '<div class="card"><div class="card-title">导入结果</div>' +
        '<p class="mb8">共读取 <b>' + (r.total || 0) + '</b> 行数据：新增 ' + r.created + ' 款，更新 ' + r.updated + ' 款' +
        (r.deduplicated ? '，文件内去重 ' + r.deduplicated + ' 行' : '') +
        (r.merged ? '，合并停售同型号 ' + r.merged + ' 个' : '') +
        (r.skipped ? '，跳过空行 ' + r.skipped + ' 行' : '') +
        (r.errors.length ? '，未导入 ' + r.errors.length + ' 行' : '') + '。</p>';
      if (r.merged) {
        h += '<div class="notice notice-info">有 ' + r.merged + ' 个同型号的重复商品已置为「停售」保留（未删除，历史单据与库存流水完整保留）' +
          (r.transferred ? '，其中 <b>' + r.transferred + '</b> 件库存已转入保留商品，并生成盘点调整单（可在库存变动中查看）。' : '。') + '</div>';
      }
      if (r.uncovered && r.uncovered.length) {
        var withStock = r.uncovered.filter(function (u) { return (Number(u.stock) || 0) > 0; }).length;
        h += '<div class="notice notice-warn">以下 <b>' + r.uncovered.length + '</b> 个商品本次导入未覆盖到（型号对不上或已淘汰），它们仍在售，请手动核对：</div>' +
          '<div class="table-wrap"><table class="tbl"><thead><tr><th>品牌</th><th>型号</th><th>类型</th><th>库存</th></tr></thead><tbody>';
        r.uncovered.forEach(function (u) {
          h += '<tr><td>' + esc(u.brand) + '</td><td>' + esc(u.model) + '</td><td>' + esc(u.category) + '</td><td>' + u.stock + '</td></tr>';
        });
        h += '</tbody></table></div>' +
          '<div class="mt8"><button class="btn" data-act="retire-uncovered">确认无误：以上 ' + r.uncovered.length + ' 个全部停售</button>' +
          '<div class="small muted mt4">仅置为停售，<b>不删除商品、不动库存、不碰任何单据</b>，可随时恢复。' +
          (withStock ? '其中 <b>' + withStock + '</b> 个仍有库存，停售后库存继续挂在这些商品名下，需你另行盘点处理。' : '') +
          '</div></div>';
      }
      if (r.retired) {
        h += '<div class="notice notice-info">已将 <b>' + r.retired + '</b> 个未覆盖商品置为停售（未删除，可在商品档案中恢复）。</div>';
      }
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
