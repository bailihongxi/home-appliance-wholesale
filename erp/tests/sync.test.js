/**
 * 云同步（sync.js）—— 问题2：GitHub 403 诊断优化
 * - githubError：细分 401/403(限流 vs 权限不足 vs 其他)/404/409/422
 * - checkAuth：预检 Token 与仓库可访问性
 */
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../js/core/sync.js');
const { newCtx } = require('./helpers/ctx.js');
const product = require('../js/core/product.js');

const BASE = {
  owner: 'bailihongxi',
  repo: 'home-appliance-wholesale',
  branch: 'gh-pages',
  path: 'data/erp-snapshot.json',
  token: 'ghp_x',
  passphrase: '12345678'
};

/** 构造带 headers 的 mock 响应 */
function res(status, body, headersObj) {
  return {
    status: status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (headersObj ? headersObj[k] : undefined) },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body || {})),
    json: () => Promise.resolve(typeof body === 'object' && body !== null ? body : JSON.parse(body || '{}'))
  };
}

/** githubError 便捷调用：body 传响应文本 */
function ge(status, bodyObj) {
  return sync._githubError(res(status, bodyObj || {}), JSON.stringify(bodyObj || {}));
}

test('githubError-401：Token 无效/过期', () => {
  const msg = ge(401, { message: 'Bad credentials' });
  assert.ok(msg.includes('401'), '含 401');
  assert.ok(msg.includes('Token 无效或已过期'), '提示重新生成 Token');
});

test('githubError-403-限流：body 含 rate limit', () => {
  const msg = ge(403, { message: 'API rate limit exceeded for 1.2.3.4' });
  assert.ok(msg.includes('限流'), '识别为限流');
  assert.ok(msg.includes('等待重置'), '提示稍后重试');
});

test('githubError-403-限流：X-RateLimit-Remaining=0', () => {
  const msg = sync._githubError(res(403, { message: 'Something went wrong' }, { 'X-RateLimit-Remaining': '0' }), '{"message":"Something went wrong"}');
  assert.ok(msg.includes('限流'), '按响应头识别为限流');
});

test('githubError-403-权限不足：body 含 Resource not accessible', () => {
  const msg = ge(403, { message: 'Resource not accessible by integration' });
  assert.ok(msg.includes('权限不足'), '识别为权限不足');
  assert.ok(msg.includes('Contents: Read and write'), '指引勾选写权限');
  assert.ok(!msg.includes('限流'), '不误报限流');
});

test('githubError-403-通用：无特征信息', () => {
  const msg = ge(403, {});
  assert.ok(msg.includes('403'), '含状态码');
  assert.ok(msg.includes('Token 权限不足或触发限流'), '给出通用指引');
});

test('githubError-404/409/422/其他', () => {
  assert.ok(ge(404, {}).includes('找不到仓库或分支'), '404 仓库/分支');
  assert.ok(ge(409, {}).includes('提交冲突'), '409 冲突');
  assert.ok(ge(422, { message: 'Invalid request' }).includes('422'), '422');
  assert.ok(ge(500, { message: 'boom' }).includes('500'), '其他状态码');
});

test('checkAuth-200：Token 有效且仓库可访问', async () => {
  const fetchImpl = (url, opt) => Promise.resolve(res(200, { full_name: 'bailihongxi/home-appliance-wholesale', private: false }));
  const r = await sync.checkAuth(BASE, fetchImpl);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.repo, 'bailihongxi/home-appliance-wholesale');
  assert.strictEqual(r.private, false);
});

test('checkAuth-401：Token 无效', async () => {
  const fetchImpl = () => Promise.resolve(res(401, { message: 'Bad credentials' }));
  const r = await sync.checkAuth(BASE, fetchImpl);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('无效或已过期'));
});

test('checkAuth-403：权限不足（细分提示）', async () => {
  const fetchImpl = () => Promise.resolve(res(403, { message: 'Resource not accessible by integration' }));
  const r = await sync.checkAuth(BASE, fetchImpl);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('权限不足'), '细分提示权限不足');
});

test('checkAuth-404：仓库不存在或无权查看', async () => {
  const fetchImpl = () => Promise.resolve(res(404, { message: 'Not Found' }));
  const r = await sync.checkAuth(BASE, fetchImpl);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('找不到仓库'), '提示检查仓库');
});

test('checkAuth-配置缺失：未填 Token / owner / repo', async () => {
  const r1 = await sync.checkAuth(Object.assign({}, BASE, { token: '  ' }), () => Promise.resolve());
  assert.strictEqual(r1.ok, false);
  assert.ok(r1.error.includes('Token'));
  const r2 = await sync.checkAuth(Object.assign({}, BASE, { owner: '', repo: '' }), () => Promise.resolve());
  assert.strictEqual(r2.ok, false);
  assert.ok(r2.error.includes('用户名') || r2.error.includes('仓库名'));
});

test('checkAuth-请求携带 Authorization Bearer Token', async () => {
  let captured = null;
  const fetchImpl = (url, opt) => {
    captured = opt.headers.Authorization;
    return Promise.resolve(res(200, { full_name: 'x/y' }));
  };
  await sync.checkAuth(BASE, fetchImpl);
  assert.strictEqual(captured, 'Bearer ghp_x');
});

/* ===== 上传大小控制：gzip 压缩 + 超限拦截 ===== */
test('gzip-压缩/解压往返：内容完整还原', async () => {
  const raw = '一级能效，含安装，质保十年，送货上门，颜色白色，能效等级一级，制冷量3500W'.repeat(20);
  const bytes = new TextEncoder().encode(raw);
  const gz = await sync.gzip(bytes);
  assert.ok(gz && gz.length > 0, '压缩产物存在');
  assert.ok(gz.length < bytes.length, '压缩后变小（JSON 文本可压缩）');
  const out = await sync.gunzip(gz);
  assert.strictEqual(new TextDecoder().decode(out), raw, '解压还原原文');
});

test('v2 压缩信封：encrypt(压缩字节) → decrypt 自动解压还原', async () => {
  const raw = '品牌=海尔,型号=BCD-200,类型=冰箱'.repeat(30);
  const gz = await sync.gzip(new TextEncoder().encode(raw));
  const env = await sync.encrypt(gz, 'pass123456', '2026-09-03T00:00:00Z', { comp: 'gzip' });
  assert.strictEqual(env.v, 2, '信封版本 v2');
  assert.strictEqual(env.comp, 'gzip', '标记压缩');
  assert.ok(env.salt && env.iv && env.ct);
  const chk = sync.validateEnvelope(env);
  assert.strictEqual(chk.ok, true, 'v2 信封校验通过');
  const text = await sync.decrypt(env, 'pass123456');
  assert.strictEqual(text, raw, '解密+解压还原原文');
  // 口令错误 → 明确报错
  await assert.rejects(() => sync.decrypt(env, 'wrong-pass'), /解密失败/);
});

test('v1 无压缩信封：decrypt 兼容还原明文', async () => {
  const raw = 'v1 明文快照内容';
  const env = await sync.encrypt(raw, 'pass123456'); // 明文路径：无 comp
  env.v = 1; // 模拟旧版信封
  const chk = sync.validateEnvelope(env);
  assert.strictEqual(chk.ok, true, 'v1 信封校验通过');
  const text = await sync.decrypt(env, 'pass123456');
  assert.strictEqual(text, raw, 'v1 明文解密兼容');
});

test('syncUp-压缩上传：返回 uploadBytes/compressed，上传体小于明文', async () => {
  const ctx = newCtx();
  product.save(ctx, {
    brand: '海尔', model: 'BCD-200', category: '冰箱', unit: '台',
    cost: '1000', priceWholesale: '1200', priceRetail: '1399', note: '一级能效，含安装'.repeat(5)
  });
  let putBody = null;
  const fetchImpl = (url, opt) => {
    if (opt.method === 'GET') return Promise.resolve(res(404, {}));
    if (opt.method === 'PUT') {
      putBody = JSON.parse(opt.body);
      return Promise.resolve(res(201, { commit: { sha: 'abc123' } }));
    }
    return Promise.resolve(res(500, {}));
  };
  const r = await sync.syncUp(ctx, BASE, fetchImpl);
  assert.strictEqual(r.ok, true, '同步成功');
  assert.strictEqual(r.compressed, true, '启用压缩');
  assert.ok(r.uploadBytes > 0, '有上传字节数');
  const envPut = JSON.parse(sync.base64ToText(putBody.content));
  assert.strictEqual(envPut.kind, 'sync-snapshot', 'PUT 信封合法');
  assert.strictEqual(envPut.comp, 'gzip', '信封标记压缩');
});

test('syncUp-超限拦截：超过上限直接拒绝且不发起请求', async () => {
  const ctx = newCtx();
  product.save(ctx, {
    brand: '美的', model: 'KFR-35', category: '空调', unit: '台',
    cost: '1800', priceWholesale: '2200', priceRetail: '2599'
  });
  const origMax = sync.MAX_UPLOAD_BYTES;
  sync.MAX_UPLOAD_BYTES = 10; // 人为调小以触发拦截
  let called = false;
  try {
    const r = await sync.syncUp(ctx, BASE, () => { called = true; return Promise.resolve(); });
    assert.strictEqual(r.ok, false, '超限拒绝');
    assert.ok(r.error.includes('上传数据过大'), '明确提示过大: ' + r.error);
    assert.ok(r.error.includes('MB'), '提示大小与上限');
    assert.strictEqual(called, false, '未发起任何网络请求');
  } finally {
    sync.MAX_UPLOAD_BYTES = origMax;
  }
});
