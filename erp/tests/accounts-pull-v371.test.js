/**
 * V3.71：管理页「从云端拉取账号表」—— 合并逻辑与接线
 *
 * 背景：账号表存在**本机 localStorage**。老板换设备 / 换浏览器后，
 * 本机只有预置的 `admin`（登录时本地命中就不会再去拉云端），
 * 于是管理页看不到员工账号（如 `pifa`），改不了密码、也发不了取数凭证。
 * V3.61 的公开拉取通道本来就能拿到云端账号表，但**没有入口** —— 本次补上，
 * 并把合并规则抽成纯函数以便回归。
 *
 * 合并规则（逐条覆盖）：
 *  1. 匹配优先级：id 优先，其次 username（两端 id 生成顺序可能不同）
 *  2. 云端为准覆盖同账号字段（云端是跨端共享的真相源）
 *  3. 本地独有账号保留（刚建好还没上传的不被抹掉）
 *  4. 本地已有取数凭证、云端该键缺失时**不得被抹掉**（否则刚发的凭证会被拉没了）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

globalThis.ERP = globalThis.ERP || {};

const accounts = require('../js/core/accounts.js');
const adminPage = require('../js/ui/page-admin.js');

globalThis.ERP.accounts = accounts;

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}

const merge = (local, cloud) => adminPage.mergeAccounts(local, cloud);

test('1 合并：云端有、本地没有 → 新增（added+1）', () => {
  const local = [{ id: 'admin', username: 'hawsystem', role: 'admin' }];
  const cloud = [
    { id: 'admin', username: 'hawsystem', role: 'admin' },
    { id: 'acct1', username: 'pifa', ownerId: 'admin' }
  ];
  const r = merge(local, cloud);
  assert.strictEqual(r.added, 1, 'pifa 应为新增');
  assert.strictEqual(r.updated, 1, 'admin 应为更新（同 id）');
  assert.strictEqual(r.list.length, 2);
  assert.ok(r.list.some(a => a.username === 'pifa'), '拉取后应能看到 pifa');
});

test('2 合并：同 id → 云端字段覆盖本地（updated）', () => {
  const local = [{ id: 'acct1', username: 'pifa', shopName: '旧店名', perms: ['a'] }];
  const cloud = [{ id: 'acct1', username: 'pifa', shopName: '批发电器', perms: ['a', 'b'] }];
  const r = merge(local, cloud);
  assert.strictEqual(r.added, 0);
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(r.list[0].shopName, '批发电器', '应以云端为准');
  assert.deepStrictEqual(r.list[0].perms, ['a', 'b']);
});

test('3 合并：id 不同但 username 相同 → 按用户名匹配，不重复建号', () => {
  const local = [{ id: 'local9', username: 'pifa', ownerId: 'admin' }];
  const cloud = [{ id: 'cloud7', username: 'pifa', ownerId: 'admin', shopName: '批发电器' }];
  const r = merge(local, cloud);
  assert.strictEqual(r.added, 0, '不应新增出第二个 pifa');
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(r.list.length, 1);
  assert.strictEqual(r.list[0].shopName, '批发电器');
});

test('4 合并：本地独有的账号保留（刚建好还没上传的不被抹掉）', () => {
  const local = [
    { id: 'admin', username: 'hawsystem' },
    { id: 'newone', username: 'gangjian', ownerId: 'admin' }
  ];
  const cloud = [{ id: 'admin', username: 'hawsystem' }];
  const r = merge(local, cloud);
  assert.strictEqual(r.list.length, 2);
  assert.ok(r.list.some(a => a.username === 'gangjian'), '本地新建未上传的账号必须保留');
});

test('5 合并：本地已有取数凭证、云端无该键 → 凭证不得被抹掉', () => {
  const cred = { kind: 'secret', v: 2 };
  const local = [{ id: 'acct1', username: 'pifa', ownerId: 'admin', syncPhraseEnc: cred }];
  const cloud = [{ id: 'acct1', username: 'pifa', ownerId: 'admin' }]; // 云端还没同步这份凭证
  const r = merge(local, cloud);
  assert.deepStrictEqual(r.list[0].syncPhraseEnc, cred, '刚发放的凭证不能被拉取抹掉');
});

test('6 合并：云端带来凭证时应当写入本地（换设备后能接着用）', () => {
  const cred = { kind: 'secret', v: 2 };
  const local = [{ id: 'acct1', username: 'pifa', ownerId: 'admin' }];
  const cloud = [{ id: 'acct1', username: 'pifa', ownerId: 'admin', syncPhraseEnc: cred }];
  const r = merge(local, cloud);
  assert.deepStrictEqual(r.list[0].syncPhraseEnc, cred);
});

test('7 合并：边界 —— 空云端 / 空本地 / 云端账号缺 id', () => {
  const local = [{ id: 'admin', username: 'hawsystem' }];
  assert.deepStrictEqual(merge(local, []).list, local, '空云端不应改动本机');

  const r2 = merge([], [{ id: 'acct1', username: 'pifa' }]);
  assert.strictEqual(r2.added, 1);
  assert.strictEqual(r2.list.length, 1);

  const r3 = merge(local, [{ username: 'noid' }, null, undefined]);
  assert.strictEqual(r3.added, 0, '缺 id 的脏数据应被跳过');
  assert.strictEqual(r3.list.length, 1);
});

test('8 接线：管理页渲染出「从云端拉取账号表」按钮与动作', () => {
  const s = memStore();
  accounts.ensurePreset(s);
  const html = adminPage.render({ currentAccount: { id: 'admin', role: 'admin' } }, { store: s });
  assert.ok(/data-act="admin-pull-accounts"/.test(html), '应渲染拉取按钮');
  assert.ok(html.includes('从云端拉取账号表'), '按钮文案应可见');
  assert.strictEqual(typeof adminPage.actions['admin-pull-accounts'], 'function', '动作应已注册');
  // 上传按钮仍应在（不能把原有入口改没了）
  assert.ok(/data-act="admin-sync-accounts"/.test(html), '上传按钮应保留');
});

test('9 接线：同步模块不可用时给出提示且不抛错（return true 以便显示错误）', () => {
  const prev = globalThis.ERP.sync;
  delete globalThis.ERP.sync;
  try {
    const state = {};
    const r = adminPage.actions['admin-pull-accounts']({}, state);
    assert.strictEqual(r, true, '应返回 true 以便把错误显示给用户');
    assert.ok(state.error, '应写入错误提示');
  } finally {
    if (prev) globalThis.ERP.sync = prev;
  }
});

test('10 版本号：page-mine V3.71 / sw.js v100（三处同步，防止版本走散）', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.71'), '关于页应显示 V3.71');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v100';"), 'SW 缓存版本应为 v100');
});
