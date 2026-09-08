/**
 * tests/import-actions-layout.test.js —— V3.27 批量导入操作按钮排布
 *
 * 背景：体检报告很长（新增/更新/合并/未覆盖/错误多张表），原「取消」「确认执行导入」
 *      渲染在报告末尾，需要一路下滚才能点到。
 * 规则：三个按钮（预演体检（不写入）/ 取消 / 确认执行导入）同排、靠最右端；
 *      未预演时不显示 取消 / 确认执行导入；报告末尾不再重复渲染按钮。
 */
const test = require('node:test');
const assert = require('node:assert');
const productPage = require('../js/ui/page-product.js');
const { newCtx } = require('./helpers/ctx.js');

/**
 * 取出 import-actions 操作行的 HTML 片段。
 * 注意：行内含 <div class="spacer"></div>，不能用 indexOf('</div>') 截断，
 * 否则只取到 spacer 为止；整行以 </div></div>（关行 + 关卡片）结束。
 */
function actionRow(html) {
  const m = /<div class="row import-actions">([\s\S]*?)<\/div><\/div>/.exec(html);
  return m ? m[1] : '';
}

/** 造一个已生成体检报告的状态 */
function previewed() {
  const ctx = newCtx();
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型\n海尔,BCD-1,冰箱\n美的,BCD-2,冰箱';
  productPage.actions['do-preview'](ctx, state);
  return { ctx, state, html: productPage.render(ctx, state) };
}

test('V3.27-三个按钮同排：预演体检 / 取消 / 确认执行导入 顺序相邻', () => {
  const { html } = previewed();
  const iPrev = html.indexOf('data-act="do-preview"');
  const iCancel = html.indexOf('data-act="cancel-preview"');
  const iImport = html.indexOf('data-act="do-import"');
  assert.ok(iPrev >= 0, '存在预演体检按钮');
  assert.ok(iCancel >= 0, '存在取消按钮');
  assert.ok(iImport >= 0, '存在确认执行导入按钮');
  assert.ok(iPrev < iCancel && iCancel < iImport, '三者按 预演体检 → 取消 → 确认执行导入 顺序相邻排列');
});

test('V3.27-三个按钮在同一个 .import-actions 行容器内（未被分隔到报告末尾）', () => {
  const { html } = previewed();
  assert.ok(html.includes('class="row import-actions"'), '操作行使用 import-actions 容器');
  const row = actionRow(html);
  assert.ok(row, '成功取出操作行片段');
  assert.ok(row.includes('data-act="do-preview"'), '预演体检在该行内');
  assert.ok(row.includes('data-act="cancel-preview"'), '取消在该行内');
  assert.ok(row.includes('data-act="do-import"'), '确认执行导入在该行内');
});

test('V3.27-按钮靠右端：确认执行导入排在该行最后', () => {
  const { html } = previewed();
  const row = actionRow(html);
  const last = row.lastIndexOf('data-act="');
  assert.ok(row.indexOf('data-act="do-import"') > row.indexOf('data-act="do-preview"'), '确认执行导入在预演体检之后');
  assert.ok(row.slice(last).startsWith('data-act="do-import"'), '确认执行导入是该行最后一个按钮（最右端）');
});

test('V3.27-确认执行导入只出现一次（报告末尾不再重复渲染）', () => {
  const { html } = previewed();
  const first = html.indexOf('data-act="do-import"');
  const last = html.lastIndexOf('data-act="do-import"');
  assert.strictEqual(first, last, '确认执行导入全局仅渲染一次');
});

test('V3.27-未预演时不显示 取消 / 确认执行导入', () => {
  const ctx = newCtx();
  const state = productPage.init(ctx);
  state.tab = 'csv';
  state.csvText = '品牌,型号,类型\n海尔,BCD-1,冰箱';
  const html = productPage.render(ctx, state);
  assert.ok(html.includes('data-act="do-preview"'), '预演体检按钮始终存在');
  assert.ok(!html.includes('data-act="do-import"'), '未预演时无确认执行导入');
  assert.ok(!html.includes('data-act="cancel-preview"'), '未预演时无取消');
});

test('V3.27-取消按钮使用 btn-danger 红色样式（与系统取消按钮规范一致）', () => {
  const { html } = previewed();
  assert.ok(/class="btn btn-danger" data-act="cancel-preview"/.test(html), '取消按钮为 btn-danger');
});

test('V3.27-操作行含下载模板与 spacer，保证按钮组被推到右侧', () => {
  const { html } = previewed();
  const row = actionRow(html);
  assert.ok(row.includes('data-act="download-template"'), '行内含下载模板');
  assert.ok(row.includes('class="spacer"'), '行内含 spacer 撑开空间');
  assert.ok(row.indexOf('class="spacer"') < row.indexOf('data-act="do-preview"'), 'spacer 在按钮组左侧，按钮组靠右');
});

test('V3.27-报告仍然完整渲染（按钮上移不影响体检报告内容）', () => {
  const { html } = previewed();
  assert.ok(html.includes('导入前体检报告'), '体检报告卡片仍在');
  assert.ok(html.includes('尚未写入系统'), '仍提示尚未写入');
});

test('V3.27-import-actions 样式已定义（可换行且右对齐）', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'base.css'), 'utf8');
  assert.ok(/\.import-actions\s*\{[^}]*flex-wrap:\s*wrap/.test(css), '窄屏可换行，避免按钮挤爆');
  assert.ok(/\.import-actions\s*\{[^}]*justify-content:\s*flex-end/.test(css), '换行后仍靠右端对齐');
});
