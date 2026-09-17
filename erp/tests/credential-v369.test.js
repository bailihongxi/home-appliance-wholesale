/**
 * V3.69：取数凭证接线 —— 员工「零配置自助取数」
 *
 * 背景：V3.65 定义了凭证的数据形态（syncPhraseEnc = 用员工密码加密的老板同步口令），
 * 但**发放端和消费端都没接上**：老板建号时没人写凭证，员工登录时也没人解凭证，
 * 于是「员工换设备自助拉数据」这条链路实际是断的（文档里却写成了已完成 —— 已更正）。
 *
 * V3.69 补的是这两处接线：
 *  - 发放端 page-admin.issueCredential：老板「新建账号」或「改员工密码」时，
 *    用明文密码加密并写入 syncPhraseEnc（只能在这两个时刻 —— 其余时刻库里只有密码哈希，无法加密）
 *  - 消费端 page-login.claimCredential：员工登录时用当次输入的明文密码解开凭证，
 *    写入本机云同步配置的 passphrase（按「数据归属账号」存，与老板共用同一份）
 *
 * 安全边界（本文件逐条覆盖）：
 *  - 凭证以员工密码为密钥，云端账号表只有密文 + 密码哈希 → 拿到账号表也解不开
 *  - 认领失败（密码错 / 无凭证 / 环境不支持）绝不影响登录本身
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

globalThis.ERP = globalThis.ERP || {};

const accounts = require('../js/core/accounts.js');
const adminPage = require('../js/ui/page-admin.js');
const loginPage = require('../js/ui/page-login.js');

globalThis.ERP.accounts = accounts;

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

/**
 * 假 sync：模拟真加解密的**语义**（密码对才解得开，密码错返回 null），
 * 配置存进内存 map，并记录 saveConfig 的 acctId 以便断言「存到谁名下」。
 */
function fakeSync(opts) {
  opts = opts || {};
  const cfgMap = new Map();
  return {
    _cfg: cfgMap,
    calls: { save: [] },
    wrapPhrase(pwd, phrase) {
      if (opts.wrapThrows) return Promise.reject(new Error('boom'));
      return Promise.resolve({ kind: 'secret', pwd: String(pwd), phrase: String(phrase) });
    },
    unwrapPhrase(pwd, env) {
      if (opts.unwrapThrows) return Promise.reject(new Error('boom'));
      if (!env || env.pwd !== String(pwd)) return Promise.resolve(null); // 密码错 = 解不开
      return Promise.resolve(env.phrase);
    },
    loadConfig(store, acctId) {
      return cfgMap.get(String(acctId || '')) || null;
    },
    saveConfig(store, cfg, acctId) {
      this.calls.save.push(acctId);
      cfgMap.set(String(acctId || ''), Object.assign({}, cfg));
      return cfg;
    }
  };
}

/** 挂到全局（bossPhrase / syncRef 读 globalThis.ERP.sync），返回卸载函数 */
function useSync(sync) {
  globalThis.ERP.sync = sync;
  return () => { delete globalThis.ERP.sync; };
}
/**
 * 造一个「老板本机已配好口令」的假 sync（发放端用）。
 * 注意：老板机器与员工新设备是**两台设备、两份配置**，所以认领端要另造一个空配置的 sync，
 * 否则会退化成「本机已配口令」而走 already-configured，测不到真实的新设备场景。
 */
function bossSyncWith(phrase, opts) {
  const sync = fakeSync(opts);
  sync.loadConfig = () => ({ passphrase: phrase });
  return sync;
}
/** 造一个「员工新设备」的假 sync：本机配置为空，只有解开凭证后才会有口令 */
function freshDeviceSync() { return fakeSync(); }

/** 播种：admin（老板）+ emp1（共用本店数据）+ solo（独立数据空间） */
function seed() {
  const s = memStore();
  accounts.ensurePreset(s);
  accounts.create(s, { username: 'emp1', password: '1234', shopName: '员工甲', ownerId: 'admin' });
  accounts.create(s, { username: 'solo', password: '1234', shopName: '独立店' });
  return s;
}
function acctOf(store, username) {
  return accounts.load(store).find((a) => a.username === username);
}

/* ============ A. 发放端：issueCredential ============ */

test('A1 issueCredential：缺账号 id → no-input，不写库', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS'));
  try {
    const r = await adminPage.issueCredential(s, '', '1234', { sync: globalThis.ERP.sync });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-input');
    assert.strictEqual(r.env, null);
  } finally { off(); }
});

test('A2 issueCredential：缺员工密码 → no-input（没有明文密码就无法加密）', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS'));
  try {
    const r = await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '', { sync: globalThis.ERP.sync });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-input');
    assert.strictEqual(!!acctOf(s, 'emp1').syncPhraseEnc, false, '失败时不得写入半截凭证');
  } finally { off(); }
});

test('A3 issueCredential：本机无同步模块 → no-sync（不抛错）', async () => {
  const s = seed();
  delete globalThis.ERP.sync;
  const r = await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-sync');
});

test('A4 issueCredential：老板尚未配置云同步口令 → no-boss-phrase（界面据此提示先去配置）', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('')); // 老板没配口令
  try {
    const r = await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync: globalThis.ERP.sync });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-boss-phrase');
    assert.strictEqual(!!acctOf(s, 'emp1').syncPhraseEnc, false);
  } finally { off(); }
});

test('A5 issueCredential：正常发放 → 写入 syncPhraseEnc', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const r = await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync: globalThis.ERP.sync });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'issued');
    const cred = acctOf(s, 'emp1').syncPhraseEnc;
    assert.ok(cred, '凭证应已落库');
    assert.strictEqual(cred.kind, 'secret');
    assert.strictEqual(cred.pwd, '1234', '凭证应以员工明文密码为密钥加密');
    assert.strictEqual(cred.phrase, 'BOSS-PHRASE', '凭证内容应为老板同步口令');
  } finally { off(); }
});

test('A6 issueCredential：加密抛错 → error，不向外抛出（不能让建号失败）', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE', { wrapThrows: true }));
  try {
    const r = await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync: globalThis.ERP.sync });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'error');
  } finally { off(); }
});

/* ============ B. 消费端：claimCredential ============ */

test('B1 claimCredential：无同步模块 → no-sync', async () => {
  const s = seed();
  delete globalThis.ERP.sync;
  const r = await loginPage.claimCredential(s, acctOf(s, 'emp1'), '1234', {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-sync');
});

test('B2 claimCredential：缺密码 → no-input', async () => {
  const s = seed();
  const off = useSync(fakeSync());
  try {
    const r = await loginPage.claimCredential(s, acctOf(s, 'emp1'), '', { sync: globalThis.ERP.sync });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-input');
  } finally { off(); }
});

test('B3 claimCredential：账号无凭证 → no-credential（老员工/未发放，静默跳过）', async () => {
  const s = seed();
  const off = useSync(fakeSync());
  try {
    const r = await loginPage.claimCredential(s, acctOf(s, 'emp1'), '1234', { sync: globalThis.ERP.sync });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-credential');
  } finally { off(); }
});

test('B4 claimCredential：密码错 → unwrap-failed（安全边界：拿不到明文就解不开）', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const sync = globalThis.ERP.sync;
    await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync });
    const r = await loginPage.claimCredential(s, acctOf(s, 'emp1'), 'wrong-pwd', { sync });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'unwrap-failed');
  } finally { off(); }
});

test('B5 claimCredential：正常认领 → applied，且写到「数据归属账号（老板）」名下', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const sync = globalThis.ERP.sync;
    await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync });

    // 员工换到一台新设备（本机没配过任何同步信息）
    const dev = freshDeviceSync();
    assert.strictEqual(dev.loadConfig(s, 'admin'), null, '新设备本机应无配置');
    const r = await loginPage.claimCredential(s, acctOf(s, 'emp1'), '1234', { sync: dev });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'applied');
    assert.deepStrictEqual(dev.calls.save, ['admin'], '员工必须与老板共用同一份同步配置，不能自存一份');
    assert.strictEqual(dev.loadConfig(s, 'admin').passphrase, 'BOSS-PHRASE');
  } finally { off(); }
});

test('B6 claimCredential：已配置过口令 → already-configured，不覆盖老板既有配置', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('OLD-PHRASE'));
  try {
    const sync = globalThis.ERP.sync;
    await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync });

    // 员工设备本机已经配过口令（比如老板手工配过）→ 不得覆盖
    const dev = freshDeviceSync();
    dev._cfg.set('admin', { passphrase: 'OLD-PHRASE' });
    const r = await loginPage.claimCredential(s, acctOf(s, 'emp1'), '1234', { sync: dev });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.reason, 'already-configured');
    assert.strictEqual(dev.loadConfig(s, 'admin').passphrase, 'OLD-PHRASE', '不得覆盖已配好的口令');
  } finally { off(); }
});

test('B7 claimCredential：缺配置读写 API → no-config-api', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const sync = globalThis.ERP.sync;
    await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync });
    const bare = { unwrapPhrase: sync.unwrapPhrase }; // 只有解密，没有配置读写
    const r = await loginPage.claimCredential(s, acctOf(s, 'emp1'), '1234', { sync: bare });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-config-api');
  } finally { off(); }
});

test('B8 claimCredential：解密抛错 → error，不向外抛出', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const sync = globalThis.ERP.sync;
    await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync });
    const r = await loginPage.claimCredential(s, acctOf(s, 'emp1'), '1234', { sync: fakeSync({ unwrapThrows: true }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'error');
  } finally { off(); }
});

test('B9 claimCredential：独立数据空间账号 → 写到自己名下（不串到老板配置）', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const sync = globalThis.ERP.sync;
    const solo = acctOf(s, 'solo');
    await adminPage.issueCredential(s, solo.id, '1234', { sync });
    const dev = freshDeviceSync();
    const r = await loginPage.claimCredential(s, acctOf(s, 'solo'), '1234', { sync: dev });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(dev.calls.save, [solo.id], '独立数据空间应写自己的配置，不串到老板名下');
  } finally { off(); }
});

/* ============ C. 端到端与回归 ============ */

test('C1 端到端：老板发放 → 员工换设备（清空口令）→ 仅凭自己账号密码自动取回', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const sync = globalThis.ERP.sync;
    const issued = await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync });
    assert.strictEqual(issued.ok, true);

    // 员工换设备：本机什么都没配
    const dev = freshDeviceSync();
    assert.strictEqual(dev.loadConfig(s, 'admin'), null, '新设备本机应无配置');

    // 员工登录（只带自己的账号密码）
    const claimed = await loginPage.claimCredential(s, acctOf(s, 'emp1'), '1234', { sync: dev });
    assert.strictEqual(claimed.ok, true);
    assert.strictEqual(dev.loadConfig(s, 'admin').passphrase, 'BOSS-PHRASE', '零配置即可自助拉数据');
  } finally { off(); }
});

test('C2 端到端：老板改员工密码后重发凭证 → 旧密码解不开、新密码可用', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const sync = globalThis.ERP.sync;
    const empId = acctOf(s, 'emp1').id;
    await adminPage.issueCredential(s, empId, 'old-pwd', { sync });
    // 老板重置密码 → 用新密码重新发放
    await adminPage.issueCredential(s, empId, 'new-pwd', { sync });

    const dev = freshDeviceSync();
    const oldTry = await loginPage.claimCredential(s, acctOf(s, 'emp1'), 'old-pwd', { sync: dev });
    assert.strictEqual(oldTry.reason, 'unwrap-failed', '旧密码必须失效');
    assert.deepStrictEqual(dev.calls.save, [], '解不开时不得写入任何配置');
    const newTry = await loginPage.claimCredential(s, acctOf(s, 'emp1'), 'new-pwd', { sync: dev });
    assert.strictEqual(newTry.ok, true);
    assert.strictEqual(dev.loadConfig(s, 'admin').passphrase, 'BOSS-PHRASE');
  } finally { off(); }
});

test('C3 回归：凭证链路全失败时，登录本身仍必须成功（不得卡住登录）', async () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE', { unwrapThrows: true }));
  const prevApp = globalThis.ERP.app;
  let loggedIn = null;
  globalThis.ERP.app = { onLogin: (a) => { loggedIn = a; } };
  try {
    await adminPage.issueCredential(s, acctOf(s, 'emp1').id, '1234', { sync: globalThis.ERP.sync });
  } catch (e) { /* 加密抛错不影响本用例 */ }
  try {
    loginPage._doLoginSuccess({}, { store: s, pwd: '1234' }, acctOf(s, 'emp1'));
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    globalThis.ERP.app = prevApp;
    off();
  }
  assert.ok(loggedIn, '登录回调必须被触发');
  assert.strictEqual(loggedIn.username, 'emp1');
});

test('C4 界面：员工卡片显示「已发放」徽章；未发放显示「未发放」', () => {
  const s = seed();
  const htmlBefore = adminPage.render({ currentAccount: { id: 'admin', role: 'admin' } }, { store: s });
  assert.ok(htmlBefore.includes('未发放'), '未发凭证时应显示「未发放」');

  accounts.update(s, acctOf(s, 'emp1').id, { syncPhraseEnc: { kind: 'secret' } });
  const htmlAfter = adminPage.render({ currentAccount: { id: 'admin', role: 'admin' } }, { store: s });
  assert.ok(htmlAfter.includes('已发放'), '发放后应显示「已发放」');
  assert.ok(/data-act="admin-clear-cred"/.test(htmlAfter), '发放后应出现「清除凭证」按钮');
});

test('C5 界面：老板本人与独立数据空间账号不需要凭证（不显示「未发放」误导）', () => {
  const s = seed();
  const html = adminPage.render({ currentAccount: { id: 'admin', role: 'admin' } }, { store: s });
  assert.ok(html.includes('不需要（本机即数据源）'), '老板应标注不需要');
  assert.ok(html.includes('不需要（独立数据空间）'), '独立空间账号应标注不需要');
});

test('C6 版本号：page-mine V3.70 / sw.js v101（三处同步，防止版本走散）', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.72'), '关于页应显示 V3.72');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v101';"), 'SW 缓存版本应为 v101');
});

/* ===== D2. V3.72：凭证写在「本机」账号表，员工换设备读的是「云端」===== */

test('E1 提醒：凭证已发放时，必须提示再点「账号表上传到云端」', () => {
  const s = seed();
  const html = adminPage.render({ currentAccount: { id: 'admin', role: 'admin' } },
    { store: (accounts.update(s, acctOf(s, 'emp1').id, { syncPhraseEnc: { kind: 'secret' } }), s) });
  assert.ok(html.includes('已发放'), '应显示已发放');
  assert.ok(html.includes('账号表上传到云端'),
    'V3.72：必须提醒上传账号表 —— 凭证在本机，员工换设备读云端，不上传等于白发');
});

test('E2 提醒：发放成功的操作提示里同样要带上传提醒（创建 / 改密码两条路径）', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'js/ui/page-admin.js'), 'utf8');
  // 两条成功提示都必须出现「账号表上传到云端」
  const hits = src.split('账号表上传到云端').length - 1;
  assert.ok(hits >= 3, '创建提示 / 改密码提示 / 卡片徽章三处都应提醒上传，实际出现 ' + hits + ' 次');
});

/* ===== D. V3.70：未发放时给出可操作指引 ===== */

test('D1 指引：老板已配口令但员工无凭证 → 引导「重设一次密码」并指向「修改」', () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const html = adminPage.render({ currentAccount: { id: 'admin', role: 'admin' } }, { store: s });
    assert.ok(html.includes('未发放'), '应显示未发放');
    assert.ok(html.includes('重设一次密码'), '必须给出「重设一次密码」的可操作指引，否则老板不知道下一步做什么');
    assert.ok(html.includes('修改'), '指引应指向「修改」入口');
  } finally { off(); }
});

test('D2 指引：老板尚未配置云同步口令 → 先引导去「我的 → 云同步」', () => {
  const s = seed();
  const off = useSync(bossSyncWith('')); // 老板没配口令：此时就算重设密码也发不出凭证
  try {
    const html = adminPage.render({ currentAccount: { id: 'admin', role: 'admin' } }, { store: s });
    assert.ok(html.includes('未发放'), '应显示未发放');
    assert.ok(html.includes('云同步'), '应引导先去配置云同步');
    assert.ok(html.includes('重设一次密码'), '仍应说明后续还要重设密码');
  } finally { off(); }
});

test('D3 指引：老板与独立数据空间账号不显示「重设密码」指引', () => {
  const s = seed();
  const off = useSync(bossSyncWith('BOSS-PHRASE'));
  try {
    const html = adminPage.render({ currentAccount: { id: 'admin', role: 'admin' } }, { store: s });
    assert.ok(html.includes('不需要（本机即数据源）'), '老板不需要凭证');
    assert.ok(html.includes('不需要（独立数据空间）'), '独立空间账号不需要凭证');
  } finally { off(); }
});
