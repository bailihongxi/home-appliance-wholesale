/**
 * barcode/generic39.js —— 自研轻量 Code39 解码器（零依赖、纯 JS、Node 可测）
 *
 * 背景（V3.36）：大量公司内部标记条码为「自行设定、无行业标准、位数不定」的
 * 一维条码。这类条码绝大多数以 Code39 编码（字母数字均可、宽窄比 2:1~3:1
 * 容差大、无需校验位、长度不限），而 native BarcodeDetector / ZXing 在
 * 低质量印刷或弱光拍摄下经常失败。本模块提供零依赖兜底通道。
 *
 * 能力：
 *   - 标准 Code39 全字符集（0-9 A-Z - . 空格 $ / + % 及 * 起止符）
 *   - 宽窄比自适应（1.6x~3x 均可，按字符段排序动态估计窄宽）
 *   - 无校验位容错；多行投票 + 置信度门槛防随机误报
 *   - 任意长度（内部编号不限位数）
 *
 * 用法（浏览器）：var r = ERP.generic39.decode(gray, width, height);
 * 用法（Node 测试）：require('../js/barcode/generic39.js').decodeRuns(runs)
 *   或 .decode(gray, w, h)；.encodeText('ABC123') 可生成测试用宽度序列。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var mod = factory();
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.generic39 = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- Code39 码表（9 元素：bar1 s1 bar2 s2 bar3 s3 bar4 s4 bar5；
   *                1=宽 0=窄；每字符恰 3 宽 6 窄） ---------------- */
  var SYMBOLS = {
    '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
    '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
    '8': '100100100', '9': '001100100',
    'A': '100001001', 'B': '001001001', 'C': '101001000', 'D': '000011001',
    'E': '100011000', 'F': '001011000', 'G': '000001101', 'H': '100001100',
    'I': '001001100', 'J': '000011100',
    'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
    'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
    'S': '001000110', 'T': '000010110',
    'U': '110000001', 'V': '011000001', 'W': '111000000', 'X': '010010001',
    'Y': '110010000', 'Z': '011010000',
    '-': '010000101', '.': '110000100', ' ': '011000100',
    '$': '010101000', '/': '010100010', '+': '010001010', '%': '000101010',
    '*': '010010100'
  };
  /** 反向映射：9-bit 模式 → 字符 */
  var REVERSE = {};
  Object.keys(SYMBOLS).forEach(function (ch) {
    REVERSE[SYMBOLS[ch]] = ch;
  });

  /** 文本 → Code39 宽度序列（交替 bar/space 宽度，窄=1 宽=2；字符间隔 1 窄 space） */
  function encodeText(text) {
    var s = String(text == null ? '' : text);
    if (s.indexOf('*') >= 0) return null; // * 为保留起止符，不可作为数据字符
    var out = [];
    var chars = '*' + s + '*';
    for (var i = 0; i < chars.length; i++) {
      var pat = SYMBOLS[chars[i]];
      if (!pat) return null;
      for (var j = 0; j < pat.length; j++) out.push(pat[j] === '1' ? 2 : 1);
      if (i < chars.length - 1) out.push(1); // 字符间隔（窄 space）
    }
    return out;
  }

  /**
   * 核心解码：宽度序列 → 文本（纯函数，Node 可测）
   * @param runs {number[]} 交替 bar/space 宽度数组（从 bar 开始）
   * @returns {string|null} 解码文本（不含 *）
   */
  function decodeRuns(runs) {
    if (!runs || runs.length < 20) return null;
    var n = runs.length;
    // 全局窄宽估计：取元素中位数偏小值（Code39 窄元素占多数）
    var sorted = runs.slice().sort(function (a, b) { return a - b; });
    var narrow = sorted[Math.floor(sorted.length * 0.4)];
    if (!narrow || narrow <= 0) return null;
    var wideTh = narrow * 1.6;

    function classify9(start) {
      // start 必须指向 bar（与码表 bar 开头对齐）
      if (start + 9 > n) return null;
      var seg = runs.slice(start, start + 9);
      var s2 = seg.slice().sort(function (a, b) { return a - b; });
      var thr = s2[Math.floor(9 * 0.5)] * 1.6; // 段内窄宽估计
      var bits = '';
      for (var i = 0; i < 9; i++) bits += (seg[i] >= thr) ? '1' : '0';
      // Code39 校验：恰 3 宽 6 窄
      var wide = 0;
      for (i = 0; i < 9; i++) if (bits[i] === '1') wide++;
      if (wide !== 3) return null;
      return REVERSE[bits] || null;
    }

    // 找起始符 '*'：扫描每个可能的 bar 起点（步进 2 元素，保证 bar 对齐）
    var text = '';
    var i = 0;
    var started = false;
    while (i < n - 9) {
      // runs[i] 应为 bar；若非 bar（偶索引为 space 时跳过 1 个）
      var ch = classify9(i);
      if (!started) {
        if (ch === '*') {
          started = true; text = '';
          i += 9;
          if (i < n) i += 1; // 跳过起始符后的字符间隔（窄 space）
        }
        else i += 2; // 未开始：仅步进 bar 起点
        continue;
      }
      if (ch === '*') return text.length ? text : null; // 结束符
      if (ch === null) return null; // 已开始但字符非法 → 本行失败
      text += ch;
      i += 9;
      // 字符间隔：1 个窄 space（跳过；若下一元素不存在则结束）
      if (i < n) i += 1;
    }
    return started && text.length ? text : null;
  }

  /** 灰度图 → 解码（多行投票 + 置信度门槛） */
  function decode(gray, width, height) {
    if (!gray || !width || !height || width < 40 || height < 20) return null;
    var tally = {};
    var lines = 0;
    var y0 = Math.round(height * 0.15);
    var y1 = Math.round(height * 0.85);
    for (var y = y0; y < y1; y += 2) {
      var r = decodeRow(gray, width, height, y);
      lines++;
      if (r) tally[r] = (tally[r] || 0) + 1;
    }
    var best = null, bestVotes = 0;
    for (var key in tally) {
      if (tally[key] > bestVotes) { bestVotes = tally[key]; best = key; }
    }
    if (!best) return null;
    if (bestVotes < 3 || bestVotes < lines * 0.3) return null;
    return { text: best, votes: bestVotes, lines: lines };
  }

  /** 单行：灰度 → 二值化 → run-length → 解码 */
  function decodeRow(gray, width, height, y) {
    try {
      var sum = 0;
      for (var x = 0; x < width; x++) sum += gray[y * width + x];
      var mean = sum / width;
      var black = 0;
      for (x = 0; x < width; x++) if (gray[y * width + x] < mean) black++;
      if (black < width * 0.03 || black > width * 0.97) return null;
      var runs = [];
      var cur = gray[y * width] < mean ? 1 : 0;
      var len = 1;
      for (x = 1; x < width; x++) {
        var v = gray[y * width + x] < mean ? 1 : 0;
        if (v === cur) len++;
        else { runs.push(len); cur = v; len = 1; }
      }
      runs.push(len);
      // 从第一个 bar 开始（若首元素为 space 则丢弃）
      if (runs.length && gray[y * width] >= mean && runs.length > 1) runs.shift();
      return decodeRuns(runs);
    } catch (e) { return null; }
  }

  /** canvas → 灰度（供浏览器端调用；与 ean13 独立实现避免耦合） */
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
    SYMBOLS: SYMBOLS,
    REVERSE: REVERSE,
    encodeText: encodeText,
    decodeRuns: decodeRuns,
    decode: decode,
    decodeRow: decodeRow,
    grayFromCanvas: grayFromCanvas
  };
});
