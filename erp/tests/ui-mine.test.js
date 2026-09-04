/**
 * 我的页（ui/page-mine.js）—— 问题2：云同步 403 诊断「测试连接」按钮
 * - 同步设置面板含「测试连接」按钮
 * - test-sync-conn：配置不全提示补全；checkAuth 成功/失败(403细分)分支
 */
const test = require('node:test');
const assert = require('node:assert');
const page = require('../js/ui/page-mine.js');
const sync = require('../js/core/sync.js');
const backup = require('../js/core/backup.js');
const schema = require('../js/core/schema.js');
const dbMod = require('../js/store/db.js');
const repo = require('../js/store/repo.js');
const { newCtx } = require('./helpers/ctx.js');

function fresh() {
  const ctx = newCtx();
  const state = page.init(ctx);
  return { ctx, state };
}

function fullCfg(state) {
  state.cfg.owner = 'bailihongxi';
  state.cfg.repo = 'home-appliance-wholesale';
  state.cfg.branch = 'gh-pages';
  state.cfg.path = 'data/erp-snapshot.json';
  state.cfg.token = 'ghp_test';
  state.cfg.passphrase = '12345678';
  return state.cfg;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('页面元数据与云同步卡片渲染', () => {
  assert.strictEqual(page.name, 'mine');
  const { ctx, state } = fresh();
  const html = page.render(ctx, state);
  assert.ok(html.includes('云同步'));
  assert.ok(html.includes('同步到云端'));
  assert.ok(html.includes('从云端恢复'));
  assert.ok(html.includes('同步设置'));
});

test('常用入口图标与首页快捷入口统一，开单为手推车样式', () => {
  const { ctx, state } = fresh();
  const html = page.render(ctx, state);
  assert.ok(html.includes('常用入口'), '含常用入口卡片');
  // 图标与首页快捷入口一致：进货🚚 商品📦 库存🗄️ 记账📒 报表📈 退换货🔁
  assert.ok(html.includes('🚚'), '进货图标与首页一致(🚚)');
  assert.ok(html.includes('📦'), '商品图标与首页一致(📦)');
  assert.ok(html.includes('🗄️'), '库存图标与首页一致(🗄️)');
  assert.ok(html.includes('📒'), '记账图标与首页一致(📒)');
  assert.ok(html.includes('📈'), '报表图标与首页一致(📈)');
  assert.ok(html.includes('🔁'), '退换货图标与首页一致(🔁)');
  // 开单统一使用手推车 🛒
  assert.ok(html.includes('🛒'), '开单为手推车样式(🛒)');
  // 不再使用旧图标
  assert.ok(!html.includes('🛍'), '不再用旧进货图标');
  assert.ok(!html.includes('▦'), '不再用旧库存图标');
  assert.ok(!html.includes('➕'), '开单不再用加号');
  // 供应商/设置为我的页独有，保留原图标
  assert.ok(html.includes('👤'), '供应商保留');
  assert.ok(html.includes('⚙'), '设置保留');
});

test('同步设置展开：含「测试连接」与「保存同步设置」按钮', () => {
  const { ctx, state } = fresh();
  state.syncOpen = true;
  const html = page.render(ctx, state);
  assert.ok(html.includes('data-act="test-sync-conn"'), '渲染测试连接按钮');
  assert.ok(html.includes('data-act="save-sync-cfg"'), '保留保存同步设置按钮');
});

test('测试连接-配置不全：提示补全同步设置', () => {
  const { ctx, state } = fresh();
  state.cfg.token = ''; // 缺 Token
  page.actions['test-sync-conn'](ctx, state);
  assert.ok(state.msg.includes('补全同步设置'), '提示补全: ' + state.msg);
  assert.strictEqual(state.msgType, 'err');
});

test('测试连接-成功：提示仓库可访问，busy 复位', async () => {
  const { ctx, state } = fresh();
  fullCfg(state);
  const orig = sync.checkAuth;
  sync.checkAuth = () => Promise.resolve({ ok: true, repo: 'bailihongxi/home-appliance-wholesale', private: false });
  try {
    page.actions['test-sync-conn'](ctx, state);
    assert.strictEqual(state.busy, true, '请求中 busy=true');
    await sleep(30);
    assert.ok(state.msg.includes('连接成功'), '成功提示: ' + state.msg);
    assert.ok(state.msg.includes('home-appliance-wholesale'), '显示仓库名');
    assert.strictEqual(state.msgType, 'ok');
    assert.strictEqual(state.busy, false, 'busy 复位');
  } finally {
    sync.checkAuth = orig;
  }
});

test('测试连接-失败(403 权限不足)：显示细分原因', async () => {
  const { ctx, state } = fresh();
  fullCfg(state);
  const orig = sync.checkAuth;
  sync.checkAuth = () => Promise.resolve({
    ok: false,
    error: 'GitHub 权限不足（403）：该 Token 缺少本仓库 Contents 写权限。请重新生成 Token 并勾选「Contents: Read and write」'
  });
  try {
    page.actions['test-sync-conn'](ctx, state);
    await sleep(30);
    assert.ok(state.msg.includes('连接失败'), '失败前缀: ' + state.msg);
    assert.ok(state.msg.includes('权限不足'), '细分原因');
    assert.strictEqual(state.msgType, 'err');
    assert.strictEqual(state.busy, false, 'busy 复位');
  } finally {
    sync.checkAuth = orig;
  }
});

test('测试连接-失败(401 Token 无效)：显示细分原因', async () => {
  const { ctx, state } = fresh();
  fullCfg(state);
  const orig = sync.checkAuth;
  sync.checkAuth = () => Promise.resolve({ ok: false, error: 'GitHub Token 无效或已过期（401），请重新生成' });
  try {
    page.actions['test-sync-conn'](ctx, state);
    await sleep(30);
    assert.ok(state.msg.includes('连接失败'));
    assert.ok(state.msg.includes('Token 无效或已过期'), '401 细分');
    assert.strictEqual(state.msgType, 'err');
  } finally {
    sync.checkAuth = orig;
  }
});

test('关于：版本号统一为 V3.11（与 PRD / 开发计划一致）', () => {
  const { ctx, state } = fresh();
  const html = page.render(ctx, state);
  assert.ok(html.includes('版本：V3.11'), '关于页显示 V3.11');
  assert.ok(html.includes('关于'), '含关于卡片');
  assert.ok(!html.includes('版本：V3.9）'), '不再显示旧版本号 V3.9');
  assert.ok(!html.includes('版本：V3.8）'), '不再显示旧版本号 V3.8');
  assert.ok(!html.includes('版本：V3.7）'), '不再显示旧版本号 V3.7');
  assert.ok(!html.includes('版本：V3.6）'), '不再显示旧版本号 V3.6');
  assert.ok(!html.includes('版本：V3.3）'), '不再显示旧版本号 V3.3');
  assert.ok(!html.includes('版本：V3.1）'), '不再显示旧版本号 V3.1');
  assert.ok(!html.includes('版本：V3.0）'), '不再显示更旧版本号');
});

test('常用入口：开单改为「销售」，点击直接进入销售管理列表页（无 tab=new）', () => {
  const { ctx, state } = fresh();
  const html = page.render(ctx, state);
  assert.ok(html.includes('>销售<'), '常用入口显示「销售」');
  assert.ok(!html.includes('开单'), '不再显示「开单」');
  // sale 入口不带 query → 直接进入销售管理列表页
  const m = html.match(/data-act="go" data-page="sale"[^>]*/);
  assert.ok(m && !m[0].includes('data-query'), '销售入口无 query，直接进入销售管理列表页');
});

test('V3.4-同步接线：syncUp/syncDown 传入脱敏账户档案，恢复后写回账户设置（店铺名/头像/经营范围，不含密码）', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'ui', 'page-mine.js'), 'utf8');
  // 上传与恢复都携带当前账户公开档案
  assert.ok(src.includes('sync.syncUp(ctx, state.cfg, undefined, currentAccountPublic())'), '同步到云端携带当前账户档案');
  assert.ok(src.includes('sync.syncDown(ctx, state.cfg, undefined, currentAccountPublic())'), '从云端恢复携带当前账户档案');
  // 恢复成功后写回账户设置（店铺名/头像/经营范围；不含密码哈希）
  assert.ok(src.includes('accounts.update(store(), ERP.currentAccount.id, {'), '恢复后写回账户设置');
  assert.ok(src.includes('shopName: r.account.shopName'), '写回店铺名');
  assert.ok(src.includes('avatar: r.account.avatar'), '写回头像');
  assert.ok(src.includes('scopeCategories: r.account.scopeCategories'), '写回经营范围');
  assert.ok(!src.includes('r.account.hash'), '账户密码哈希不参与同步写回');
});

test('问题3-从云端恢复后落库：合并结果写入本地库，重新加载不回滚', async () => {
  const memBackend = dbMod.memoryBackend();
  const db = await dbMod.create({ backend: memBackend, name: 'q3persist', version: 1 });
  // 本地初始：库存 5（旧）
  const data = schema.emptyData();
  data.products.push({
    id: 'p1', brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: 1000, priceWholesale: 1200, priceRetail: 1399, stock: 5, note: '',
    barcodes: [], status: 'on', createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z', stockAt: '2026-09-01T00:00:00Z'
  });
  const ctx = repo.createContext(data);
  ctx.touch('products', data.products[0]);
  await repo.flush(ctx, db); // 旧库存落库

  // 云端快照：库存 13（新）
  const cloud = newCtx();
  cloud.data.products.push({
    id: 'p1', brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: 1000, priceWholesale: 1200, priceRetail: 1399, stock: 13, note: '',
    barcodes: [], status: 'on', createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z', stockAt: '2026-09-02T00:00:00Z'
  });
  const cloudText = JSON.stringify(backup.build(cloud));

  // mock 云端下载：真实走 backup.restore 记录级合并（与 sync.syncDown 内部一致）
  const orig = sync.syncDown;
  sync.syncDown = (c, cfg, fetchImpl, acct) => {
    const r = backup.restore(c, cloudText, { merge: true });
    return Promise.resolve({ ok: true, skipped: false, at: 'x', summary: r.summary, summaryText: '商品1/库存13', account: null });
  };
  const oldApp = globalThis.ERP && globalThis.ERP.app;
  globalThis.ERP = globalThis.ERP || {};
  globalThis.ERP.app = { commit: () => repo.flush(ctx, db) };
  try {
    const state = page.init(ctx);
    fullCfg(state);
    page.actions['sync-down'](ctx, state); // ui.confirm 无 DOM → 确认后异步 run()
    await sleep(120);
    // 关键：恢复后数据已落库 —— 重新加载（模拟重登）不回滚
    const reloaded = await repo.loadAll(db);
    const p = reloaded.products.find((x) => x.id === 'p1');
    assert.ok(p, '重新加载后商品仍在');
    assert.strictEqual(p.stock, 13, '恢复后的新库存已落库，重新加载不回滚到旧库存5');
  } finally {
    sync.syncDown = orig;
    globalThis.ERP.app = oldApp;
  }
});

test('问题3-从云端恢复后落库：合并结果写入本地库，重新加载不回滚', async () => {
  const memBackend = dbMod.memoryBackend();
  const db = await dbMod.create({ backend: memBackend, name: 'q3persist', version: 1 });
  // 本地初始：库存 5（旧）
  const data = schema.emptyData();
  data.products.push({
    id: 'p1', brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: 1000, priceWholesale: 1200, priceRetail: 1399, stock: 5, note: '',
    barcodes: [], status: 'on', createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z', stockAt: '2026-09-01T00:00:00Z'
  });
  const ctx = repo.createContext(data);
  ctx.touch('products', data.products[0]);
  await repo.flush(ctx, db); // 旧库存落库

  // 云端快照：库存 13（新）
  const cloud = newCtx();
  cloud.data.products.push({
    id: 'p1', brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: 1000, priceWholesale: 1200, priceRetail: 1399, stock: 13, note: '',
    barcodes: [], status: 'on', createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z', stockAt: '2026-09-02T00:00:00Z'
  });
  const cloudText = JSON.stringify(backup.build(cloud));

  // mock 云端下载：真实走 backup.restore 记录级合并（与 sync.syncDown 内部一致）
  const orig = sync.syncDown;
  sync.syncDown = (c, cfg, fetchImpl, acct) => {
    const r = backup.restore(c, cloudText, { merge: true });
    return Promise.resolve({ ok: true, skipped: false, at: 'x', summary: r.summary, summaryText: '商品1/库存13', account: null });
  };
  const oldApp = globalThis.ERP && globalThis.ERP.app;
  globalThis.ERP = globalThis.ERP || {};
  globalThis.ERP.app = { commit: () => repo.flush(ctx, db) };
  try {
    const state = page.init(ctx);
    fullCfg(state);
    page.actions['sync-down'](ctx, state); // ui.confirm 无 DOM → 确认后异步 run()
    await sleep(120);
    // 关键：恢复后数据已落库 —— 重新加载（模拟重登）不回滚
    const reloaded = await repo.loadAll(db);
    const p = reloaded.products.find((x) => x.id === 'p1');
    assert.ok(p, '重新加载后商品仍在');
    assert.strictEqual(p.stock, 13, '恢复后的新库存已落库，重新加载不回滚到旧库存5');
  } finally {
    sync.syncDown = orig;
    globalThis.ERP.app = oldApp;
  }
});
