/**
 * tests/sync-consistency.test.js —— 问题5：电脑版与手机版库存数量不一致
 * 用内存 mock GitHub Contents API 模拟「电脑 push → 手机 pull」真实同步流程，
 * 验证：1) 基础同步两端库存一致；2) 双端各自改动时全量覆盖模型的行为（暴露数据丢失）。
 */
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../js/core/sync.js');
const backup = require('../js/core/backup.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');
const inv = require('../js/core/inventory.js');

/** 内存云端：path -> { sha, content(base64 信封文本) } */
function makeCloud() {
  const store = {};
  let n = 0;
  function pathOf(url) {
    const m = String(url).split('?')[0].match(/\/contents\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : String(url);
  }
  function fetchImpl(url, opts) {
    const method = (opts && opts.method) || 'GET';
    return Promise.resolve().then(() => {
      const path = pathOf(url);
      if (method === 'GET') {
        const rec = store[path];
        if (!rec) return { status: 404, ok: false, text: () => Promise.resolve('{"message":"Not Found"}') };
        return { status: 200, ok: true, json: () => Promise.resolve({ sha: rec.sha, content: rec.content }) };
      }
      if (method === 'PUT') {
        const body = JSON.parse(opts.body);
        const rec = store[path];
        if (rec && body.sha && rec.sha !== body.sha) {
          return { status: 422, ok: false, text: () => Promise.resolve('{"message":"sha mismatch"}') };
        }
        n += 1;
        const sha = 'blob' + n;
        store[path] = { sha, content: body.content };
        return { status: 201, ok: true, json: () => Promise.resolve({ commit: { sha: 'commit' + n } }) };
      }
      return { status: 500, ok: false, text: () => Promise.resolve('{}') };
    });
  }
  return { fetchImpl, store };
}

const CFG = {
  owner: 'bailihongxi', repo: 'home-appliance-wholesale', branch: 'gh-pages',
  path: 'data/acct1/erp-snapshot.json', token: 't', passphrase: 'test-pass-123456'
};

function ctxWithStock(brand, model, stock) {
  const ctx = newCtx();
  const r = product.save(ctx, { brand, model, category: '冰箱', unit: '台', cost: '1000', priceWholesale: '1200', priceRetail: '1399' });
  if (!r.ok) throw new Error('建档失败：' + r.error);
  // 库存由单据驱动：用盘点设置期初库存
  const take = inv.applyStocktake(ctx, { date: '2026-09-01', counts: { [r.product.id]: stock } });
  if (!take.ok) throw new Error('库存设置失败：' + (take.error || (take.errors || []).join('；')));
  return ctx;
}

test('基础同步：电脑 push → 手机 pull，两端库存一致', async () => {
  const cloud = makeCloud();
  const pc = ctxWithStock('海尔', 'BCD-200', 5);
  const r1 = await sync.syncUp(pc, CFG, cloud.fetchImpl);
  assert.ok(r1.ok, '电脑上传成功：' + (r1.error || ''));

  const phone = newCtx();
  const r2 = await sync.syncDown(phone, CFG, cloud.fetchImpl);
  assert.ok(r2.ok, '手机恢复成功：' + (r2.error || ''));
  const p = phone.data.products.find(x => x.brand === '海尔');
  assert.ok(p, '手机端存在该商品');
  assert.strictEqual(p.stock, 5, '手机端库存与电脑端一致（5）');
  assert.strictEqual(pc.data.products[0].stock, p.stock, '两端库存相同');
});

test('幂等：内容一致时电脑再 push 跳过，库存不变', async () => {
  const cloud = makeCloud();
  const pc = ctxWithStock('格力', 'KFR-35', 8);
  await sync.syncUp(pc, CFG, cloud.fetchImpl);
  const r2 = await sync.syncUp(pc, CFG, cloud.fetchImpl);
  assert.ok(r2.ok && r2.skipped, '二次上传内容一致被跳过');
  // 手机恢复后库存 8
  const phone = newCtx();
  await sync.syncDown(phone, CFG, cloud.fetchImpl);
  assert.strictEqual(phone.data.products[0].stock, 8);
});

test('问题5-双端同基线各自改库存：从云端恢复按“较新”合并，不整库覆盖丢数据', async () => {
  const cloud = makeCloud();
  // 基线：商品1 库存5 上传云端
  const base = ctxWithStock('海尔', 'BCD-200', 5);
  await sync.syncUp(base, CFG, cloud.fetchImpl);

  // 电脑端：基于基线恢复 → 库存改为 9（较早 T1）→ 上传（云端=9）
  const pc = newCtx();
  await sync.syncDown(pc, CFG, cloud.fetchImpl);
  const pid = pc.data.products[0].id;
  inv.applyStocktake(pc, { date: '2026-09-03', counts: { [pid]: 9 } });
  pc.data.products[0].updatedAt = '2026-09-03T08:00:00+08:00'; // 电脑较早
  const rp = await sync.syncUp(pc, CFG, cloud.fetchImpl);
  assert.ok(rp.ok && !rp.skipped, '电脑上传库存9');

  // 手机端：基于基线恢复 → 库存改为 2（较晚 T2）→ 上传（云端=2，覆盖电脑）
  const phone = newCtx();
  await sync.syncDown(phone, CFG, cloud.fetchImpl);
  inv.applyStocktake(phone, { date: '2026-09-04', counts: { [pid]: 2 } });
  phone.data.products[0].updatedAt = '2026-09-04T08:00:00+08:00'; // 手机较晚
  const rph = await sync.syncUp(phone, CFG, cloud.fetchImpl);
  assert.ok(rph.ok && !rph.skipped, '手机上传播2');

  // 电脑端从云端恢复（合并模式）：同一商品 id，云端较新（手机 T2）→ 库存收敛为 2
  const rp2 = await sync.syncDown(pc, CFG, cloud.fetchImpl);
  assert.ok(rp2.ok, '电脑合并恢复成功');
  assert.strictEqual(pc.data.products[0].stock, 2, '同商品按较新（手机2）合并');
  assert.ok(phone.data.products[0].stock === 2, '手机端保持2，两端一致');
});

test('问题5-独立新增不丢失：云端新增商品合并到本地，本地独有商品保留', async () => {
  const cloud = makeCloud();
  // 基线：商品A 上传
  const base = ctxWithStock('海尔', 'BCD-200', 5);
  await sync.syncUp(base, CFG, cloud.fetchImpl);

  // 电脑端：恢复后新增商品B（本地独有）并上传
  const pc = newCtx();
  await sync.syncDown(pc, CFG, cloud.fetchImpl);
  const rb = product.save(pc, { brand: '格力', model: 'KFR-35', category: '空调', unit: '台', cost: '1800', priceWholesale: '2200', priceRetail: '2599' });
  assert.ok(rb.ok, '电脑新增商品B');
  await sync.syncUp(pc, CFG, cloud.fetchImpl); // 云端 = A + B

  // 手机端：基于旧基线（仅A）→ 合并恢复 → 云端新增商品B 进入手机
  const phone = newCtx();
  await sync.syncDown(phone, CFG, cloud.fetchImpl);
  assert.ok(phone.data.products.some(p => p.brand === '格力'), '云端新增商品B 合并到手机端');
  assert.ok(phone.data.products.some(p => p.brand === '海尔'), '基线商品A 保留');

  // 手机端独立新增商品C，再从云端合并恢复 → 商品C 不被覆盖丢失
  const rc = product.save(phone, { brand: '美的', model: 'M1-300', category: '厨房电器', unit: '台', cost: '800', priceWholesale: '999', priceRetail: '1199' });
  assert.ok(rc.ok, '手机新增商品C');
  const r2 = await sync.syncDown(phone, CFG, cloud.fetchImpl);
  assert.ok(r2.ok, '手机合并恢复成功');
  assert.ok(phone.data.products.some(p => p.brand === '美的'), '本地独有商品C 合并后保留');
  assert.ok(phone.data.products.some(p => p.brand === '海尔'), '商品A 仍在');
  assert.ok(phone.data.products.some(p => p.brand === '格力'), '商品B 仍在');
});
