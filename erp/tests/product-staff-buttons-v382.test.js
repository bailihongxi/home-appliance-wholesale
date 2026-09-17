/**
 * V3.82 员工「商品档案」页只保留搜索 —— 导入 / 导出按钮收归老板专属
 *
 * **背景**：老板反馈员工商品档案页不该有「导出全部 / 批量导入」这类全店档案整体操作的入口。
 * 核查发现更严重的一点：旧版这两个按钮由 `data_manage` 权限判定，而员工为了能
 * 「从云端恢复」通常都会被勾上 data_manage —— 于是员工顺带能**导出全店商品档案，
 * 且导出的 CSV 含成本列**，与「成本仅老板可见」直接冲突。
 *
 * **口径**：导入 / 导出属「全店档案整体操作」→ 只按**数据归属者**（老板 / 管理总控）开放，
 * 不再随 data_manage 权限下放；界面隐藏 + 动作层拦截 + render 兜底三重。
 * 编辑类按钮（新建 / 删除选中 / 合并选中）仍按 product_edit 权限，
 * 没勾的员工最终只剩「搜索 + 状态筛选」。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

globalThis.ERP = globalThis.ERP || {};
globalThis.ERP.app = globalThis.ERP.app || {};
globalThis.ERP.app.render = function () {};
// 记录导出行为：员工触发 export-all 时不应产生任何下载
globalThis.__downloads = [];
globalThis.ERP.app.download = function (name, content, mime) {
  globalThis.__downloads.push({ name: name, content: content, mime: mime });
};

const page = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const accounts = require('../js/core/accounts.js');
globalThis.ERP.accounts = accounts;

/** 员工：共用老板库（ownerId=admin），被勾了 data_manage（为了能云端恢复） */
function staff(perms) {
  return {
    id: 'emp1', ownerId: 'admin', username: 'pifa', role: 'user',
    perms: Object.assign({ data_manage: true }, perms || {})
  };
}

/** 老板 / 管理总控：数据归属者 */
function boss() {
  return { id: 'admin', username: 'hawsystem', role: 'admin' };
}

function mk(acct) {
  const ctx = newCtx();
  ctx.currentAccount = acct;
  globalThis.ERP.currentAccount = acct;
  const state = page.init(ctx);
  return { ctx, state };
}

function seed(ctx) {
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399'
  });
}

function done() {
  delete globalThis.ERP.currentAccount;
}

/* ---------------- 界面层 ---------------- */

test('T1 员工（有 data_manage）：不出现「导出全部 / 批量导入」', () => {
  const { ctx, state } = mk(staff());
  try {
    seed(ctx);
    const html = page.render(ctx, state);
    assert.ok(!html.includes('data-act="export-all"'), '不应有「导出全部」按钮');
    assert.ok(!html.includes('data-act="open-csv"'), '不应有「批量导入」按钮');
    assert.ok(!/导出全部/.test(html), '连按钮文字都不出现');
    assert.ok(!/批量导入/.test(html), '连按钮文字都不出现');
  } finally { done(); }
});

test('T2 员工页仍保留搜索与状态筛选（需求：只留搜索）', () => {
  const { ctx, state } = mk(staff());
  try {
    seed(ctx);
    const html = page.render(ctx, state);
    assert.ok(html.includes('search-bar-product'), '搜索框保留');
    assert.ok(html.includes('data-name="filterStatus"'), '状态筛选保留');
    assert.ok(html.includes('海尔'), '商品数据照常可见');
  } finally { done(); }
});

test('T3 员工未勾 product_edit：勾选列与「操作」列一并隐藏', () => {
  const { ctx, state } = mk(staff());
  try {
    seed(ctx);
    const html = page.render(ctx, state);
    assert.ok(!html.includes('data-act="toggle-all-check"'), '无全选框');
    assert.ok(!html.includes('data-act="row-check"'), '无行内勾选框');
    assert.ok(!html.includes('data-act="edit-product"'), '无行内「编辑」');
    assert.ok(!html.includes('data-act="toggle-status"'), '无行内「停售」');
    assert.ok(!html.includes('>操作<'), '无「操作」列表头');
  } finally { done(); }
});

test('T4 员工勾了 product_edit：编辑类按钮照旧，但导入/导出仍然没有', () => {
  const { ctx, state } = mk(staff({ product_edit: true }));
  try {
    seed(ctx);
    const html = page.render(ctx, state);
    assert.ok(!html.includes('data-act="export-all"'), '导出仍不开放');
    assert.ok(!html.includes('data-act="open-csv"'), '导入仍不开放');
    assert.ok(html.includes('data-act="open-new"'), '「新建商品」按权限开放');
    assert.ok(html.includes('data-act="edit-product"'), '行内「编辑」按权限开放');
  } finally { done(); }
});

test('T5 老板 / 管理总控：导入导出按钮照旧（回归）', () => {
  const { ctx, state } = mk(boss());
  try {
    seed(ctx);
    const html = page.render(ctx, state);
    assert.ok(html.includes('data-act="export-all"'), '老板有「导出全部」');
    assert.ok(html.includes('data-act="open-csv"'), '老板有「批量导入」');
    assert.ok(html.includes('data-act="open-new"'), '老板有「新建商品」');
    assert.ok(html.includes('data-act="toggle-all-check"'), '老板有全选框');
  } finally { done(); }
});

test('T6 空列表：员工不再被引导去点不存在的「新建商品」', () => {
  const { ctx, state } = mk(staff());
  try {
    const html = page.render(ctx, state);
    assert.ok(!/点右上角「新建商品」添加/.test(html), '不引导员工新建');
    assert.ok(/换个关键词/.test(html), '改为引导换搜索条件');
  } finally { done(); }
});

test('T6b 空列表：老板的引导语照旧（回归）', () => {
  const { ctx, state } = mk(boss());
  try {
    const html = page.render(ctx, state);
    assert.ok(/点右上角「新建商品」添加/.test(html), '老板仍看到新建引导');
  } finally { done(); }
});

/* ---------------- 动作层（防绕过） ---------------- */

test('T7 员工绕过界面触发 open-csv：被拦回列表，不进导入页', () => {
  const { ctx, state } = mk(staff());
  try {
    const r = page.actions['open-csv'](ctx, state);
    assert.strictEqual(state.tab, 'list', '仍停在列表');
    assert.notStrictEqual(r, false, '需要重渲染以反映拦截结果');
  } finally { done(); }
});

test('T8 员工绕过界面触发 export-all：不产生任何下载文件', () => {
  const { ctx, state } = mk(staff());
  try {
    seed(ctx);
    globalThis.__downloads = [];
    page.actions['export-all'](ctx, state);
    assert.strictEqual(globalThis.__downloads.length, 0, '不应导出（CSV 含成本列）');
  } finally { done(); }
});

test('T8b 老板触发 export-all：正常导出（回归）', () => {
  const { ctx, state } = mk(boss());
  try {
    seed(ctx);
    globalThis.__downloads = [];
    page.actions['export-all'](ctx, state);
    assert.strictEqual(globalThis.__downloads.length, 1, '老板可导出');
    assert.ok(/商品档案全部\.csv/.test(globalThis.__downloads[0].name), '文件名正确');
  } finally { done(); }
});

test('T8c 老板 open-csv 正常进入导入页（回归）', () => {
  const { ctx, state } = mk(boss());
  try {
    page.actions['open-csv'](ctx, state);
    assert.strictEqual(state.tab, 'csv', '老板可进导入页');
    assert.ok(/批量导入商品/.test(page.render(ctx, state)), '渲染的是导入页');
  } finally { done(); }
});

test('T9 render 兜底：员工即使 state.tab 被改成 csv 也回列表', () => {
  const { ctx, state } = mk(staff());
  try {
    state.tab = 'csv';
    const html = page.render(ctx, state);
    assert.ok(!/批量导入商品/.test(html), '不渲染导入页');
    assert.ok(html.includes('search-bar-product'), '渲染的是列表页');
  } finally { done(); }
});

/* ---------------- 版本 ---------------- */

test('T10 版本号三处同步：page-mine V3.82 / sw.js v111', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.82'), '关于页应显示 V3.82');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v111';"), 'SW 缓存版本应为 v111');
});
