/**
 * barcode/ean13.js —— 自研轻量 EAN-13 解码器（零依赖、纯 JS、Node 可测、国产浏览器兼容）
 *
 * 背景：vendor ZXing（老库）与官方 @zxing/library UMD 的一维解码链路已确诊打包损坏；
 * quagga2 依赖已弃用 API 在鸿蒙/Android WebView 不可用。本模块实现
 * 「4-run 比例匹配 + 首位奇偶枚举 + 校验位过滤 + 多行投票」的 EAN-13 解码，
 * 对相机帧 / 直出 JPEG / 轻噪声图像稳定可解（微信重压缩图受块效应影响时
 * 由调用方结合 native 通道与置信度决策，不硬编错误结果）。
 *
 * 用法（浏览器）：var r = ERP.ean13.decode(gray, width, height);
 *                var gray = ERP.ean13.grayFromCanvas(canvas);
 * 用法（Node 测试）：require('../js/barcode/ean13.js').decode(gray, w, h)
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var mod = factory();
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.ean13 = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- EAN-13 码表（与 ZXing 一致） ---------------- */
  var L_BITS = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  var G_BITS = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  var R_BITS = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  /** 首位数字 → 左侧 6 位奇偶模式（O=L 码，E=G 码） */
  var PARITY = ['OOOOOO', 'OOEOEE', 'OOEEOE', 'OOEEEO', 'OEOOEE', 'OEOEOE', 'OEEOOE', 'OEEOEO', 'OEOEOO', 'OEEEOO'];

  /** 7 模块位串 → 4-run 长度（W,B,W,B 或 B,W,B,W） */
  function patOf(bits7) {
    var runs = [];
    var cur = bits7[0], len = 1;
    for (var i = 1; i < bits7.length; i++) {
      if (bits7[i] === cur) len++;
      else { runs.push(len); cur = bits7[i]; len = 1; }
    }
    runs.push(len);
    while (runs.length < 4) runs.push(0);
    return runs.slice(0, 4);
  }
  var L_PATS = L_BITS.map(patOf);
  var G_PATS = G_BITS.map(patOf);
  var R_PATS = R_BITS.map(patOf);

  /** 归一化匹配偏差：counters 与 patterns 中某一模式的绝对偏差和（按比例缩放） */
  function matchOne(counters, patterns) {
    var total = counters[0] + counters[1] + counters[2] + counters[3];
    var best = -1, bestVar = Infinity;
    for (var p = 0; p < patterns.length; p++) {
      var pat = patterns[p];
      var patSum = pat[0] + pat[1] + pat[2] + pat[3];
      var v = 0;
      for (var i = 0; i < 4; i++) {
        v += Math.abs(counters[i] - pat[i] * total / patSum);
      }
      if (v < bestVar) { bestVar = v; best = p; }
    }
    return { idx: best, v: bestVar, t: total };
  }

  /** 单条扫描线解码（返回 13 位数字串；失败返回 null） */
  function decodeRow(gray, width, height, y) {
    var row = new Uint8Array(width);
    var sum = 0;
    for (var x = 0; x < width; x++) { row[x] = gray[y * width + x]; sum += row[x]; }
    var mean = sum / width;
    var black = 0;
    for (x = 0; x < width; x++) if (row[x] < mean) black++;
    if (black < width * 0.03 || black > width * 0.97) return null;
    var bin = new Uint8Array(width);
    for (x = 0; x < width; x++) bin[x] = row[x] < mean ? 1 : 0;
    var runs = [];
    var cur = bin[0], len = 1, start = 0;
    for (x = 1; x < width; x++) {
      if (bin[x] === cur) len++;
      else { runs.push({ v: cur, len: len, start: start }); cur = bin[x]; len = 1; start = x; }
    }
    runs.push({ v: cur, len: len, start: start });

    for (var i = 0; i < runs.length - 2; i++) {
      var r0 = runs[i], r1 = runs[i + 1], r2 = runs[i + 2];
      if (r0.v !== 1 || r1.v !== 0 || r2.v !== 1) continue; // 起始符 101
      var a = (r0.len + r1.len + r2.len) / 3;
      if (a < 1.5) continue;
      var dev = Math.abs(r0.len - a) + Math.abs(r1.len - a) + Math.abs(r2.len - a);
      if (dev > 1.8 * a) continue;

      // 左侧 6 位 counters（白,黑,白,黑）
      var lc = [];
      var j = i + 3, ok = true;
      for (var d = 0; d < 6; d++) {
        if (j + 3 >= runs.length) { ok = false; break; }
        if (runs[j].v !== 0 || runs[j + 1].v !== 1 || runs[j + 2].v !== 0 || runs[j + 3].v !== 1) { ok = false; break; }
        lc.push([runs[j].len, runs[j + 1].len, runs[j + 2].len, runs[j + 3].len]);
        j += 4;
      }
      if (!ok || lc.length !== 6) continue;

      // 分隔符 01010
      if (j + 4 >= runs.length) continue;
      if (runs[j].v !== 0 || runs[j + 1].v !== 1 || runs[j + 2].v !== 0 || runs[j + 3].v !== 1 || runs[j + 4].v !== 0) continue;
      var sepOk = true;
      for (var k = 0; k < 5; k++) if (Math.abs(runs[j + k].len - a) > 0.8 * a) { sepOk = false; break; }
      if (!sepOk) continue;
      j += 5;

      // 右侧 6 位 counters（黑,白,黑,白）
      var rc = [];
      ok = true;
      for (d = 0; d < 6; d++) {
        if (j + 3 >= runs.length) { ok = false; break; }
        if (runs[j].v !== 1 || runs[j + 1].v !== 0 || runs[j + 2].v !== 1 || runs[j + 3].v !== 0) { ok = false; break; }
        rc.push([runs[j].len, runs[j + 1].len, runs[j + 2].len, runs[j + 3].len]);
        j += 4;
      }
      if (!ok || rc.length !== 6) continue;

      // 结束符 101
      if (j + 2 >= runs.length) continue;
      if (runs[j].v !== 1 || runs[j + 1].v !== 0 || runs[j + 2].v !== 1) continue;

      // 右侧解码（固定 R 码）
      var right = '';
      ok = true;
      for (d = 0; d < 6; d++) {
        var m = matchOne(rc[d], R_PATS);
        if (m.idx < 0 || m.v > m.t * 0.42) { ok = false; break; }
        right += m.idx;
      }
      if (!ok) continue;

      // 首位枚举（0-9）：奇偶确定左侧 L/G，校验位过滤
      var bestRes = null;
      for (var d1 = 0; d1 < 10; d1++) {
        var parity = PARITY[d1];
        var left = '', tv = 0;
        ok = true;
        for (d = 0; d < 6; d++) {
          var pats = parity[d] === 'O' ? L_PATS : G_PATS;
          var m2 = matchOne(lc[d], pats);
          if (m2.idx < 0 || m2.v > m2.t * 0.42) { ok = false; break; }
          left += m2.idx;
          tv += m2.v;
        }
        if (!ok) continue;
        var ds = d1 + left + right;
        var sc = 0;
        for (k = 0; k < 12; k++) sc += (k % 2 === 0) ? +ds[k] : +ds[k] * 3;
        var check = (10 - (sc % 10)) % 10;
        if (check !== +ds[12]) continue;
        if (!bestRes || tv < bestRes.v) bestRes = { digits: ds, v: tv };
      }
      if (bestRes) return bestRes.digits;
    }
    return null;
  }

  /**
   * 多行扫描 + 投票解码
   * @param gray Uint8Array（width*height）
   * @returns {text, votes, lines} 或 null（无任何行通过校验 / 票数不足置信度门槛）
   */
  function decode(gray, width, height) {
    if (!gray || !width || !height || width < 60 || height < 20) return null;
    var tally = {};
    var y0 = Math.round(height * 0.15);
    var y1 = Math.round(height * 0.85);
    var lines = 0;
    for (var y = y0; y < y1; y += 2) {
      var r = decodeRow(gray, width, height, y);
      lines++;
      if (r) tally[r] = (tally[r] || 0) + 1;
    }
    var best = null, bestVotes = 0;
    for (var k in tally) {
      if (tally[k] > bestVotes) { bestVotes = tally[k]; best = k; }
    }
    if (!best) return null;
    // 置信度门槛：多数行一致才可信（防随机噪声误报）
    if (bestVotes < 3 || bestVotes < lines * 0.3) return null;
    return { text: best, votes: bestVotes, lines: lines };
  }

  /** 浏览器端：canvas → 灰度（getImageData；data URL / 本地同源图不污染画布） */
  function grayFromCanvas(canvas) {
    try {
      if (!canvas || !canvas.getContext) return null;
      var w = canvas.width || 0, h = canvas.height || 0;
      if (!w || !h) return null;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      var data = ctx.getImageData(0, 0, w, h).data;
      var gray = new Uint8Array(w * h);
      for (var i = 0, j = 0; i < data.length; i += 4, j++) {
        gray[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      }
      return gray;
    } catch (e) { return null; }
  }

  return {
    decode: decode,
    decodeRow: decodeRow,
    grayFromCanvas: grayFromCanvas,
    L_PATS: L_PATS,
    G_PATS: G_PATS,
    R_PATS: R_PATS,
    PARITY: PARITY
  };
});
