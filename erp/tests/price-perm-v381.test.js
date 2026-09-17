/**
 * V3.82 员工价格可见性总开关（权限级）× 商品单条开关 叠加生效
 *
 * **背景**：V3.66 只有商品单条开关（staffShowRetail / staffShowWholesale），
 * 老板想"整批不给员工看价格"就得一个商品一个商品地点（每条档案都设一遍太慢）。
 * 本版在员工权限里新增「价格可见」组：显示零售价 / 显示批发价 两个**总开关**，
 * 与单条开关取「与」——任一关闭，员工即看不到对应价格；老板/数据归属者不受影响。
 *
 * **兼容关键**：V3.82 之前创建的账号 perms 里没有这两个 key，历史行为是"默认可见"，
 * 迁移补 true（升级不突变）；新建账号由 create() 显式写 false（key 存在），仍默认全关。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

globalThis.ERP = globalThis.ERP || {};

const product = require('../js/core/product.js');
const accounts = require('../js/core/accounts.js');
globalThis.ERP.accounts = accounts;

/** 构造员工账号（perms 手工指定，模拟老板勾选后的状态） */
function staff(perms) {
  return { id: 'emp1', ownerId: 'admin', username: 'pifa', role: 'user', perms: perms };
}

/** 与 accounts.can 同语义的 stub：admin 全通过，其余查 perms */
function installFakeAccounts() {
  globalThis.ERP.accounts = {
    can: function (acct, perm) {
      if (!acct) return false;
      if (acct.role === 'admin' || acct.id === 'admin') return true;
      return !!(acct.perms && acct.perms[perm]);
    }
  };
}
installFakeAccounts();

const P = { id: 'p1', staffShowRetail: true, staffShowWholesale: true };

test('T1 总开关关：零售/批发价对员工全部隐藏（即使单条开关是开的）', () => {
  const a = staff({ price_retail_view: false, price_wholesale_view: false });
  assert.strictEqual(product.visibleToStaff(P, a, 'retail'), false, '总开关关 + 单条开 → 不可见');
  assert.strictEqual(product.visibleToStaff(P, a, 'wholesale'), false, '总开关关 + 单条开 → 不可见');
  assert.strictEqual(product.visibleToStaff(null, a, 'retail'), false, '商品缺单条字段也拦（总开关优先）');
});

test('T2 总开关开 + 单条关：单条开关仍独立生效（叠加取「与」）', () => {
  const a = staff({ price_retail_view: true, price_wholesale_view: true });
  const pHideRetail = { id: 'p2', staffShowRetail: false, staffShowWholesale: true };
  assert.strictEqual(product.visibleToStaff(pHideRetail, a, 'retail'), false, '单条关零售 → 不可见');
  assert.strictEqual(product.visibleToStaff(pHideRetail, a, 'wholesale'), true, '单条开批发 → 可见');
});

test('T3 总开关开 + 单条开：员工正常看价', () => {
  const a = staff({ price_retail_view: true, price_wholesale_view: true });
  assert.strictEqual(product.visibleToStaff(P, a, 'retail'), true);
  assert.strictEqual(product.visibleToStaff(P, a, 'wholesale'), true);
});

test('T4 老板 / 数据归属者：不受两层开关影响，全可见（回归）', () => {
  const boss = { id: 'admin', username: 'hawsystem', role: 'admin' };
  assert.strictEqual(product.visibleToStaff(P, boss, 'retail'), true);
  assert.strictEqual(product.visibleToStaff(P, boss, 'wholesale'), true);
  assert.strictEqual(product.visibleToStaff(P, boss, 'cost'), true, '老板看成本');
  const solo = { id: 'solo1', ownerId: null, role: 'user', perms: {} };
  assert.strictEqual(product.visibleToStaff(P, solo, 'wholesale'), true, '独立数据空间账号看全');
});

test('T5 成本：员工无论权限怎么勾都不可见（回归）', () => {
  const a = staff({ price_retail_view: true, price_wholesale_view: true });
  assert.strictEqual(product.visibleToStaff(P, a, 'cost'), false);
});

test('T6 兼容迁移：V3.82 之前的账号 load 后自动补「可见」= true（升级不突变）', () => {
  const store = fakeStore();
  saveRaw(store, [{
    id: 'emp9', username: 'old-staff', role: 'user', ownerId: 'admin',
    hash: 'x', salt: 'x', perms: { sale_bill: true }
  }]);
  const list = accounts.load(store);
  const a = list.find((x) => x.id === 'emp9');
  assert.strictEqual(a.perms.price_retail_view, true, '老账号补「显示零售价」= true');
  assert.strictEqual(a.perms.price_wholesale_view, true, '老账号补「显示批发价」= true');
  assert.strictEqual(a.perms.sale_bill, true, '原有权限不动');
  assert.strictEqual(accounts.can(a, 'price_retail_view'), true);
  assert.strictEqual(product.visibleToStaff(P, a, 'retail'), true, '升级前后行为一致：单条默认开 → 可见');
});

test('T6b 新建账号：价格两项显式 false（默认全关），后续 load 不会被迁移补成可见', () => {
  const store = fakeStore();
  const r = accounts.create(store, { username: 'newbie', password: '1234', ownerId: 'admin' });
  assert.ok(r.ok, '创建成功：' + JSON.stringify(r));
  const a = accounts.load(store).find((x) => x.username === 'newbie');
  assert.strictEqual(a.perms.price_retail_view, false, '仍是显式 false');
  assert.strictEqual(a.perms.price_wholesale_view, false, '仍是显式 false');
  assert.strictEqual(product.visibleToStaff(P, a, 'retail'), false, '新建员工默认看不到零售价');
});

test('T7 权限清单：新增「价格可见」组与两个总开关', () => {
  const ids = accounts.PERMS.map((p) => p.id);
  assert.ok(ids.includes('price_retail_view'), '权限清单含「显示零售价」');
  assert.ok(ids.includes('price_wholesale_view'), '权限清单含「显示批发价」');
  const g = accounts.PERM_GROUPS.map((x) => x.id);
  assert.ok(g.includes('price'), '新增权限组「价格可见」');
  const pr = accounts.PERMS.find((p) => p.id === 'price_retail_view');
  assert.strictEqual(pr.group, 'price', '两项归属「价格可见」组');
});

test('T7b accounts 模块缺失的极端环境：退回单条开关行为（不误遮蔽）', () => {
  const a = staff({ price_retail_view: true, price_wholesale_view: false });
  const saved = globalThis.ERP.accounts;
  delete globalThis.ERP.accounts;
  try {
    assert.strictEqual(product.visibleToStaff(P, a, 'retail'), true, '无 accounts → 按单条开关（开）');
  } finally {
    globalThis.ERP.accounts = saved;
  }
});

test('T8 商品编辑页提示语说明两层开关的叠加关系', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js/ui/page-product.js'), 'utf8');
  assert.ok(src.includes('总开关'), '提示语提到总开关');
  assert.ok(src.includes('任一关闭'), '说明「任一关闭即隐藏」');
});

test('T9 版本号三处同步：page-mine V3.83 / sw.js v112', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.83'), '关于页应显示 V3.82');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v112';"), 'SW 缓存版本应为 v111');
});

/* ---------------- 测试辅助 ---------------- */

function fakeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }
  };
}

function saveRaw(store, list) {
  store.setItem(accounts.ACCOUNTS_KEY, JSON.stringify(list));
}
