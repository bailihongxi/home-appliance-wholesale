/**
 * V3.83 框架层「全店整体操作」归属者专属（纵深防御）
 *
 * **背景**：V3.82 修了商品档案页的「导出全部 / 批量导入」按钮，
 * 但核查发现**框架层的动作级拦截**（`accounts.requireActionPerm`）仍把这些动作
 * 按 `data_manage` 权限放行：`clear-data`（清空全部数据）、`export-backup`（导出备份）、
 * `do-import`（批量导入覆盖档案）、`save-price-sys / apply-price-sys`（一键重算全店价格）。
 *
 * 而员工为了能「从云端恢复」通常都会被勾上 `data_manage` ——
 * 界面入口虽然隐藏了，动作层却是敞开的：只要动作被触发（残留入口 / 旧 state / 绕过），
 * 员工就能清空或带走全店数据。
 *
 * **口径**：这类动作加 `owner: true` —— **只看是不是数据归属者**，勾什么权限都不放行。
 * 同步类（sync-down）与本机设置（save-settings）保持不变，否则员工没法正常工作。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

globalThis.ERP = globalThis.ERP || {};
const accounts = require('../js/core/accounts.js');
globalThis.ERP.accounts = accounts;

/** 员工：共用老板库，为云端恢复被勾了 data_manage（本版要防的典型账号） */
const STAFF = { id: 'emp1', ownerId: 'admin', role: 'user', perms: { data_manage: true, report: true } };
/** 老板 / 管理总控 */
const BOSS = { id: 'admin', username: 'hawsystem', role: 'admin', perms: { data_manage: true } };
/** 独立数据空间账号（无 ownerId → 自身即归属者）；report 权限也要有，否则 report 页规则按权限就拦了 */
const SOLO = { id: 'boss2', role: 'boss', perms: { data_manage: true, report: true } };

const DESTRUCTIVE = [
  ['product', 'clear-data'], ['inventory', 'clear-data'], ['account', 'clear-data'],
  ['setting', 'clear-data'], ['mine', 'clear-data'],
  ['mine', 'export-backup'],
  ['product', 'do-import'], ['purchase', 'do-import'],
  ['product', 'download-template'], ['purchase', 'download-template'],
  ['product', 'export-all'],
  ['setting', 'save-price-sys'], ['setting', 'apply-price-sys'],
  ['report', 'save-price-sys'], ['report', 'apply-price-sys']
];

test('T1 员工（勾了 data_manage）：所有全店整体操作一律拒绝', () => {
  DESTRUCTIVE.forEach(([pg, act]) => {
    assert.strictEqual(accounts.requireActionPerm(STAFF, pg, act), false,
      '员工不可执行 ' + pg + '/' + act);
  });
});

test('T2 员工即便勾齐权限也不放行（owner 判定优先于权限）', () => {
  const all = {};
  accounts.PERMS.forEach((p) => { all[p.id] = true; });
  const full = { id: 'emp2', ownerId: 'admin', role: 'user', perms: all };
  assert.strictEqual(accounts.can(full, 'data_manage'), true, '权限确实全开');
  assert.strictEqual(accounts.requireActionPerm(full, 'mine', 'clear-data'), false, '仍拒绝清空');
  assert.strictEqual(accounts.requireActionPerm(full, 'mine', 'export-backup'), false, '仍拒绝导出备份');
  assert.strictEqual(accounts.requireActionPerm(full, 'product', 'do-import'), false, '仍拒绝批量导入');
});

test('T3 关键回归：员工仍能 sync-down（不然没法从云端恢复）', () => {
  assert.strictEqual(accounts.requireActionPerm(STAFF, 'mine', 'sync-down'), true, '可拉取');
  assert.strictEqual(accounts.requireActionPerm(STAFF, 'mine', 'save-sync-cfg'), true, '可存同步配置');
  assert.strictEqual(accounts.requireActionPerm(STAFF, 'mine', 'test-sync-conn'), true, '可测连接');
});

test('T4 关键回归：员工仍能改本机设置（打印参数 / 打开密码）', () => {
  assert.strictEqual(accounts.requireActionPerm(STAFF, 'setting', 'save-settings'), true);
  assert.strictEqual(accounts.requireActionPerm(STAFF, 'setting', 'save-shop'), true);
  assert.strictEqual(accounts.requireActionPerm(STAFF, 'setting', 'toggle-shop-edit'), true);
});

test('T5 关键回归：员工业务动作不受影响（开单 / 收款 / 记账 / 盘点）', () => {
  const s = {
    id: 'emp3', ownerId: 'admin', role: 'user',
    perms: { sale_bill: true, sale_pay: true, ledger: true, stock_adjust: true, product_edit: true }
  };
  assert.strictEqual(accounts.requireActionPerm(s, 'sale', 'save-sale'), true, '可开单');
  assert.strictEqual(accounts.requireActionPerm(s, 'sale', 'do-pay'), true, '可收款');
  assert.strictEqual(accounts.requireActionPerm(s, 'account', 'save-manual'), true, '可记账');
  assert.strictEqual(accounts.requireActionPerm(s, 'inventory', 'save-take'), true, '可盘点');
  assert.strictEqual(accounts.requireActionPerm(s, 'product', 'save-product'), true, '可建档');
});

test('T6 老板 / 管理总控：全部照常放行', () => {
  DESTRUCTIVE.forEach(([pg, act]) => {
    assert.strictEqual(accounts.requireActionPerm(BOSS, pg, act), true,
      '老板可执行 ' + pg + '/' + act);
  });
});

test('T7 独立数据空间账号（无 ownerId，自身即归属者）：照常放行', () => {
  DESTRUCTIVE.forEach(([pg, act]) => {
    assert.strictEqual(accounts.requireActionPerm(SOLO, pg, act), true,
      '独立账号可执行 ' + pg + '/' + act);
  });
});

test('T8 未登录 / 空账号：由登录态控制，本层放行（不改变既有语义）', () => {
  assert.strictEqual(accounts.requireActionPerm(null, 'mine', 'clear-data'), true);
});

test('T9 源码：归属者专属规则带 owner 标记且覆盖四类危险动作', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js/core/accounts.js'), 'utf8');
  const i = src.indexOf('var ACTION_RULES');
  const rules = src.slice(i, src.indexOf('};', i));
  ['clear-data', 'export-backup', 'do-import', 'apply-price-sys'].forEach((k) => {
    assert.ok(new RegExp(k).test(rules), '规则表涉及 ' + k);
  });
  assert.ok(/owner:\s*true/.test(rules), '存在 owner 标记');
  // sync-down 必须在「非 owner」的那条规则里，否则员工没法恢复数据
  const syncRule = rules.match(/\{ test: \/\^\(sync-up\|sync-down[^\n]*\}/);
  assert.ok(syncRule, '找到同步类规则');
  assert.ok(!/owner/.test(syncRule[0]), '同步类规则不能带 owner（否则员工无法从云端恢复）');
});

test('T10 版本号三处同步：page-mine V3.83 / sw.js v112', () => {
  const root = path.join(__dirname, '..');
  const mine = fs.readFileSync(path.join(root, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.83'), '关于页应显示 V3.83');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v112';"), 'SW 缓存版本应为 v112');
});
