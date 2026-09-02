/**
 * core/sync.js —— 手机端 → GitHub Pages 云同步（问题5）
 *
 * 设计约束：无服务器。全部在浏览器里完成：
 *   1) 用 core/backup.build(ctx) 组装完整账本快照（JSON）
 *   2) 用同步口令做 PBKDF2-SHA256 派生密钥 → AES-GCM 加密（密文信封）
 *   3) 用 GitHub Contents API 把信封 PUT 到仓库固定路径 → 每次覆盖历史（同一路径 + sha）
 *   4) 另一台设备打开 GitHub Pages 页面 → 拉取同一路径 → 输入同口令解密 → 覆盖本地
 *
 * 安全要点：
 *   - 仓库可以是公开的：上传的是 AES-GCM 密文，明文部分只保留同步时间；
 *   - Token / 口令只存本机 localStorage（sync.loadConfig / saveConfig），
 *     不写进代码、不进 Git、不进备份文件、不进上传的快照。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var util = isNode ? require('./util.js') : root.ERP && root.ERP.util;
  var backup = isNode ? require('./backup.js') : root.ERP && root.ERP.backup;
  var mod = factory(util, backup);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.sync = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util, backup) {
  'use strict';

  var sync = {};

  sync.ENVELOPE_VERSION = 1;
  sync.KDF_ITERATIONS = 150000;
  sync.CONFIG_KEY = 'erp.sync.config';

  /* ---------------- 配置（只存本机） ---------------- */

  sync.defaultConfig = function defaultConfig() {
    return {
      owner: '',
      repo: '',
      branch: 'gh-pages',
      path: 'data/erp-snapshot.json',
      token: '',
      passphrase: '',
      lastPushAt: '',
      lastPullAt: ''
    };
  };

  /** V3：按账号隔离同步配置 key 与默认路径（各账号数据互不干扰） */
  sync.configKeyFor = function configKeyFor(acctId) {
    return acctId ? sync.CONFIG_KEY + '.' + acctId : sync.CONFIG_KEY;
  };
  sync.defaultPathFor = function defaultPathFor(acctId) {
    return acctId ? 'data/' + acctId + '/erp-snapshot.json' : 'data/erp-snapshot.json';
  };

  /** 从 localStorage 之类的存储读配置（store 需实现 getItem/setItem；acctId 可选，V3 按账号隔离） */
  sync.loadConfig = function loadConfig(store, acctId) {
    var base = sync.defaultConfig();
    base.path = sync.defaultPathFor(acctId);
    if (!store || !store.getItem) return base;
    var raw = null;
    try {
      raw = store.getItem(sync.configKeyFor(acctId));
    } catch (e) {
      return base;
    }
    if (!raw) return base;
    try {
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return base;
      Object.keys(base).forEach(function (k) {
        if (obj[k] !== undefined && obj[k] !== null) base[k] = obj[k];
      });
      return base;
    } catch (e2) {
      return base;
    }
  };

  sync.saveConfig = function saveConfig(store, cfg, acctId) {
    var out = sync.defaultConfig();
    out.path = sync.defaultPathFor(acctId);
    Object.keys(out).forEach(function (k) {
      if (cfg && cfg[k] !== undefined && cfg[k] !== null) out[k] = cfg[k];
    });
    // 归一化：去空格、去 path 首尾斜杠
    ['owner', 'repo', 'branch', 'path', 'token', 'passphrase'].forEach(function (k) {
      out[k] = String(out[k]).trim();
    });
    out.path = out.path.replace(/^\/+|\/+$/g, '');
    if (store && store.setItem) {
      try {
        store.setItem(sync.configKeyFor(acctId), JSON.stringify(out));
      } catch (e) { /* 隐私模式下写入失败：忽略，仅本次会话有效 */ }
    }
    return out;
  };

  /** 校验配置，返回 {ok, errors[]} */
  sync.validateConfig = function validateConfig(cfg) {
    var errors = [];
    var c = cfg || {};
    if (!String(c.owner || '').trim()) errors.push('请填写 GitHub 用户名（owner）');
    if (!String(c.repo || '').trim()) errors.push('请填写仓库名（repo）');
    if (!String(c.branch || '').trim()) errors.push('请填写分支名（branch）');
    var p = String(c.path || '').trim();
    if (!p) errors.push('请填写快照文件路径（如 data/erp-snapshot.json）');
    else if (!/\.json$/i.test(p)) errors.push('快照文件路径需以 .json 结尾');
    if (!String(c.token || '').trim()) errors.push('请填写 GitHub Token（仅存本机）');
    var pw = String(c.passphrase || '');
    if (!pw) errors.push('请设置同步口令（用于加密，换设备恢复要用同一口令）');
    else if (pw.length < 6) errors.push('同步口令至少 6 位');
    return { ok: errors.length === 0, errors: errors };
  };

  /** Contents API 地址 */
  sync.apiUrl = function apiUrl(cfg) {
    var path = String(cfg.path || '').replace(/^\/+/, '');
    return 'https://api.github.com/repos/' +
      encodeURIComponent(String(cfg.owner).trim()) + '/' +
      encodeURIComponent(String(cfg.repo).trim()) + '/contents/' +
      path.split('/').map(encodeURIComponent).join('/');
  };

  /** GitHub Pages 上的公开地址（用于提示用户在另一台设备打开） */
  sync.pagesUrl = function pagesUrl(cfg) {
    return 'https://' + String(cfg.owner).trim().toLowerCase() + '.github.io/' +
      String(cfg.repo).trim() + '/';
  };

  /**
   * 从当前网址猜配置：https://bailihongxi.github.io/shoes-clothing-erp/
   *   → { owner:'bailihongxi', repo:'shoes-clothing-erp' }
   * 非 github.io 域名（如 file:// 本地打开）返回 null。
   */
  sync.guessFromLocation = function guessFromLocation(loc) {
    if (!loc) return null;
    var host = String(loc.hostname || loc.host || '').toLowerCase();
    var m = host.match(/^([a-z0-9-]+)\.github\.io$/);
    if (!m) return null;
    var seg = String(loc.pathname || '/').split('/').filter(Boolean);
    return { owner: m[1], repo: seg.length ? seg[0] : '' };
  };

  sync.commitMessage = function commitMessage(at) {
    return 'chore(sync): 手机端账本同步 ' + (at || util.nowISO());
  };

  /* ---------------- 编解码工具 ---------------- */

  function strToBytes(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return new Uint8Array(Buffer.from(String(s), 'utf8'));
  }

  function bytesToStr(b) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b);
    return Buffer.from(b).toString('utf8');
  }

  function bytesToB64(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof btoa === 'function') {
      var bin = '';
      var CH = 8192;
      for (var i = 0; i < arr.length; i += CH) {
        bin += String.fromCharCode.apply(null, arr.subarray(i, i + CH));
      }
      return btoa(bin);
    }
    return Buffer.from(arr).toString('base64');
  }

  function b64ToBytes(b64) {
    var clean = String(b64 || '').replace(/\s+/g, '');
    if (typeof atob === 'function') {
      var bin = atob(clean);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }

  sync._b64 = { encode: bytesToB64, decode: b64ToBytes, str: strToBytes, unstr: bytesToStr };

  /** UTF-8 文本 → base64（GitHub Contents API 要求 content 为 base64） */
  sync.textToBase64 = function textToBase64(text) {
    return bytesToB64(strToBytes(text));
  };

  sync.base64ToText = function base64ToText(b64) {
    return bytesToStr(b64ToBytes(b64));
  };

  /* ---------------- 加解密 ---------------- */

  function subtle() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (c && c.subtle) return c.subtle;
    throw new Error('当前环境不支持 Web Crypto（需 https 或 localhost）');
  }

  function randomBytes(n) {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (c && c.getRandomValues) return c.getRandomValues(new Uint8Array(n));
    throw new Error('当前环境不支持安全随机数');
  }

  function deriveKey(passphrase, saltBytes, iterations) {
    var s = subtle();
    return s
      .importKey('raw', strToBytes(passphrase), { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (base) {
        return s.deriveKey(
          { name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /**
   * 加密：明文字符串 → 信封对象（可直接 JSON.stringify 上传）
   * 明文部分只暴露同步时间，不含店名/数据量。
   */
  sync.encrypt = function encrypt(plainText, passphrase, at) {
    var salt = randomBytes(16);
    var iv = randomBytes(12);
    var iter = sync.KDF_ITERATIONS;
    return deriveKey(passphrase, salt, iter)
      .then(function (key) {
        return subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, strToBytes(plainText));
      })
      .then(function (ct) {
        return {
          app: 'appliance-erp',
          kind: 'sync-snapshot',
          v: sync.ENVELOPE_VERSION,
          alg: 'AES-GCM-256',
          kdf: 'PBKDF2-SHA256',
          iter: iter,
          salt: bytesToB64(salt),
          iv: bytesToB64(iv),
          ct: bytesToB64(new Uint8Array(ct)),
          at: at || util.nowISO()
        };
      });
  };

  /** 校验信封格式（不解密） */
  sync.validateEnvelope = function validateEnvelope(env) {
    if (typeof env === 'string') {
      try {
        env = JSON.parse(env);
      } catch (e) {
        return { ok: false, error: '云端文件不是合法 JSON：' + e.message };
      }
    }
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      return { ok: false, error: '云端文件内容不是对象' };
    }
    if (env.kind !== 'sync-snapshot') return { ok: false, error: '云端文件不是本软件的同步快照' };
    if (env.v > sync.ENVELOPE_VERSION) {
      return { ok: false, error: '云端快照版本（v' + env.v + '）高于当前程序，请先升级软件' };
    }
    if (!env.salt || !env.iv || !env.ct) return { ok: false, error: '云端快照缺少加密字段（salt/iv/ct）' };
    return { ok: true, envelope: env };
  };

  /** 解密：信封 → 明文字符串（口令错误会给出明确提示） */
  sync.decrypt = function decrypt(env, passphrase) {
    var v = sync.validateEnvelope(env);
    if (!v.ok) return Promise.reject(new Error(v.error));
    var e = v.envelope;
    return deriveKey(passphrase, b64ToBytes(e.salt), e.iter || sync.KDF_ITERATIONS)
      .then(function (key) {
        return subtle().decrypt({ name: 'AES-GCM', iv: b64ToBytes(e.iv) }, key, b64ToBytes(e.ct));
      })
      .then(function (buf) {
        return bytesToStr(new Uint8Array(buf));
      })
      .catch(function () {
        throw new Error('解密失败：同步口令不对，或云端快照已损坏');
      });
  };

  /* ---------------- 快照打包 / 落地 ---------------- */

  /** 组装本机账本快照的明文 JSON 字符串（含统计摘要，供上传前提示） */
  sync.buildSnapshotText = function buildSnapshotText(ctx) {
    var obj = backup.build(ctx);
    // Token / 口令绝不进快照（配置本就不在 settings 里，这里再兜一层）
    if (obj.settings && obj.settings.sync) delete obj.settings.sync;
    var text = JSON.stringify(obj);
    return { text: text, summary: obj.summary || {}, bytes: strToBytes(text).length };
  };

  /** 摘要文字：3 款商品 / 5 进货单 / 8 销售单 */
  sync.summaryText = function summaryText(summary) {
    var s = summary || {};
    var parts = [];
    function add(key, label) {
      if (s[key]) parts.push(s[key] + ' ' + label);
    }
    add('products', '商品');
    add('purchases', '进货单');
    add('sales', '销售单');
    add('ledgers', '账目');
    return parts.length ? parts.join(' / ') : '空账本';
  };

  /** 把云端明文快照覆盖到本地（复用 backup.restore 的校验 + 迁移） */
  sync.applySnapshotText = function applySnapshotText(ctx, text) {
    return backup.restore(ctx, text);
  };

  /* ---------------- GitHub Contents API ---------------- */

  function headers(cfg) {
    return {
      Authorization: 'Bearer ' + String(cfg.token).trim(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  function pickFetch(fetchImpl) {
    var f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
    if (!f) throw new Error('当前环境不支持网络请求（fetch 不可用）');
    return f;
  }

  /** 读取远端文件的 sha（不存在返回 null） */
  sync.remoteSha = function remoteSha(cfg, fetchImpl) {
    var f = pickFetch(fetchImpl);
    var url = sync.apiUrl(cfg) + '?ref=' + encodeURIComponent(cfg.branch);
    return f(url, { method: 'GET', headers: headers(cfg) }).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(githubError(res, t));
        });
      }
      return res.json().then(function (j) {
        return j && j.sha ? j.sha : null;
      });
    });
  };

  /** 细分 403：限流 vs 权限不足 vs 其他 */
  function describe403(res, msg) {
    var low = String(msg || '').toLowerCase();
    var rl = -1;
    try {
      if (res && res.headers && typeof res.headers.get === 'function') {
        var v = res.headers.get('X-RateLimit-Remaining');
        if (v !== null && v !== undefined) rl = parseInt(String(v), 10);
      }
    } catch (e) {
      rl = -1;
    }
    var rateLimited = rl === 0 || low.indexOf('rate limit') >= 0 || low.indexOf('rate_limit') >= 0;
    if (rateLimited) {
      return 'GitHub 限流（403）：API 调用次数已达上限，请等待重置后再试（通常每小时重置；若 Token 无效会按匿名限额计算、更容易触发）。可先在下方「测试连接」确认 Token 是否有效';
    }
    if (/resource not accessible|not authorized|push access|must have|permission/i.test(low)) {
      return 'GitHub 权限不足（403）：该 Token 缺少本仓库 Contents 写权限。请重新生成 Token 并勾选「Contents: Read and write」（classic Token 勾选 repo 权限），且 Token 的 owner/repo 需与填写的仓库一致';
    }
    return 'GitHub 拒绝访问（403）：' + (msg || 'Token 权限不足或触发限流，请检查 Token 与仓库权限');
  }

  /** 把 GitHub 响应转成中文错误提示（细分 401/403/404/409/422） */
  function githubError(res, body) {
    var status = res && res.status ? res.status : res;
    var msg = '';
    try {
      var j = JSON.parse(body);
      msg = j && j.message ? j.message : '';
    } catch (e) {
      msg = String(body || '').slice(0, 160);
    }
    if (status === 401) return 'GitHub 拒绝访问（401）：Token 无效或已过期，请重新生成并重新填写';
    if (status === 403) return describe403(res, msg);
    if (status === 404) return '找不到仓库或分支（404）：请检查用户名 / 仓库名 / 分支名';
    if (status === 409) return '提交冲突（409）：云端刚被改过，请再点一次同步';
    if (status === 422) return '提交被拒绝（422）：' + (msg || '路径或分支不合法');
    return 'GitHub 返回错误 ' + status + (msg ? '：' + msg : '');
  }

  sync._githubError = githubError;
  sync._describe403 = describe403;

  /**
   * 预检：验证 Token 是否有效、对目标仓库是否可访问（用于「测试连接」/同步前的快速诊断）。
   * @returns {Promise<{ok, error?, repo?, private?}>}
   */
  sync.checkAuth = function checkAuth(cfg, fetchImpl) {
    var f = pickFetch(fetchImpl);
    var owner = String((cfg && cfg.owner) || '').trim();
    var repo = String((cfg && cfg.repo) || '').trim();
    var token = String((cfg && cfg.token) || '').trim();
    if (!token) return Promise.resolve({ ok: false, error: '未填写 GitHub Token' });
    if (!owner || !repo) return Promise.resolve({ ok: false, error: '请先填写 GitHub 用户名（owner）与仓库名（repo）' });
    var url = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
    return f(url, { method: 'GET', headers: headers(cfg) }).then(function (res) {
      if (res.status === 401) return { ok: false, error: 'GitHub Token 无效或已过期（401），请重新生成' };
      if (res.status === 403) return { ok: false, error: githubError(res, '') };
      if (res.status === 404) return { ok: false, error: '找不到仓库（404）：请检查用户名 / 仓库名，或该 Token 无权查看此仓库' };
      if (!res.ok) return { ok: false, error: githubError(res, '') };
      return res.json().then(function (j) {
        return { ok: true, repo: j.full_name || (owner + '/' + repo), private: !!j.private };
      });
    });
  };

  /**
   * 上传（覆盖历史）：先取 sha，再 PUT 同一路径。
   * @returns {Promise<{ok, at, commit, url, created}>}
   */
  sync.push = function push(cfg, contentText, fetchImpl) {
    var v = sync.validateConfig(cfg);
    if (!v.ok) return Promise.reject(new Error(v.errors.join('；')));
    var f = pickFetch(fetchImpl);
    var at = util.nowISO();
    return sync.remoteSha(cfg, fetchImpl).then(function (sha) {
      var body = {
        message: sync.commitMessage(at),
        content: sync.textToBase64(contentText),
        branch: String(cfg.branch).trim()
      };
      if (sha) body.sha = sha; // 有 sha = 覆盖历史内容
      return f(sync.apiUrl(cfg), {
        method: 'PUT',
        headers: headers(cfg),
        body: JSON.stringify(body)
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error(githubError(res, t));
          });
        }
        return res.json().then(function (j) {
          return {
            ok: true,
            at: at,
            created: !sha,
            commit: j && j.commit ? j.commit.sha : null,
            url: sync.pagesUrl(cfg)
          };
        });
      });
    });
  };

  /** 下载云端信封 */
  sync.pull = function pull(cfg, fetchImpl) {
    var v = sync.validateConfig(cfg);
    if (!v.ok) return Promise.reject(new Error(v.errors.join('；')));
    var f = pickFetch(fetchImpl);
    var url = sync.apiUrl(cfg) + '?ref=' + encodeURIComponent(cfg.branch);
    return f(url, { method: 'GET', headers: headers(cfg) }).then(function (res) {
      if (res.status === 404) throw new Error('云端还没有快照，请先在手机上点一次「同步到云端」');
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(githubError(res, t));
        });
      }
      return res.json().then(function (j) {
        var text = j && j.content ? sync.base64ToText(j.content) : '';
        var chk = sync.validateEnvelope(text);
        if (!chk.ok) throw new Error(chk.error);
        return chk.envelope;
      });
    });
  };

  /* ---------------- 高层流程 ---------------- */

  /** 一键同步：打包 → 加密 → 上传覆盖 */
  sync.syncUp = function syncUp(ctx, cfg, fetchImpl) {
    var v = sync.validateConfig(cfg);
    if (!v.ok) return Promise.resolve({ ok: false, error: v.errors.join('；') });
    var snap = sync.buildSnapshotText(ctx);
    return sync
      .encrypt(snap.text, cfg.passphrase)
      .then(function (env) {
        return sync.push(cfg, JSON.stringify(env), fetchImpl);
      })
      .then(function (r) {
        return {
          ok: true,
          at: r.at,
          created: r.created,
          bytes: snap.bytes,
          summary: snap.summary,
          summaryText: sync.summaryText(snap.summary),
          url: r.url
        };
      })
      .catch(function (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      });
  };

  /** 一键恢复：下载 → 解密 → 覆盖本地 */
  sync.syncDown = function syncDown(ctx, cfg, fetchImpl) {
    var v = sync.validateConfig(cfg);
    if (!v.ok) return Promise.resolve({ ok: false, error: v.errors.join('；') });
    return sync
      .pull(cfg, fetchImpl)
      .then(function (env) {
        return sync.decrypt(env, cfg.passphrase).then(function (text) {
          var r = sync.applySnapshotText(ctx, text);
          if (!r.ok) throw new Error(r.error);
          return {
            ok: true,
            at: env.at,
            summary: r.summary,
            summaryText: sync.summaryText(r.summary)
          };
        });
      })
      .catch(function (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      });
  };

  return sync;
});
