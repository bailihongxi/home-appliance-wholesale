/**
 * sw.js —— Service Worker（仅 https 托管时生效，file:// 双击无效）
 * 作用：缓存应用外壳，断网后仍可打开使用（PRD 7 / 开发计划 Sprint 8）。
 * 更新策略（V3.34 起）：导航与静态资源全部 network-first——在线一律拿最新
 * 页面与资源（新功能一次打开即生效，杜绝「旧缓存卡版本」），离线回退缓存外壳。
 */
var CACHE = 'appliance-erp-v68';
var SHELL = [
  './',
  './index.html',
  './css/base.css',
  './css/mobile.css',
  './css/desktop.css',
  './css/print.css',
  './js/core/util.js',
  './js/core/schema.js',
  './js/core/docNo.js',
  './js/core/product.js',
  './js/core/inventory.js',
  './js/core/ledger.js',
  './js/core/debt.js',
  './js/core/profit.js',
  './js/core/backup.js',
  './js/core/sync.js',
  './js/core/cart.js',
  './js/core/engine.js',
  './js/core/accounts.js',
  './js/core/legacy-migrate.js',
  './js/store/db.js',
  './js/store/repo.js',
  './js/ui/router.js',
  './js/ui/print-doc.js',
  './js/ui/components.js',
  './js/ui/page-home.js',
  './js/ui/page-product.js',
  './js/ui/page-purchase.js',
  './js/ui/page-sale.js',
  './js/ui/page-exchange.js',
  './js/ui/page-inventory.js',
  './js/ui/page-account.js',
  './js/ui/page-report.js',
  './js/ui/page-setting.js',
  './js/ui/page-mine.js',
  './js/ui/page-admin.js',
  './js/ui/page-supplier.js',
  './js/ui/page-customer.js',
  './js/ui/page-login.js',
  './js/barcode/ean13.js',
  './js/barcode/generic39.js',
  './js/barcode/scan.js',
  './js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).catch(function () {});
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
          return caches.delete(k);
        })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  // 导航请求：network-first——在线一律拿最新页面（避免 SW 缓存让用户长期停留在旧版），
  // 离线时回退缓存外壳
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }
  // 静态资源（js/css/图片等）：network-first——在线一律拿最新资源
  // （避免旧缓存让用户首次打开看不到新功能），离线回退缓存
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req);
    })
  );
});
