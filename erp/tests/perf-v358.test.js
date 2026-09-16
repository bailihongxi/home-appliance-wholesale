/**
 * tests/perf-v358.test.js —— V3.58 全局性能专项（加载 / 切换 / 搜索）
 *
 * 覆盖四项改造：
 *   1) repo 上下文主键索引：getProduct / getPartner 由 O(n) 线性查找改为 O(1)，
 *      且在新增(push) / 删除(splice) / 整体替换(换数组) 后结果依然正确。
 *   2) 利润聚合去 O(n²)：topProducts 内部合并为单次聚合，新增 productAgg / rankProducts。
 *   3) 大体积第三方库懒加载：core/lazy.js 去重 + 失败可重试；Excel 库初始不可用、ensureLoaded 后才可用。
 *   4) 通用区块级局部刷新：app 同路由重渲染只替换变化区块（零写入 / 属性同步 / 结构不符回落整页）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { newCtx } = require('./helpers/ctx.js');
const repo = require('../js/store/repo.js');
const util = require('../js/core/util.js');
const schema = require('../js/core/schema.js');
require('../js/core/util.js');
require('../js/core/schema.js');
require('../js/core/ledger.js');
const profit = require('../js/core/profit.js');
const lazy = require('../js/core/lazy.js');
const appMod = require('../js/app.js');
// app.js 是 UMD（挂 globalThis.ERP.app，不导出模块），真实实例要通过 ERP 命名空间取
const app = (appMod && appMod.navItems) ? appMod : (globalThis.ERP && globalThis.ERP.app);

const ROOT = path.join(__dirname, '..');

/** 造 n 个商品的上下文 */
function ctxWith(n) {
  const ctx = newCtx();
  for (let i = 0; i < n; i++) {
    ctx.data.products.push({
      id: 'p' + i, brand: 'B' + i, model: 'M' + i, category: '空调', unit: '台',
      cost: 100, priceWholesale: 120, priceRetail: 139, stock: 5, status: 'on', barcodes: ['69' + i]
    });
  }
  return ctx;
}

/* ============ 1) 主键索引 ============ */

test('V3.58 索引：getProduct 命中任意位置的商品', () => {
  const ctx = ctxWith(500);
  assert.strictEqual(ctx.getProduct('p0').model, 'M0');
  assert.strictEqual(ctx.getProduct('p499').model, 'M499');
  assert.strictEqual(ctx.getProduct('p250').model, 'M250');
  assert.strictEqual(ctx.getProduct('nope'), null, '不存在的 id 返回 null');
});

test('V3.58 索引：新增(push)后可立即查到', () => {
  const ctx = ctxWith(3);
  assert.strictEqual(ctx.getProduct('p9'), null);
  ctx.data.products.push({ id: 'p9', brand: '新', model: 'NM9', stock: 1 });
  assert.strictEqual(ctx.getProduct('p9').model, 'NM9', 'push 后长度变化应触发索引重建');
});

test('V3.58 索引：删除(splice)后查不到', () => {
  const ctx = ctxWith(5);
  assert.ok(ctx.getProduct('p2'));
  ctx.data.products.splice(2, 1);
  assert.strictEqual(ctx.getProduct('p2'), null, 'splice 后长度变化应触发索引重建');
});

test('V3.58 索引：整体替换数组后读到新数据', () => {
  const ctx = ctxWith(3);
  assert.strictEqual(ctx.getProduct('p1').model, 'M1');
  ctx.data.products = [{ id: 'p1', brand: '新', model: 'REPLACED', stock: 0 }];
  assert.strictEqual(ctx.getProduct('p1').model, 'REPLACED', '换数组后应重建索引');
});

test('V3.58 索引：重复 id 与 Array.find 同义（取首个）', () => {
  const ctx = newCtx();
  ctx.data.products.push({ id: 'dup', model: 'first', stock: 1 });
  ctx.data.products.push({ id: 'dup', model: 'second', stock: 2 });
  assert.strictEqual(ctx.getProduct('dup').model, 'first');
});

test('V3.58 索引：字段原地修改无需重建（索引存的是对象引用）', () => {
  const ctx = ctxWith(2);
  const p = ctx.getProduct('p1');
  p.stock = 999;
  assert.strictEqual(ctx.getProduct('p1').stock, 999, '原地改字段后应读到最新值');
});

test('V3.58 索引：getPartner 同理可用且人到联系人列表替换后仍正确', () => {
  const ctx = newCtx();
  ctx.data.partners.push({ id: 'a1', name: '供应商甲', type: 'supplier' });
  ctx.data.partners.push({ id: 'a2', name: '客户乙', type: 'customer' });
  assert.strictEqual(ctx.getPartner('a2').name, '客户乙');
  ctx.data.partners.push({ id: 'a3', name: '客户丙', type: 'customer' });
  assert.strictEqual(ctx.getPartner('a3').name, '客户丙');
});

test('V3.58 索性性能：3000 商品做 3000 次查询应在毫秒级（此前为 O(n²)）', () => {
  const ctx = ctxWith(3000);
  const ids = ctx.data.products.map(p => p.id);
  const t0 = Date.now();
  let hits = 0;
  ids.forEach(id => { if (ctx.getProduct(id)) hits++; });
  const ms = Date.now() - t0;
  assert.strictEqual(hits, 3000, '全部命中');
  assert.ok(ms < 100, '3000 次查询耗时应远低于百毫秒（实际 ' + ms + 'ms）');
});

/* ============ 2) 利润聚合 ============ */

test('V3.58 利润：productAgg 单次聚合结果与逐产品参数一致', () => {
  const ctx = ctxWith(50);
  const today = util.today();
  ctx.data.sales.push({
    no: 'X1', date: today, type: 'sale', partnerId: null, voided: false, discount: 0,
    items: [
      { productId: 'p0', qty: 3, price: 200, costSnapshot: 100, type: 'sale' },
      { productId: 'p1', qty: 1, price: 200, costSnapshot: 100, type: 'sale' }
    ],
    payments: [{ method: 'cash', amount: 800 }], received: 800, debt: 0, payable: 800
  });
  const agg = profit.productAgg(ctx);
  assert.strictEqual(agg.length, 2, '聚合出 2 个商品');
  const p0 = agg.find(a => a.productId === 'p0');
  assert.strictEqual(p0.qty, 3);
  assert.strictEqual(p0.revenue, 600);
  assert.strictEqual(p0.cost, 300);
  assert.strictEqual(p0.grossProfit, 300);
  assert.ok(p0.name.indexOf('B0') >= 0, '带出商品名称（走索引）');
});

test('V3.58 利润：rankProducts 畅销 desc / 滞销 asc 取自同一份聚合', () => {
  const ctx = ctxWith(30);
  const today = util.today();
  const items = [];
  for (let i = 0; i < 10; i++) items.push({ productId: 'p' + i, qty: i + 1, price: 200, costSnapshot: 100, type: 'sale' });
  ctx.data.sales.push({
    no: 'X1', date: today, type: 'sale', partnerId: null, voided: false, discount: 0, items,
    payments: [{ method: 'cash', amount: 1 }], received: 1, debt: 0, payable: 1
  });
  const agg = profit.productAgg(ctx);
  const best = profit.rankProducts(agg, 'profit', 'desc', 3);
  const worst = profit.rankProducts(agg, 'profit', 'asc', 3);
  assert.strictEqual(best[0].productId, 'p9', '销量最高的是 p9');
  assert.strictEqual(worst[0].productId, 'p0', '最低的是 p0');
  // 与旧的 topProducts API 结果一致（保证没有行为回归）
  assert.deepStrictEqual(best.map(x => x.productId), profit.topProducts(ctx, { by: 'profit', n: 3 }).map(x => x.productId));
  assert.deepStrictEqual(worst.map(x => x.productId), profit.topProducts(ctx, { by: 'profit', order: 'asc', n: 3 }).map(x => x.productId));
});

test('V3.58 利润：报表页畅销/滞销只聚合一次（源码不再两次 topProducts）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/ui/page-report.js'), 'utf8');
  const calls = (src.match(/topProducts\(/g) || []).length;
  assert.strictEqual(calls, 0, '报表页不应再直接调用 topProducts（改为 productAgg + rankProducts）');
  assert.ok(src.includes('profit.productAgg(ctx)'), '改用 productAgg');
  assert.ok(src.includes("profit.rankProducts(agg, state.topBy, 'desc', 5)"), '畅销');
  assert.ok(src.includes("profit.rankProducts(agg, state.topBy, 'asc', 5)"), '滞销');
});

/* ============ 3) 懒加载 ============ */

test('V3.58 懒加载：同一 key 并发共享，只注入一次脚本', async () => {
  lazy._reset();
  const injected = [];
  const fakeDoc = {
    createElement: () => ({
      set src(v) { injected.push(v); }, get src() { return ''; },
      async: false, onload: null, onerror: null
    }),
    head: { appendChild: (el) => { setTimeout(() => el.onload && el.onload(), 0); } }
  };
  let ready = false;
  const check = () => (ready ? 'LIB' : null);
  const p1 = lazy.load('x', 'lib.js', check, { document: fakeDoc, timeout: 1000 });
  const p2 = lazy.load('x', 'lib.js', check, { document: fakeDoc, timeout: 1000 });
  // 在脚本 onload 前让 check 通过
  ready = true;
  const [a, b] = await Promise.all([p1, p2]);
  assert.strictEqual(a, 'LIB');
  assert.strictEqual(b, 'LIB');
  assert.strictEqual(injected.length, 1, '并发只注入一次（实际 ' + injected.length + ' 次）');
});

test('V3.58 懒加载：失败后可重试（不清 Promise 缓存会永久失败）', async () => {
  lazy._reset();
  let loaded = false;      // 只有脚本 onload 成功后 check 才通过
  let failFirst = true;
  const fakeDoc = {
    createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
    head: {
      appendChild: (el) => {
        setTimeout(() => {
          if (failFirst) { failFirst = false; el.onerror && el.onerror(); return; }
          loaded = true;
          el.onload && el.onload();
        }, 0);
      }
    }
  };
  const check = () => (loaded ? 'OK2' : null);
  await assert.rejects(() => lazy.load('k2', 'x.js', check, { document: fakeDoc, timeout: 500 }), /懒加载失败/);
  const ok = await lazy.load('k2', 'x.js', check, { document: fakeDoc, timeout: 500 });
  assert.strictEqual(ok, 'OK2', '第二次应重试成功');
});

test('V3.58 懒加载：index.html 首屏不再引入大体积 vendor', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scriptSrcs = (html.match(/<script[^>]*src="([^"]+)"/g) || [])
    .map(s => (/src="([^"]+)"/.exec(s) || [, ''])[1]);
  assert.ok(!scriptSrcs.some(s => s.includes('xlsx')), '首屏不再 <script> 加载 xlsx(861KB)：' + scriptSrcs.filter(s => s.includes('xlsx')));
  assert.ok(!scriptSrcs.some(s => s.includes('zxing')), '首屏不再 <script> 加载 zxing(407KB)');
  assert.ok(scriptSrcs.includes('js/core/lazy.js'), '引入懒加载器');
});

test('V3.58 懒加载：excel.available 在 Node 下仍可用（直接 require），并暴露 ensureLoaded', () => {
  const excel = require('../js/core/excel.js');
  assert.strictEqual(typeof excel.ensureLoaded, 'function', '新增 ensureLoaded');
  assert.strictEqual(excel.available(), true, 'Node 环境直接可用（测试不受影响）');
});

test('V3.58 懒加载：scan 暴露 ensureZxing 且在无 window 时安全返回', async () => {
  const scanSrc = fs.readFileSync(path.join(ROOT, 'js/barcode/scan.js'), 'utf8');
  assert.ok(scanSrc.includes('scan.ensureZxing = ensureZxing;'), '暴露 ensureZxing');
  assert.ok(scanSrc.includes("lazy.load('zxing', 'vendor/zxing-decode.min.js'"), 'zxing 走懒加载');
  assert.ok(scanSrc.includes("if (typeof window === 'undefined') return Promise.resolve(null);"), '无 window 时安全返回');
});

/* ============ 4) 通用区块级局部刷新 ============ */

/** 极简 DOM 桩：实现 patch 所需能力，并按实际情况合成 outerHTML（叶子有快照，非叶子由子节点拼出） */
function domStub() {
  function El(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.outerHTMLStore = '';
    this.innerHTMLStore = '';
    this.__leaf = false;   // 叶子：outerHTML 用存储的快照
    this.__writes = 0;
  }
  El.prototype.setAttribute = function (n, v) { this.attrs[n] = v; this.__writes++; };
  El.prototype.getAttribute = function (n) { return n in this.attrs ? this.attrs[n] : null; };
  El.prototype.hasAttribute = function (n) { return n in this.attrs; };
  El.prototype.removeAttribute = function (n) { delete this.attrs[n]; this.__writes++; };
  // 供 syncAttrs 使用：返回与浏览器一致的类数组 attributes
  Object.defineProperty(El.prototype, 'attributes', {
    get() { return Object.keys(this.attrs).map(k => ({ name: k, value: this.attrs[k] })); }
  });
  Object.defineProperty(El.prototype, 'outerHTML', {
    get() {
      if (this.__leaf) return this.outerHTMLStore;
      const lower = this.tagName.toLowerCase();
      const attrStr = Object.keys(this.attrs).map(k => ' ' + k + '="' + this.attrs[k] + '"').join('');
      return '<' + lower + attrStr + '>' + this.children.map(c => c.outerHTML).join('') + '</' + lower + '>';
    },
    set(v) {
      this.__writes++;
      this.__leaf = true;
      this.outerHTMLStore = v;
      const m = /^<([a-zA-Z0-9]+)/.exec(v);
      this.tagName = m ? m[1].toUpperCase() : this.tagName;
      this.children = [];
    }
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    get() { return this.innerHTMLStore; },
    set(v) { this.__writes++; this.innerHTMLStore = v; this.children = []; }
  });
  return El;
}

/** 造一个叶子节点（带 outerHTML 快照） */
function mk(El, tag, html) {
  const el = new El(tag);
  el.outerHTMLStore = html;
  el.__leaf = true;
  el.__writes = 0;
  return el;
}

/* ---- 直接对「新旧两棵树」做断言：不需要真实 HTML 解析器，桩即可覆盖核心逻辑 ---- */

test('V3.58 局部刷新：子节点完全相同时零 DOM 写入（不闪屏）', () => {
  const El = domStub();
  const oldRoot = new El('div');
  const newRoot = new El('div');
  oldRoot.children = [mk(El, 'div', '<div class="head">H</div>'), mk(El, 'div', '<div class="body">B</div>')];
  newRoot.children = [mk(El, 'div', '<div class="head">H</div>'), mk(El, 'div', '<div class="body">B</div>')];

  const ok = app._reconcileList(oldRoot, newRoot, 0);
  assert.strictEqual(ok, true, '结构一致 → 增量比对成功');
  assert.strictEqual(oldRoot.children[0].__writes, 0, 'head 区块零写入');
  assert.strictEqual(oldRoot.children[1].__writes, 0, 'body 区块零写入');
});

test('V3.58 局部刷新：只有最后一个区块变化时，其余区块零写入', () => {
  const El = domStub();
  const oldRoot = new El('div');
  const newRoot = new El('div');
  oldRoot.children = [mk(El, 'div', '<div class="head">H</div>'), mk(El, 'div', '<div class="body">OLD</div>')];
  newRoot.children = [mk(El, 'div', '<div class="head">H</div>'), mk(El, 'div', '<div class="body">NEW</div>')];

  const ok = app._reconcileList(oldRoot, newRoot, 0);
  assert.strictEqual(ok, true);
  assert.strictEqual(oldRoot.children[0].__writes, 0, '未变化的 head 零写入（不会被重建）');
  assert.ok(oldRoot.children[1].__writes > 0, '变化的 body 被重写');
  assert.strictEqual(oldRoot.children[1].outerHTML, '<div class="body">NEW</div>', '内容已更新');
});

test('V3.58 局部刷新：顶层结构不一致时回落整页替换（正确性优先）', () => {
  const El = domStub();
  // 数量不同
  const a = new El('div');
  const b = new El('div');
  a.children = [mk(El, 'div', '<div>X</div>')];
  b.children = [mk(El, 'div', '<div>X</div>'), mk(El, 'div', '<div>Y</div>')];
  assert.strictEqual(app._reconcileList(a, b, 0), false, '元素数量不同 → 回落');
  // 标签不同
  const c = new El('div');
  const d = new El('div');
  c.children = [mk(El, 'div', '<div>X</div>')];
  d.children = [mk(El, 'span', '<span>X</span>')];
  assert.strictEqual(app._reconcileList(c, d, 0), false, '标签名不同 → 回落');
});

test('V3.58 局部刷新：仅属性变化时同步属性而不整块重建（class 高亮切换）', () => {
  const El = domStub();
  // 父节点有两个子节点：内容完全一致，只有父节点的 class 从 tab 变成 tab on
  const oldParent = new El('button'); oldParent.setAttribute('class', 'tab');
  const newParent = new El('button'); newParent.setAttribute('class', 'tab on');
  oldParent.children = [mk(El, 'span', '<span>1</span>'), mk(El, 'span', '<span>2</span>')];
  newParent.children = [mk(El, 'span', '<span>1</span>'), mk(El, 'span', '<span>2</span>')];

  const oldRoot = new El('div'); oldRoot.children = [oldParent];
  const newRoot = new El('div'); newRoot.children = [newParent];
  oldParent.__writes = 0; // 清掉构造阶段的写入计数，只看 reconcile 过程中的写入

  app._reconcileList(oldRoot, newRoot, 0);
  assert.strictEqual(oldParent.getAttribute('class'), 'tab on', '属性差异已同步');
  assert.strictEqual(oldParent.__writes, 1, '只写了属性（未整块重建），实际写入 ' + oldParent.__writes + ' 次');
  assert.strictEqual(oldRoot.children[0], oldParent, '节点被保留而非替换');
});

test('V3.58 局部刷新：app.render 优先 update，其次 patchMain，最后才整页', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.ok(src.includes('patched = page.update(app.ctx, state) === true;'), '优先页面自带 update');
  assert.ok(src.includes('patched = patchMain(app.main, html);'), '其次通用增量写入');
  assert.ok(src.includes('if (patched) lastMainHtml = html;'), '增量成功记录基线');
  assert.ok(src.includes('if (win && !patched) {'), '局部刷新成功时不调用 scrollTo');
  assert.ok(src.includes('if (routeChanged) lastMainHtml = null;'), '跨路由重置基线');
});

test('V3.61 版本号三处同步：page-mine V3.61 / sw.js v90 / ui-mine 断言', () => {
  const mine = fs.readFileSync(path.join(ROOT, 'js/ui/page-mine.js'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const t = fs.readFileSync(path.join(ROOT, 'tests/ui-mine.test.js'), 'utf8');
  assert.ok(mine.includes('版本：V3.61'), '关于页 V3.61');
  assert.ok(sw.includes("var CACHE = 'appliance-erp-v90';"), 'SW 缓存版本 v90');
  assert.ok(t.includes('版本：V3.61'), '测试断言 V3.61');
});
