/**
 * tests/render-scroll.test.js —— V3.48 同路由重渲染保持滚动位置
 * 解决销售开单/进货单等页面内点击加入按钮后整页重渲染跳回顶部的问题。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = path.join(__dirname, '..', 'js', 'app.js');
const src = fs.readFileSync(APP_JS, 'utf8');

function renderFn() {
  const m = src.match(/function render\(\) \{[\s\S]*?\n  \}/);
  assert.ok(m, '找到 app.js 的 render() 函数');
  return m[0];
}

test('render() 记录 lastRoute 并检测路由变化', () => {
  const fn = renderFn();
  assert.ok(fn.includes('var routeName = router().currentName'), 'render 读取当前路由名');
  assert.ok(fn.includes('var routeChanged = lastRoute !== routeName'), 'render 计算 routeChanged');
  assert.ok(fn.includes('lastRoute = routeName'), 'render 更新 lastRoute');
});

test('render() 同路由重渲染前保存滚动位置', () => {
  const fn = renderFn();
  assert.ok(fn.includes('savedScroll.x = win.scrollX'), '保存水平滚动位置');
  assert.ok(fn.includes('savedScroll.y = win.scrollY'), '保存垂直滚动位置');
  assert.ok(fn.includes('!routeChanged'), '仅在路由未变化时保存滚动位置');
});

test('render() 路由变化时回到顶部，同路由时恢复滚动位置', () => {
  const fn = renderFn();
  assert.ok(fn.includes('if (routeChanged) {') && fn.includes('win.scrollTo(0, 0)'),
    '路由变化时 scrollTo(0,0)');
  assert.ok(fn.includes('win.scrollTo(savedScroll.x, savedScroll.y)'),
    '同路由时恢复保存的滚动位置');
});

test('app 暴露 lastRoute / _savedScroll 以便运行时观测', () => {
  assert.ok(src.includes('app.lastRoute = function () { return lastRoute; }'), '暴露 app.lastRoute');
  assert.ok(src.includes('app._savedScroll = function () { return { x: savedScroll.x, y: savedScroll.y }; }'),
    '暴露 app._savedScroll');
});

test('V3.49 render() 同路由重渲染前记录各 .table-wrap 横向滚动位置', () => {
  const fn = renderFn();
  assert.ok(fn.includes('var savedHScroll = []') || src.includes('var savedHScroll = []'), '存在 savedHScroll 变量');
  assert.ok(fn.includes('querySelectorAll(\'.table-wrap\')'), 'render 查询 .table-wrap 容器');
  assert.ok(fn.includes('savedHScroll.push(wrapsBefore[wi].scrollLeft'), '记录每个 .table-wrap 的 scrollLeft');
  assert.ok(fn.includes('if (win && !routeChanged)'), '仅在同路由（非路由切换）时记录横向滚动');
});

test('V3.49 render() 同路由重渲染后恢复 .table-wrap 的 scrollLeft', () => {
  const fn = renderFn();
  assert.ok(fn.includes('var wrapsAfter = app.main.querySelectorAll(\'.table-wrap\')'), 'render 查询重渲染后的 .table-wrap');
  assert.ok(fn.includes('wrapsAfter[wj].scrollLeft = savedHScroll[wj]'), '将保存的 scrollLeft 写回容器');
  assert.ok(fn.includes('var n = Math.min(wrapsAfter.length, savedHScroll.length)'), '按最小数量对齐，避免越界/错位');
  // 仅同路由时恢复：恢复逻辑位于 else 分支（routeChanged 为 false 时）
  assert.ok(/else\s*\{\s*win\.scrollTo\(savedScroll\.x, savedScroll\.y\)/.test(fn), '恢复逻辑位于同路由分支');
});

test('app 暴露 _savedHScroll 以便运行时观测', () => {
  assert.ok(src.includes('app._savedHScroll = function () { return savedHScroll.slice(); }'), '暴露 app._savedHScroll');
});
