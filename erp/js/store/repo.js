/**
 * store/repo.js —— 工作上下文（内存工作集 + 脏数据刷新）
 * 业务层（core/engine）只操作 ctx.data，repo 负责落库与查询助手。
 */
(function (root, factory) {
  // 防御：与 engine.js 同一套延迟加载模式，避免 IIFE 加载顺序错乱时锁定 undefined。
  root.ERP = root.ERP || {};
  var isNode = typeof module !== 'undefined' && module.exports;
  var E = root.ERP;
  var schemaStatic = E.schema || (isNode ? require('../core/schema.js') : null);
  var utilStatic = E.util || (isNode ? require('../core/util.js') : null);
  var mod = factory(schemaStatic, utilStatic, E);
  if (isNode) module.exports = mod;
  root.ERP.repo = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schema, util, ERP) {
  'use strict';

  /**
   * 运行时兜底：闭包内 schema/util 可能是 null（早期加载顺序错乱时），函数实际调用时
   * 优先用最新的 ERP.schema / ERP.util。这是 issue11 修复：避免 IIFE 顶层把 null 锁进闭包。
   */
  function schemaRef() { return (ERP && ERP.schema) || schema || null; }
  function utilRef() { return (ERP && ERP.util) || util || null; }

  /**
   * 由纯数据构造工作上下文
   * ctx.data：所有表的数组；ctx.touch(store, rec)：标记该记录需要落库
   */
  function createContext(data) {
    var dirty = Object.create(null);

    /**
     * V3.58 性能：主键查询索引（store → {arr, len, keyField, map}）。
     *
     * 背景（全系统卡顿的主要根因）：ctx.getProduct / getPartner 原为 Array.find 线性查找，
     * 而 profit.topProducts 会为「每一条售出商品」调用 ctx.getProduct —— 3000 商品即 3000 次
     * 线性扫描 × 3000 长度 ≈ 450 万次比较，直接导致报表页 ~106ms、首页 ~90ms 的白屏等待。
     *
     * 失效策略（不依赖 touch，避免批量导入时逐条失效退化成 O(n²)）：
     *   1) 数组引用变化（整体替换列表）→ 重建
     *   2) 数组长度变化（push 新增 / splice 删除）→ 重建
     *   3) 命中记录的 key 与查询 key 不一致（理论兜底，O(1) 校验）→ 重建
     * 字段级修改（改库存/改成本）无需失效：索引保存的是对象引用，读到的一定是最新值。
     * 注：barcodes 属于「不改长度的原地修改」，故 getProductByCode 仍走线性扫描以确保正确。
     */
    var idxCache = Object.create(null);

    function buildIndex(store, list, keyField) {
      var map = Object.create(null);
      for (var i = 0; i < list.length; i++) {
        var rec = list[i];
        if (!rec) continue;
        var k = rec[keyField];
        if (k === undefined || k === null) continue;
        var ks = String(k);
        // 与 Array.find 语义一致：重复 key 取「首个」
        if (!(ks in map)) map[ks] = rec;
      }
      return { arr: list, len: list.length, keyField: keyField, map: map };
    }

    function ensureIndex(store) {
      var arr = (ctx.data && ctx.data[store]) || null;
      if (!Array.isArray(arr)) arr = [];
      var s = schemaRef();
      var keyField = (s && s.KEY_PATH && s.KEY_PATH[store]) || 'id';
      var cached = idxCache[store];
      if (!cached || cached.arr !== arr || cached.len !== arr.length || cached.keyField !== keyField) {
        cached = buildIndex(store, arr, keyField);
        idxCache[store] = cached;
      }
      return cached;
    }

    /** 按主键取记录（O(1)）；索引失效或异常时自动退化为线性查找，保证结果正确 */
    function indexGet(store, key) {
      if (key === undefined || key === null) return null;
      var ks = String(key);
      var idx = ensureIndex(store);
      var hit = idx.map[ks];
      if (hit) {
        // O(1) 校验：key 对得上才可信（数组被原地替换等极端场景自动修复）
        if (String(hit[idx.keyField]) === ks) return hit;
        idxCache[store] = buildIndex(store, idx.arr, idx.keyField);
        var again = idxCache[store].map[ks];
        if (again) return again;
      }
      return null;
    }

    var ctx = {
      data: data,
      settings: (data && data.settings) || (schemaRef() ? schemaRef().defaultSettings() : {}),

      touch: function (store, rec) {
        if (!rec) return;
        var s = schemaRef();
        if (!s || !s.KEY_PATH || !s.KEY_PATH[store]) return; // schema 未加载或未知 store，安全 no-op（不抛错）
        var keyPath = s.KEY_PATH[store];
        var key = rec[keyPath];
        if (key === undefined || key === null) return;
        if (!dirty[store]) dirty[store] = Object.create(null);
        dirty[store][String(key)] = rec;
      },

      /** 标记整张表为脏（批量改动后用） */
      touchAll: function (store) {
        var list = (data && data[store]) || [];
        for (var i = 0; i < list.length; i++) ctx.touch(store, list[i]);
      },

      dirtyKeys: function () {
        return Object.keys(dirty);
      },

      takeDirty: function () {
        var out = Object.create(null);
        Object.keys(dirty).forEach(function (store) {
          out[store] = Object.keys(dirty[store]).map(function (k) {
            return dirty[store][k];
          });
        });
        dirty = Object.create(null);
        return out;
      },

      clearDirty: function () {
        dirty = Object.create(null);
      },

      /* ---- 查询助手 ---- */
      /** 按商品 id 取商品（电器版单层模型，无 SKU）—— V3.58：走主键索引，O(1) */
      getProduct: function (id) {
        return indexGet('products', id);
      },
      /** 按原厂条码 / 二维码内容取商品（归一化：去空白、转大写）
       *  注：条码可被原地修改（长度不变），索引难以及时失效，故仍走线性扫描保证结果正确；
       *  调用频次极低（扫码/导入时单次），不影响整体性能。 */
      getProductByCode: function (code) {
        var c = String(code == null ? '' : code).trim().toUpperCase();
        if (!c) return null;
        var arr = (ctx.data && ctx.data.products) || [];
        return arr.find(function (p) {
          var barr = p.barcodes;
          if (!Array.isArray(barr)) return false;
          return barr.some(function (b) {
            return String(b == null ? '' : b).trim().toUpperCase() === c;
          });
        }) || null;
      },
      /** 按往来单位 id 取记录 —— V3.58：走主键索引，O(1) */
      getPartner: function (partnerId) {
        return indexGet('partners', partnerId);
      },
      getDoc: function (store, no) {
        return (data[store] || []).find(function (d) {
          return d.no === no;
        }) || null;
      }
    };

    return ctx;
  }

  /** 从 db 载入全部数据 + 设置 */
  async function loadAll(db) {
    var s = schemaRef();
    if (!s) {
      throw new Error('repo.loadAll 失败：schema 模块尚未加载，请检查 index.html 脚本顺序（core/schema.js 必须早于 store/repo.js）');
    }
    var data = s.emptyData();
    for (var i = 0; i < s.DATA_STORES.length; i++) {
      var name = s.DATA_STORES[i];
      data[name] = await db.getAll(name);
    }
    var settingsRec = await db.get('meta', s.META_SETTINGS_KEY);
    data.settings = s.mergeSettings(settingsRec ? settingsRec.value : null);
    data.lastBackupAt = await getMeta(db, s.META_LAST_BACKUP_KEY);
    return data;
  }

  async function getMeta(db, key) {
    var rec = await db.get('meta', key);
    return rec ? rec.value : null;
  }

  async function setMeta(db, key, value) {
    await db.put('meta', { key: key, value: value });
    return value;
  }

  /** 把 ctx 上的脏数据写入 db */
  async function flush(ctx, db) {
    var dirty = ctx.takeDirty();
    var stores = Object.keys(dirty);
    var counts = Object.create(null);
    for (var i = 0; i < stores.length; i++) {
      var store = stores[i];
      var list = dirty[store];
      if (!list.length) continue;
      var s = schemaRef();
      var kp = s && s.KEY_PATH && s.KEY_PATH[store];
      // V3.37：__deleted 标记 → db.del 物理删除；其余 bulkPut 落库
      var puts = [];
      for (var j = 0; j < list.length; j++) {
        var rec = list[j];
        if (!rec) continue;
        if (rec.__deleted) {
          if (kp) await db.del(store, rec[kp]);
          else await db.del(store, String(rec.id != null ? rec.id : rec.no));
          continue;
        }
        puts.push(rec);
      }
      if (puts.length) {
        await db.bulkPut(store, puts);
        counts[store] = puts.length;
      }
    }
    return counts;
  }

  /** 保存设置（meta 表 + 内存） */
  async function saveSettings(db, settings) {
    var s = schemaRef();
    await db.put('meta', { key: (s && s.META_SETTINGS_KEY) || 'settings', value: settings });
    return settings;
  }

  /** 记操作日志 */
  function log(ctx, action, detail) {
    var u = utilRef();
    var rec = {
      id: u && typeof u.uuid === 'function' ? u.uuid('log') : ('log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      at: u && typeof u.nowISO === 'function' ? u.nowISO() : new Date().toISOString(),
      action: action,
      detail: detail || ''
    };
    ctx.data.logs = ctx.data.logs || [];
    ctx.data.logs.push(rec);
    ctx.touch('logs', rec);
    return rec;
  }

  return {
    createContext: createContext,
    loadAll: loadAll,
    flush: flush,
    getMeta: getMeta,
    setMeta: setMeta,
    saveSettings: saveSettings,
    log: log
  };
});
