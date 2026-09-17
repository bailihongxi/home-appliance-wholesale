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

  var DEFAULT_LOGO = 'assets/favicon.png';
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

  /**
   * V3.75：当前「展示身份」——顶栏 / 首页 banner 统一取值处。
   * 员工（非数据归属账号）共用老板的 settings，若继续读 settings 就会在顶栏
   * 显示老板的店名与头像（用户反馈「首页右上角还是总控的名字和头像」）。
   * 故员工一律显示**自己的账号档案**（shopName || username + account.avatar）；
   * 老板（数据归属账号）与无账号场景仍显示店铺资料。
   */
  api.isStaffAccount = function isStaffAccount(account) {
    var a = account || null;
    if (!a) return false;
    var ERPns = (typeof ERP !== 'undefined') ? ERP : null;
    if (ERPns && ERPns.sync && typeof ERPns.sync.isDataOwner === 'function') return !ERPns.sync.isDataOwner(a);
    if (ERPns && ERPns.accounts && typeof ERPns.accounts.isDataOwner === 'function') return !ERPns.accounts.isDataOwner(a);
    // 无模块可依赖时（如纯 Node 单测）退化为「带 ownerId 即员工」
    return !!(a.ownerId && a.ownerId !== a.id);
  };

  /** 展示身份：{ name, logo, isStaff } */
  api.identity = function identity(settings, account) {
    var a = account || ((typeof ERP !== 'undefined' && ERP.currentAccount) || null);
    if (api.isStaffAccount(a)) {
      var nm = String(a.shopName || a.username || '').trim();
      return {
        isStaff: true,
        name: nm || '员工账号',
        logo: (a.avatar && String(a.avatar).trim()) ? String(a.avatar).trim() : DEFAULT_LOGO
      };
    }
    return { isStaff: false, name: api.shopName(settings), logo: api.logoHref(settings) };
  };

  /** 网页标题：店名 · 页面名（V3.75：员工用自己的账号名当店名部分） */
  api.pageTitle = function pageTitle(settings, pageTitle) {
    return api.shopName(settings) + ' · ' + (pageTitle || '');
  };

  return api;
});
