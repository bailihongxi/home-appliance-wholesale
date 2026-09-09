/**
 * generic39.test.js —— V3.36 自研 Code39 解码器测试
 * 公司内部标记条码：自行设定、无行业标准、位数不定，绝大多数以 Code39 编码。
 * 本测试覆盖：往返解码、宽窄比自适应、无起始符拒绝、灰度图多行投票、非法字符。
 */
const test = require('node:test');
const assert = require('node:assert');
const g39 = require('../js/barcode/generic39.js');

/* ---------- 往返：encodeText → decodeRuns ---------- */

test('Code39 往返：纯数字内部码（位数不定）', () => {
  ['20260909', '10001', '7', '00998877665544332211'].forEach(t => {
    const runs = g39.encodeText(t);
    assert.ok(runs, '可编码 ' + t);
    assert.strictEqual(g39.decodeRuns(runs), t);
  });
});

test('Code39 往返：字母+数字+常用符号混合码', () => {
  ['HD-1024', 'ABC123', 'MIXED.CODE 42', 'SUPPLIER/01', 'A+B', 'X%Y'].forEach(t => {
    const runs = g39.encodeText(t);
    assert.ok(runs, '可编码 ' + t);
    assert.strictEqual(g39.decodeRuns(runs), t);
  });
});

test('Code39 宽窄比自适应：3:1 宽窄同样可解（2:1~3:1 打印机均可）', () => {
  const t = 'GD2026-09';
  const runs = g39.encodeText(t).map(v => (v === 2 ? 3 : 1));
  assert.strictEqual(g39.decodeRuns(runs), t);
});

/* ---------- 拒绝与容错 ---------- */

test('Code39 无起始符/乱数据 → null（不误报）', () => {
  assert.strictEqual(g39.decodeRuns([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), null, '等宽全 1 无法构成 Code39');
  assert.strictEqual(g39.decodeRuns(null), null);
  assert.strictEqual(g39.decodeRuns([]), null);
  assert.strictEqual(g39.decodeRuns([2, 1, 2]), null, '过短序列');
});

test('Code39 内容含 *（保留起止符）→ 不可作为数据编码', () => {
  assert.strictEqual(g39.encodeText('O*X'), null);
});

/* ---------- 灰度图解码（多行投票 + 置信度门槛） ---------- */

/** 合成 Code39 灰度条码：中心多行绘制，验证 decodeRow / decode 投票 */
function synthGray(text, opts) {
  opts = opts || {};
  const w = opts.w || 2000, h = opts.h || 90, px = opts.px || 6;
  const runs = g39.encodeText(text);
  assert.ok(runs, '可编码 ' + text);
  const gray = new Uint8Array(w * h).fill(255);
  let x = 120, idx = 0;
  runs.forEach(len => {
    const black = (idx % 2 === 0);
    for (let k = 0; k < len * px; k++) if (x + k < w && black) gray[45 * w + x + k] = 0;
    x += len * px; idx++;
  });
  for (let y = 35; y < 55; y++) for (let xx = 120; xx < x; xx++) gray[y * w + xx] = gray[45 * w + xx];
  return { gray, w, h };
}

test('decode：灰度条码图解出内部码（多行投票）', () => {
  const { gray, w, h } = synthGray('20260909001');
  const r = g39.decode(gray, w, h);
  assert.ok(r, '应解码成功');
  assert.strictEqual(r.text, '20260909001');
  assert.ok(r.votes >= 3, '投票数足够');
});

test('decode：无条码纯白图 → null（不误报）', () => {
  const gray = new Uint8Array(800 * 80).fill(255);
  assert.strictEqual(g39.decode(gray, 800, 80), null);
});

test('decodeRow：窄宽比 2:1 合成行可解', () => {
  const { gray, w, h } = synthGray('HD-1024');
  const r = g39.decodeRow(gray, w, h, 45);
  assert.strictEqual(r, 'HD-1024');
});

/* ---------- 码表完整性 ---------- */

test('Code39 码表：44 符号（43 数据字符 + 起止符 *），恰 3 宽 6 窄', () => {
  assert.strictEqual(Object.keys(g39.SYMBOLS).length, 44);
  Object.keys(g39.SYMBOLS).forEach(ch => {
    const pat = g39.SYMBOLS[ch];
    assert.strictEqual(pat.length, 9, '9 元素');
    assert.strictEqual(pat.split('1').length - 1, 3, '恰 3 宽');
    assert.strictEqual(pat.split('0').length - 1, 6, '恰 6 窄');
  });
  assert.strictEqual(g39.REVERSE[g39.SYMBOLS['*']], '*', '起止符可识别');
});
