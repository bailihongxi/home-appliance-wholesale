/**
 * V3.60 账号云同步（跨端共用账号表）
 * - accounts.exportForSync：脱敏导出（含哈希、不含明文密码）
 * - accounts.mergeCloud：云端优先合并（admin 保护 / 同名保 id / 本地独有保留）
 * - sync.pushAccounts / pullAccounts：加密上传、下载解密（mock fetch）
 * - sync.findSyncConfig：配置查找（优先管理总控）
 * - page.tryCloudLogin：本地无账号 → 云端拉取合并 → 登录成功/失败
 */
const test = require('node:test');
const assert = require('node:assert');
const accounts = require('../js/core/accounts.js');
const sync = require('../js/core/sync.js');
const login = require('../js/ui/page-login.js');
const util = require('../js/core/util.js');

/** localStorage 风格内存 store（支持 key/length，供 findSyncConfig 遍历） */
function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
    _raw: m
  };
}

/** 造一个账号对象 */
function acct(over) {
  return Object.assign({
    id: 'acct9', username: 'staff', shopName: '店员', role: 'user',
    avatar: '', scopeCategories: [], perms: {}, ownerId: null,
    hash: util.hashPassword('123456'), createdAt: '2026-09-16'
  }, over || {});
}

/** mock GitHub fetch：记录调用；push 流程 GET(sha)→PUT，pull 流程 GET(content) */
function mockFetch(cloudEnv) {
  const calls = [];
  const f = (url, options) => {
    calls.push({ url, method: options ? options.method : 'GET', body: options ? options.body : null });
    const method = options ? options.method : 'GET';
    return Promise.resolve({
      status: method === 'PUT' ? 200 : (cloudEnv ? 200 : 404),
      ok: method === 'PUT' ? true : !!cloudEnv,
      json: () => Promise.resolve(method === 'PUT'
        ? { commit: { sha: 'c-abc' } }
        : (cloudEnv
          ? { sha: 's-1', content: sync.textToBase64(JSON.stringify(cloudEnv)) }
          : { message: 'Not Found' })),
      text: () => Promise.resolve(method === 'PUT' ? '' : '{"message":"Not Found"}'),
      headers: { get: () => '5000' }
    });
  };
  return { f, calls };
}

const CFG = { owner: 'bailihongxi', repo: 'home-appliance-wholesale', branch: 'gh-pages', token: 'tok-test', passphrase: 'sync-pass-123' };

/* ================= exportForSync ================= */

test('exportForSync：含哈希与权限/数据空间，不含明文密码', () => {
  const list = [acct({ username: 'staff', perms: { sale_bill: true }, ownerId: 'admin', hash: 'h1' })];
  const out = accounts.exportForSync(list);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].hash, 'h1', '保留哈希（登录校验所需）');
  assert.strictEqual(out[0].perms.sale_bill, true, '保留权限');
  assert.strictEqual(out[0].ownerId, 'admin', '保留数据空间');
  assert.strictEqual(out[0].password, undefined, '不含明文密码字段');
  assert.strictEqual(JSON.stringify(out).indexOf('123456'), -1, '明文密码值不出现');
});

/* ================= mergeCloud ================= */

test('mergeCloud：云端新增账号合并进本地', () => {
  const local = [acct({ id: 'admin', username: 'hawsystem', role: 'admin' })];
  const cloud = [acct({ id: 'acct1', username: 'staff1', ownerId: 'admin' })];
  const r = accounts.mergeCloud(local, cloud);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.list.length, 2);
  assert.ok(r.list.some((a) => a.username === 'staff1'), '云端账号已并入');
});

test('mergeCloud：云端同名账号更新本地，但保留本地 id（数据空间稳定）', () => {
  const local = [acct({ id: 'acct5', username: 'staff', perms: {}, ownerId: 'admin', hash: 'local-hash' })];
  const cloud = [acct({ id: 'acct2', username: 'staff', perms: { ws_bill: true }, ownerId: 'admin', hash: 'cloud-hash' })];
  const r = accounts.mergeCloud(local, cloud);
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(r.list.length, 1);
  const m = r.list[0];
  assert.strictEqual(m.id, 'acct5', '保留本地 id');
  assert.strictEqual(m.hash, 'cloud-hash', '内容以云端为准');
  assert.strictEqual(m.perms.ws_bill, true, '权限以云端为准');
});

test('mergeCloud：管理总控 admin 永远保留本地版本', () => {
  const local = [acct({ id: 'admin', username: 'hawsystem', role: 'admin', shopName: '管理总控', hash: 'local-admin-hash' })];
  const cloud = [acct({ id: 'admin', username: 'hawsystem', role: 'admin', shopName: '被篡改', hash: 'cloud-hash' })];
  const r = accounts.mergeCloud(local, cloud);
  assert.strictEqual(r.list.length, 1);
  assert.strictEqual(r.list[0].hash, 'local-admin-hash', '本地 admin 哈希不被覆盖');
  assert.strictEqual(r.list[0].shopName, '管理总控', '本地 admin 店名不被覆盖');
  assert.strictEqual(r.updated, 0, 'admin 不计为更新');
});

test('mergeCloud：本地独有账号保留（并集，不丢账号）', () => {
  const local = [acct({ id: 'admin', username: 'hawsystem', role: 'admin' }), acct({ id: 'acct7', username: 'localonly', ownerId: null })];
  const cloud = [acct({ id: 'acct1', username: 'staff', ownerId: 'admin' })];
  const r = accounts.mergeCloud(local, cloud);
  assert.strictEqual(r.list.length, 3, '并集：admin + 本地独有 + 云端新增');
  assert.ok(r.list.some((a) => a.username === 'localonly'), '本地独有保留');
  assert.ok(r.list.some((a) => a.username === 'staff'), '云端新增并入');
});

test('mergeCloud：空输入健壮性', () => {
  assert.strictEqual(accounts.mergeCloud(null, null).list.length, 0);
  assert.strictEqual(accounts.mergeCloud([], []).changed, false);
  const r = accounts.mergeCloud(undefined, [acct({ username: 'a1' })]);
  assert.strictEqual(r.added, 1);
});

/* ================= findSyncConfig ================= */

test('findSyncConfig：优先管理总控配置，其次遍历其他账号配置', () => {
  const store = memStore();
  sync.saveConfig(store, CFG, 'admin');
  const found = sync.findSyncConfig(store);
  assert.ok(found, '找到配置');
  assert.strictEqual(found.repo, CFG.repo);
  assert.strictEqual(found.passphrase, CFG.passphrase);
});

test('findSyncConfig：无管理总控配置时遍历其他账号配置', () => {
  const store = memStore();
  sync.saveConfig(store, CFG, 'acct3');
  const found = sync.findSyncConfig(store);
  assert.ok(found, '遍历到 acct3 配置');
  assert.strictEqual(found.owner, CFG.owner);
});

test('findSyncConfig：无任何配置返回 null', () => {
  const store = memStore();
  assert.strictEqual(sync.findSyncConfig(store), null);
  assert.strictEqual(sync.findSyncConfig(null), null);
});

/* ================= pushAccounts / pullAccounts ================= */

test('pushAccounts：加密上传到账号表固定路径', async () => {
  const store = memStore();
  sync.saveConfig(store, CFG, 'admin');
  const { f, calls } = mockFetch(null);
  const list = [acct({ username: 'staff' })];
  const r = await sync.pushAccounts(store, list, f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.count, 1);
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.ok(putCall, '发生 PUT');
  assert.ok(putCall.url.indexOf(sync.ACCOUNTS_PATH) >= 0, '上传到 accounts-sync.json 路径');
  const body = JSON.parse(putCall.body);
  const env = JSON.parse(sync.base64ToText(body.content));
  assert.strictEqual(env.kind, 'sync-snapshot', '是加密信封');
  assert.ok(!!env.ct, '密文存在');
  assert.ok(!/staff/.test(env.ct), '明文不直接出现在信封里');
});

test('pullAccounts：下载解密返回账号表；云端无表静默降级', async () => {
  const store = memStore();
  sync.saveConfig(store, CFG, 'admin');
  // 构造云端信封
  const text = JSON.stringify(sync.accountsBody([acct({ username: 'cloudstaff', ownerId: 'admin' })]));
  const env = await sync.encrypt(text, CFG.passphrase);
  const { f } = mockFetch(env);
  const r = await sync.pullAccounts(store, f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.list.length, 1);
  assert.strictEqual(r.list[0].username, 'cloudstaff');

  // 云端无表 → NO_SNAPSHOT
  const r2 = await sync.pullAccounts(store, mockFetch(null).f);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.error, 'NO_SNAPSHOT');

  // 本地无配置 → NO_CFG
  const r3 = await sync.pullAccounts(memStore(), mockFetch(null).f);
  assert.strictEqual(r3.ok, false);
  assert.strictEqual(r3.error, 'NO_CFG');
});

test('pushAccounts：未配置同步时给出明确错误', async () => {
  const r = await sync.pushAccounts(memStore(), [acct({})], null);
  assert.strictEqual(r.ok, false);
  assert.ok(/同步配置/.test(r.error), '提示配置缺失');
});

/* ================= tryCloudLogin ================= */

test('tryCloudLogin：本地无账号 → 云端拉取合并 → 登录成功（cloud=true）', async () => {
  const store = memStore();
  sync.saveConfig(store, CFG, 'admin');
  const cloudAcct = acct({ id: 'acct1', username: 'staff', ownerId: 'admin', hash: util.hashPassword('123456') });
  const text = JSON.stringify(sync.accountsBody([cloudAcct]));
  const env = await sync.encrypt(text, CFG.passphrase);
  const { f } = mockFetch(env);
  // 本地仅有 admin（预置）
  accounts.ensurePreset(store);
  const r = await login.tryCloudLogin(store, 'staff', '123456', f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.cloud, true, '依赖云端账号表');
  assert.strictEqual(r.account.username, 'staff');
  // 云端账号已合并进本地（后续登录无需再拉取）
  const local = accounts.load(store);
  assert.ok(local.some((a) => a.username === 'staff'), '账号已持久化到本地');
});

test('tryCloudLogin：云端合并后密码错误返回真实校验错误', async () => {
  const store = memStore();
  sync.saveConfig(store, CFG, 'admin');
  const cloudAcct = acct({ id: 'acct1', username: 'staff', hash: util.hashPassword('123456') });
  const env = await sync.encrypt(JSON.stringify(sync.accountsBody([cloudAcct])), CFG.passphrase);
  const { f } = mockFetch(env);
  accounts.ensurePreset(store);
  const r = await login.tryCloudLogin(store, 'staff', 'wrong', f);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.cloud, true);
  assert.ok(/密码错误/.test(r.error), '显示真实密码错误');
});

test('tryCloudLogin：云端无表/无配置 → 静默返回账号不存在（cloud=false）', async () => {
  // 有配置、云端无表
  const store = memStore();
  sync.saveConfig(store, CFG, 'admin');
  const r1 = await login.tryCloudLogin(store, 'nobody', '123456', mockFetch(null).f);
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.cloud, false);
  assert.ok(/账号不存在/.test(r1.error));

  // 无配置
  const r2 = await login.tryCloudLogin(memStore(), 'nobody', '123456', null);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.cloud, false);
  assert.ok(/账号不存在/.test(r2.error));
});

test('tryCloudLogin：本地已有账号无需云端也能登录（cloud=false 但成功）', async () => {
  const store = memStore();
  const created = accounts.create(store, { username: 'staff', password: '123456', shopName: '店员' });
  assert.strictEqual(created.ok, true);
  const r = await login.tryCloudLogin(store, 'staff', '123456', null);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.cloud, false, '本地校验即成功');
});
