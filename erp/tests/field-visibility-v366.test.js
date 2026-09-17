/**
 * V3.66 字段级可见性（员工不能看见成本 + 零售/批发每款独立控制）
 * - 成本：仅「数据归属账号（老板）」可见；所有非归属员工（含报表权限）一律不可见
 * - 零售价 / 批发价：每款商品可独立开关是否对员工可见（默认可见，不覆盖存量）
 * - 判定集中在 product.visibleToStaff + accounts.canViewCost，避免散落多处
 */
const test = require('node:test');
const assert = require('node:assert');
// 页面模块内 ERP 为加载时快照：须在 require 前注入 app 桩（render/download）
globalThis.ERP = globalThis.ERP || {};
globalThis.ERP.app = globalThis.ERP.app || {};
globalThis.ERP.app.render = function () {};
globalThis.ERP.app.download = function () {};

const product = require('../js/core/product.js');
const accounts = require('../js/core/accounts.js');
const page = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');

const ADMIN = { id: 'admin', username: 'hawsystem', role: 'admin', shopName: '管理总控' };
const STAFF = { id: 'emp1', ownerId: 'admin', role: 'user', perms: { product_read: true } };
const STAFF_REPORT = { id: 'emp2', ownerId: 'admin', role: 'user', perms: { product_read: true, report: true } };
const SOLO = { id: 'boss2', role: 'boss', perms: {} }; // 独立数据空间（自身即归属）

function seed(ctx) {
  // a：默认（无开关）→ 员工可见零售/批发
  const a = product.save(ctx, { brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' }).product;
  // b：对员工隐藏零售价
  const b = product.save(ctx, { brand: '格力', model: 'KFR-35', category: '空调', unit: '台', cost: '1800', priceWholesale: '2200', priceRetail: '2599', staffShowRetail: false }).product;
  // c：对员工隐藏批发价
  const c = product.save(ctx, { brand: '美的', model: 'MG-10', category: '洗衣机', unit: '台', cost: '900', priceWholesale: '1100', priceRetail: '1299', staffShowWholesale: false }).product;
  return { a, b, c };
}

test('isDataOwner：老板为数据归属；员工非归属；独立账号自身归属', () => {
  assert.strictEqual(product.isDataOwner(ADMIN), true, 'admin 是归属');
  assert.strictEqual(product.isDataOwner(STAFF), false, '员工（ownerId=admin）非归属');
  assert.strictEqual(product.isDataOwner(SOLO), true, '独立账号自身归属');
  assert.strictEqual(product.isDataOwner(null), false, '空账号非归属');
});

test('canViewCost（V3.66）：仅数据归属账号可见成本', () => {
  assert.strictEqual(accounts.canViewCost(ADMIN), true, 'admin 可见成本');
  assert.strictEqual(accounts.canViewCost(STAFF), false, '员工不可见成本');
  assert.strictEqual(accounts.canViewCost(STAFF_REPORT), false, '有报表权限的员工仍不可见成本');
  assert.strictEqual(accounts.canViewCost(SOLO), true, '独立账号可见成本');
  assert.strictEqual(accounts.canViewCost(null), false, '空账号不可见成本');
});

test('visibleToStaff：成本对员工一律不可见；无账号上下文按老板可见', () => {
  const { a } = (function () { const c = newCtx(); return { a: seed(c).a }; })();
  assert.strictEqual(product.visibleToStaff(a, ADMIN, 'cost'), true, '老板见成本');
  assert.strictEqual(product.visibleToStaff(a, STAFF, 'cost'), false, '员工不见成本');
  assert.strictEqual(product.visibleToStaff(a, null, 'cost'), true, '无账号按老板可见，避免误遮蔽');
});

test('visibleToStaff：零售/批发按每款独立开关；老板无视开关', () => {
  const { a, b, c } = (function () { const ctx = newCtx(); return seed(ctx); })();
  // 默认（无开关字段）：员工可见
  assert.strictEqual(product.visibleToStaff(a, STAFF, 'retail'), true, '默认零售可见');
  assert.strictEqual(product.visibleToStaff(a, STAFF, 'wholesale'), true, '默认批发可见');
  // 格力 隐藏零售
  assert.strictEqual(product.visibleToStaff(b, STAFF, 'retail'), false, '格力零售对员工隐藏');
  assert.strictEqual(product.visibleToStaff(b, STAFF, 'wholesale'), true, '格力批发对员工仍可见');
  // 美的 隐藏批发
  assert.strictEqual(product.visibleToStaff(c, STAFF, 'wholesale'), false, '美的批发对员工隐藏');
  assert.strictEqual(product.visibleToStaff(c, STAFF, 'retail'), true, '美的零售对员工仍可见');
  // 老板始终可见（无视开关）
  assert.strictEqual(product.visibleToStaff(b, ADMIN, 'retail'), true, '老板见格力零售（无视开关）');
  assert.strictEqual(product.visibleToStaff(c, ADMIN, 'wholesale'), true, '老板见美的批发（无视开关）');
});

test('product.save：员工可见开关持久化（新建默认可见，编辑可改）', () => {
  const ctx = newCtx();
  const r1 = product.save(ctx, { brand: '测试', model: 'T1', category: '其他', cost: '500', staffShowRetail: false });
  assert.strictEqual(r1.product.staffShowRetail, false, '新建写入隐藏零售');
  assert.strictEqual(r1.product.staffShowWholesale, true, '未传批发开关默认可见');
  const r2 = product.save(ctx, { brand: '测试', model: 'T2', category: '其他', cost: '500' });
  assert.strictEqual(r2.product.staffShowRetail, true, '新建默认零售可见');
  assert.strictEqual(r2.product.staffShowWholesale, true, '新建默认批发可见');
  // 编辑更新开关
  const r3 = product.save(ctx, { id: r1.product.id, brand: '测试', model: 'T1', category: '其他', cost: '500', staffShowWholesale: false });
  assert.strictEqual(r3.product.staffShowWholesale, false, '编辑写入隐藏批发');
  assert.strictEqual(r3.product.staffShowRetail, false, '编辑保留已设零售开关');
});

test('档案列表：老板见成本列；员工隐藏成本列并按开关显示 —/数字', () => {
  const ctx = newCtx();
  const { b, c } = seed(ctx);
  // 老板
  ctx.currentAccount = ADMIN;
  let st = page.init(ctx); st.tab = 'list';
  let htmlBoss = page.render(ctx, st);
  assert.ok(htmlBoss.includes('<th class="num">成本</th>'), '老板见成本列');
  assert.ok(htmlBoss.includes('¥2599.00'), '老板见格力零售');
  assert.ok(htmlBoss.includes('¥1100.00'), '老板见美的批发');
  // 员工
  ctx.currentAccount = STAFF;
  st = page.init(ctx); st.tab = 'list';
  let htmlStaff = page.render(ctx, st);
  assert.ok(!htmlStaff.includes('<th class="num">成本</th>'), '员工隐藏成本列');
  assert.ok(!htmlStaff.includes('¥2599.00'), '员工不见格力零售（已隐藏）');
  assert.ok(!htmlStaff.includes('¥1100.00'), '员工不见美的批发（已隐藏）');
  assert.ok(htmlStaff.includes('¥1200.00'), '员工仍见海尔批发（默认可见）');
  assert.ok(htmlStaff.includes('¥1399.00'), '员工仍见海尔零售（默认可见）');
  assert.ok(htmlStaff.includes('¥2200.00'), '员工仍见格力批发（未隐藏）');
  assert.ok(htmlStaff.includes('¥1299.00'), '员工仍见美的零售（未隐藏）');
  assert.ok(htmlStaff.includes('>—<'), '隐藏的价格以 — 占位');
});

test('建档表单：老板见成本输入 + 两个独立开关；员工见「无权查看成本」且无开关', () => {
  const ctx = newCtx();
  ctx.currentAccount = ADMIN;
  let st = page.init(ctx); st.tab = 'new';
  let html = page.render(ctx, st);
  assert.ok(html.includes('data-input="cost-field"'), '老板见成本输入');
  assert.ok(html.includes('data-name="staffShowRetail"'), '老板见零售开关');
  assert.ok(html.includes('data-name="staffShowWholesale"'), '老板见批发开关');

  // 编辑「隐藏零售」的商品 → 零售开关应为未勾选
  const { b } = seed(ctx);
  st = page.init(ctx);
  page.actions['edit-product'](ctx, st, { getAttribute: (n) => (n === 'data-id' ? b.id : null) });
  st.tab = 'new';
  html = page.render(ctx, st);
  assert.ok(!html.includes('data-name="staffShowRetail" checked'), '隐藏零售的商品：零售开关未勾选');
  assert.ok(html.includes('data-name="staffShowWholesale" checked'), '批发开关仍勾选（默认可见）');

  // 员工：成本输入替换为提示，且看不到开关
  ctx.currentAccount = STAFF;
  st = page.init(ctx); st.tab = 'new';
  html = page.render(ctx, st);
  assert.ok(html.includes('当前账号无权查看成本'), '员工见无权查看成本提示');
  assert.ok(!html.includes('data-input="cost-field"'), '员工不见成本输入');
  assert.ok(!html.includes('data-name="staffShowRetail"'), '员工不见零售开关');
  assert.ok(!html.includes('data-name="staffShowWholesale"'), '员工不见批发开关');
});

test('建档表单：无账号上下文（未登录/测试）按老板可见成本', () => {
  const ctx = newCtx(); // 不设 currentAccount
  const st = page.init(ctx); st.tab = 'new';
  const html = page.render(ctx, st);
  assert.ok(html.includes('data-input="cost-field"'), '无账号仍见成本输入（避免误遮蔽）');
});
