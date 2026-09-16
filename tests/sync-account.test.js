/**
 * tests/sync-account.test.js —— V3.4 增强：云同步除业务数据外，系统整体参数设置（settings）
 * 与账户设置（脱敏账户档案：店铺名/头像/经营范围）也随快照同步；且各账户数据/设置/同步路径
 * 完全隔离，不与其它账户或其它项目（鞋服母版）公用数据库。
 *
 * 覆盖：
 * 1) settings（系统参数）进快照并在恢复时更新本地；
 * 2) 账户档案进快照且脱敏（不含密码哈希）；
 * 3) syncUp 上传含账户档案、syncDown 返回账户档案供写回；
 * 4) 按账户隔离：sync 配置 key / 云路径按账户区分；命名空间独立于鞋服母版。
 */
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../js/core/sync.js');
const backup = require('../js/core/backup.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

/** 内存云端：path -> { sha, content(base64 信封文本) }（与 sync-consistency 同款） */
function makeCloud() {
  const store = {};
  let n = 0;
  function pathOf(url) {
    const m = String(url).split('?')[0].match(/\/contents\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : String(url);
  }
  function fetchImpl(url, opts) {
    const method = (opts && opts.method) || 'GET';
    return Promise.resolve().then(() => {
      const path = pathOf(url);
      if (method === 'GET') {
        const rec = store[path];
        if (!rec) return { status: 404, ok: false, text: () => Promise.resolve('{"message":"Not Found"}') };
        return { status: 200, ok: true, json: () => Promise.resolve({ sha: rec.sha, content: rec.content }) };
      }
      if (method === 'PUT') {
        const body = JSON.parse(opts.body);
        const rec = store[path];
        if (rec && body.sha && rec.sha !== body.sha) {
          return { status: 422, ok: false, text: () => Promise.resolve('{"message":"sha mismatch"}') };
        }
        n += 1;
        const sha = 'blob' + n;
        store[path] = { sha, content: body.content };
        return { status: 201, ok: true, json: () => Promise.resolve({ commit: { sha: 'commit' + n } }) };
      }
      return { status: 500, ok: false, text: () => Promise.resolve('{}') };
    });
  }
  return { fetchImpl, store };
}

const CFG = {
  owner: 'bailihongxi', repo: 'home-appliance-wholesale', branch: 'gh-pages',
  path: 'data/acct1/erp-snapshot.json', token: 't', passphrase: 'test-pass-123456'
};

/** 脱敏账户档案（等价 accounts.strip 输出，无 hash） */
const ACCOUNT = {
  id: 'acct1', username: 'appliance', shopName: '大家电店旗舰',
  role: 'user', avatar: 'data:image/svg+xml;base64,AAAA', scopeCategories: ['冰箱', '空调'], createdAt: '2026-09-01'
};

test('系统参数设置（settings）进快照，且不含同步口令', () => {
  const ctx = newCtx();
  ctx.settings.shopName = '大家电店旗舰';
  ctx.settings.lowStock = 5;
  ctx.settings.sync = { owner: 'x', repo: 'y', token: 'SECRET_TOKEN' }; // 模拟误存
  const snap = sync.buildSnapshotText(ctx);
  const obj = JSON.parse(snap.text);
  assert.ok(obj.settings, '快照含 settings');
  assert.strictEqual(obj.settings.shopName, '大家电店旗舰', '店铺名随快照同步');
  assert.strictEqual(obj.settings.lowStock, 5, '库存预警阈值随快照同步');
  assert.ok(!obj.settings.sync, '同步口令/token 绝不进快照');
  assert.ok(!snap.text.includes('SECRET_TOKEN'), '快照明文不含 token');
});

test('账户设置（脱敏档案）进快照：店铺名/头像/经营范围同步，且不含密码哈希', () => {
  const ctx = newCtx();
  const snap = sync.buildSnapshotText(ctx, ACCOUNT);
  const obj = JSON.parse(snap.text);
  assert.ok(obj.account, '快照含账户档案');
  assert.strictEqual(obj.account.shopName, '大家电店旗舰', '店铺名同步');
  assert.strictEqual(obj.account.avatar, ACCOUNT.avatar, '头像同步');
  assert.deepStrictEqual(obj.account.scopeCategories, ['冰箱', '空调'], '经营范围同步');
  assert.ok(obj.account.hash === undefined, '不含密码哈希 hash');
  assert.ok(obj.account.password === undefined, '不含明文密码');
  assert.ok(!snap.text.includes('hash') || obj.account.hash === undefined, '快照不携带 hash');
});

test('syncUp 上传快照含账户档案（电脑端设置/数据一起上传）', async () => {
  const cloud = makeCloud();
  const ctx = newCtx();
  product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  const r = await sync.syncUp(ctx, CFG, cloud.fetchImpl, ACCOUNT);
  assert.strictEqual(r.ok, true, '上传成功');
  const env = JSON.parse(sync.base64ToText(cloud.store[CFG.path].content));
  const text = await sync.decrypt(env, CFG.passphrase);
  const obj = JSON.parse(text);
  assert.strictEqual(obj.account.shopName, '大家电店旗舰', '上传快照含账户档案');
  assert.strictEqual(obj.settings.shopName, '我的电器店', '上传快照含系统参数');
});

test('syncDown 返回云端账户档案，供手机端写回店铺名/头像/经营范围', async () => {
  const cloud = makeCloud();
  // 电脑端上传：业务数据 + 系统参数 + 账户档案
  const pc = newCtx();
  product.save(pc, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  pc.settings.shopName = '大家电店旗舰';
  await sync.syncUp(pc, CFG, cloud.fetchImpl, ACCOUNT);

  // 手机端（不同 ctx）从云端恢复：得到账户档案 + 系统参数
  const phone = newCtx();
  const r = await sync.syncDown(phone, CFG, cloud.fetchImpl, ACCOUNT);
  assert.strictEqual(r.ok, true, '恢复成功');
  assert.ok(r.account, '返回云端账户档案');
  assert.strictEqual(r.account.shopName, '大家电店旗舰', '账户店铺名可写回');
  assert.strictEqual(r.account.avatar, ACCOUNT.avatar, '账户头像可写回');
  assert.deepStrictEqual(r.account.scopeCategories, ['冰箱', '空调'], '账户经营范围可写回');
  assert.strictEqual(phone.settings.shopName, '大家电店旗舰', '系统参数随恢复更新到手机端');
});

test('设置与账户按账户隔离：sync 配置 key / 云路径不与其他账户或项目公用', () => {
  // 命名空间独立（不与鞋服母版 erp.* / shoeErp 共用）
  assert.strictEqual(sync.CONFIG_KEY, 'applianceErp.sync.config', '同步配置键使用 applianceErp 命名空间');
  // 按账户隔离
  assert.strictEqual(sync.configKeyFor('acct1'), 'applianceErp.sync.config.acct1');
  assert.strictEqual(sync.configKeyFor('acct2'), 'applianceErp.sync.config.acct2');
  assert.notStrictEqual(sync.configKeyFor('acct1'), sync.configKeyFor('acct2'), '不同账户配置键互不相同');
  assert.strictEqual(sync.defaultPathFor('acct1'), 'data/acct1/erp-snapshot.json');
  assert.strictEqual(sync.defaultPathFor('acct2'), 'data/acct2/erp-snapshot.json');
  assert.notStrictEqual(sync.defaultPathFor('acct1'), sync.defaultPathFor('acct2'), '不同账户云端路径互不相同');
  // 快照自标识 appliance-erp（不与鞋服项目数据混用）
  const ctx = newCtx();
  const obj = JSON.parse(sync.buildSnapshotText(ctx).text);
  assert.strictEqual(obj.app, 'appliance-erp', '快照应用标识独立');
});

test('恢复（merge）时系统参数保留两端：云端优先、本地独有键保留', async () => {
  const cloud = makeCloud();
  // 云端：shopName=云端店、lowStock=3
  const cloudCtx = newCtx();
  cloudCtx.settings.shopName = '云端店';
  cloudCtx.settings.lowStock = 3;
  const env = await sync.encrypt(sync.buildSnapshotText(cloudCtx).text, CFG.passphrase);
  cloud.store[CFG.path] = { sha: 'b1', content: sync.textToBase64(JSON.stringify(env)) };

  // 本地：shopName=本地店、units=默认台
  const local = newCtx();
  local.settings.shopName = '本地店';
  const r = await sync.syncDown(local, CFG, cloud.fetchImpl);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(local.settings.shopName, '云端店', '系统参数云端优先');
  assert.strictEqual(local.settings.lowStock, 3, '云端新增参数合并到本地');
});
