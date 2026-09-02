/**
 * core/branding.js —— 品牌资源（图标/名称）解析
 *
 * 集中处理「网页图标、应用 logo、网页名称」的取值规则：
 * - 账号自定义头像（settings.avatar）优先，未设置回退默认电器图标
 * - 网页名称 = 店名（settings.shopName）+ 页面标题
 * 便于 Node 单测，避免散落在 app.js / page-home.js 各自写一遍。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var mod = factory();
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.branding = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_LOGO = 'assets/icon-192.png';
  var DEFAULT_SHOP = '我的电器店';

  var api = {};

  /** 应用内品牌 logo / favicon 地址：自定义头像优先，未设置用默认电器图标 */
  api.logoHref = function logoHref(settings) {
    var avatar = settings && settings.avatar;
    return (avatar && String(avatar).trim()) ? String(avatar).trim() : DEFAULT_LOGO;
  };

  /** 默认 logo（无任何自定义时的兜底） */
  api.defaultLogo = function defaultLogo() {
    return DEFAULT_LOGO;
  };

  /** 店名（settings.shopName 或默认） */
  api.shopName = function shopName(settings) {
    var n = settings && settings.shopName;
    return (n && String(n).trim()) ? String(n).trim() : DEFAULT_SHOP;
  };

  /** 网页标题：店名 · 页面名 */
  api.pageTitle = function pageTitle(settings, pageTitle) {
    return api.shopName(settings) + ' · ' + (pageTitle || '');
  };

  return api;
});
