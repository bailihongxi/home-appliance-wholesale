/**
 * print/bluetooth-label.js —— 蓝牙标签打印模块
 * 支持凝优 LabelPrinter P50 等便携式热敏标签打印机（CPCL 指令集）
 * 通过 Web Bluetooth API 连接 BLE 打印机，生成 CPCL 指令并发送打印
 *
 * 功能：
 *  - 蓝牙设备扫描与连接（navigator.bluetooth）
 *  - 连接状态管理（已连接/未连接/连接中）
 *  - CPCL 指令生成（文本、一维条码、二维码）
 *  - 商品标签打印（品牌、型号、价格、条码）
 *  - 降级方案：不支持蓝牙时生成 CPCL 指令文本供复制
 */
(function (root, factory) {
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var mod = factory(E.util || (isNode ? require('../core/util.js') : null), E);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.btLabel = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, ERP) {
  'use strict';

  /** 打印机状态 */
  var state = {
    device: null,
    server: null,
    characteristic: null,
    connected: false,
    connecting: false,
    lastError: null
  };

  /** 默认标签配置（40×30mm，203 DPI = 8 dots/mm） */
  var DEFAULT_CONFIG = {
    widthMm: 40,
    heightMm: 30,
    dpi: 203,
    density: 8,
    protocol: 'CPCL'
  };

  /** mm 转 dots（203 DPI = 8 dots/mm） */
  function mmToDots(mm, dpi) {
    var d = dpi || 203;
    return Math.round(mm * d / 25.4);
  }

  /** 检查浏览器是否支持 Web Bluetooth */
  function isSupported() {
    return typeof navigator !== 'undefined' && navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function';
  }

  /** 获取当前连接状态 */
  function getState() {
    return {
      supported: isSupported(),
      connected: state.connected,
      connecting: state.connecting,
      deviceName: state.device ? state.device.name : null,
      lastError: state.lastError
    };
  }

  /** 扫描并连接蓝牙打印机
   *  凝优 P50 等打印机通常使用 SPP 或自定义 BLE Service
   *  尝试常见的串口服务 UUID 和打印机服务 UUID
   */
  function connect() {
    return new Promise(function (resolve, reject) {
      if (!isSupported()) {
        var err = new Error('当前浏览器不支持 Web Bluetooth，请使用 Chrome/Edge 浏览器，或通过 HTTPS 访问');
        state.lastError = err.message;
        reject(err);
        return;
      }
      state.connecting = true;
      state.lastError = null;

      // 常见打印机 BLE Service UUID
      var optionalServices = [
        '00001101-0000-1000-8000-00805f9b34fb', // SPP (Serial Port Profile)
        '0000ffe0-0000-1000-8000-00805f9b34fb', // 常见打印机 Service
        '0000fff0-0000-1000-8000-00805f9b34fb', // 另一种常见 Service
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // 部分打印机自定义
        '0000abf0-0000-1000-8000-00805f9b34fb'
      ];

      navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: optionalServices
      })
        .then(function (device) {
          state.device = device;
          device.addEventListener('gattserverdisconnected', onDisconnected);
          return device.gatt.connect();
        })
        .then(function (server) {
          state.server = server;
          return findWritableCharacteristic(server);
        })
        .then(function (char) {
          state.characteristic = char;
          state.connected = true;
          state.connecting = false;
          resolve(getState());
        })
        .catch(function (err) {
          state.connecting = false;
          state.lastError = err.message || String(err);
          reject(err);
        });
    });
  }

  /** 在 GATT Server 中查找可写特征值 */
  function findWritableCharacteristic(server) {
    return server.getPrimaryServices().then(function (services) {
      var chain = Promise.resolve(null);
      services.forEach(function (service) {
        chain = chain.then(function (found) {
          if (found) return found;
          return service.getCharacteristics().then(function (chars) {
            for (var i = 0; i < chars.length; i++) {
              var c = chars[i];
              if (c.properties.write || c.properties.writeWithoutResponse) {
                return c;
              }
            }
            return null;
          }).catch(function () { return null; });
        });
      });
      return chain.then(function (char) {
        if (!char) throw new Error('未找到可写特征值，请确认打印机已开机并处于可连接状态');
        return char;
      });
    });
  }

  /** 断开连接 */
  function disconnect() {
    try {
      if (state.device && state.device.gatt && state.device.gatt.connected) {
        state.device.gatt.disconnect();
      }
    } catch (e) { /* ignore */ }
    onDisconnected();
  }

  function onDisconnected() {
    state.connected = false;
    state.characteristic = null;
    state.server = null;
  }

  /** 发送数据到打印机（分块发送，避免 MTU 限制） */
  function sendData(data) {
    if (!state.connected || !state.characteristic) {
      return Promise.reject(new Error('打印机未连接'));
    }
    var chunkSize = 500; // 每次发送不超过 500 字节
    var chunks = [];
    for (var i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }
    return chunks.reduce(function (chain, chunk) {
      return chain.then(function () {
        return state.characteristic.writeValueWithoutResponse
          ? state.characteristic.writeValueWithoutResponse(chunk)
          : state.characteristic.writeValue(chunk);
      });
    }, Promise.resolve());
  }

  /** 生成 CPCL 标签指令
   *  @param items Array<{text?:string, x?:number, y?:number, font?:number, size?:number,
   *                       barcode?:string, barcodeType?:string, height?:number,
   *                       qrcode?:string, qrSize?:number}>
   *  @param config {widthMm, heightMm, dpi, density, copies}
   *  @returns Uint8Array CPCL 指令字节
   */
  function buildCpclLabel(items, config) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    var w = mmToDots(config.widthMm, config.dpi);
    var h = mmToDots(config.heightMm, config.dpi);
    var copies = config.copies || 1;

    var lines = [];
    // CPCL 头部：! 0 <dpi_x> <dpi_y> <height_dots> <copies>
    lines.push('! 0 ' + config.dpi + ' ' + config.dpi + ' ' + h + ' ' + copies);
    // 打印浓度
    lines.push('DENSITY ' + (config.density || 8));
    // 纸张宽度
    lines.push('PAGE-WIDTH ' + w);

    items.forEach(function (item) {
      if (item.text !== undefined && item.text !== null) {
        var font = item.font || 4;
        var size = item.size || 0;
        var x = item.x || 10;
        var y = item.y || 10;
        lines.push('TEXT ' + font + ' ' + size + ' ' + x + ' ' + y + ' ' + String(item.text));
      }
      if (item.barcode) {
        var bcType = item.barcodeType || 'CODE128';
        var bcHeight = item.height || 60;
        var bcX = item.x || 10;
        var bcY = item.y || 80;
        lines.push('BARCODE ' + bcType + ' ' + bcHeight + ' ' + bcX + ' ' + bcY + ' ' + item.barcode);
      }
      if (item.qrcode) {
        var qrX = item.x || 10;
        var qrY = item.y || 80;
        var qrSize = item.qrSize || 4;
        lines.push('QRCODE ' + qrX + ' ' + qrY + ' M ' + qrSize + ' ' + item.qrcode);
      }
    });

    lines.push('PRINT');
    lines.push('');

    // 转为 Uint8Array（UTF-8 编码；若打印机需 GBK，可在此处替换编码逻辑）
    var text = lines.join('\r\n');
    var bytes;
    if (typeof TextEncoder !== 'undefined') {
      bytes = new TextEncoder().encode(text);
    } else {
      // Node 环境降级
      bytes = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) {
        bytes[i] = text.charCodeAt(i) & 0xFF;
      }
    }
    return bytes;
  }

  /** 生成商品标签 CPCL 指令
   *  @param product {brand, model, priceWholesale, priceRetail, barcodes}
   *  @param config 标签配置
   *  @param opts {showPrice: 'wholesale'|'retail'|'both'|'none'}
   */
  function buildProductLabel(product, config, opts) {
    opts = opts || {};
    config = Object.assign({}, DEFAULT_CONFIG, config || {});
    var h = mmToDots(config.heightMm, config.dpi);
    var items = [];
    var y = 8;

    // 品牌
    if (product.brand) {
      items.push({ text: product.brand, x: 8, y: y, font: 5, size: 0 });
      y += 28;
    }
    // 型号
    if (product.model) {
      items.push({ text: product.model, x: 8, y: y, font: 4, size: 0 });
      y += 24;
    }
    // 价格
    var priceText = '';
    if (opts.showPrice === 'wholesale' && product.priceWholesale) {
      priceText = '批发: ' + formatPrice(product.priceWholesale);
    } else if (opts.showPrice === 'retail' && product.priceRetail) {
      priceText = '零售: ' + formatPrice(product.priceRetail);
    } else if (opts.showPrice === 'both') {
      if (product.priceWholesale) priceText += '批:' + formatPrice(product.priceWholesale) + ' ';
      if (product.priceRetail) priceText += '零:' + formatPrice(product.priceRetail);
    }
    if (priceText) {
      items.push({ text: priceText, x: 8, y: y, font: 5, size: 0 });
      y += 28;
    }

    // 条码
    var barcode = product.barcodes && product.barcodes[0];
    if (barcode) {
      var bcHeight = Math.min(h - y - 10, 50);
      if (bcHeight > 20) {
        items.push({ barcode: barcode, x: 8, y: y, height: bcHeight, barcodeType: 'CODE128' });
      }
    }

    return buildCpclLabel(items, config);
  }

  function formatPrice(cents) {
    if (cents == null) return '';
    return (Number(cents) / 100).toFixed(2);
  }

  /** 打印商品标签
   *  @param product 商品对象
   *  @param config 标签配置（从 ctx.settings.label/print 读取）
   *  @param opts {showPrice, copies}
   */
  function printProductLabel(product, config, opts) {
    if (!state.connected) {
      return Promise.reject(new Error('打印机未连接，请先在「设置」中连接蓝牙打印机'));
    }
    var data = buildProductLabel(product, config, opts);
    return sendData(data);
  }

  /** 打印自定义 CPCL 指令 */
  function printCpcl(items, config) {
    if (!state.connected) {
      return Promise.reject(new Error('打印机未连接'));
    }
    var data = buildCpclLabel(items, config);
    return sendData(data);
  }

  /** 获取 CPCL 指令文本（降级方案：不支持蓝牙时供复制） */
  function getCpclText(product, config, opts) {
    var data = buildProductLabel(product, config, opts);
    var text = '';
    for (var i = 0; i < data.length; i++) {
      text += String.fromCharCode(data[i]);
    }
    return text;
  }

  return {
    isSupported: isSupported,
    getState: getState,
    connect: connect,
    disconnect: disconnect,
    sendData: sendData,
    buildCpclLabel: buildCpclLabel,
    buildProductLabel: buildProductLabel,
    printProductLabel: printProductLabel,
    printCpcl: printCpcl,
    getCpclText: getCpclText,
    mmToDots: mmToDots,
    DEFAULT_CONFIG: DEFAULT_CONFIG
  };
});
