/**
 * scan-realtime.test.js —— 扫码实时识别修复专项测试（V3.28）
 * 覆盖：
 *   ① buildFormats：实时识别码制列表
 *   ② pickDecoders：拍照解码优先级（原生 BarcodeDetector 优先，ZXing 兜底）
 *   ③ needDowngrade：空转 12 秒 / 连续异常 5 次 → 自动降级
 *   ④ closeCamera：摄像头流统一释放（修复二次打开黑屏）
 */
const test = require('node:test');
const assert = require('node:assert');
const scan = require('../js/barcode/scan.js');

test('scan.buildFormats：包含常见一维码与二维码码制', () => {
  const f = scan.buildFormats();
  assert.ok(Array.isArray(f));
  ['code_128', 'ean_13', 'ean_8', 'code_39', 'qr_code', 'itf'].forEach(k => {
    assert.ok(f.includes(k), '应包含 ' + k);
  });
});

test('scan.pickDecoders：原生 BarcodeDetector 优先，ZXing 兜底', () => {
  assert.deepStrictEqual(scan.pickDecoders({ native: true, zxing: true }), ['native', 'zxing']);
  assert.deepStrictEqual(scan.pickDecoders({ native: false, zxing: true }), ['zxing']);
  assert.deepStrictEqual(scan.pickDecoders({ native: true, zxing: false }), ['native']);
  assert.deepStrictEqual(scan.pickDecoders({}), []);
  assert.deepStrictEqual(scan.pickDecoders(null), []);
});

test('scan.needDowngrade：连续空转达到阈值 → 降级', () => {
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 59, errorFrames: 0, firstEmptyAt: 0 }), false);
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 60, errorFrames: 0, firstEmptyAt: 0 }), true, '空转60帧应降级');
});

test('scan.needDowngrade：连续异常达到阈值 → 降级（设备实时识别不可用）', () => {
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 0, errorFrames: 4, firstEmptyAt: 0 }), false);
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 0, errorFrames: 5, firstEmptyAt: 0 }), true, '异常5次应降级');
});

test('scan.needDowngrade：自首次空转起超过 12 秒 → 降级（时间兜底）', () => {
  const start = Date.now() - 5000; // 5秒，远未到12秒阈值
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 10, errorFrames: 0, firstEmptyAt: start }), false);
  const start2 = Date.now() - 13000; // 13秒，超过12秒阈值
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 10, errorFrames: 0, firstEmptyAt: start2 }), true, '超12秒应降级');
});

test('scan.needDowngrade：空输入 / 正常状态不降级', () => {
  assert.strictEqual(scan.needDowngrade(), false);
  assert.strictEqual(scan.needDowngrade(null), false);
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 0, errorFrames: 0, firstEmptyAt: 0 }), false);
  assert.strictEqual(scan.needDowngrade({ emptyFrames: 5, errorFrames: 1, firstEmptyAt: Date.now() }), false);
});

test('scan.closeCamera：统一释放摄像头流（所有轨道 stop）', () => {
  const stopped = [];
  const fakeStream = {
    getTracks() {
      return [{ stop() { stopped.push('t1'); } }, { stop() { stopped.push('t2'); } }];
    }
  };
  assert.strictEqual(scan.closeCamera(fakeStream), true);
  assert.deepStrictEqual(stopped, ['t1', 't2'], '所有轨道应被 stop');
});

test('scan.closeCamera：空流 / 无 getTracks 安全返回 false', () => {
  assert.strictEqual(scan.closeCamera(null), false);
  assert.strictEqual(scan.closeCamera(undefined), false);
  assert.strictEqual(scan.closeCamera({}), false);
  assert.strictEqual(scan.closeCamera({ getTracks: 'not-a-function' }), false);
});

test('scan.closeCamera：幂等（重复调用不报错）', () => {
  const fakeStream = { getTracks() { return [{ stop() {} }]; } };
  assert.strictEqual(scan.closeCamera(fakeStream), true);
  assert.strictEqual(scan.closeCamera(fakeStream), true);
  assert.strictEqual(scan.closeCamera(fakeStream), true);
});
