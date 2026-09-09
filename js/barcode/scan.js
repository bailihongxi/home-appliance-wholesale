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
   * 扫码结果规范化（V3.35 参考鞋服 V1.3-10 思路、独立实现）：
   * UPC-A 为 12 位纯数字条码，补前导 0 即等价于 EAN-13（13 位）——
   * 使扫码枪/相机扫出的 12 位 UPC-A 能匹配以 0 开头的 13 位商品条码。
   * 非 12 位纯数字内容原样保留（不局限国标长度）。
   */
  scan.normalizeCode = function normalizeCode(text) {
    var s = String(text == null ? '' : text).trim();
    if (/^\d{12}$/.test(s)) return '0' + s;
    return s;
  };

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
    // ①b UPC-A ↔ EAN-13 规范化变体匹配：12 位补前导 0 / 13 位以 0 开头去前导 0，
    //     使扫码或手输的两种长度都能对上商品档案中的另一长度条码
    var upc = scan.normalizeCode(c); // 12 位 → 补 0（13 位原样）
    if (upc !== c) {
      var byUpc = ctx.getProductByCode(upc);
      if (byUpc) return { found: true, product: byUpc, code: c };
    }
    var trim0 = /^0\d{12}$/.test(c) ? c.slice(1) : '';
    if (trim0 && trim0 !== c) {
      var byTrim = ctx.getProductByCode(trim0);
      if (byTrim) return { found: true, product: byTrim, code: c };
    }
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
   * 拍照解码优先级：原生 BarcodeDetector（Android/鸿蒙识别率高）→
   * 自研 EAN-13（零依赖，替代打包损坏的 ZXing 作为主通道）→ ZXing 兜底
   * @returns {string[]} ['native','ean13','zxing'] 子集
   */
  scan.pickDecoders = function pickDecoders(env) {
    env = env || {};
    var order = [];
    if (env.native) order.push('native');
    if (env.ean13) order.push('ean13');
    if (env.zxing) order.push('zxing');
    return order;
  };

  /**
   * 实时识别是否需要降级到拍照/手输
   * @param stat { emptyFrames, errorFrames, firstEmptyAt }
   *   - 连续空转 emptyFrames >= 60（约1秒60帧 或时间兜底 12 秒）
   *   - 连续异常 errorFrames >= 5（设备实时识别不可用；仅画面正常时计数）
   *   - 自首次空转起超 12 秒（时间兜底，防止帧率波动）
   */
  scan.needDowngrade = function needDowngrade(stat) {
    stat = stat || {};
    if (stat.errorFrames >= 5) return true;
    if (stat.emptyFrames >= 60) return true;
    if (stat.firstEmptyAt && (Date.now() - stat.firstEmptyAt) >= 12000) return true;
    return false;
  };

  /**
   * 黑屏判定：摄像头已启动但长时间无实际画面帧（videoWidth=0）
   * @returns {boolean} 距启动 >= 2500ms 且仍无帧 → 黑屏降级
   */
  scan.isBlackOut = function isBlackOut(videoWidth, startedAt, now) {
    return !videoWidth && (now - startedAt) >= 2500;
  };

  /**
   * detect 异常是否应计入降级计数：
   * 仅当画面正常（videoWidth>0）时的异常才算「设备实时识别不可用」；
   * 黑屏期间 detect 抛异常不计数，交给 isBlackOut 处理（避免异常降级抢跑黑屏检测）
   */
  scan.shouldCountError = function shouldCountError(videoWidth) {
    return videoWidth > 0;
  };

  /**
   * 是否切换到「抓帧识别」模式：
   * 实时模式（video-detect）下 detect(video) 连续异常 3 次 → 切抓帧（画面保留、静态帧多通道解码），
   * 兼容 BarcodeDetector 半实现（API 存在但 detect(video) 不可用）的国产浏览器/鸿蒙 WebView
   */
  scan.shouldSwitchFrame = function shouldSwitchFrame(mode, errorFrames) {
    return mode === 'video' && errorFrames >= 3;
  };

  /** 抓帧节流：距上次抓帧 >= interval(默认500ms) 才抓新帧 */
  scan.frameDue = function frameDue(lastFrameAt, now, interval) {
    return (now - lastFrameAt) >= (interval == null ? 500 : interval);
  };

  /**
   * 原生通道超时保护：华为/鸿蒙等自带浏览器 BarcodeDetector.detect() 可能
   * 挂起不返回或耗时 5-10 秒，超时后强制跳过 native，交给 ZXing 兜底
   */
  scan.NATIVE_TIMEOUT_MS = 2500;
  /** ZXing 纯 JS 解码长边上限：原图过大逐行扫描极慢（5-10s+），压缩后 <1s 且识别率更高 */
  scan.ZXING_MAX_EDGE = 1280;

  /**
   * 多通道解码（可注入实现，便于测试）：
   * ① 原生 BarcodeDetector（带超时保护）→ ② 自研 EAN-13 → ③ ZXing 纯 JS（解码前压缩图片）
   * source：Image 元素 / canvas；done(ok, text)
   * impl：{ native: { available, detect(src, cb) }, ean13: { available, decode(src, cb) }, zxing: { available, decode(src, cb) } }
   */
  scan.decodeWith = function decodeWith(source, done, impl) {
    var env = impl || {
      native: { available: hasNative(), detect: nativeDetect },
      ean13: { available: hasEan13(), decode: ean13Decode },
      zxing: { available: hasZxing(), decode: zxingDecode }
    };
    var order = scan.pickDecoders({
      native: env.native && env.native.available,
      ean13: env.ean13 && env.ean13.available,
      zxing: env.zxing && env.zxing.available
    });
    if (!order.length) { done(false); return; }
    // 出口统一规范化：所有通道的成功结果过 normalizeCode（UPC-A 12 位 → EAN-13 13 位）
    var finalize = function (ok, text) {
      done(ok, ok ? scan.normalizeCode(text) : text);
    };
    var i = 0;
    function next() {
      if (i >= order.length) { done(false); return; }
      var kind = order[i++];
      if (kind === 'native') {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          next(); // 超时：跳过 native，交给下一通道
        }, scan.NATIVE_TIMEOUT_MS);
        try {
          env.native.detect(source, function (ok, text) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (ok) finalize(true, text);
            else next();
          });
        } catch (e) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          next();
        }
      } else if (kind === 'ean13') {
        try {
          env.ean13.decode(source, function (ok, text) {
            if (ok) finalize(true, text);
            else next();
          });
        } catch (e) { next(); }
      } else {
        try {
          env.zxing.decode(source, function (ok, text) {
            if (ok) finalize(true, text);
            else next();
          });
        } catch (e) { next(); }
      }
    }
    next();
  };

  function hasNative() {
    return typeof window !== 'undefined' && !!window.BarcodeDetector;
  }
  function hasEan13() {
    return !!(window.ERP && window.ERP.ean13 && typeof window.ERP.ean13.decode === 'function');
  }
  function hasZxing() {
    return !!(window.ZXing && typeof window.ZXing.decodeCanvas === 'function');
  }

  /** 统一转为「适合解码的 canvas」（长边 ≤ ZXING_MAX_EDGE，只缩小不放大） */
  function toDecodeCanvas(source) {
    try {
      var w = 0, h = 0, el = null;
      if (source && source.tagName === 'IMG') {
        w = source.naturalWidth; h = source.naturalHeight; el = source;
      } else if (source && source.tagName === 'CANVAS') {
        w = source.width; h = source.height; el = source;
      } else { return null; }
      if (!w || !h) return null;
      var scale = Math.min(1, scan.ZXING_MAX_EDGE / Math.max(w, h));
      if (scale >= 1) return source;
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(el, 0, 0, c.width, c.height);
      return c;
    } catch (e) { return null; }
  }

  /** 原图 → 原始尺寸 canvas（自研 EAN-13 用原图精度，不缩放） */
  function toCanvas(source) {
    try {
      if (source && source.tagName === 'CANVAS') return source;
      if (source && source.tagName === 'IMG') {
        var w = source.naturalWidth || 0;
        var h = source.naturalHeight || 0;
        if (!w || !h) return null;
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(source, 0, 0, w, h);
        return c;
      }
      return null;
    } catch (e) { return null; }
  }

  /** 自研 EAN-13 通道：原图 canvas → 灰度 → 多行投票解码；
   *  0° 失败 → ±4° 旋转重试（手持倾斜）→ 90°/270° 转置重试（竖排印刷/竖版标签条码） */
  function ean13Decode(source, cb) {
    try {
      var canvas = toCanvas(source);
      if (!canvas) { cb(false); return; }
      var gray = window.ERP.ean13.grayFromCanvas(canvas);
      var r = gray ? window.ERP.ean13.decode(gray, canvas.width, canvas.height) : null;
      if (r && r.text) { cb(true, r.text); return; }
      // 旋转重试（拍摄角度较大时水平扫描线失效）
      for (var i = 0; i < 2; i++) {
        var rc = rotateCanvas(canvas, i === 0 ? -4 : 4);
        if (!rc) continue;
        var rg = window.ERP.ean13.grayFromCanvas(rc);
        var rr = rg ? window.ERP.ean13.decode(rg, rc.width, rc.height) : null;
        if (rr && rr.text) { cb(true, rr.text); return; }
      }
      // 转置重试（V3.35）：条码竖排印刷/竖版标签时，转置 90°/270° 后按行扫描
      for (var t = 0; t < 2; t++) {
        var tc = transposeCanvas(canvas, t === 0 ? 90 : 270);
        if (!tc) continue;
        var tg = window.ERP.ean13.grayFromCanvas(tc);
        var tr = tg ? window.ERP.ean13.decode(tg, tc.width, tc.height) : null;
        if (tr && tr.text) { cb(true, tr.text); return; }
      }
      cb(false);
    } catch (e) { cb(false); }
  }

  /** canvas 旋转（白底补齐边缘），±4° 兜底手持倾斜 */
  function rotateCanvas(canvas, deg) {
    try {
      var w = canvas.width, h = canvas.height;
      if (!w || !h) return null;
      var diag = Math.ceil(Math.sqrt(w * w + h * h));
      var c = document.createElement('canvas');
      c.width = diag;
      c.height = diag;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, diag, diag);
      ctx.translate(diag / 2, diag / 2);
      ctx.rotate(deg * Math.PI / 180);
      ctx.drawImage(canvas, -w / 2, -h / 2);
      return c;
    } catch (e) { return null; }
  }

  /** canvas 转置（V3.35）：90°/270° 旋转且宽高互换、白底补齐——
   *  竖排印刷/竖版标签的条码转成横向后可按行扫描 */
  function transposeCanvas(canvas, deg) {
    try {
      var w = canvas.width, h = canvas.height;
      if (!w || !h) return null;
      var c = document.createElement('canvas');
      c.width = h; // 宽高互换
      c.height = w;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(deg * Math.PI / 180);
      ctx.drawImage(canvas, -w / 2, -h / 2);
      return c;
    } catch (e) { return null; }
  }

  /** 原生通道（吃压缩后小图，快且稳） */
  function nativeDetect(source, cb) {
    try {
      var d = new window.BarcodeDetector();
      var canvas = toDecodeCanvas(source);
      if (!canvas) { cb(false); return; }
      d.detect(canvas).then(function (list) {
        if (list && list.length) cb(true, list[0].rawValue);
        else cb(false);
      }).catch(function () { cb(false); });
    } catch (e) { cb(false); }
  }

  /** ZXing 纯 JS 通道（干净打包版：canvas → Hybrid/Global 双二值化，覆盖二维码/Code128 等码制） */
  function zxingDecode(source, cb) {
    try {
      var canvas = toDecodeCanvas(source);
      if (!canvas) { cb(false); return; }
      var r = window.ZXing.decodeCanvas(canvas);
      if (r) cb(true, r);
      else cb(false);
    } catch (e) { cb(false); }
  }

  /** 中心区域放大重试：条码占照片比例小时，放大画面中心后识别率提升 */
  function zoomCenterCanvas(img, factor) {
    try {
      var w = img.naturalWidth || 640;
      var h = img.naturalHeight || 480;
      if (!w || !h) return null;
      var cw = Math.max(1, Math.round(w / factor));
      var ch = Math.max(1, Math.round(h / factor));
      var sx = Math.round((w - cw) / 2);
      var sy = Math.round((h - ch) / 2);
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, sx, sy, cw, ch, 0, 0, w, h);
      return c;
    } catch (e) { return null; }
  }

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
    var stat = {
      emptyFrames: 0, errorFrames: 0, firstEmptyAt: 0, startedAt: Date.now(),
      mode: 'video', lastFrameAt: 0
    };
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
        // 注意：不加 width/height 理想分辨率约束——部分鸿蒙/Android WebView
        // 对带约束的流渲染黑屏（无帧），导致 detect 持续异常与取景黑屏
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          .then(function (s) {
            if (stop) { scan.closeCamera(s); return; }
            stream = s;
            video.srcObject = s;
            var pp = video.play();
            if (pp && typeof pp.then === 'function') {
              pp.then(function () { if (!stop) tick(); })
                .catch(function () { if (!stop) downgrade('摄像头启动失败，已切换为拍照/手输'); });
            } else {
              tick();
            }
          })
          .catch(function () {
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
        /** 识别成功 */
        function success(raw) {
          stop = true;
          scan.closeCamera(stream);
          ui.closeModal();
          if (opts.onResult) opts.onResult(raw);
        }
        function tick() {
          if (stop) return;
          // 黑屏检测（优先）：2.5 秒无实际画面帧 → 降级。
          if (scan.isBlackOut(video.videoWidth, stat.startedAt, Date.now())) {
            downgrade('摄像头未输出画面，已切换为拍照/手输');
            return;
          }
          // 抓帧模式：detect(video) 不可用/挂起时的兜底，画面保留、静态帧多通道解码
          if (stat.mode === 'frame') { frameTick(); return; }
          var detectSettled = false;
          // 超时保护：鸿蒙/Android 自带浏览器 detect(video) 可能挂起永不返回
          // （取景正常但「无任何识别操作」的根因）→ 超时切抓帧，走多通道解码
          var detectTimer = setTimeout(function () {
            if (detectSettled || stop) return;
            detectSettled = true;
            stat.mode = 'frame';
            stat.lastFrameAt = 0;
            stat.errorFrames = 0;
            requestAnimationFrame(tick);
          }, scan.NATIVE_TIMEOUT_MS);
          detector.detect(video).then(function (list) {
            if (detectSettled || stop) return;
            detectSettled = true;
            clearTimeout(detectTimer);
            if (list && list.length) { success(list[0].rawValue); return; }
            stat.emptyFrames++;
            stat.errorFrames = 0;
            if (!stat.firstEmptyAt) stat.firstEmptyAt = Date.now();
            if (scan.needDowngrade(stat)) {
              downgrade('实时识别超时（约12秒无结果），已切换为拍照/手输');
              return;
            }
            requestAnimationFrame(tick);
          }).catch(function () {
            if (detectSettled || stop) return;
            detectSettled = true;
            clearTimeout(detectTimer);
            // 仅画面正常时的异常计数；连续 3 次 → 切抓帧模式（不关闭画面）
            if (scan.shouldCountError(video.videoWidth)) {
              stat.errorFrames++;
              if (scan.shouldSwitchFrame(stat.mode, stat.errorFrames)) {
                stat.mode = 'frame';
                stat.lastFrameAt = 0;
                requestAnimationFrame(tick);
                return;
              }
            }
            requestAnimationFrame(tick);
          });
        }
        function frameTick() {
          if (stop) return;
          if (scan.isBlackOut(video.videoWidth, stat.startedAt, Date.now())) {
            downgrade('摄像头未输出画面，已切换为拍照/手输');
            return;
          }
          var now = Date.now();
          if (!scan.frameDue(stat.lastFrameAt, now, 500)) { requestAnimationFrame(frameTick); return; }
          stat.lastFrameAt = now;
          var canvas = captureFrame(video);
          if (!canvas) { requestAnimationFrame(frameTick); return; }
          scan.decodeWith(canvas, function (ok, text) {
            if (stop) return;
            if (ok) { success(text); return; }
            if (Date.now() - stat.startedAt >= 15000) {
              downgrade('实时识别超时（已尝试多种识别方式），请拍照或手输');
              return;
            }
            requestAnimationFrame(frameTick);
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

  /** 从 video 抓取当前帧到 canvas（videoWidth=0 时返回 null） */
  function captureFrame(video) {
    try {
      var w = video.videoWidth || 0;
      var h = video.videoHeight || 0;
      if (!w || !h) return null;
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, w, h);
      return c;
    } catch (e) { return null; }
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
    var img = new Image();
    img.onload = function () {
      scan.decodeWith(img, function (ok, text) {
        if (ok) { if (opts.onResult) opts.onResult(text); return; }
        // 中心区域放大重试：条码占照片比例小时提升识别率
        var zoomed = zoomCenterCanvas(img, 2);
        if (zoomed) {
          scan.decodeWith(zoomed, function (ok2, text2) {
            if (ok2) { if (opts.onResult) opts.onResult(text2); return; }
            if (opts.onError) opts.onError('未识别到条码/二维码，请对准条码、避免反光、保持完整后重拍，或手输');
          });
        } else if (opts.onError) {
          opts.onError('未识别到条码/二维码，请对准条码、避免反光、保持完整后重拍，或手输');
        }
      });
    };
    img.onerror = function () {
      if (opts.onError) opts.onError('图片加载失败，请重试或手输');
    };
    img.src = dataUrl;
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
