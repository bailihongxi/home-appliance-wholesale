/**
 * js/core/lazy.js —— 大体积第三方库按需加载（V3.58 加载性能优化）
 *
 * 背景：vendor/xlsx.full.min.js(861KB) + vendor/zxing-decode.min.js(407KB) 合计 1.27MB，
 * 原先在 index.html 里**每次启动都同步加载**，但 Excel 导入和条码拍照识别都是低频功能，
 * 绝大多数使用会话根本用不到 —— 首屏为此付出了近七成的下载与解析时间。
 *
 * 方案：改为**真正用到时才注入 <script>**，且：
 *   1) 同一个库并发请求共享一个 Promise（不会重复注入）；
 *   2) 加载成功后由 check() 校验全局对象就绪再 resolve；
 *   3) 支持 file:// —— 仍用 <script src> 注入，与原先 index.html 直载的行为一致；
 *   4) 失败可重试（清掉 Promise 缓存），不会因一次网络抖动永久不可用。
 *
 * 纯函数式 API + 可注入 document，便于 Node 单测。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var mod = factory();
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.lazy = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var pending = Object.create(null);

  function defaultDoc() {
    return (typeof document !== 'undefined' && document) || null;
  }

  /**
   * 按需加载脚本
   * @param key      去重键（同一 key 并发共享）
   * @param src      脚本地址（相对 index.html）
   * @param check    就绪判定函数，返回真值表示全局对象已可用
   * @param opts     { document?, timeout? }
   * @returns Promise<*> check() 的返回值
   */
  function load(key, src, check, opts) {
    opts = opts || {};
    if (pending[key]) {
      var existed = pending[key];
      return existed.catch(function () {
        // 上次失败 → 允许重试
        delete pending[key];
        return load(key, src, check, opts);
      });
    }
    var ready = (typeof check === 'function') ? check : function () { return true; };
    var already = ready();
    if (already) return Promise.resolve(already);

    var promise = new Promise(function (resolve, reject) {
      var doc = opts.document || defaultDoc();
      if (!doc || !doc.createElement) {
        reject(new Error('懒加载失败：当前环境无 document（非浏览器环境）'));
        return;
      }
      var timer = null;
      var timeout = opts.timeout || 20000;
      function done(getValue) {
        if (timer) { clearTimeout(timer); timer = null; }
        var v = ready();
        if (v) resolve(v);
        else reject(new Error('懒加载失败：' + key + ' 脚本已执行但全局对象未就绪'));
      }
      var el = doc.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = function () { done(); };
      el.onerror = function () {
        if (timer) { clearTimeout(timer); timer = null; }
        reject(new Error('懒加载失败：无法加载 ' + src + '（网络或离线）'));
      };
      timer = setTimeout(function () {
        reject(new Error('懒加载超时：' + src));
      }, timeout);
      (doc.head || doc.body || doc.documentElement).appendChild(el);
    });

    pending[key] = promise;
    return promise;
  }

  return {
    load: load,
    /** 供单测清理状态 */
    _reset: function () { pending = Object.create(null); },
    /** 是否已缓存过该库的 Promise */
    _has: function (key) { return !!pending[key]; }
  };
});
