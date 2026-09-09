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

  /** 实时识别支持的码制（缺省列表，兼容各平台） */
  scan.buildFormats = function buildFormats() {
    return ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'];
  };

  /**
   * 拍照解码优先级：原生 BarcodeDetector（Android/鸿蒙识别率高）优先，ZXing 兜底
   * @returns {string[]} ['native','zxing'] | ['zxing'] | []
   */
  scan.pickDecoders = function pickDecoders(env) {
    env = env || {};
    var order = [];
    if (env.native) order.push('native');
    if (env.zxing) order.push('zxing');
    return order;
  };

  /**
   * 实时识别是否需要降级到拍照/手输
   * @param stat { emptyFrames, errorFrames, firstEmptyAt }
   *   - 连续空转 emptyFrames >= 60（约1秒60帧 或时间兜底 12 秒）
   *   - 连续异常 errorFrames >= 5（设备实时识别不可用）
   *   - 自首次空转起超 12 秒（时间兜底，防止帧率波动）
   */
  scan.needDowngrade = function needDowngrade(stat) {
    stat = stat || {};
    if (stat.errorFrames >= 5) return true;
    if (stat.emptyFrames >= 60) return true;
    if (stat.firstEmptyAt && (Date.now() - stat.firstEmptyAt) >= 12000) return true;
    return false;
  };

  /** 统一释放摄像头流（幂等：无流/已停止均安全） */
  scan.closeCamera = function closeCamera(stream) {
    if (stream && typeof stream.getTracks === 'function') {
      var tracks = stream.getTracks();
      for (var i = 0; i < tracks.length; i++) {
        try { tracks[i].stop(); } catch (e) { /* 忽略单轨停止失败 */ }
      }
      return true;
    }
    return false;
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
    var detector = new window.BarcodeDetector({ formats: scan.buildFormats() });
    var video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.style.cssText = 'width:100%;max-height:50vh;background:#000;border-radius:8px';
    var stop = false;
    var stream = null;
    var stat = { emptyFrames: 0, errorFrames: 0, firstEmptyAt: 0, startedAt: Date.now() };
    var mask = ui.modal({
      title: '扫码',
      body: '<div id="scan-video"></div>' +
        '<p class="muted small" id="scan-hint">将条码或二维码对准取景框，保持平稳、避免反光</p>',
      actions: [
        { text: '📷 拍照识别', cls: 'btn', act: 'scan-photo' },
        { text: '手输', cls: 'btn', act: 'scan-manual' },
        { text: '取消', cls: 'btn', act: 'scan-cancel' }
      ],
      maskClose: false,
      // 统一关闭钩子：取消/X/遮罩/外部 closeModal 都会释放摄像头（修复二次打开黑屏）
      onClose: function () {
        stop = true;
        scan.closeCamera(stream || video.srcObject);
      },
      onMount: function (body) {
        body.querySelector('#scan-video').appendChild(video);
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        }).then(function (s) {
          if (stop) { scan.closeCamera(s); return; }
          stream = s;
          video.srcObject = s;
          video.play();
          tick();
        }).catch(function () {
          stop = true;
          ui.closeModal();
          manualCard(opts);
        });
        /** 降级到拍照/手输（释放摄像头 + 关弹窗 + 提示） */
        function downgrade(msg) {
          stop = true;
          scan.closeCamera(stream);
          ui.closeModal();
          if (opts.onError) opts.onError(msg);
          manualCard(opts);
        }
        function tick() {
          if (stop) return;
          // 黑屏检测：摄像头已启动但 3 秒无实际画面帧 → 降级
          if (!video.videoWidth && Date.now() - stat.startedAt >= 3000) {
            downgrade('摄像头未输出画面，已切换为拍照/手输');
            return;
          }
          detector.detect(video).then(function (list) {
            if (stop) return;
            if (list && list.length) {
              stop = true;
              scan.closeCamera(stream);
              ui.closeModal();
              if (opts.onResult) opts.onResult(list[0].rawValue);
              return;
            }
            stat.emptyFrames++;
            stat.errorFrames = 0;
            if (!stat.firstEmptyAt) stat.firstEmptyAt = Date.now();
            if (scan.needDowngrade(stat)) {
              downgrade('实时识别超时（约12秒无结果），已切换为拍照/手输');
              return;
            }
            requestAnimationFrame(tick);
          }).catch(function () {
            if (stop) return;
            stat.errorFrames++;
            if (scan.needDowngrade(stat)) {
              downgrade('当前设备无法实时识别，已切换为拍照/手输');
              return;
            }
            requestAnimationFrame(tick);
          });
        }
      }
    });
    if (!mask) return;
    // 「📷 拍照识别」：随时可切（onClose 自动释放摄像头）
    var photoBtn = mask.querySelector('[data-act="scan-photo"]');
    if (photoBtn) photoBtn.addEventListener('click', function () {
      ui.closeModal();
      photoInput(opts);
    });
    // 「手输」：释放后切手动卡片
    var manualBtn = mask.querySelector('[data-act="scan-manual"]');
    if (manualBtn) manualBtn.addEventListener('click', function () {
      ui.closeModal();
      manualCard(opts);
    });
    // 「取消」：直接关闭（onClose 释放摄像头）
    var cancelBtn = mask.querySelector('[data-act="scan-cancel"]');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      ui.closeModal();
    });
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
    var env = {
      native: typeof window !== 'undefined' && !!window.BarcodeDetector,
      zxing: !!(window.ZXing && window.ZXing.BrowserCodeReader)
    };
    var order = scan.pickDecoders(env);
    if (!order.length) {
      if (opts.onError) opts.onError('当前环境无法拍照识别，请手输条码');
      return;
    }
    var i = 0;
    function next() {
      if (i >= order.length) {
        if (opts.onError) opts.onError('未识别到条码/二维码，请重试或手输');
        return;
      }
      var kind = order[i++];
      var done = function (ok, text) {
        if (ok) { if (opts.onResult) opts.onResult(text); }
        else next();
      };
      if (kind === 'native') nativeDecode(dataUrl, done);
      else zxingDecode(dataUrl, done);
    }
    next();
  }

  /** 原生解码图片（Android/鸿蒙识别率高于 ZXing 纯 JS） */
  function nativeDecode(dataUrl, done) {
    try {
      var detector = new window.BarcodeDetector();
      var img = new Image();
      img.onload = function () {
        detector.detect(img).then(function (list) {
          if (list && list.length) done(true, list[0].rawValue);
          else done(false);
        }).catch(function () { done(false); });
      };
      img.onerror = function () { done(false); };
      img.src = dataUrl;
    } catch (e) { done(false); }
  }

  /** ZXing 兜底解码（无原生能力的环境） */
  function zxingDecode(dataUrl, done) {
    try {
      var reader = new window.ZXing.BrowserCodeReader();
      reader.decodeFromImageUrl(dataUrl).then(function (r) {
        if (r && r.text) done(true, r.text);
        else done(false);
      }).catch(function () { done(false); });
    } catch (e) { done(false); }
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
          if (app && app.go) app.go('sale', { tab: 'new' });
        });
      }
    });
  };

  return scan;
});
