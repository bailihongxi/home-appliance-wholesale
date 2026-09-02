/**
 * barcode/scan.js —— 扫码三级降级（电器版，PRD 5.10）
 *   ① BarcodeDetector 实时预览（连续扫，Android Chrome）
 *   ② 拍照识别（<input type=file capture> → 解码，file:// 也能用）
 *   ③ 手输条码数字（等价于扫码结果）
 *
 * 定位规则：扫机身原厂条码 / 二维码 → product.barcodes[] 匹配；
 * 手输时可输入「原厂条码」或「品牌+型号」（如 海尔 BCD-200）。
 * 纯逻辑部分（resolve / card）可在 Node 中测试；
 * 浏览器交互部分（start / fromPhoto / fromInput / openCard）仅在浏览器生效，
 * 调用前会判断运行环境，缺失能力时自动降级到「手输」。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = (root && root.ERP) || {};
  var mod = factory(
    E.util || (isNode ? require('../core/util.js') : null),
    E.product || (isNode ? require('../core/product.js') : null),
    E.ui || (isNode ? require('../ui/components.js') : null),
    E
  );
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.scan = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, product, ui, ERP) {
  'use strict';

  var scan = {};

  /** 归一化条码：去空白、转大写 */
  function norm(code) {
    return String(code == null ? '' : code).trim().toUpperCase();
  }

  /**
   * 解析扫码/手输结果 → 定位商品（电器版）
   * @returns {found, product, code}
   * 优先原厂条码精确匹配；再按 品牌+型号 组合匹配（手输场景）；
   * 再尝试整体匹配品牌或型号（唯一命中才返回）。
   */
  scan.resolve = function resolve(ctx, code) {
    var c = norm(code);
    if (!c) return { found: false, code: c };
    // ① 原厂条码 / 二维码内容精确匹配
    var byCode = ctx.getProductByCode(c);
    if (byCode) return { found: true, product: byCode, code: c };
    // ② 品牌+型号 组合（空格分隔，如「海尔 BCD-200」）
    var parts = c.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      var b = parts[0].toUpperCase();
      var m = parts.slice(1).join(' ').toUpperCase();
      var hit = (ctx.data.products || []).filter(function (p) {
        return String(p.brand || '').trim().toUpperCase() === b &&
          String(p.model || '').trim().toUpperCase() === m;
      });
      if (hit.length === 1) return { found: true, product: hit[0], code: c };
      if (hit.length > 1) return { found: false, ambiguous: true, code: c };
    }
    // ③ 单独品牌或型号（唯一命中）
    var hits = (ctx.data.products || []).filter(function (p) {
      return String(p.brand || '').trim().toUpperCase() === c ||
        String(p.model || '').trim().toUpperCase() === c;
    });
    if (hits.length === 1) return { found: true, product: hits[0], code: c };
    return { found: false, code: c };
  };

  /**
   * 商品卡数据（电器版）：单层商品信息 + 双价 + 库存
   * @returns {product, totalStock, allZero} 或 null
   */
  scan.card = function card(ctx, productId) {
    var p = (ctx.data.products || []).find(function (x) {
      return String(x.id) === String(productId);
    });
    if (!p) return null;
    var totalStock = p.stock || 0;
    return {
      product: p,
      totalStock: totalStock,
      allZero: totalStock <= 0,
      low: ctx.settings && ctx.settings.defaultThreshold != null
        ? totalStock > 0 && totalStock < ctx.settings.defaultThreshold
        : false
    };
  };

  /* ---------------- 浏览器交互（仅浏览器） ---------------- */

  function hasWindow() {
    return typeof window !== 'undefined' && window && typeof document !== 'undefined';
  }

  /** 决定扫码方式：同时满足「有 BarcodeDetector」与「安全上下文」才实时扫，否则走手动兜底 */
  scan.chooseMode = function chooseMode(detector, secure) {
    return (detector && secure !== false) ? 'realtime' : 'manual';
  };

  /**
   * 启动扫码（三级降级）
   * @param opts { onResult(code), onError(msg) }
   */
  scan.start = function start(opts) {
    opts = opts || {};
    if (!hasWindow()) { if (opts.onError) opts.onError('当前环境不支持扫码'); return; }
    if (scan.chooseMode(window.BarcodeDetector, window.isSecureContext) === 'realtime') {
      realtime(opts);
    } else {
      manualCard(opts);
    }
  };

  /** ① 实时扫码（一维条码 + QR 二维码） */
  function realtime(opts) {
    var formats = ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'];
    var detector = new window.BarcodeDetector({ formats: formats });
    var video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.style.cssText = 'width:100%;max-height:50vh;background:#000;border-radius:8px';
    var stop = false;
    var mask = ui.modal({
      title: '扫码',
      body: '<div id="scan-video"></div><p class="muted small">将条码或二维码对准取景框，连续识别</p>',
      actions: [{ text: '手输', cls: 'btn', act: 'scan-manual' }, { text: '取消', cls: 'btn', act: 'close-modal' }],
      maskClose: false,
      onMount: function (body) {
        body.querySelector('#scan-video').appendChild(video);
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          .then(function (stream) {
            video.srcObject = stream;
            video.play();
            tick();
          })
          .catch(function () { closeMask(); manualCard(opts); });
        function tick() {
          if (stop) return;
          detector.detect(video).then(function (list) {
            if (list && list.length) {
              stop = true;
              streamStop(stream);
              closeMask();
              if (opts.onResult) opts.onResult(list[0].rawValue);
            } else {
              requestAnimationFrame(tick);
            }
          }).catch(function () { /* 继续 */ requestAnimationFrame(tick); });
        }
      }
    });
    // 手输按钮
    if (mask) {
      mask.querySelector('[data-act="scan-manual"]').addEventListener('click', function () {
        stop = true;
        streamStop(video.srcObject);
        closeMask();
        manualCard(opts);
      });
    }
    function streamStop(s) { if (s && s.getTracks) s.getTracks().forEach(function (t) { t.stop(); }); }
    function closeMask() { if (ui && ui.closeModal) ui.closeModal(); }
  }

  /** ② 拍照识别：懒加载 vendor/zxing 解码 */
  function photoInput(opts) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        decodeImage(reader.result, opts);
      };
      reader.readAsDataURL(f);
      document.body.removeChild(input);
    });
    input.click();
  }

  function decodeImage(dataUrl, opts) {
    // 优先用已加载的 ZXing 全局（支持 QR）
    if (window.ZXing && window.ZXing.BrowserCodeReader) {
      try {
        var reader = new window.ZXing.BrowserCodeReader();
        reader.decodeFromImageUrl(dataUrl).then(function (r) {
          if (r && r.text && opts.onResult) opts.onResult(r.text);
          else if (opts.onError) opts.onError('未识别到条码/二维码，请重试或手输');
        }).catch(function () {
          if (opts.onError) opts.onError('识别失败，请重试或手输');
        });
        return;
      } catch (e) { /* 落到手输 */ }
    }
    if (opts.onError) opts.onError('当前环境无法拍照识别，请手输条码');
  }

  /**
   * ③ 手动兜底卡片：拍照识别 + 手输条码 / 品牌型号
   */
  function manualCard(opts) {
    if (!hasWindow()) { if (opts.onError) opts.onError('当前环境不支持扫码'); return; }
    var body =
      '<p class="muted small mb8">本设备无法实时扫码，可任选其一：</p>' +
      '<button class="btn btn-block mb8" data-act="scan-photo">📷 拍照 / 从相册识别</button>' +
      '<div class="field"><label>手输条码 / 二维码内容，或 品牌+型号</label>' +
      '<input class="input" id="scan-manual-input" placeholder="如 6901234567892 或 海尔 BCD-200" autocomplete="off"></div>';
    ui.modal({
      title: '扫码',
      body: body,
      actions: [
        { text: '确定', cls: 'btn btn-primary', act: 'scan-manual-ok' },
        { text: '取消', cls: 'btn', act: 'close-modal' }
      ],
      maskClose: true,
      onMount: function (b, mask) {
        var input = b.querySelector('#scan-manual-input');
        if (input && input.focus) setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
        var okBtn = mask.querySelector('[data-act="scan-manual-ok"]');
        if (okBtn) okBtn.addEventListener('click', function () {
          var v = input ? String(input.value || '').trim() : '';
          if (!v) { ui.toast('请输入条码 / 品牌型号', 'err'); return; }
          if (ui.closeModal) ui.closeModal();
          if (opts.onResult) opts.onResult(v);
        });
        var photoBtn = mask.querySelector('[data-act="scan-photo"]');
        if (photoBtn) photoBtn.addEventListener('click', function () {
          if (ui.closeModal) ui.closeModal();
          photoInput(opts);
        });
      }
    });
  }

  /** 扫码结果 → 打开商品卡（浏览器）；未建档则提示去建档 */
  scan.openCard = function openCard(ctx, code, app) {
    if (!hasWindow()) return;
    var res = scan.resolve(ctx, code);
    if (!res.found) {
      ui.toast(res.ambiguous ? '该品牌型号存在多个商品，请在商品列表中选择' : '未找到对应商品，请先在「商品档案」建档', 'err');
      if (app && app.go) app.go('product');
      return;
    }
    var c = scan.card(ctx, res.product.id);
    if (!c) return;
    var p = c.product;
    var priceLine =
      '<div class="small muted mb8">批发价 ' + ui.money(p.priceWholesale) +
      ' · 零售价 ' + ui.money(p.priceRetail) +
      ' · 成本 ' + ui.money(p.cost) + '</div>';
    var stockBadge = c.allZero
      ? ' <b style="color:#dc2626">（0 库存）</b>'
      : (c.low ? ' <b style="color:#faad14">（库存偏低）</b>' : '');
    var barcodes = Array.isArray(p.barcodes) && p.barcodes.length
      ? '<div class="small muted" style="margin-top:6px">原厂条码：' + util.escapeHtml(p.barcodes.join(' / ')) + '</div>'
      : '';
    var body =
      '<div class="small muted mb8">' + util.escapeHtml(p.category) + ' · ' + util.escapeHtml(p.unit) + ' · 库存 ' + c.totalStock + stockBadge + '</div>' +
      priceLine +
      '<div class="small">' + util.escapeHtml(p.note || '') + '</div>' + barcodes;
    ui.modal({
      title: '商品 · ' + util.escapeHtml(product.displayName(p)),
      body: body,
      actions: [
        { text: '去开单', cls: 'btn btn-primary', act: 'scan-go-sale' },
        { text: '关闭', cls: 'btn', act: 'close-modal' }
      ],
      onMount: function (b, mask) {
        mask.querySelector('[data-act="scan-go-sale"]').addEventListener('click', function () {
          ui.closeModal();
          ERP.pendingSaleProduct = p.id;
          if (app && app.go) app.go('sale');
        });
      }
    });
  };

  return scan;
});
