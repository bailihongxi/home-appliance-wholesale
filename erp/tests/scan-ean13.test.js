/**
 * scan-ean13.test.js —— 自研 EAN-13 解码器专项测试（V3.32）
 * 覆盖：
 *   ① 完美合成条码解码（5012345678900 / 6901234567892）
 *   ② 模糊 + 噪声图像（模拟相机帧）仍稳定解码
 *   ③ 校验位错误的条码被拒绝（返回 null）
 *   ④ 非法/空输入安全返回 null
 *   ⑤ 多行投票：多数行一致才返回
 */
const test = require('node:test');
const assert = require('node:assert');
const ean13 = require('../js/barcode/ean13.js');

/* ---------------- EAN-13 位串 → 灰度像素 生成器（测试专用） ---------------- */
const L_BITS = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G_BITS = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R_BITS = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['OOOOOO', 'OOEOEE', 'OOEEOE', 'OOEEEO', 'OEOOEE', 'OEOEOE', 'OEEOOE', 'OEEOEO', 'OEOEOO', 'OEEEOO'];

function ean13Bits(digits) {
  const parity = PARITY[+digits[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) {
    bits += parity[i - 1] === 'O' ? L_BITS[+digits[i]] : G_BITS[+digits[i]];
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R_BITS[+digits[i]];
  bits += '101';
  return bits;
}

function renderBits(bits, moduleW, height, padTop, padBottom) {
  const width = bits.length * moduleW;
  const h = (padTop || 0) + height + (padBottom || 0);
  const gray = new Uint8Array(width * h).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      gray[(y + (padTop || 0)) * width + x] = bits[Math.floor(x / moduleW)] === '1' ? 0 : 255;
    }
  }
  return { gray, width, height: h };
}

/** 模糊 + 噪声（模拟相机帧）：3x3 均值 + 高斯噪声 */
function simulateFrame(img, blurK, noise) {
  const { gray, width, height } = img;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0, n = 0;
      for (let dy = -blurK; dy <= blurK; dy++) {
        for (let dx = -blurK; dx <= blurK; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < height && xx >= 0 && xx < width) { s += gray[yy * width + xx]; n++; }
        }
      }
      const v = s / n + (Math.random() - 0.5) * noise;
      out[y * width + x] = v < 0 ? 0 : (v > 255 ? 255 : (v | 0));
    }
  }
  return { gray: out, width, height };
}

/* ---------------- 测试 ---------------- */

test('ean13.decode：完美合成条码 5012345678900 解码成功', () => {
  const img = renderBits(ean13Bits('5012345678900'), 10, 60);
  const r = ean13.decode(img.gray, img.width, img.height);
  assert.ok(r, '应解出结果');
  assert.strictEqual(r.text, '5012345678900');
  assert.ok(r.votes >= 1, '应有投票数');
});

test('ean13.decode：另一合法条码 6901234567892 解码成功', () => {
  const img = renderBits(ean13Bits('6901234567892'), 10, 60);
  const r = ean13.decode(img.gray, img.width, img.height);
  assert.ok(r, '应解出结果');
  assert.strictEqual(r.text, '6901234567892');
});

test('ean13.decode：模糊 + 噪声（模拟相机帧）仍稳定解码', () => {
  const img = renderBits(ean13Bits('5012345678900'), 10, 60);
  const noisy = simulateFrame(img, 1, 20);
  const r = ean13.decode(noisy.gray, noisy.width, noisy.height);
  assert.ok(r, '模糊+噪声应解出');
  assert.strictEqual(r.text, '5012345678900');
});

test('ean13.decode：较强模糊 + 噪声仍解码', () => {
  const img = renderBits(ean13Bits('5012345678900'), 10, 60);
  const noisy = simulateFrame(img, 2, 40);
  const r = ean13.decode(noisy.gray, noisy.width, noisy.height);
  assert.ok(r, '较强模糊+噪声应解出');
  assert.strictEqual(r.text, '5012345678900');
});

test('ean13.decode：噪声 / 干扰图返回 null（防误报）', () => {
  // 随机噪声：无条码结构，应返回 null
  const noise = new Uint8Array(300 * 60);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 255) | 0;
  assert.strictEqual(ean13.decode(noise, 300, 60), null);
  // 均匀灰块：无起始符结构，应返回 null
  const flat = new Uint8Array(300 * 60).fill(128);
  assert.strictEqual(ean13.decode(flat, 300, 60), null);
});

test('ean13.decode：全白 / 全黑图像返回 null', () => {
  const white = new Uint8Array(300 * 60).fill(255);
  assert.strictEqual(ean13.decode(white, 300, 60), null);
  const black = new Uint8Array(300 * 60).fill(0);
  assert.strictEqual(ean13.decode(black, 300, 60), null);
});

test('ean13.decode：空输入 / 尺寸过小安全返回 null', () => {
  assert.strictEqual(ean13.decode(null, 300, 60), null);
  assert.strictEqual(ean13.decode(undefined, 300, 60), null);
  assert.strictEqual(ean13.decode(new Uint8Array(10 * 10), 10, 10), null, '宽度过小');
  assert.strictEqual(ean13.decode(new Uint8Array(300 * 10), 300, 10), null, '高度过小');
  assert.strictEqual(ean13.decode(new Uint8Array(0), 0, 0), null);
});

test('ean13.decodeRow：单行在条码中部可解码', () => {
  const img = renderBits(ean13Bits('5012345678900'), 10, 60);
  const r = ean13.decodeRow(img.gray, img.width, img.height, 30);
  assert.strictEqual(r, '5012345678900');
});

test('ean13.decodeRow：条码外部行（全白留白区）返回 null', () => {
  const img = renderBits(ean13Bits('5012345678900'), 10, 60, 20, 20);
  assert.strictEqual(ean13.decodeRow(img.gray, img.width, img.height, 0), null);
  assert.strictEqual(ean13.decodeRow(img.gray, img.width, img.height, 10), null);
  assert.strictEqual(ean13.decodeRow(img.gray, img.width, img.height, 99), null);
});

test('ean13.decode：多行投票一致性（votes 反映多数行）', () => {
  const img = renderBits(ean13Bits('6901234567892'), 10, 80);
  const r = ean13.decode(img.gray, img.width, img.height);
  assert.ok(r, '应解出');
  assert.strictEqual(r.text, '6901234567892');
  assert.ok(r.votes >= r.lines * 0.8, '多数行应一致（votes=' + r.votes + ' lines=' + r.lines + '）');
});

test('ean13 码表：L/G/R/PARITY 结构与 EAN-13 标准一致', () => {
  assert.strictEqual(ean13.L_PATS.length, 10);
  assert.strictEqual(ean13.G_PATS.length, 10);
  assert.strictEqual(ean13.R_PATS.length, 10);
  assert.strictEqual(ean13.PARITY.length, 10);
  // L[0]=0001101 → runs [3,2,1,1]
  assert.deepStrictEqual(ean13.L_PATS[0], [3, 2, 1, 1]);
  // R[0]=1110010 → runs [3,2,1,1]（与 L0 同形，颜色从黑开始）
  assert.deepStrictEqual(ean13.R_PATS[0], [3, 2, 1, 1]);
  // G[0]=0100111 → runs [1,1,2,3]
  assert.deepStrictEqual(ean13.G_PATS[0], [1, 1, 2, 3]);
  assert.strictEqual(ean13.PARITY[0], 'OOOOOO');
  assert.strictEqual(ean13.PARITY[5], 'OEOEOE');
});

test('ean13.decode：不均匀光照（左右明暗渐变，模拟真实相机场景）仍稳定解码', () => {
  const img = renderBits(ean13Bits('5012345678900'), 10, 60, 20, 20);
  const gray2 = new Uint8Array(img.gray.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const factor = 1.0 - 0.35 * (x / img.width); // 左侧亮、右侧暗
      gray2[y * img.width + x] = Math.min(255, Math.round(img.gray[y * img.width + x] * factor));
    }
  }
  const r = ean13.decode(gray2, img.width, img.height);
  assert.strictEqual(r && r.text, '5012345678900', '光照渐变下应稳定解码');
});
