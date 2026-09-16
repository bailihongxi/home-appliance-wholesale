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

test('scan.pickDecoders：原生 BarcodeDetector 优先，自研 EAN-13 其次，ZXing 兜底', () => {
  assert.deepStrictEqual(scan.pickDecoders({ native: true, zxing: true }), ['native', 'zxing']);
  assert.deepStrictEqual(scan.pickDecoders({ native: false, zxing: true }), ['zxing']);
  assert.deepStrictEqual(scan.pickDecoders({ native: true, zxing: false }), ['native']);
  assert.deepStrictEqual(scan.pickDecoders({}), []);
  assert.deepStrictEqual(scan.pickDecoders(null), []);
});

test('scan.pickDecoders：显式启用 ean13 通道时加入（native → ean13 → zxing）', () => {
  assert.deepStrictEqual(scan.pickDecoders({ native: true, ean13: true, zxing: true }), ['native', 'ean13', 'zxing']);
  assert.deepStrictEqual(scan.pickDecoders({ ean13: true }), ['ean13']);
  assert.deepStrictEqual(scan.pickDecoders({ native: true, ean13: true }), ['native', 'ean13']);
  assert.deepStrictEqual(scan.pickDecoders({ native: false, ean13: true, zxing: true }), ['ean13', 'zxing']);
  assert.deepStrictEqual(scan.pickDecoders({ ean13: false, zxing: true }), ['zxing']);
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

test('scan.isBlackOut：无画面帧且超过 2.5 秒 → 黑屏降级', () => {
  const now = Date.now();
  assert.strictEqual(scan.isBlackOut(0, now - 2500, now), true, '无帧且满2.5秒应降级');
  assert.strictEqual(scan.isBlackOut(0, now - 3000, now), true);
  assert.strictEqual(scan.isBlackOut(0, now - 2499, now), false, '未到2.5秒不降级');
  assert.strictEqual(scan.isBlackOut(640, now - 10000, now), false, '有帧永不黑屏');
  assert.strictEqual(scan.isBlackOut(1280, now - 1000, now), false);
});

test('scan.shouldCountError：仅画面正常时计数异常（黑屏异常不计数）', () => {
  assert.strictEqual(scan.shouldCountError(0), false, '黑屏期间异常不计数，交给黑屏检测');
  assert.strictEqual(scan.shouldCountError(undefined), false);
  assert.strictEqual(scan.shouldCountError(null), false);
  assert.strictEqual(scan.shouldCountError(1), true);
  assert.strictEqual(scan.shouldCountError(640), true);
});

test('scan.shouldSwitchFrame：实时模式 detect 连续异常 3 次 → 切抓帧模式（画面保留）', () => {
  assert.strictEqual(scan.shouldSwitchFrame('video', 2), false, '2次异常不切换');
  assert.strictEqual(scan.shouldSwitchFrame('video', 3), true, '3次异常切换抓帧');
  assert.strictEqual(scan.shouldSwitchFrame('video', 5), true);
  assert.strictEqual(scan.shouldSwitchFrame('frame', 3), false, '已在抓帧模式不重复切换');
  assert.strictEqual(scan.shouldSwitchFrame('frame', 10), false);
});

test('scan.frameDue：抓帧节流（默认 500ms 间隔）', () => {
  const now = Date.now();
  assert.strictEqual(scan.frameDue(0, now, 500), true, '首帧立即抓');
  assert.strictEqual(scan.frameDue(now - 499, now, 500), false, '未到间隔不抓');
  assert.strictEqual(scan.frameDue(now - 500, now, 500), true, '满间隔可抓');
  assert.strictEqual(scan.frameDue(now - 1000, now, 500), true);
  assert.strictEqual(scan.frameDue(now - 1000, now), true, '默认500ms');
  assert.strictEqual(scan.frameDue(now - 100, now), false);
});

test('scan.decodeWith：native 挂起超时后 ZXing 兜底成功（华为浏览器半实现场景）', async () => {
  const old = scan.NATIVE_TIMEOUT_MS;
  scan.NATIVE_TIMEOUT_MS = 50;
  try {
    const nativeDetect = () => {}; // 永不回调：模拟 detect() 挂起
    let zxingCalled = false;
    const zxingDecode = (src, cb) => { zxingCalled = true; cb(true, '5012345678900'); };
    const r = await new Promise((res) => {
      scan.decodeWith(null, (ok, text) => res({ ok, text }), {
        native: { available: true, detect: nativeDetect },
        zxing: { available: true, decode: zxingDecode }
      });
    });
    assert.strictEqual(r.ok, true, '超时后应交给 ZXing 并成功');
    assert.strictEqual(r.text, '5012345678900');
    assert.strictEqual(zxingCalled, true, 'ZXing 兜底必须被调用');
  } finally { scan.NATIVE_TIMEOUT_MS = old; }
});

test('scan.decodeWith：native 快速失败后 ZXing 兜底成功', async () => {
  const nativeDetect = (src, cb) => cb(false);
  const zxingDecode = (src, cb) => cb(true, '6901234567892');
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok, text) => res({ ok, text }), {
      native: { available: true, detect: nativeDetect },
      zxing: { available: true, decode: zxingDecode }
    });
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, '6901234567892');
});

test('scan.decodeWith：native 快速成功时不再等待 ZXing', async () => {
  const nativeDetect = (src, cb) => cb(true, 'qr-text-ok');
  let zxingCalled = false;
  const zxingDecode = (src, cb) => { zxingCalled = true; cb(false); };
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok, text) => res({ ok, text }), {
      native: { available: true, detect: nativeDetect },
      zxing: { available: true, decode: zxingDecode }
    });
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'qr-text-ok');
  assert.strictEqual(zxingCalled, false, 'native 成功不应调用 ZXing');
});

test('scan.decodeWith：双通道均失败 → done(false)', async () => {
  const nativeDetect = (src, cb) => cb(false);
  const zxingDecode = (src, cb) => cb(false);
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok) => res({ ok }), {
      native: { available: true, detect: nativeDetect },
      zxing: { available: true, decode: zxingDecode }
    });
  });
  assert.strictEqual(r.ok, false);
});

test('scan.decodeWith：native 不可用时仅走 ZXing', async () => {
  let zxingCalled = false;
  const zxingDecode = (src, cb) => { zxingCalled = true; cb(true, 'zx-only'); };
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok, text) => res({ ok, text }), {
      native: { available: false, detect: null },
      zxing: { available: true, decode: zxingDecode }
    });
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'zx-only');
  assert.strictEqual(zxingCalled, true);
});

test('scan.decodeWith：均不可用 → done(false) 不抛错', async () => {
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok) => res({ ok }), {
      native: { available: false, detect: null },
      ean13: { available: false, decode: null },
      zxing: { available: false, decode: null }
    });
  });
  assert.strictEqual(r.ok, false);
});

test('scan.decodeWith：native 失败 → 自研 EAN-13 成功（不等待 ZXing）', async () => {
  const nativeDetect = (src, cb) => cb(false);
  let ean13Called = false;
  let zxingCalled = false;
  const ean13Decode = (src, cb) => { ean13Called = true; cb(true, '5012345678900'); };
  const zxingDecode = (src, cb) => { zxingCalled = true; cb(false); };
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok, text) => res({ ok, text }), {
      native: { available: true, detect: nativeDetect },
      ean13: { available: true, decode: ean13Decode },
      zxing: { available: true, decode: zxingDecode }
    });
  });
  assert.strictEqual(r.ok, true, 'ean13 通道应成功');
  assert.strictEqual(r.text, '5012345678900');
  assert.strictEqual(ean13Called, true, 'ean13 必须被调用');
  assert.strictEqual(zxingCalled, false, 'ean13 成功不应调用 ZXing');
});

test('scan.decodeWith：native 挂起超时 → 自研 EAN-13 兜底成功（华为浏览器半实现场景）', async () => {
  const old = scan.NATIVE_TIMEOUT_MS;
  scan.NATIVE_TIMEOUT_MS = 50;
  try {
    const nativeDetect = () => {}; // 永不回调：模拟 detect() 挂起
    let ean13Called = false;
    const ean13Decode = (src, cb) => { ean13Called = true; cb(true, '6901234567892'); };
    const r = await new Promise((res) => {
      scan.decodeWith(null, (ok, text) => res({ ok, text }), {
        native: { available: true, detect: nativeDetect },
        ean13: { available: true, decode: ean13Decode },
        zxing: { available: true, decode: (src, cb) => cb(false) }
      });
    });
    assert.strictEqual(r.ok, true, '超时后应交给 ean13 并成功');
    assert.strictEqual(r.text, '6901234567892');
    assert.strictEqual(ean13Called, true, 'ean13 兜底必须被调用');
  } finally { scan.NATIVE_TIMEOUT_MS = old; }
});

test('scan.decodeWith：native 与 ean13 均失败 → ZXing 最后兜底', async () => {
  const nativeDetect = (src, cb) => cb(false);
  const ean13Decode = (src, cb) => cb(false);
  let zxingCalled = false;
  const zxingDecode = (src, cb) => { zxingCalled = true; cb(true, 'zx-fallback'); };
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok, text) => res({ ok, text }), {
      native: { available: true, detect: nativeDetect },
      ean13: { available: true, decode: ean13Decode },
      zxing: { available: true, decode: zxingDecode }
    });
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'zx-fallback');
  assert.strictEqual(zxingCalled, true, 'ZXing 应作为最后兜底被调用');
});

test('scan.decodeWith：ean13 不可用时跳过，native → zxing 正常', async () => {
  const nativeDetect = (src, cb) => cb(true, 'native-ok');
  const ean13Decode = () => { throw new Error('不应被调用'); };
  let zxingCalled = false;
  const zxingDecode = (src, cb) => { zxingCalled = true; cb(false); };
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok, text) => res({ ok, text }), {
      native: { available: true, detect: nativeDetect },
      ean13: { available: false, decode: ean13Decode },
      zxing: { available: true, decode: zxingDecode }
    });
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'native-ok');
  assert.strictEqual(zxingCalled, false);
});

/* ---------- V3.36：自研 Code39 通道（公司内部自定义条码） ---------- */

test('scan.pickDecoders：显式启用 code39 通道时加入（native → ean13 → code39 → zxing）', () => {
  assert.deepStrictEqual(scan.pickDecoders({ native: true, ean13: true, code39: true, zxing: true }), ['native', 'ean13', 'code39', 'zxing']);
  assert.deepStrictEqual(scan.pickDecoders({ code39: true }), ['code39']);
  assert.deepStrictEqual(scan.pickDecoders({ native: true, code39: true }), ['native', 'code39']);
  assert.deepStrictEqual(scan.pickDecoders({ code39: false, zxing: true }), ['zxing']);
});

test('scan.decodeWith：code39 通道成功（内部自定义条码文本原样透出）', async () => {
  const code39Decode = (src, cb) => cb(true, 'HD-1024'); // 模拟扫出 Code39 内部码
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok, text) => res({ ok, text }), {
      code39: { available: true, decode: code39Decode }
    });
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, 'HD-1024');
});

test('scan.decodeWith：code39 在 ean13 之后、zxing 之前调用', async () => {
  const calls = [];
  const r = await new Promise((res) => {
    scan.decodeWith(null, (ok) => res({ ok }), {
      native: { available: true, detect: (src, cb) => { calls.push('native'); cb(false); } },
      ean13: { available: true, decode: (src, cb) => { calls.push('ean13'); cb(false); } },
      code39: { available: true, decode: (src, cb) => { calls.push('code39'); cb(false); } },
      zxing: { available: true, decode: (src, cb) => { calls.push('zxing'); cb(false); } }
    });
  });
  assert.deepStrictEqual(calls, ['native', 'ean13', 'code39', 'zxing']);
  assert.strictEqual(r.ok, false);
});
