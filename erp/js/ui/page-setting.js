/**
 * ui/page-setting.js —— 设置 / 备份恢复 / 打开密码 / 打印设置 / 操作日志（PRD 5.8 / 7）
 * 表单值在 state 中暂存（data-change="field"），保存类动作读取 state 写回 ctx.settings。
 * 文件导入在 mount 中走浏览器 FileReader；核心备份逻辑由 core/backup.js 承担（已单测）。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP || {};
  var util = isNode ? require('../core/util.js') : (ERP.util || null);
  var ui = isNode ? require('./components.js') : (ERP.ui || null);
  var schema = isNode ? require('../core/schema.js') : (ERP.schema || null);
  var backup = isNode ? require('../core/backup.js') : (ERP.backup || null);
  var repo = isNode ? require('../store/repo.js') : (ERP.repo || null);
  var product = isNode ? require('../core/product.js') : (ERP.product || null);
  var mod = factory(ERP, util, ui, schema, backup, repo, product);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.setting = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP, util, ui, schema, backup, repo, product) {
  'use strict';

  var C = ui;
  var esc = util.escapeHtml;

  function app() { return ERP.app; }

  var page = {
    name: 'setting',
    title: '设置',
    icon: '⚙️',
    hideInNav: true,

    init: function (ctx) {
      var s = (ctx && ctx.settings) || {};
      var lab = s.label || {};
      var prn = s.print || {};
      return {
        shopName: s.shopName || '',
        widthMm: lab.widthMm || 40,
        heightMm: lab.heightMm || 30,
        dpi: lab.dpi || 203,
        protocol: prn.protocol || 'tspl',
        density: prn.density || 8,
        pwd: '',
        pwd2: '',
        showLog: false,
        imported: null,
        priceForm: {
          wholesaleMargin: String(s.wholesaleMargin == null ? 20 : s.wholesaleMargin),
          retailMargin: String(s.retailMargin == null ? 35 : s.retailMargin)
        }
      };
    },

    render: function (ctx, state) {
      var s = ctx.settings;
      var val = function (k, v) {
        return 'value="' + esc(v == null ? '' : v) + '"';
      };

      /* ---- 店铺与打印设置 ---- */
      var general =
        '<div class="card mb8"><h3 class="card-title">店铺与打印</h3>' +
        '<div class="form-row"><label>店铺名称</label>' +
        '<input class="input" data-change="field" data-name="shopName" ' + val('shopName', state.shopName) + '></div>' +
        '<div class="grid grid-3">' +
        '<div class="form-row"><label>标签宽(mm)</label><input class="input" inputmode="decimal" data-change="field" data-name="widthMm" ' + val('widthMm', state.widthMm) + '></div>' +
        '<div class="form-row"><label>标签高(mm)</label><input class="input" inputmode="decimal" data-change="field" data-name="heightMm" ' + val('heightMm', state.heightMm) + '></div>' +
        '<div class="form-row"><label>打印DPI</label><input class="input" inputmode="numeric" data-change="field" data-name="dpi" ' + val('dpi', state.dpi) + '></div>' +
        '</div>' +
        '<div class="grid grid-3">' +
        '<div class="form-row"><label>打印机指令</label>' + C.select({
          name: 'protocol', value: state.protocol, on: 'field',
          options: [{ value: 'tspl', text: 'TSPL（标签机）' }, { value: 'escpos', text: 'ESC-POS（小票机）' }]
        }) + '</div>' +
        '<div class="form-row"><label>打印浓度</label><input class="input" inputmode="numeric" data-change="field" data-name="density" ' + val('density', state.density) + '></div>' +
        '<div class="form-row" style="justify-content:flex-end"><label>&nbsp;</label>' +
        '<button class="btn btn-primary" data-act="save-settings">保存设置</button></div>' +
        '</div>' +
        /* ---- 蓝牙标签打印机 ---- */
        '<div class="bt-print-section" style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;">' +
        '<div class="form-row"><label>蓝牙标签打印机</label>' +
        '<span id="bt-status" class="bt-status" style="font-size:13px;color:' + (ERP.btLabel && ERP.btLabel.getState().connected ? '#16a34a' : '#6b7280') + '">' +
        (ERP.btLabel && ERP.btLabel.getState().connected ? '已连接：' + (ERP.btLabel.getState().deviceName || '打印机') : '未连接') +
        '</span></div>' +
        '<div class="form-row"><label>&nbsp;</label>' +
        (ERP.btLabel && ERP.btLabel.getState().connected
          ? '<button class="btn" data-act="bt-disconnect">断开打印机</button>'
          : '<button class="btn btn-primary" data-act="bt-connect">连接蓝牙打印机</button>') +
        '<span class="muted small" style="margin-left:8px;">支持凝优P50等CPCL标签机</span>' +
        '</div>' +
        (ERP.btLabel && !ERP.btLabel.isSupported()
          ? '<div class="notice notice-warn mt8" style="font-size:12px;">当前浏览器不支持 Web Bluetooth，请使用 Chrome/Edge 并通过 HTTPS 或 localhost 访问</div>'
          : '') +
        '</div>' +
        '</div>';

      /* ---- 打开密码 ---- */
      var lock = s.lock || {};
      var lockHtml = lock.enabled
        ? '<div class="notice notice-info"><span>🔒 打开密码已启用</span>' +
          '<button class="btn btn-sm" data-act="disable-lock">关闭密码</button></div>'
        : '<div class="grid grid-2">' +
          '<div class="form-row"><label>设置密码</label><input class="input" type="password" inputmode="numeric" data-change="field" data-name="pwd" placeholder="6 位数字" value="' + esc(state.pwd || '') + '"></div>' +
          '<div class="form-row"><label>确认密码</label><input class="input" type="password" inputmode="numeric" data-change="field" data-name="pwd2" placeholder="再次输入" value="' + esc(state.pwd2 || '') + '"></div>' +
          '</div>' +
          '<button class="btn btn-primary" data-act="set-password">启用打开密码</button>';

      var security =
        '<div class="card mb8"><h3 class="card-title">打开密码</h3>' +
        '<p class="muted small mb8">启用后，每次打开软件需输入密码（本地校验，用于防误触，非加密级）。</p>' +
        lockHtml + '</div>';

      /* ---- 备份恢复 ---- */
      var backupCard =
        '<div class="card mb8"><h3 class="card-title">备份与恢复</h3>' +
        '<p class="muted small mb8">每天导出一份账本（电脑 + 网盘各存一份）。导入会用备份文件<strong>整体覆盖</strong>当前数据，导入前会二次确认。</p>' +
        '<div class="row">' +
        '<button class="btn btn-primary" data-act="export-backup">⬇️ 导出备份</button>' +
        '<button class="btn" id="btn-pick-backup" data-act="pick-backup">⬆️ 选择文件导入</button>' +
        '<input type="file" id="backup-file" accept="application/json,.json" data-change="import-backup" style="display:none">' +
        '</div>' +
        (state.imported ? '<div class="small mt8 ' + (state.imported.ok ? 'ok' : 'err') + '">' +
          (state.imported.ok ? '✓ 已恢复 ' + state.imported.summary.products + ' 个商品等数据' : '✗ ' + state.imported.error) + '</div>' : '') +
        '</div>';

      /* ---- 危险操作 ---- */
      var danger =
        '<div class="card mb8"><h3 class="card-title">数据管理</h3>' +
        '<button class="btn btn-danger" data-act="clear-data">清空全部数据</button>' +
        '<span class="muted small ml8">清空后不可恢复，请先导出备份。</span>' +
        '</div>';

      /* ---- 操作日志 ---- */
      var logs = ctx.data.logs || [];
      var logHtml = state.showLog
        ? '<ul class="log-list">' + (logs.length ? logs.slice().reverse().slice(0, 50).map(function (l) {
            return '<li><span class="muted">' + esc(l.at) + '</span> · ' + esc(l.action) + ' ' + esc(l.detail || '') + '</li>';
          }).join('') : '<li class="muted">暂无操作记录</li>') + '</ul>'
        : '';
      var logCard =
        '<div class="card"><h3 class="card-title">操作日志' +
        '<button class="btn btn-sm ' + (state.showLog ? 'btn-primary' : '') + '" data-act="toggle-log" style="float:right">' +
        (state.showLog ? '收起' : '查看') + '</button></h3>' + logHtml + '</div>';

      /* ---- 价格体系（V3.5：整体利润率 + 一键应用系统价格） ---- */
      var pf = state.priceForm || {};
      var pW = pf.wholesaleMargin !== '' ? pf.wholesaleMargin : (ctx.settings.wholesaleMargin == null ? 20 : ctx.settings.wholesaleMargin);
      var pR = pf.retailMargin !== '' ? pf.retailMargin : (ctx.settings.retailMargin == null ? 35 : ctx.settings.retailMargin);
      var priceCard =
        '<div class="card mb8"><h3 class="card-title">价格体系（整体利润率）</h3>' +
        '<p class="muted small mb8">新建/导入商品时，批发价、零售价留空将按 成本 ×（1+利润率）自动生成并取整到元；您仍可手动修改任意商品价格。已存利润率随云同步。</p>' +
        '<div class="grid grid-2">' +
        '<div class="form-row"><label>批发利润率（%）</label><input class="input" inputmode="decimal" data-change="price-field" data-name="wholesaleMargin" value="' + esc(String(pW)) + '"></div>' +
        '<div class="form-row"><label>零售利润率（%）</label><input class="input" inputmode="decimal" data-change="price-field" data-name="retailMargin" value="' + esc(String(pR)) + '"></div>' +
        '</div>' +
        '<div class="row mt8">' +
        '<button class="btn btn-primary" data-act="save-price-sys">保存利润率</button>' +
        '<button class="btn" data-act="apply-price-sys">一键更新全部商品价格</button>' +
        '</div>' +
        '<div class="small muted mt8">「一键更新」会按最新利润率把全部商品的批发价、零售价统一重算（取整到元），已有自定义价格也会被覆盖。</div>' +
        '</div>';

      return general + priceCard + security + backupCard + danger + logCard;
    },

    actions: {
      field: function (ctx, state, el) {
        var name = el.getAttribute('data-name');
        if (name) state[name] = el.value;
      },

      /* ---- 价格体系（V3.5） ---- */
      'price-field': function (ctx, state, el) {
        var name = el.getAttribute('data-name');
        if (name && state.priceForm) state.priceForm[name] = el.value;
      },

      'save-price-sys': function (ctx, state) {
        var pf = state.priceForm || {};
        var w = Number(pf.wholesaleMargin);
        var r = Number(pf.retailMargin);
        if (isNaN(w) || w < 0 || isNaN(r) || r < 0) {
          if (app() && app().toast) app().toast('利润率需为不小于 0 的数字', 'err');
          return false;
        }
        ctx.settings.wholesaleMargin = w;
        ctx.settings.retailMargin = r;
        if (app() && app().saveSettings) app().saveSettings();
        repo.log(ctx, '设置价格体系', '批发利润率 ' + w + '% / 零售利润率 ' + r + '%');
        if (app() && app().toast) app().toast('已保存整体利润率（批发 ' + w + '% / 零售 ' + r + '%）', 'ok');
        return true;
      },

      'apply-price-sys': function (ctx, state) {
        var list = ctx.data.products || [];
        if (!list.length) {
          if (app() && app().toast) app().toast('还没有商品，先新建商品再应用系统价格', 'ok');
          return true;
        }
        var n = 0;
        list.forEach(function (p) {
          var auto = product.autoPrices(ctx, p.cost);
          if (p.priceWholesale !== auto.priceWholesale || p.priceRetail !== auto.priceRetail) {
            p.priceWholesale = auto.priceWholesale;
            p.priceRetail = auto.priceRetail;
            ctx.touch('products', p);
            n++;
          }
        });
        if (n) {
          repo.log(ctx, '一键应用系统价格', n + ' 款商品按利润率重新定价（取整到元）');
          if (app() && app().render) app().render();
          if (app() && app().toast) app().toast('已按系统价格更新 ' + n + ' 款商品（批发/零售统一取整到元）', 'ok');
        } else {
          if (app() && app().toast) app().toast('所有商品价格已符合系统价格，无需更新', 'ok');
        }
        return true;
      },

      'save-settings': function (ctx, state) {
        ctx.settings.shopName = util.cleanText(state.shopName) || '我的电器店';
        ctx.settings.label = Object.assign({}, ctx.settings.label, {
          widthMm: util.parseMoney(state.widthMm) / 100 || ctx.settings.label.widthMm,
          heightMm: util.parseMoney(state.heightMm) / 100 || ctx.settings.label.heightMm,
          dpi: parseInt(state.dpi, 10) || ctx.settings.label.dpi
        });
        ctx.settings.print = Object.assign({}, ctx.settings.print, {
          protocol: state.protocol || ctx.settings.print.protocol,
          density: parseInt(state.density, 10) || ctx.settings.print.density
        });
        if (app() && app().saveSettings) app().saveSettings();
        if (app() && app().toast) app().toast('设置已保存', 'ok');
        return true;
      },

      /** 连接蓝牙标签打印机 */
      'bt-connect': function (ctx, state) {
        if (!ERP.btLabel || !ERP.btLabel.isSupported()) {
          if (app() && app().toast) app().toast('当前浏览器不支持蓝牙，请使用 Chrome/Edge', 'err');
          return;
        }
        if (app() && app().toast) app().toast('正在扫描蓝牙设备...', 'info');
        ERP.btLabel.connect()
          .then(function (s) {
            if (app() && app().toast) app().toast('已连接：' + (s.deviceName || '打印机'), 'ok');
            if (app() && app().render) app().render();
          })
          .catch(function (err) {
            if (app() && app().toast) app().toast('连接失败：' + (err.message || err), 'err');
          });
      },

      /** 断开蓝牙打印机 */
      'bt-disconnect': function (ctx, state) {
        if (ERP.btLabel) ERP.btLabel.disconnect();
        if (app() && app().toast) app().toast('已断开打印机', 'ok');
        if (app() && app().render) app().render();
      },

      'set-password': function (ctx, state) {
        var pwd = String(state.pwd || '').trim();
        if (!/^\d{4,12}$/.test(pwd)) {
          if (app() && app().toast) app().toast('密码需为 4-12 位数字', 'err');
          return false;
        }
        if (pwd !== String(state.pwd2 || '').trim()) {
          if (app() && app().toast) app().toast('两次输入不一致', 'err');
          return false;
        }
        ctx.settings.lock = { enabled: true, hash: util.hashPassword(pwd) };
        if (app() && app().saveSettings) app().saveSettings();
        state.pwd = ''; state.pwd2 = '';
        if (app() && app().toast) app().toast('打开密码已启用', 'ok');
        return true;
      },

      'disable-lock': function (ctx, state) {
        ctx.settings.lock = { enabled: false, hash: null };
        if (app() && app().saveSettings) app().saveSettings();
        if (app() && app().toast) app().toast('已关闭打开密码', 'ok');
        return true;
      },

      'export-backup': function (ctx, state) {
        var b = backup.build(ctx);
        var json = JSON.stringify(b, null, 2);
        if (app() && app().download) {
          app().download(backup.fileName(ctx), json, 'application/json');
        }
        var now = util.nowISO();
        if (ctx.data) ctx.data.lastBackupAt = now;
        if (app() && app().setMeta) app().setMeta(schema.META_LAST_BACKUP_KEY, now);
        if (app() && app().toast) app().toast('备份已导出', 'ok');
        return true;
      },

      'pick-backup': function (ctx, state, el) {
        var input = document.getElementById('backup-file');
        if (input) input.click();
        return false;
      },

      'import-backup': function (ctx, state, el) {
        // 浏览器：el 为 file input，读取文件后恢复
        if (!el || !el.files || !el.files.length) return false;
        var file = el.files[0];
        var reader = new FileReader();
        reader.onload = function () {
          var text = reader.result;
          var r = backup.restore(ctx, text);
          if (r.ok) {
            if (app() && app().commit) app().commit();
            state.imported = { ok: true, summary: r.summary };
            if (app() && app().toast) app().toast('备份已恢复', 'ok');
          } else {
            state.imported = { ok: false, error: r.error };
            if (app() && app().toast) app().toast('恢复失败：' + r.error, 'err');
          }
          if (app() && app().render) app().render();
        };
        reader.readAsText(file);
        return false;
      },

      'toggle-log': function (ctx, state) {
        state.showLog = !state.showLog;
        return true;
      },

      'clear-data': function (ctx, state) {
        var doClear = async function () {
          // 直接清空 IndexedDB 每张表（不能依赖 flush：空列表会被 flush 跳过，导致旧数据残留）
          var db = app() && app().db;
          for (var i = 0; i < schema.DATA_STORES.length; i++) {
            var name = schema.DATA_STORES[i];
            ctx.data[name] = [];
            if (db && typeof db.clear === 'function') {
              try { await db.clear(name); } catch (e) { /* 忽略单表清空失败 */ }
            }
          }
          ctx.data.settings = schema.defaultSettings();
          ctx.settings = ctx.data.settings;
          if (ctx.data) ctx.data.lastBackupAt = null;
          // 保存重置后的设置到 IndexedDB
          if (app() && app().saveSettings) {
            try { await app().saveSettings(); } catch (e) { /* ignore */ }
          }
          if (app() && app().commit) await app().commit();
          if (app() && app().toast) app().toast('已清空全部数据', 'ok');
          return true;
        };
        if (app() && app().commit && C.confirm) {
          return C.confirm('清空全部数据', '此操作不可恢复，确定要继续吗？', '确认清空').then(function (ok) {
            if (!ok) return false;
            return doClear();
          });
        }
        return doClear();
      }
    }
  };

  return page;
});
