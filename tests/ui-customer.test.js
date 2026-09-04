/**
 * 客户管理页面（ui/page-customer.js）
 * - 页面元数据、列表渲染（应收余额标签 / 收款 / 编辑 / 删除按钮）
 * - 新增 / 编辑：名称必填、同名客户去重（type=customer）
 * - 删除：有余额或已有销售记录的客户禁止删除
 * - 收款：跳转记账中心（deep-link collect）
 * - 手机端「我的 → 常用入口」含「客户」入口
 */
const test = require('node:test');
const assert = require('node:assert');
// 模拟浏览器全局命名空间（page-customer.js 闭包捕获 root.ERP，需先初始化）
global.ERP = global.ERP || {};
const page = require('../js/ui/page-customer.js');
const { newCtx } = require('./helpers/ctx.js');

function seedCustomer(ctx, over) {
  const p = Object.assign({
    id: 'cus_1', name: '西安红星家电城', phone: '13800000000',
    type: 'customer', balance: 0, note: '月结'
  }, over || {});
  ctx.data.partners.push(p);
  return p;
}

test('页面元数据', () => {
  assert.strictEqual(page.name, 'customer');
  assert.strictEqual(page.title, '客户');
});

test('balanceLabel：应收语义（>0 客户欠我，<0 我方多收，=0 已结清）', () => {
  const b1 = page.balanceLabel(5000);
  assert.ok(b1.text.includes('应收'));
  assert.strictEqual(b1.cls, 'warn');
  const b2 = page.balanceLabel(-2000);
  assert.ok(b2.text.includes('我方多收'));
  assert.strictEqual(b2.cls, 'ok');
  const b3 = page.balanceLabel(0);
  assert.strictEqual(b3.text, '已结清');
});

test('列表渲染：显示客户、应收余额、收款/编辑/删除按钮', () => {
  const ctx = newCtx();
  seedCustomer(ctx, { balance: 3000 });
  const state = page.init();
  const html = page.render(ctx, state);
  assert.ok(html.includes('西安红星家电城'), '显示客户名');
  assert.ok(html.includes('应收'), '显示应收余额标签');
  assert.ok(html.includes('data-act="collect"'), '含收款按钮');
  assert.ok(html.includes('data-act="edit-customer"'), '含编辑按钮');
  assert.ok(html.includes('data-act="delete-customer"'), '含删除按钮');
  assert.ok(html.includes('＋ 新增客户'), '含新增按钮');
});

test('列表渲染：空列表提示', () => {
  const ctx = newCtx();
  const state = page.init();
  const html = page.render(ctx, state);
  assert.ok(html.includes('还没有客户'), '空列表提示');
});

test('新增客户：保存成功且 type=customer', () => {
  const ctx = newCtx();
  const state = page.init();
  state.form = { id: '', name: '新客户甲', phone: '139', note: '备注' };
  const ok = page.actions['save-customer'](ctx, state);
  assert.strictEqual(ok, true);
  assert.strictEqual(ctx.data.partners.length, 1);
  const p = ctx.data.partners[0];
  assert.strictEqual(p.type, 'customer');
  assert.strictEqual(p.name, '新客户甲');
  assert.strictEqual(p.balance, 0);
  assert.strictEqual(state.editing, null, '保存后关闭表单');
});

test('新增客户：名称必填被拦截', () => {
  const ctx = newCtx();
  const state = page.init();
  state.form = { id: '', name: '   ', phone: '', note: '' };
  const ok = page.actions['save-customer'](ctx, state);
  assert.strictEqual(ok, false);
  assert.strictEqual(ctx.data.partners.length, 0, '未创建');
  assert.ok(state.error.includes('请填写客户名称'));
});

test('新增客户：同名客户去重（仅 type=customer）', () => {
  const ctx = newCtx();
  seedCustomer(ctx, { id: 'cus_x', name: '红星店' });
  // 供应商同名的客户允许
  ctx.data.partners.push({ id: 'sup_1', name: '红星店', type: 'supplier', balance: 0 });
  const state = page.init();
  state.form = { id: '', name: '红星店', phone: '', note: '' };
  const ok = page.actions['save-customer'](ctx, state);
  assert.strictEqual(ok, false, '同名客户被拦截');
  assert.ok(state.error.includes('已存在同名客户'));
  assert.strictEqual(ctx.data.partners.length, 2, '未新增（供应商+客户）');
});

test('编辑客户：修改名称/电话/备注生效', () => {
  const ctx = newCtx();
  const p = seedCustomer(ctx, { id: 'cus_2', name: '老客户', phone: '1', note: 'a' });
  const state = page.init();
  state.editing = 'cus_2';
  state.form = { id: 'cus_2', name: '老客户改', phone: '2', note: 'b' };
  const ok = page.actions['save-customer'](ctx, state);
  assert.strictEqual(ok, true);
  assert.strictEqual(p.name, '老客户改');
  assert.strictEqual(p.phone, '2');
  assert.strictEqual(p.note, 'b');
  assert.strictEqual(ctx.data.partners.length, 1, '仍是同一条');
});

test('删除客户：有往来余额禁止删除', () => {
  const ctx = newCtx();
  seedCustomer(ctx, { id: 'cus_3', name: '欠款客户', balance: 8888 });
  const state = page.init();
  const el = { getAttribute: (k) => (k === 'data-id' ? 'cus_3' : '') };
  const ok = page.actions['delete-customer'](ctx, state, el);
  assert.strictEqual(ok, false);
  assert.strictEqual(ctx.data.partners.length, 1, '客户保留');
});

test('删除客户：已有销售记录禁止删除', () => {
  const ctx = newCtx();
  const p = seedCustomer(ctx, { id: 'cus_4', name: '有单客户', balance: 0 });
  ctx.data.sales.push({ no: 'S1', partnerName: p.name, voided: false, items: [] });
  const state = page.init();
  const el = { getAttribute: (k) => (k === 'data-id' ? 'cus_4' : '') };
  const ok = page.actions['delete-customer'](ctx, state, el);
  assert.strictEqual(ok, false);
  assert.strictEqual(ctx.data.partners.length, 1, '客户保留');
});

test('删除客户：无余额且无销售记录可删除', () => {
  const ctx = newCtx();
  seedCustomer(ctx, { id: 'cus_5', name: '可删客户', balance: 0 });
  const state = page.init();
  const el = { getAttribute: (k) => (k === 'data-id' ? 'cus_5' : '') };
  const ok = page.actions['delete-customer'](ctx, state, el);
  assert.strictEqual(ok, true);
  assert.strictEqual(ctx.data.partners.length, 0, '客户已删除');
});

test('收款：跳转记账中心并携带 collect=客户id', () => {
  const ctx = newCtx();
  seedCustomer(ctx, { id: 'cus_6', name: '收款客户', balance: 1000 });
  let jumped = null;
  global.ERP = global.ERP || {};
  global.ERP.app = { go: (pageName, query) => { jumped = { pageName, query }; } };
  try {
    const state = page.init();
    const el = { getAttribute: (k) => (k === 'data-id' ? 'cus_6' : '') };
    const ok = page.actions['collect'](ctx, state, el);
    assert.strictEqual(ok, false, 'collect 返回 false（阻止默认动作）');
    assert.ok(jumped, '已触发跳转');
    assert.strictEqual(jumped.pageName, 'account');
    assert.strictEqual(jumped.query.collect, 'cus_6');
  } finally {
    delete global.ERP.app;
  }
});

test('手机端入口：我的页常用入口含「客户」', () => {
  const mine = require('../js/ui/page-mine.js');
  const ctx = {
    settings: { shopName: '大家电店', scopeCategories: [], avatar: '' },
    currentAccount: { id: 'acct1', username: 'appliance', role: 'user', shopName: '大家电店' }
  };
  const state = { cfg: null, busy: false, editShop: false, shopNameEdit: '大家电店' };
  const html = mine.render(ctx, state);
  assert.ok(html.includes('data-page="customer"'), '常用入口含客户入口');
});
