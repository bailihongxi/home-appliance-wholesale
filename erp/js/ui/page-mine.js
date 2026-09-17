/**
 * ui/page-mine.js —— 我的（v2 薄荷绿 UI 重设计）
 *
 * 设计图 1-3（手机）：
 * - 薄荷绿 banner「我的」
 * - 店铺卡片：圆形头像 + 店铺名 + 副标题「进销存记账 · 个体工商户」+ 右箭头
 * - 云同步卡片：标题 + 3 按钮（同步到云端 / 从云端恢复 / 同步设置）+ 副文字
 * - 8 格圆形快捷入口（2 行 4 列）：开单 / 进货 / 商品 / 供应商 / 库存 / 记账中心 / 报表 / 设置
 * - 底部版本信息：V3.4 / 数据存储于本机 IndexedDB / 自动备份保障数据安全
 *
 * 云同步（问题5）：手机端一键把账本加密上传到 GitHub 仓库固定路径（覆盖历史），
 * 另一台设备打开 GitHub Pages 页面 → 「从云端恢复」→ 输入同一同步口令即可覆盖本地。
 * Token 与口令只存本机 localStorage，不进 Git、不进备份、不进上传的快照。
 *
 * 关于 / 常用入口 / 同步设置等关键能力保留（兼容既有断言）。
 */
(function (root, factory) {
  var isNode = typeof module !== 'undefined' && module.exports;
  var ERP = root.ERP || {};
  var util = isNode ? require('../core/util.js') : (ERP.util || null);
  var ui = isNode ? require('./components.js') : (ERP.ui || null);
  var schema = isNode ? require('../core/schema.js') : (ERP.schema || null);
  var sync = isNode ? require('../core/sync.js') : (ERP.sync || null);
  var accounts = isNode ? require('../core/accounts.js') : (ERP.accounts || null);
  var mod = factory(ERP, util, ui, schema, sync, accounts);
  if (isNode) module.exports = mod;
  root.ERP = root.ERP || {};
  root.ERP.pages = root.ERP.pages || {};
  root.ERP.pages.mine = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ERP, util, ui, schema, sync, accounts) {
  'use strict';

  var C = ui;
  var esc = util.escapeHtml;

  /** 本机存储（localStorage）；不可用时返回 null，配置只在本次会话有效 */
  function store() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  /** V3：当前登录账号 id（账号自身维度，仅用于「我是谁」的判断） */
  function currentAcctId() {
    return (ERP && ERP.currentAccount && ERP.currentAccount.id) || null;
  }

  /**
   * V3.62：云同步的「数据归属账号 id」——决定同步配置 key 与云端快照路径。
   *
   * 背景（新用户登录后没有任何数据的根因之一）：原实现直接用 currentAcctId()，
   * 于是「共用本店数据」的员工账号（ownerId=admin）会去找
   *   applianceErp.sync.config.acctN + data/acctN/erp-snapshot.json
   * 而老板的数据实际上传在 data/admin/erp-snapshot.json，员工端必然 404
   * 「云端还没有快照」，永远拉不到本店数据。
   * 修正：共用本店数据时按归属账号（老板）定位，独立数据空间仍用自身 id。
   */
  function syncAcctId() {
    var a = (ERP && ERP.currentAccount) || null;
    if (!a || !a.id) return currentAcctId();
    if (accounts && typeof accounts.dataOwnerId === 'function') {
      return accounts.dataOwnerId(a) || a.id;
    }
    return a.ownerId || a.id;
  }

  /** 当前账号是否共用老板（归属账号）的本店数据 */
  function sharesBossData() {
    var a = (ERP && ERP.currentAccount) || null;
    if (!a) return false;
    if (accounts && typeof accounts.sharesBossData === 'function') return !!accounts.sharesBossData(a);
    return !!a.ownerId;
  }

  /** 本机业务数据是否为空账本（无商品 / 无进货 / 无销售 / 无账目）——统一走 util，避免两处逻辑漂移 */
  function isEmptyLedger(ctx) {
    return util.isEmptyLedger(ctx);
  }

  /** 取指定账号 id 的脱敏公开档案 */
  function accountPublicById(id) {
    if (!accounts || !id) return null;
    try {
      var list = accounts.load(store());
      var acct = accounts.getById(list, id);
      return acct ? accounts.strip(acct) : null;
    } catch (e) {
      return null;
    }
  }

  /** V3.4：当前登录账户的脱敏公开档案（随云快照同步：店铺名/头像/经营范围，不含密码哈希） */
  function currentAccountPublic() {
    return accountPublicById(currentAcctId());
  }

  /**
   * V3.62：写入快照的账户档案。
   * 共用本店数据时应写「归属账号（老板）」的档案，否则员工上传会把自己的店名/头像
   * 写进全店共享快照，老板再从云端恢复时店名就被员工覆盖了。
   */
  function syncAccountPublic() {
    if (!ERP || !ERP.currentAccount) return null;
    return accountPublicById(syncAcctId()) || currentAccountPublic();
  }

  /**
   * 同步/恢复后把 ctx 脏数据落库（问题3修复）。
   * 根因：从云端恢复只改了内存 ctx.data 并 touch，未写 IndexedDB，
   * 导致「已恢复成功」但刷新 / 重新登录后又从旧库 loadAll → 数据回滚到旧值。
   * 恢复（sync-down）完成后必须显式 commit 写盘。
   */
  function flushNow(ctx) {
    var g = (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : null));
    var app = (g && g.ERP && g.ERP.app) || ERP.app;
    if (app && typeof app.commit === 'function') return app.commit();
    return Promise.resolve(null);
  }

  /** 首次进入：读本机配置（V3 按账号），owner/repo 为空时尝试从当前网址猜 */
  function initCfg() {
    var cfg = sync.loadConfig(store(), syncAcctId());
    if (!cfg.owner || !cfg.repo) {
      var loc = typeof location !== 'undefined' ? location : null;
      var g = sync.guessFromLocation(loc);
      if (g) {
        cfg.owner = cfg.owner || g.owner;
        cfg.repo = cfg.repo || g.repo;
      }
    }
    return cfg;
  }

  function app() {
    return ERP.app || null;
  }

  /** 异步流程结束后：落库 + 重渲染 */
  function finish(state, msg, type) {
    state.busy = false;
    state.msg = msg || '';
    state.msgType = type || 'ok';
    if (msg) ui.toast(msg, type === 'err' ? 'err' : 'ok');
    var a = app();
    if (!a) return;
    Promise.resolve(a.commit ? a.commit() : null)
      .catch(function () { /* 落库失败已在 app 层提示 */ })
      .then(function () {
        if (a.render) a.render();
      });
  }

  var page = {
    name: 'mine',
    title: '我的',
    icon: '👤',

    init: function () {
      return {
        cfg: initCfg(),
        syncOpen: false,
        busy: false,
        msg: '',
        msgType: 'ok',
        // V3：店铺资料编辑
        editShop: false,
        shopNameEdit: '',
        avatarDataUrl: ''
      };
    },

    actions: {
      /** V3.54：检查更新——清空 SW 缓存 + 更新注册 + 重新拉取最新版本
       *  场景：部署新版本后，手机端仍显示旧界面（HTTP 缓存/SW 缓存残留）时手动强制刷新 */
      'check-update': function (ctx, state) {
        ui.toast('正在检查更新…', 'ok');
        var doReload = function () {
          try { location.reload(); } catch (e) { location.href = location.href; }
        };
        var hasSW = (typeof navigator !== 'undefined') && navigator.serviceWorker;
        var hasCaches = (typeof caches !== 'undefined') && caches && caches.keys;
        if (!hasSW) { doReload(); return false; }
        Promise.resolve(hasCaches ? caches.keys() : [])
          .then(function (keys) {
            return Promise.all((keys || []).map(function (k) { return caches.delete(k); }));
          })
          .catch(function () {})
          .then(function () { return navigator.serviceWorker.getRegistration(); })
          .then(function (reg) { return reg ? reg.update() : null; })
          .catch(function () {})
          .then(function () { doReload(); });
        return false; // 不重渲染，避免闪烁
      },

      /** 展开/收起同步设置 */
      'toggle-sync-cfg': function (ctx, state) {
        state.syncOpen = !state.syncOpen;
      },

      /** 同步设置字段（只记值，不重渲染，避免打断输入） */
      'sync-field': function (ctx, state, el) {
        var k = el.getAttribute('data-name');
        if (!k) return;
        state.cfg[k] = el.value;
      },

      /** 保存同步设置到本机 */
      'save-sync-cfg': function (ctx, state) {
        state.cfg = sync.saveConfig(store(), state.cfg, syncAcctId());
        var v = sync.validateConfig(state.cfg);
        if (!v.ok) {
          state.msg = '已保存，但还差：' + v.errors.join('；');
          state.msgType = 'err';
          ui.toast(v.errors[0], 'err');
          return true;
        }
        state.msg = '同步设置已保存在本机（不会上传、不进 Git）';
        state.msgType = 'ok';
        ui.toast('同步设置已保存', 'ok');
        return true;
      },

      /** 一键同步到云端（加密上传，覆盖历史） */
      'sync-up': function (ctx, state) {
        if (state.busy) return false;
        // V3.65：只读拉取账号（共用本店数据的员工）禁止上传，避免冲掉全店共享快照
        if (ctx.currentAccount && !sync.isDataOwner(ctx.currentAccount)) {
          state.msg = '本账号为只读拉取，不能上传到云端（仅归属账号 / 管理总控可上传）';
          state.msgType = 'err';
          ui.toast('本账号不能上传', 'err');
          return true;
        }
        state.cfg = sync.saveConfig(store(), state.cfg, syncAcctId());
        var v = sync.validateConfig(state.cfg);
        if (!v.ok) {
          state.syncOpen = true;
          state.msg = v.errors.join('；');
          state.msgType = 'err';
          ui.toast(v.errors[0], 'err');
          return true;
        }
        // V3.62：共用全店数据时，禁止用空账本覆盖云端共享快照（否则全店数据被清空）
        if (sharesBossData() && isEmptyLedger(ctx)) {
          state.syncOpen = true;
          state.msg = '已阻止上传：本机还是空账本，上传会把云端「全店共享数据」清空。请先点「从云端恢复」把本店数据拉到本机，再上传。';
          state.msgType = 'err';
          ui.toast('已阻止上传：本机是空账本', 'err');
          return true;
        }
        var run = function () {
        state.busy = true;
        state.msg = '正在加密并上传…';
        state.msgType = 'ok';
        // 问题3：上传前先把脏数据落库，保证本地 IndexedDB 与云端快照内容一致（避免刷新后本地仍是旧数据）
        return flushNow(ctx).then(function () {
          return sync.syncUp(ctx, state.cfg, undefined, syncAccountPublic()).then(function (r) {
            if (!r.ok) {
              finish(state, '同步失败：' + r.error, 'err');
              return;
            }
            if (r.skipped) {
              // 本地与云端内容一致：跳过上传
              finish(state, '✓ ' + (r.reason || '本地与云端一致，无需重新上传'), 'ok');
              return;
            }
            state.cfg.lastPushAt = r.at;
            state.cfg = sync.saveConfig(store(), state.cfg, syncAcctId());
            var up = Math.max(1, Math.round((r.uploadBytes || r.bytes) / 1024));
            finish(
              state,
              '☁️ 已同步到云端（' + r.summaryText + '，上传 ' + up + ' KB' +
              (r.compressed ? ' · 已压缩' : '') + '），云端历史已被覆盖',
              'ok'
            );
          });
        });
        };
        // V3.62：共用全店数据的账号上传会覆盖「全店共享快照」，先确认再执行
        if (sharesBossData()) {
          if (ui.confirm) {
            ui.confirm('同步到云端', '该账号<b>共用全店数据</b>，上传会<b>覆盖全店共享快照</b>，其他共用本店数据的账号从云端恢复时都会拿到本次上传的内容。<br>确定继续？')
              .then(function (yes) { if (yes) run(); });
            return false;
          }
        }
        return run();
      },

      /** 从云端恢复（下载解密，覆盖本地） */
      'sync-down': function (ctx, state) {
        if (state.busy) return false;
        state.cfg = sync.saveConfig(store(), state.cfg, syncAcctId());
        var v = sync.validateConfig(state.cfg);
        if (!v.ok) {
          // V3.79：员工（本机没有「同步设置」面板，V3.73）——**只要口令在手就走免 Token 公开通道**。
          // 场景：员工换新手机后本机配置为空（owner/repo/branch/path/token 全缺），但只要
          // 「取数口令」在，公开快照仍可拉取：它是 GitHub Pages 上的静态文件，读它不需要
          // Token，地址也能从在线网址自动推断。旧实现要求「错误里只缺 Token 一项」才降级，
          // 于是零配置的新设备会被拦下，用户只得看到「请填写 GitHub Token」这类死路。
          if (!canSelfFixSync(ctx)) {
            if (!needPhraseError(v.errors)) {
              publicDown(ctx, state);
              return false; // publicDown 内部走确认框 + finish 重渲染
            }
            // 缺口令 → 员工无论如何都拉不到（解密必需），给「找谁做什么」的指引
            state.msg = staffSyncHint(v.errors);
            state.msgType = 'err';
            ui.toast(state.msg, 'err');
            return true;
          }
          // 老板 / 数据归属者：行为不变——仅「只差 Token」时降级到公开通道，
          // 其余配置缺失仍展开「同步设置」面板让他自己补齐（他本来就有这个入口）。
          if (onlyMissingToken(v.errors)) {
            publicDown(ctx, state);
            return false; // publicDown 内部走确认框 + finish 重渲染
          }
          state.syncOpen = true;
          state.msg = v.errors.join('；');
          state.msgType = 'err';
          ui.toast(v.errors[0], 'err');
          return true;
        }
        var run = function () {
          state.busy = true;
          state.msg = '正在下载并解密…';
          state.msgType = 'ok';
          sync.syncDown(ctx, state.cfg, undefined, syncAccountPublic()).then(function (r) {
            if (!r.ok) {
              finish(state, '恢复失败：' + r.error, 'err');
              return;
            }
            if (r.skipped) {
              // 本地与云端内容一致：无需恢复
              finish(state, '✓ ' + (r.reason || '本地与云端一致，无需恢复'), 'ok');
              return;
            }
            // V3.4：写回云端账户档案（店铺名/头像/经营范围，不含密码哈希），保持双端账户设置一致
            if (r.account && accounts && ERP && ERP.currentAccount) {
              accounts.update(store(), ERP.currentAccount.id, {
                shopName: r.account.shopName,
                avatar: r.account.avatar,
                scopeCategories: r.account.scopeCategories
              });
              if (r.account.shopName) ERP.currentAccount.shopName = r.account.shopName;
              if (r.account.avatar) ERP.currentAccount.avatar = r.account.avatar;
            }
            state.cfg.lastPullAt = util.nowISO();
            state.cfg = sync.saveConfig(store(), state.cfg, syncAcctId());
            // 问题3修复：恢复的合并结果必须落库，否则刷新 / 重新登录后从旧库 loadAll → 数据回滚
            return flushNow(ctx).then(function () {
              finish(state, '⬇️ 已用云端快照覆盖本机（' + r.summaryText + '）', 'ok');
            });
          });
        };
        if (ui.confirm) {
          ui.confirm('从云端恢复', '将用云端快照<b>覆盖本机全部数据</b>，本机未同步的改动会丢失。<br>确定继续？')
            .then(function (yes) {
              if (yes) run();
            });
          return false;
        }
        run();
        return true;
      },

      /** 测试连接：用 checkAuth 快速诊断 Token 有效性 / 仓库可访问性 / 权限 */
      'test-sync-conn': function (ctx, state) {
        if (state.busy) return false;
        state.cfg = sync.saveConfig(store(), state.cfg, syncAcctId());
        var v = sync.validateConfig(state.cfg);
        if (!v.ok) {
          state.syncOpen = true;
          state.msg = '请先补全同步设置：' + v.errors.join('；');
          state.msgType = 'err';
          ui.toast(v.errors[0], 'err');
          return true;
        }
        state.busy = true;
        state.msg = '正在连接 GitHub 验证 Token 与仓库…';
        state.msgType = 'ok';
        sync.checkAuth(state.cfg).then(function (r) {
          if (r.ok) {
            finish(
              state,
              '✅ 连接成功：可访问仓库 ' + r.repo + (r.private ? '（私有）' : '（公开）') +
              '。若点「同步到云端」仍报权限错误，说明该 Token 还缺「Contents: Read and write」写权限',
              'ok'
            );
          } else {
            finish(state, '连接失败：' + r.error, 'err');
          }
        });
        return false;
      },

      /** 跳转店铺设置 */
      'go-shop-edit': function (ctx, state) {
        if (ERP.app && ERP.app.go) ERP.app.go('setting');
        else if (ui.toast) ui.toast('请到设置页修改店铺信息', 'ok');
      },

      /** V3：展开/收起店铺资料编辑 */
      'toggle-shop-edit': function (ctx, state) {
        state.editShop = !state.editShop;
        state.shopNameEdit = state.editShop ? (ctx.settings.shopName || '') : '';
        state.avatarDataUrl = '';
      },

      /** 店铺名称输入 */
      'shop-name-edit': function (ctx, state, el) {
        state.shopNameEdit = el.value;
      },

      /** 头像文件选择 → 读为 dataURL 预览（保存时写入 settings.avatar） */
      'pick-avatar': function (ctx, state, el) {
        if (!el || !el.files || !el.files.length) return false;
        var file = el.files[0];
        if (!/^image\//.test(file.type || '')) {
          if (ui.toast) ui.toast('请选择图片文件', 'err');
          return false;
        }
        if (file.size > 512 * 1024) {
          if (ui.toast) ui.toast('图片过大（≤500KB）', 'err');
          return false;
        }
        var reader = new FileReader();
        var self = state;
        reader.onload = function (e) {
          self.avatarDataUrl = String(e.target && e.target.result || '');
          var a = app();
          if (a && a.render) a.render();
        };
        reader.readAsDataURL(file);
        return false;
      },

      /** 保存店铺资料（店名 + 头像）→ settings + 账号列表同步（V3.76：员工动作层兜底拦截） */
      'save-shop': function (ctx, state) {
        var cur = ctx && ctx.currentAccount;
        if (cur && sync.isDataOwner && !sync.isDataOwner(cur)) {
          if (ui.toast) ui.toast('员工账号不能修改店铺资料（这是全店共享资料）', 'err');
          return false;
        }
        var name = String(state.shopNameEdit || '').trim();
        if (!name) {
          if (ui.toast) ui.toast('店铺名称不能为空', 'err');
          return false;
        }
        ctx.settings.shopName = name;
        if (state.avatarDataUrl) ctx.settings.avatar = state.avatarDataUrl;
        // 同步到账号列表（登录页展示用）
        if (accounts && ERP.currentAccount) {
          accounts.updateProfile(store(), ERP.currentAccount.id, {
            shopName: name,
            avatar: state.avatarDataUrl || (ctx.settings.avatar || '')
          });
          ERP.currentAccount.shopName = name;
          if (state.avatarDataUrl) ERP.currentAccount.avatar = state.avatarDataUrl;
        }
        // 保存 settings 到库
        var a = app();
        if (a && a.saveSettings) a.saveSettings();
        // 重渲染：立即刷新 favicon / 顶栏 logo / 网页名称
        if (a && a.render) a.render();
        state.editShop = false;
        state.msg = '店铺资料已保存';
        state.msgType = 'ok';
        if (ui.toast) ui.toast('店铺资料已保存', 'ok');
        return true;
      },

      /**
       * V3.78：切换账号 —— 退出当前登录并回到登录页（本机数据 / 账号表 / 云同步设置全部保留）。
       *
       * 与旧实现（直接 logout）的两点差别：
       *  1) 二次确认，避免误触就把人踢回登录页；
       *  2) 退出前先 commit 落库 —— 旧实现 `return false` 跳过了框架的 afterAction 落库，
       *     若手头刚录入的单据还在脏状态，退出后会丢。
       */
      'switch-account': function (ctx, state) {
        var a = app();
        if (!a || !a.logout) return false;
        var doLogout = function () {
          var p = a.commit ? a.commit() : null;
          if (p && typeof p.then === 'function') {
            p.then(function () { a.logout(); }, function () { a.logout(); });
          } else {
            a.logout();
          }
        };
        if (ui.confirm) {
          ui.confirm('切换账号',
            '将<b>退出当前登录</b>并回到登录页，换成另一个账号登录。<br>' +
            '本机数据、账号表与云同步设置都不会被删除，重新登录同一账号即可继续。')
            .then(function (yes) { if (yes) doLogout(); });
          return false; // 异步进行中：阻止默认 afterAction 重渲染
        }
        doLogout();
        return false;
      }
    },

    render: function (ctx, state) {
      return (
        '<div class="mobile-only">' + mobileMine(ctx, state) + '</div>' +
        '<div class="desktop-only">' + desktopMine(ctx, state) + '</div>'
      );
    }
  };

  /* ---------------- 桌面端我的（banner 收进手机端，桌面用 page-head） ---------------- */

  function desktopMine(ctx, state) {
    var s = ctx.settings || {};
    // V3.73：员工显示自己的账号名，不显示老板店铺名
    var cur = ctx && ctx.currentAccount;
    var headName = (!cur || sync.isDataOwner(cur))
      ? (s.shopName || '我的电器店')
      : (cur.shopName || cur.username || '员工账号');
    var h = '<div class="page-head"><h2>我的</h2>' +
      '<span class="desc">' + esc(headName) + ' · 进销存记账</span></div>';
    h += '<div class="mine-desktop">' + mobileMine(ctx, state, true) + '</div>';
    return h;
  }

  /* ---------------- 手机端我的（v2 设计图 1-3） ---------------- */

  function mobileMine(ctx, state, noBanner) {
    var s = ctx.settings || {};
    var cfg = state.cfg || sync.defaultConfig();

    var h = '';

    // 1. 薄荷绿 banner（桌面端由 page-head 替代，noBanner=true 时跳过）
    if (!noBanner) {
      h += '<div class="page-banner mine-banner">' +
        '<div class="banner-title">我的</div>' +
      '</div>';
    }

    // 2. 店铺信息卡片（头像 + 店名 + 经营范围 + 右箭头）—— V3：显示账号头像，可编辑
    //    V3.73：员工（非数据归属账号）只读展示自己的账号名，不再显示老板的店铺资料、
    //    也不提供编辑入口（员工点编辑会把店名/头像写进全店共享快照，V3.55 已堵写回，入口也一并收起）
    var curAcct = ctx && ctx.currentAccount;
    var isOwnerView = !curAcct || (sync.isDataOwner ? sync.isDataOwner(curAcct) : true);
    if (isOwnerView) {
      var scopeText = (ctx.settings.scopeCategories && ctx.settings.scopeCategories.length)
        ? (ctx.settings.scopeCategories.join(' / ')) : '全部分类';
      var avatarHtml = s.avatar
        ? '<img class="avatar-img" src="' + esc(s.avatar) + '" alt="">'
        : '<div class="avatar">⚡</div>';
      h += '<div class="shop-info-card" data-act="toggle-shop-edit">' +
        avatarHtml +
        '<div class="info">' +
          '<div class="name">' + esc(s.shopName || '我的电器店') + '</div>' +
          '<div class="sub">经营：' + esc(scopeText) + '</div>' +
        '</div>' +
        '<div class="arrow">›</div>' +
      '</div>';

      // V3：店铺资料编辑面板（店名 / 头像上传）
      // V3.78：「切换账号」移出本面板（原先藏在这个二级面板里，员工端还完全没有），
      //         统一提到下面的独立账号卡片，一眼可见
      if (state.editShop) {
        h += '<div class="card mt8 shop-edit-box">' +
          '<div class="card-title">店铺资料</div>' +
          '<div class="field"><label>店铺名称</label>' +
          '<input class="input" data-input="shop-name-edit" data-live="1" value="' + esc(state.shopNameEdit) + '" placeholder="如 我的电器店"></div>' +
          '<div class="field"><label>店铺头像</label>' +
          '<div class="row wrap"><input type="file" accept="image/*" data-change="pick-avatar" style="max-width:220px">' +
          (state.avatarDataUrl ? '<img class="avatar-preview" src="' + esc(state.avatarDataUrl) + '" alt="">' : '') +
          '</div><div class="small muted">支持 JPG/PNG，建议 500KB 以内</div></div>' +
          '<div class="row"><button class="btn btn-primary" data-act="save-shop">保存</button></div>' +
        '</div>';
      }

      // V3.78：账号卡片 —— 当前登录账号 + 「切换账号」入口（老板 / 独立数据账号）
      h += renderAccountCard(curAcct);
    } else {
      // V3.73：员工视图 —— 只显示自己的账号名（无编辑箭头、无老板经营范围）
      // V3.78：右侧补一个「切换账号」按钮（此前员工端没有任何切换入口，换账号只能清浏览器会话）
      var staffAvatar = curAcct.avatar
        ? '<img class="avatar-img" src="' + esc(curAcct.avatar) + '" alt="">'
        : '<div class="avatar">👤</div>';
      h += '<div class="shop-info-card">' +
        staffAvatar +
        '<div class="info">' +
          '<div class="name">' + esc(curAcct.shopName || curAcct.username || '员工账号') + '</div>' +
        '</div>' +
        '<button class="btn btn-sm" data-act="switch-account">切换账号</button>' +
      '</div>';
    }

    // 3. 云同步卡片（V3.59：拥有「数据管理」权限、或共用本店数据的员工均可看到——员工用于「从云端恢复」拉取）
    if (!accounts || accounts.can(curAcct, 'data_manage') || sharesBossData()) {
      h += renderSyncCard(state, cfg, curAcct);
    }

    // V2.3：管理员专属「权限管理」入口（普通账号不显示）
    if (curAcct && accounts && accounts.isAdmin(curAcct)) {
      h += '<div class="card mt8 admin-entry" data-act="go" data-page="admin">' +
        '<div class="row" style="align-items:center;gap:10px">' +
          '<span style="font-size:20px">🔐</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="name" style="font-weight:700">权限管理</div>' +
            '<div class="small muted">管理账号、分配权限与经营范围</div>' +
          '</div>' +
          '<span class="arrow">›</span>' +
        '</div>' +
      '</div>';
    }

    // 4. 常用入口（9 格圆形 3×3 九宫格）—— 关键字串「常用入口」保留；V3.59 按权限过滤
    h += renderQuickGrid(ctx);

    // 5. 关于 + 版本信息（V3.73：员工视图不显示——按需求员工页只留权限模块与「从云端恢复」）
    if (isOwnerView) h += renderAbout();

    return h;
  }

  /**
   * V3.62：云同步卡片上的「数据空间」说明。
   * 共用本店数据的员工账号，其快照路径与同步配置都归属老板账号——这里显式写出来，
   * 让「登录进来没数据」时可以一眼判断该从哪个库取数据。
   */
  function dataSpaceTip() {
    var a = (ERP && ERP.currentAccount) || null;
    if (!a) return '';
    var ownerId = syncAcctId() || (a.id || '');
    var dbName = schema && schema.dbNameFor ? schema.dbNameFor(ownerId) : ('applianceErp_' + ownerId);
    if (sharesBossData()) {
      return '数据空间：<b>共用本店数据</b>（归属 @' + esc(String(ownerId)) + '，库 ' + esc(dbName) + '）· 与老板同一本账，同步配置与快照路径也按归属账号走';
    }
    return '数据空间：<b>独立</b>（库 ' + esc(dbName) + '）· 与其他账号数据隔离';
  }

  /**
   * V3.78：账号卡片（老板 / 独立数据账号视图）—— 显示「当前登录账号」+「切换账号」按钮。
   *
   * 背景：此前全站唯一的切换入口藏在「店铺资料」二级编辑面板里（员工端完全没有），
   * 换账号只能靠清浏览器会话或换浏览器。用户要求把入口放到「我的」页并显眼可见。
   * 切换 = 退出登录回登录页（不预填账号），本机数据与账号表不受影响。
   */
  function renderAccountCard(curAcct) {
    var uname = (curAcct && (curAcct.username || curAcct.name)) || '本机账号';
    var role = '普通账号';
    if (!curAcct) role = '本机账号';
    else if (accounts && accounts.isAdmin && accounts.isAdmin(curAcct)) role = '管理总控';
    return '<div class="card mt8 account-switch-card">' +
      '<div class="row" style="align-items:center;gap:10px">' +
        '<span style="font-size:20px">🔄</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div class="name" style="font-weight:700">当前登录账号</div>' +
          '<div class="small muted">@' + esc(String(uname)) + ' · ' + esc(role) + '</div>' +
        '</div>' +
        '<button class="btn btn-sm" data-act="switch-account">切换账号</button>' +
      '</div>' +
    '</div>';
  }

  /**
   * V3.79：公开快照通道真正依赖的只有「取数口令」——
   * Token 不需要（读 GitHub Pages 静态文件无需写权限）、owner/repo 不需要
   * （`sync.publicBaseUrl` 能从在线网址 `<owner>.github.io/<repo>` 推断）、
   * branch/path 也用不上。所以「口令在手 = 具备拉取条件」，
   * 缺口令才是员工侧唯一无法自解的情况（此时需管理总控重发凭证）。
   */
  function needPhraseError(errors) {
    var list = errors || [];
    for (var i = 0; i < list.length; i++) {
      if (/口令/.test(String(list[i]))) return true;
    }
    return false;
  }

  /** V3.79：校验错误里「只差 Token」这一项（owner/repo/branch/path/口令都齐）→ 可走免 Token 公开通道 */
  function onlyMissingToken(errors) {
    var e = errors || [];
    if (!e || !e.length) return false;
    for (var i = 0; i < e.length; i++) {
      if (!/Token/.test(String(e[i]))) return false;
    }
    return true;
  }

  /**
   * V3.79：公开通道失败的提示 —— 必须转成「找谁做什么」的可执行动作。
   * 员工页按需求（V3.73）没有同步设置入口，只给技术错误码等于死路。
   */
  function publicDownHint(err) {
    var e = String(err == null ? '' : err);
    if (e === 'NO_PHRASE') {
      return '本机还没有「取数口令」，无法解密云端数据：请让管理总控在「账户权限管理」里重新保存一次你的密码（会重新发放取数凭证），然后你在本机重新登录一次即可自动获得。';
    }
    if (e === 'NO_CFG_PUBLIC') {
      return '无法推断云端地址：请用 GitHub Pages 在线地址打开本页（本地 file:// 双击打开时无法推断）。';
    }
    if (e === 'NO_SNAPSHOT') {
      return '云端还没有快照：请先让管理总控在「我的 → 云同步」点一次「同步到云端」。';
    }
    if (e === 'BAD_PHRASE') {
      return '取数口令不正确，解不开云端数据：请让管理总控重新保存一次你的密码，以重新发放取数凭证。';
    }
    return '从云端恢复失败：' + e;
  }

  /**
   * V3.79：员工（只读拉取、页面无同步设置入口）遇到配置不完整时**不能**再显示
   * 「请填写 GitHub Token（仅存本机）」这类本机无法自解的错误——那是一条死路。
   * 一律转成「找谁做什么」的指引。
   */
  function staffSyncHint(errors) {
    var list = errors || [];
    var needPhrase = false;
    for (var i = 0; i < list.length; i++) {
      if (/口令/.test(String(list[i]))) needPhrase = true;
    }
    if (needPhrase) return publicDownHint('NO_PHRASE');
    return '本机无法确定云端取数地址或口令：请用 GitHub Pages 在线地址打开本页；' +
      '若仍不行，请让管理总控在「账户权限管理」里重新保存一次你的密码（会重新发放取数凭证），然后你在本机重新登录一次即可。';
  }

  /** 当前账号能否自己修好同步配置（数据归属账号有「同步设置」面板；员工没有） */
  function canSelfFixSync(ctx) {
    var a = (ctx && ctx.currentAccount) || (ERP && ERP.currentAccount) || null;
    if (!a) return true; // 无账号上下文（单测/异常场景）按原逻辑走
    if (sync.isDataOwner) return !!sync.isDataOwner(a);
    return !a.ownerId;
  }

  /**
   * V3.80：当前账号是不是「员工（共用老板本店数据、只读拉取）」。
   *
   * 员工的本机数据永远是云端的一个**残缺副本**（恢复时按 createdBy 只取自己名下的单，
   * 且操作日志整表不下发）。这类账号从云端恢复时若继续用「记录级合并」，
   * 本机残留的旧草稿、改过的商品价格、被老板删掉的单据会一直混在里面，
   * 员工看到的数据与云端不一致却毫无察觉 —— 所以员工走**全量替换**。
   * 老板/管理总控是数据归属者，本机可能还有待上传的新单，必须保持合并，绝不能全量覆盖。
   */
  function isStaffAcct() {
    var a = (ERP && ERP.currentAccount) || null;
    if (!a || !a.id) return false;
    if (sync && typeof sync.isDataOwner === 'function') return !sync.isDataOwner(a);
    return !!(a.ownerId && String(a.ownerId) !== String(a.id));
  }

  /**
   * V3.80：物理清空本机 IndexedDB 的全部业务表。
   *
   * **为什么不能只改内存**：`repo.flush()` 只对脏记录做 `bulkPut`（upsert），
   * **不会删除**数据库里存在、而当前列表里没有的记录。只在 ctx.data 上替换，
   * 员工当下看不到旧数据，刷新页面 `loadAll` 一读库，旧数据又全回来了。
   * （`page-setting.js` 的 clear-data 动作同样踩过这个坑，注释里已写明。）
   */
  function clearLocalStores() {
    var a = app();
    var db = a && a.db;
    if (!db || typeof db.clear !== 'function') return Promise.resolve(null);
    var names = (schema && schema.DATA_STORES) || [];
    return names.reduce(function (p, name) {
      return p.then(function () {
        return Promise.resolve(db.clear(name))['catch'](function () { return null; });
      });
    }, Promise.resolve(null));
  }

  /**
   * V3.79：免 Token 的「公开快照通道」恢复。
   *
   * **断链修复**：`sync.pullSnapshotPublic()`（V3.65 写好，注释明确写着「员工端没有 Token
   * 也能取数」）**从未被任何代码调用**；而 `sync.syncDown()` 在 validateConfig 里强制要求
   * Token。于是员工换新手机 / 老板换新电脑后，本机没有 Token → 点「从云端恢复」直接报
   * 「请填写 GitHub Token（仅存本机）」，而员工的「我的」页按 V3.73 需求没有同步设置入口
   * —— 用户被卡死在最后一步（V3.69 的「零配置自助取数」因此没有真正闭环）。
   *
   * 修复：只缺 Token 时改读 GitHub Pages 上的**公开静态快照**（读公开文件不需要写权限），
   * 口令用登录时 V3.69 自动认领的「取数口令」；按权限过滤（只取本账号名下的单）在 core 层完成。
   */
  function publicDown(ctx, state) {
    // V3.80：员工 = 全量替换（先清空本机再整体下载）；老板 = 记录级合并（保本机待上传数据）
    var staffMode = isStaffAcct();
    var run = function () {
      state.busy = true;
      state.msg = staffMode
        ? '正在清空本机数据并重新下载云端数据…'
        : '正在从云端公开快照恢复（免 Token 模式）…';
      state.msgType = 'ok';
      return sync.pullSnapshotPublic(
        store(), syncAcctId(), state.cfg.passphrase, undefined,
        (ERP && ERP.currentAccount) || null
      ).then(function (r) {
        if (!r.ok) {
          finish(state, publicDownHint(r.error), 'err');
          return;
        }
        // V3.80：员工走 merge:false（全量覆盖 = 云端数据整体替换本机残副本）；
        // 老板仍走 merge:true，本机待上传的新单不会被覆盖掉。
        var applied = sync.applySnapshotText(ctx, r.text, { merge: !staffMode });
        if (!applied.ok) {
          finish(state, '恢复失败：' + applied.error, 'err');
          return;
        }
        // 与 Token 通道一致：写回云端账户档案（店铺名/头像/经营范围，不含密码哈希）
        if (applied.account && accounts && ERP.currentAccount) {
          accounts.update(store(), ERP.currentAccount.id, {
            shopName: applied.account.shopName,
            avatar: applied.account.avatar,
            scopeCategories: applied.account.scopeCategories
          });
          if (applied.account.shopName) ERP.currentAccount.shopName = applied.account.shopName;
          if (applied.account.avatar) ERP.currentAccount.avatar = applied.account.avatar;
        }
        state.cfg.lastPullAt = util.nowISO();
        state.cfg = sync.saveConfig(store(), state.cfg, syncAcctId());
        // V3.80：员工先把本机旧数据从 IndexedDB 里物理清掉，再落库云端数据；
        // 否则 flush 只做 upsert，旧记录会残留，刷新页面后又复活。
        return Promise.resolve(staffMode ? clearLocalStores() : null)
          .then(function () { return flushNow(ctx); })
          .then(function () {
            finish(state, staffMode
              ? '⬇️ 已清空本机数据并从云端重新拉取完成（本机数据与云端完全一致）：' + applied.summaryText
              : '⬇️ 已从云端恢复（免 Token 模式 · 按权限只取本账号名下的单）：' + applied.summaryText, 'ok');
          });
      });
    };
    if (ui.confirm) {
      if (staffMode) {
        ui.confirm('从云端恢复（清空本机后重新拉取）',
          '将<b>先删除本机全部数据</b>（商品、单据、库存、记账等），再从云端<b>整体下载</b>最新数据。<br>' +
          '<b>本机未同步到云端的改动会全部丢失</b>，恢复后本机与云端完全一致。<br>' +
          '（不需要 GitHub Token）确定继续？')
          .then(function (yes) { if (yes) run(); });
      } else {
        ui.confirm('从云端恢复（免 Token 模式）',
          '将读取云端<b>公开快照</b>并用本机「取数口令」解密（<b>不需要 GitHub Token</b>）。<br>' +
          '恢复会把云端数据合并到本机，本机未同步的改动可能被覆盖。确定继续？')
          .then(function (yes) { if (yes) run(); });
      }
      return false;
    }
    run();
    return true;
  }

  /** 云同步卡片（按图1布局）；V3.73：员工（只读拉取）只显示「从云端恢复」按钮，其余说明/设置/状态全部不显示 */
  function renderSyncCard(state, cfg, curAcct) {
    var busy = !!state.busy;
    var lastPush = cfg.lastPushAt ? (util.fmtDateTime ? util.fmtDateTime(cfg.lastPushAt) : cfg.lastPushAt) : '';
    // V3.65：共用本店数据的员工为「只读拉取」，不能上传到云端（避免冲掉全店共享快照）
    var canUpload = !curAcct || sync.isDataOwner(curAcct);

    if (!canUpload) {
      var hs = '<div class="card sync-card"><div class="sync-actions">' +
        '<button class="sync-btn cloud-down" data-act="sync-down"' + (busy ? ' disabled' : '') + '>' +
          '<span class="ico">⬇</span>' +
          '<span class="t">' + (busy ? '恢复中…' : '从云端恢复') + '</span>' +
        '</button>' +
      '</div>';
      if (state.msg) {
        hs += '<div class="notice ' + (state.msgType === 'err' ? 'notice-danger' : 'notice-info') + ' mt8">' +
          esc(state.msg) + '</div>';
      }
      hs += '</div>';
      return hs;
    }

    var h = '<div class="card sync-card">' +
      '<div class="sync-head">' +
        '<div class="sync-title">☁ 云同步 <span class="sync-sub">(GitHub Pages)</span></div>' +
        '<button class="sync-setting-btn" data-act="toggle-sync-cfg">同步设置</button>' +
      '</div>' +
      '<div class="sync-actions">' +
        (canUpload
          ? '<button class="sync-btn cloud-up" data-act="sync-up"' + (busy ? ' disabled' : '') + '>' +
              '<span class="ico">☁</span>' +
              '<span class="t">' + (busy ? '同步中…' : '同步到云端') + '</span>' +
            '</button>'
          : '<button class="sync-btn cloud-up" disabled title="只读拉取账号不能上传">' +
              '<span class="ico">☁</span>' +
              '<span class="t">同步到云端（只读）</span>' +
            '</button>') +
        '<button class="sync-btn cloud-down" data-act="sync-down"' + (busy ? ' disabled' : '') + '>' +
          '<span class="ico">⬇</span>' +
          '<span class="t">从云端恢复</span>' +
        '</button>' +
      '</div>' +
      (canUpload
        ? '<div class="sync-tip">' +
            '把本机账本加密上传到仓库固定路径，每次覆盖历史；换手机/电脑打开同一网址后点「从云端恢复」，输入同一同步口令即可拿到最新数据。' +
          '</div>'
        : '<div class="sync-tip">' +
            '本账号为<b>只读拉取</b>：只能从云端恢复本店数据（且按权限只取自己名下的单），<b>不能上传</b>，以免冲掉全店共享快照。' +
          '</div>') +
      // V3.62：显式标出本次同步归属的数据空间，避免「员工拉不到本店数据」时无从判断
      '<div class="sync-status">' + dataSpaceTip() + '</div>' +
      '<div class="sync-status">' +
        (lastPush ? '上次同步：<b>' + esc(lastPush) + '</b>' : '还没同步过') +
      '</div>';

    if (state.msg) {
      h += '<div class="notice ' + (state.msgType === 'err' ? 'notice-danger' : 'notice-info') + ' mt8">' +
        esc(state.msg) + '</div>';
    }

    // 同步设置展开面板
    if (state.syncOpen) {
      h += '<div class="sync-cfg-panel">' +
        field('GitHub 用户名', 'owner', cfg.owner, 'bailihongxi') +
        field('仓库名', 'repo', cfg.repo, 'shoes-clothing-erp') +
        field('分支', 'branch', cfg.branch, 'gh-pages') +
        field('快照路径', 'path', cfg.path, 'data/erp-snapshot.json') +
        field('GitHub Token', 'token', cfg.token, 'github_pat_… 仅存本机', 'password') +
        field('同步口令', 'passphrase', cfg.passphrase, '至少 6 位，换设备恢复要用同一口令', 'password') +
        '<div class="row mt8">' +
        '<button class="btn btn-primary btn-sm" data-act="save-sync-cfg">保存同步设置</button>' +
        '<button class="btn btn-sm" data-act="test-sync-conn">测试连接</button></div>' +
        '<ul class="about-list small mt8">' +
        '<li>Token 去 GitHub → Settings → Developer settings → Fine-grained tokens 生成，' +
        '只勾这一个仓库的 <b>Contents: Read and write</b>。</li>' +
        '<li>上传的是 <b>AES-GCM 密文</b>，公开仓库里别人也看不到你的经营数据。</li>' +
        '<li>Token 与口令只存在这台设备的浏览器里，不会上传、不进 Git、不进备份文件。</li>' +
        '<li>口令丢了云端快照就解不开了，请自己记牢。</li>' +
        '</ul>' +
      '</div>';
    }

    h += '</div>';
    return h;
  }

  /** 8 格圆形快捷入口（2 行 4 列），图标与首页「快捷入口」统一；开单统一为手推车样式；V3.59 按权限过滤 */
  function renderQuickGrid(ctx) {
    var acct = (ctx && ctx.currentAccount) || ERP.currentAccount;
    var items = [
      { page: 'sale',      icon: '🛒', text: '销售',     color: 'c-green' },
      { page: 'purchase',  icon: '🚚', text: '进货',     color: 'c-teal' },
      { page: 'product',   icon: '📦', text: '商品',     color: 'c-blue' },
      { page: 'supplier',  icon: '👤', text: '供应商',   color: 'c-yellow' },
      { page: 'customer',  icon: '🤝', text: '客户',     color: 'c-teal' },
      { page: 'inventory', icon: '🗄️', text: '库存',     color: 'c-teal' },
      { page: 'account',   icon: '📒', text: '记账中心', color: 'c-purple' },
      { page: 'report',    icon: '📈', text: '报表',     color: 'c-pink' },
      { page: 'exchange',  icon: '🔁', text: '退换货',   color: 'c-peach' },
      { page: 'setting',   icon: '⚙', text: '设置',     color: 'c-gray' }
    ].filter(function (it) {
      // V3.59：无权限入口隐藏（未分配的功能员工不可见）
      return !accounts || accounts.canView(acct, it.page);
    });
    var h = '<div class="card quick-grid-card"><h3 class="card-title">常用入口</h3><div class="quick-grid mine-quick">';
    items.forEach(function (it) {
      h += '<button class="quick-circle ' + it.color + '" data-act="go" data-page="' + esc(it.page) + '"' +
        (it.query ? ' data-query="' + esc(it.query) + '"' : '') + '>' +
        '<span class="disc">' + it.icon + '</span>' +
        '<span class="text">' + esc(it.text) + '</span>' +
      '</button>';
    });
    h += '</div></div>';
    return h;
  }

  /** 关于 + 版本信息 */
  function renderAbout() {
    return (
      '<div class="card about-card">' +
        '<h3 class="card-title">关于</h3>' +
        '<ul class="about-list">' +
          '<li>版本：V3.83（schema v' + schema.VERSION + '）</li>' +
          '<li>数据存储于本机 IndexedDB</li>' +
          '<li>自动备份保障数据安全</li>' +
        '</ul>' +
        '<div class="row mt8" style="flex-wrap:wrap;gap:8px;align-items:center">' +
          '<button class="btn btn-sm" data-act="check-update">🔄 检查更新</button>' +
          '<span class="small weak">界面还是旧版时点这里，强制拉取最新版本</span>' +
        '</div>' +
      '</div>'
    );
  }

  function field(label, name, value, placeholder, type) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input class="input" type="' + (type || 'text') + '" data-input="sync-field" data-name="' + esc(name) + '" ' +
      'placeholder="' + esc(placeholder || '') + '" value="' + esc(value === undefined || value === null ? '' : value) + '" ' +
      'autocomplete="off" spellcheck="false"></div>';
  }

  page.renderSync = renderSyncCard;
  // V3.79：导出两个纯函数便于单测（校验判定 + 失败文案映射）
  page.needPhraseError = needPhraseError;
  page.onlyMissingToken = onlyMissingToken;
  page.publicDownHint = publicDownHint;
  page.staffSyncHint = staffSyncHint;
  // V3.80：导出「是否员工账号」判定，供员工/老板两条恢复路径的回归断言使用
  page.isStaffAcct = isStaffAcct;

  return page;
});