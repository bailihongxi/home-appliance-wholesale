/**
 * ui-button-style.test.js —— V3.39「加入」「选为原单」按钮统一为橘色（btn-orange）
 * 覆盖：销售开单/进货开单/退换货的加入、选为原单按钮均使用 btn-orange，
 *       不再使用 btn-primary；橘色样式与系统整体风格一致（阴影 + hover）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SALE = fs.readFileSync(path.join(__dirname, '../js/ui/page-sale.js'), 'utf8');
const PURCHASE = fs.readFileSync(path.join(__dirname, '../js/ui/page-purchase.js'), 'utf8');
const EXCHANGE = fs.readFileSync(path.join(__dirname, '../js/ui/page-exchange.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../css/base.css'), 'utf8');

test('销售开单「加入」按钮：btn-orange，不再用 btn-primary', () => {
  assert.ok(SALE.includes('class="btn btn-sm btn-orange" data-act="pick-product"'),
    'pick-product 按钮应为 btn-orange');
  assert.ok(!/btn btn-sm btn-primary" data-act="pick-product"/.test(SALE),
    'pick-product 不应再使用 btn-primary');
});

test('进货开单「加入」按钮：btn-orange，不再用 btn-primary', () => {
  assert.ok(PURCHASE.includes('class="btn btn-sm btn-orange" data-act="add-item"'),
    'add-item 按钮应为 btn-orange');
  assert.ok(!/btn btn-sm btn-primary" data-act="add-item"/.test(PURCHASE),
    'add-item 不应再使用 btn-primary');
});

test('退换货「选为原单」「加入」按钮：btn-orange，不再用 btn-primary', () => {
  assert.ok(EXCHANGE.includes('class="btn btn-sm btn-orange" data-act="select-original"'),
    'select-original 按钮应为 btn-orange');
  assert.ok(EXCHANGE.includes('class="btn btn-sm btn-orange" data-act="repl-add"'),
    'repl-add 按钮应为 btn-orange');
  assert.ok(!/btn btn-sm btn-primary" data-act="(select-original|repl-add)"/.test(EXCHANGE),
    '退换货这两个按钮不应再使用 btn-primary');
});

test('.btn-orange 样式与系统整体风格一致（阴影 + hover + active 三态）', () => {
  assert.ok(/\.btn-orange\s*{[^}]*box-shadow:\s*0 4px 12px rgba\(249,\s*115,\s*22,\s*\.25\)/.test(CSS),
    'btn-orange 应有与 btn-primary 一致的柔和阴影');
  assert.ok(/\.btn-orange:hover\s*{[^}]*background:\s*#ea580c/.test(CSS),
    'btn-orange 应有 hover 加深态');
  assert.ok(/\.btn-orange:active\s*{[^}]*background:\s*#c2410c/.test(CSS),
    'btn-orange 应有 active 按下态');
});

test('.act 单元格按钮规则不覆盖 .btn 类按钮（橘色实底不被链接样式压掉）', () => {
  assert.ok(/table\.tbl \.act a,\s*table\.tbl \.act button:not\(\.btn\)\s*{/.test(CSS),
    '.act 链接式按钮样式应只作用于非 .btn 按钮');
  assert.ok(!/table\.tbl \.act button\s*{(?!:not)/.test(CSS.replace('button:not(.btn)', '')),
    '不允许出现覆盖 .btn 类的旧 .act button 全量规则');
});
