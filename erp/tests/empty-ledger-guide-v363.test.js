/**
 * V3.63 本机空账本引导（「新用户登录后没有任何数据」的最后一环）
 *
 * V3.62 修好了云同步的数据空间维度，员工已经「能」拉到本店数据；
 * 但新员工在一台新设备上登录，看到的仍是一片空白、不知道该做什么。
 * 本文件约束首页按「数据空间」给出正确引导，且不误伤有数据的账号与无账号场景。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// 与 shared-data-sync 同款坑：必须先建立 globalThis.ERP 再 require 页面模块，
// 否则页面 UMD 闭包持有的 ERP 对象与 globalThis.ERP 不是同一个。
globalThis.ERP = globalThis.ERP || {};

const page = require('../js/ui/page-home.js');
const util = require('../js/core/util.js');
const accounts = require('../js/core/accounts.js');
const { newCtx } = require('./helpers/ctx.js');

const ROOT = path.join(__dirname, '..');

/** 构造带权限的账号档案 */
function acct(id, ownerId) {
  const perms = {};
  accounts.PERMS.forEach((p) => { perms[p.id] = true; });
  return { id, username: id, shopName: id, role: 'user', perms, ownerId: ownerId || null };
}

/** 渲染首页（ctx 带上账号上下文，模拟真实登录态） */
function render(a) {
  const ctx = newCtx();
  ctx.currentAccount = a;
  return page.render(ctx, page.init());
}

test('未登录 / 无账号上下文：不显示空账本引导（避免无账号场景凭空多卡片）', () => {
  const ctx = newCtx();
  const html = page.render(ctx, page.init());
  assert.ok(!html.includes('本机还没有数据'), '无账号上下文不应出现引导');
});

test('共用本店数据 + 本机空账本：引导用管理总控登录并从云端恢复', () => {
  const html = render(acct('acct1', 'admin'));
  assert.ok(html.includes('本机还没有数据'), '空账本应有引导卡片');
  assert.ok(html.includes('管理总控'), '共用本店数据需提示用管理总控账号登录');
  assert.ok(html.includes('从云端恢复'), '需给出「从云端恢复」动作');
  assert.ok(html.includes('data-act="go" data-page="mine"'), '提供去云同步入口');
  assert.ok(html.includes('共用同一本账'), '说明与老板共用同一本账');
});

test('独立数据空间 + 本机空账本：引导去建档/导入，不提管理总控', () => {
  const html = render(acct('acct2', null));
  assert.ok(html.includes('本机还没有数据'), '空账本应有引导卡片');
  assert.ok(html.includes('data-act="go" data-page="product"'), '提供去建档/导入入口');
  assert.ok(!html.includes('管理总控'), '独立数据空间不应引导去找管理总控');
  assert.ok(!html.includes('data-act="go" data-page="mine"'), '独立空间不引导去云同步');
});

test('本机已有数据：不显示空账本引导', () => {
  const ctx = newCtx();
  ctx.currentAccount = acct('acct1', 'admin');
  ctx.data.products.push({
    id: 'p1', brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: 1000, priceWholesale: 1200, priceRetail: 1399, stock: 5, note: '',
    barcodes: [], status: 'on'
  });
  const html = page.render(ctx, page.init());
  assert.ok(!html.includes('本机还没有数据'), '有数据时不应出现引导');
});

test('util.isEmptyLedger：空 / 有商品 / 有销售 判定', () => {
  const empty = newCtx();
  assert.strictEqual(util.isEmptyLedger(empty), true, '全新空账本');
  assert.strictEqual(util.isEmptyLedger(empty.data), true, '也支持直接传 data');

  const withProduct = newCtx();
  withProduct.data.products.push({ id: 'p1' });
  assert.strictEqual(util.isEmptyLedger(withProduct), false, '有商品即非空');

  const withSale = newCtx();
  withSale.data.sales.push({ no: 'S1' });
  assert.strictEqual(util.isEmptyLedger(withSale), false, '有销售单即非空');

  const withLedger = newCtx();
  withLedger.data.ledgers.push({ id: 'L1' });
  assert.strictEqual(util.isEmptyLedger(withLedger), false, '有账目即非空');
});

test('V3.68 版本号：page-mine V3.68 / sw.js v97', () => {
  const fs = require('node:fs');
  const mineSrc = fs.readFileSync(path.join(ROOT, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(mineSrc.includes('版本：V3.68'), '关于页 V3.65');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v97';"), 'SW 缓存版本 v94');
});
