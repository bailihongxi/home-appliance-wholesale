/**
 * 修复：手机版本登录为空白页
 * 根因：sw.js Service Worker 缓存列表缺少 V3 新增文件（accounts.js/page-login.js/legacy-migrate.js），
 *       且缓存版本号未升级，手机端 SW 返回缓存的旧版 index.html（无 V3 脚本）→ 登录页渲染失败空白。
 * 验证：CACHE 版本升级、SHELL 包含 V3 新增文件、导航请求后台更新。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

test('sw.js CACHE 版本已升级（不再是旧版 v6）', () => {
  const m = sw.match(/var CACHE\s*=\s*'([^']+)'/);
  assert.ok(m, '应定义 CACHE 变量');
  assert.notStrictEqual(m[1], 'shoe-erp-v6', '缓存版本应已升级，不能停留在 v6');
  assert.ok(/v\d+/.test(m[1]), '版本号格式应为 vN');
});

test('sw.js SHELL 包含 V3 新增核心文件', () => {
  const required = [
    './js/core/accounts.js',
    './js/core/legacy-migrate.js',
    './js/ui/page-login.js'
  ];
  required.forEach((f) => {
    assert.ok(sw.includes("'" + f + "'"), 'SHELL 应包含 ' + f);
  });
});

test('sw.js SHELL 包含所有已有页面和核心模块（无遗漏）', () => {
  // 核心模块
  ['util.js', 'schema.js', 'sync.js', 'db.js', 'repo.js', 'engine.js'].forEach((f) => {
    assert.ok(sw.includes(f), 'SHELL 应包含核心模块 ' + f);
  });
  // 所有业务页面
  ['page-home.js', 'page-product.js', 'page-sale.js', 'page-inventory.js',
   'page-mine.js', 'page-admin.js', 'page-setting.js', 'page-report.js', 'page-login.js',
   'page-supplier.js', 'page-customer.js'].forEach((f) => {
    assert.ok(sw.includes(f), 'SHELL 应包含页面 ' + f);
  });
});

test('sw.js SHELL 包含单据打印模块 print-doc.js', () => {
  assert.ok(sw.includes("'./js/ui/print-doc.js'"), 'SHELL 应包含单据打印模块（销售单/进货单打印）');
});

test('sw.js 导航与静态资源使用 network-first（在线拿最新，离线回退缓存）', () => {
  // V3.34 起：全部请求 network-first——在线一律拿最新页面与资源，
  // 杜绝「旧缓存让用户首次打开看不到新功能」；离线时才回退缓存外壳。
  const block = sw.slice(sw.indexOf("self.addEventListener('fetch'"));
  assert.ok(block.includes('fetch(req)'), '应先尝试网络获取最新资源');
  assert.ok(block.includes('caches.match(req)'), '网络失败时回退到缓存');
  assert.ok(block.includes('.catch(function ()'), '离线走 catch 回退分支');
  // 不应再存在 cache-first 的「先返回缓存再后台更新」逻辑
  assert.ok(!block.includes('cached || net') && !block.includes('cached||net'),
    '不应先返回缓存（已改为 network-first 防止旧缓存卡版本）');
  // 导航请求仍有后台更新缓存逻辑（在线响应写回缓存供离线使用）
  const navBlock = sw.slice(sw.indexOf("req.mode === 'navigate'"));
  assert.ok(navBlock.includes('caches.open(CACHE)'), '导航请求应将新响应写入缓存');
});

test('sw.js activate 事件清除旧版本缓存', () => {
  assert.ok(sw.includes("keys.filter(function (k) { return k !== CACHE; })"),
    'activate 应删除非当前版本的旧缓存');
  assert.ok(sw.includes('self.skipWaiting()'), 'install 应 skipWaiting 立即生效');
});

test('index.html：本地开发（localhost）注销 SW 避免缓存干扰，线上才注册 SW', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes("host === 'localhost' || host === '127.0.0.1'"),
    '应识别本地开发主机');
  assert.ok(html.includes("r.unregister()"), '本地应注销历史 SW 注册');
  assert.ok(html.includes("navigator.serviceWorker.register('sw.js')"),
    '线上（https）仍应注册 SW');
});
