/**
 * core/backup.js —— 备份导出 / 校验 / 恢复（PRD 7）
 * 纯逻辑层：不碰 DOM、不碰 IndexedDB；UI 层负责文件读写与落库（repo.flush）。
 *
 * 备份文件结构（单 JSON）：
 *   {
 *     app: 'shoe-erp',
 *     schemaVersion: 1,
 *     exportedAt: 'ISO...',
 *     summary: { products: n, skus: n, ... },
 *     settings: {...},
 *     meta: [...],
 *     products: [...], skus: [...], ... (schema.DATA_STORES 全部数组)
 *   }
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var schema = isNode ? require('./schema.js') : root.ERP && root.ERP.schema;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var mod = factory(schema, util);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.backup = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schema, util) {
  'use strict';

  var backup = {};

  /** 计数摘要 */
  function countSummary(data) {
    var s = {};
    schema.DATA_STORES.forEach(function (name) {
      s[name] = (data[name] || []).length;
    });
    return s;
  }

  /**
   * 组装备份对象（不落盘，返回普通对象，便于 JSON 序列化）
   * @param ctx 工作上下文
   */
  backup.build = function build(ctx) {
    var data = ctx.data || {};
    var out = {
      app: 'appliance-erp',
      schemaVersion: schema.VERSION,
      exportedAt: util.nowISO(),
      summary: countSummary(data),
      settings: ctx.settings || null,
      meta: (data.meta || []).slice()
    };
    schema.DATA_STORES.forEach(function (name) {
      out[name] = (data[name] || []).slice();
    });
    return out;
  };

  /** 备份文件名：电器店账本_20260831_1030.json */
  backup.fileName = function fileName(ctx) {
    var shop = (ctx && ctx.settings && ctx.settings.shopName) || '账本';
    var safe = String(shop).replace(/[\\/:*?"<>|]/g, '_');
    return safe + '_' + util.stamp() + '.json';
  };

  /**
   * 校验备份（接受字符串或对象）。
   * 返回 { ok, error?, warnings? }
   */
  backup.validate = function validate(raw) {
    if (typeof raw === 'string') {
      if (!raw.trim()) return { ok: false, error: '文件内容为空' };
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        return { ok: false, error: '不是合法的 JSON 文件：' + e.message };
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: '不是合法的备份文件（内容不是对象）' };
    }
    var check = schema.validateBackup(raw);
    if (!check.ok) return check;
    return { ok: true, warnings: check.warnings || [] };
  };

  /**
   * 记录级合并（跨端同步恢复用，避免全量覆盖丢失另一端独立更新）：
   *  - 同一主键两边都有 → 取较新（updatedAt || createdAt || date）
   *  - 云端独有 → 加入；本地独有 → 保留
   *  - 无主键的表（如 meta）按 key 合并，云端优先
   */
  function recTime(rec) {
    if (!rec) return '';
    return rec.updatedAt || rec.createdAt || rec.date || '';
  }

  function keyOf(rec, store) {
    var kp = schema.KEY_PATH[store];
    if (!kp || !rec) return null;
    var k = rec[kp];
    return k === undefined || k === null ? null : String(k);
  }

  function mergeStore(localArr, cloudArr, store) {
    var map = Object.create(null);
    function put(r) {
      var k = keyOf(r, store);
      var ek = k === null ? '__null__' : k;
      var exist = map[ek];
      if (!exist) { map[ek] = r; return; }
      if (recTime(r) >= recTime(exist)) map[ek] = r; // 同主键取较新
    }
    (localArr || []).forEach(put); // 本地优先占位
    (cloudArr || []).forEach(put); // 云端按较新覆盖
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  /**
   * 恢复：校验 → 迁移 → 写入 ctx.data 全部仓库 + meta + settings，
   * 并 touch 所有受影响仓库（供 repo.flush 落库）。
   * @param opts {merge?:boolean} merge=true 时采用记录级合并（保两端数据），默认全量覆盖
   * 返回 { ok, error? , from, to, notes, summary }
   * 注意：校验失败时不修改任何现有数据。
   */
  backup.restore = function restore(ctx, raw, opts) {
    var v = backup.validate(raw);
    if (!v.ok) return { ok: false, error: v.error };

    var obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    var migrated = schema.migrate(obj);
    if (!migrated.ok) return { ok: false, error: migrated.error };

    var d = migrated.data;
    var merge = opts && opts.merge === true;
    schema.DATA_STORES.forEach(function (name) {
      if (merge) {
        ctx.data[name] = mergeStore(ctx.data[name] || [], d[name] || [], name);
      } else {
        ctx.data[name] = (d[name] || []).slice();
      }
      if (ctx.touchAll) ctx.touchAll(name);
    });
    if (merge) {
      ctx.data.meta = mergeStore(ctx.data.meta || [], d.meta || [], 'meta');
      // settings 无时间戳：本地为底、云端字段优先，云端缺失的本地键保留
      ctx.data.settings = schema.mergeSettings(Object.assign({}, ctx.data.settings || {}, d.settings || {}));
      ctx.settings = ctx.data.settings;
    } else {
      ctx.data.meta = (d.meta || []).slice();
      ctx.data.settings = d.settings || ctx.data.settings;
      ctx.settings = d.settings || ctx.settings;
    }
    if (ctx.touchAll) ctx.touchAll('meta');

    return {
      ok: true,
      from: migrated.from,
      to: migrated.to,
      notes: migrated.notes,
      summary: d.summary || countSummary(ctx.data)
    };
  };

  return backup;
});
