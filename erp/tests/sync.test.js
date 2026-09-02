/**
 * 云同步（sync.js）—— 问题2：GitHub 403 诊断优化
 * - githubError：细分 401/403(限流 vs 权限不足 vs 其他)/404/409/422
 * - checkAuth：预检 Token 与仓库可访问性
 */
const test = require('node:test');
const assert = require('node:assert');
const sync = require('../js/core/sync.js');

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
