/**
 * core/schema.js —— 数据结构定义、默认设置、schemaVersion 迁移（电器版）
 * 电器版：商品单层模型（无编码、无 SKU、无属性），字段 = 品牌/型号/类型/单位/成本/批发价/零售价/库存/备注/原厂条码
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.schema = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var S = {
    /** 当前数据结构版本 */
    VERSION: 2,
    DB_NAME: 'applianceErp',
    DB_VERSION: 1,
    META_SETTINGS_KEY: 'settings',
    META_LAST_BACKUP_KEY: 'lastBackupAt',

    /** V3 多账号：每账号独立数据库名 applianceErp_<acctId>（与鞋服母版 shoeErp/erp 隔离） */
    dbNameFor: function dbNameFor(acctId) {
      return acctId ? 'applianceErp_' + acctId : 'applianceErp';
    },

    STORES: {
      products: 'products',
      purchases: 'purchases',
      sales: 'sales',
      stocktakes: 'stocktakes',
      stockLogs: 'stockLogs',
      ledgers: 'ledgers',
      partners: 'partners',
      logs: 'logs',
      meta: 'meta'
    },

    KEY_PATH: {
      products: 'id',
      purchases: 'no',
      sales: 'no',
      stocktakes: 'no',
      stockLogs: 'id',
      ledgers: 'id',
      partners: 'id',
      logs: 'id',
      meta: 'key'
    },

    /** 备份/导出时会整体写入的表（顺序固定） */
    DATA_STORES: [
      'products',
      'purchases',
      'sales',
      'stocktakes',
      'stockLogs',
      'ledgers',
      'partners',
      'logs'
    ],

    /** 商品类型字典（可在设置里自定义；账号经营范围按此过滤） */
    CATEGORIES: ['冰箱', '洗衣机', '空调', '电视', '厨房电器', '生活小家电', '数码影音', '配件耗材', '其他'],

    /** 本账号可见类型列表（经营范围过滤）：scopeCategories 为空=不限制 */
    categoriesFor: function categoriesFor(settings) {
      var all = S.CATEGORIES.slice();
      if (!settings) return all;
      var sc = settings.scopeCategories;
      if (!sc || !sc.length) return all;
      return all.filter(function (c) { return sc.indexOf(c) >= 0; });
    },

    /** 判断某类型是否在本账号经营范围内（空 scope=不限制） */
    inScope: function inScope(settings, category) {
      if (!settings) return true;
      var sc = settings.scopeCategories;
      if (!sc || !sc.length) return true;
      return sc.indexOf(category) >= 0;
    },

    STATUS: { ON: 'on', OFF: 'off' },

    /** 单据类型 */
    DOC: {
      PURCHASE: 'purchase',
      SALE: 'sale',
      GIFT: 'gift',
      REFUND: 'refund',
      STOCKTAKE: 'stocktake'
    },

    /** 流水类型 */
    LEDGER: {
      SALE_INCOME: 'sale_income',
      PURCHASE_EXPENSE: 'purchase_expense',
      PAY_SUPPLIER: 'pay_supplier',
      GIFT_COST: 'gift_cost',
      REFUND_OUT: 'refund_out',
      RECEIVE_DEBT: 'receive_debt',
      EXPENSE: 'expense',
      INCOME: 'income'
    },

    EXPENSE_CATEGORIES: ['房租', '水电', '人工', '物流', '其他'],

    LEDGER_LABEL: {
      sale_income: '销售收入',
      purchase_expense: '进货支出',
      pay_supplier: '供应商付款',
      gift_cost: '赠送成本',
      refund_out: '退货退款',
      receive_debt: '客户回款',
      expense: '费用支出',
      income: '其他收入'
    },

    GIFT_REASONS: ['赠品', '样品', '自用', '破损'],

    PAY_METHODS: ['wechat', 'cash', 'alipay'],
    PAY_METHOD_LABEL: { wechat: '微信', cash: '现金', alipay: '支付宝' },

    PARTNER_TYPES: ['supplier', 'customer'],

    /** 销售价格类型：批发 / 零售 */
    PRICE_TYPE: { WHOLESALE: 'wholesale', RETAIL: 'retail' },
    PRICE_TYPE_LABEL: { wholesale: '批发', retail: '零售' }
  };

  /* ---------------- 默认设置 ---------------- */

  S.defaultSettings = function defaultSettings() {
    return {
      shopName: '我的电器店',
      /** V3：本账号经营范围（类型白名单）；空数组=未限制（全部分类） */
      scopeCategories: [],
      /** V3：本账号头像（dataURL） */
      avatar: '',
      defaultThreshold: 3,
      lock: { enabled: false, hash: null },
      debtOverdueDays: 15
    };
  };

  S.mergeSettings = function mergeSettings(raw) {
    var base = S.defaultSettings();
    if (!raw || typeof raw !== 'object') return base;
    var out = Object.assign({}, base, raw);
    out.lock = Object.assign({}, base.lock, raw.lock || {});
    return out;
  };

  /* ---------------- 空数据 / 校验 ---------------- */

  S.emptyData = function emptyData() {
    var data = { schemaVersion: S.VERSION };
    S.DATA_STORES.forEach(function (name) {
      data[name] = [];
    });
    return data;
  };

  /**
   * 备份结构校验（不抛错，返回 {ok, error, warnings}）
   */
  S.validateBackup = function validateBackup(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: '不是合法的备份文件（内容不是 JSON 对象）' };
    }
    if (typeof raw.schemaVersion !== 'number') {
      return { ok: false, error: '备份文件缺少 schemaVersion，可能不是本软件导出的备份' };
    }
    var missing = [];
    S.DATA_STORES.forEach(function (name) {
      if (!Array.isArray(raw[name])) missing.push(name);
    });
    if (missing.length) {
      return { ok: false, error: '备份文件结构不完整，缺少：' + missing.join('、') };
    }
    if (raw.schemaVersion > S.VERSION) {
      return {
        ok: false,
        error: '备份文件版本（v' + raw.schemaVersion + '）高于当前程序（v' + S.VERSION + '），请先升级软件再导入'
      };
    }
    return { ok: true, warnings: [] };
  };

  /**
   * 迁移：低版本备份 → 当前版本（逐版本升级，钩子在此扩展）
   * v1（鞋服版）结构含 skus/printJobs，与电器版 v2 不兼容：给出明确提示，不自动迁移。
   */
  S.migrate = function migrate(raw) {
    var check = S.validateBackup(raw);
    if (!check.ok) return { ok: false, error: check.error };
    var data = S.emptyData();
    S.DATA_STORES.forEach(function (name) {
      data[name] = Array.isArray(raw[name]) ? raw[name].slice() : [];
    });
    var notes = [];
    var from = raw.schemaVersion;
    if (from < 2) {
      return {
        ok: false,
        error: '检测到旧版（鞋服版 v1）备份。电器版数据结构不兼容，无法自动迁移，请勿导入旧备份；如需使用请重新建档。'
      };
    }
    var v = from;
    while (v < S.VERSION) {
      v += 1;
      notes.push('已从 v' + (v - 1) + ' 升级到 v' + v);
    }
    data.schemaVersion = S.VERSION;
    data.meta = Array.isArray(raw.meta) ? raw.meta.slice() : [];
    data.settings = raw.settings || null;
    data.exportedAt = raw.exportedAt || null;
    data.summary = raw.summary || null;
    return { ok: true, data: data, from: from, to: S.VERSION, notes: notes };
  };

  return S;
});
