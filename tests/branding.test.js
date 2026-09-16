const test = require('node:test');
const assert = require('node:assert');
const branding = require('../js/core/branding.js');

test('页面元数据：默认图标与店名', () => {
  assert.strictEqual(branding.defaultLogo(), 'assets/favicon.png');
  // 无自定义时回退默认
  assert.strictEqual(branding.logoHref(null), 'assets/favicon.png');
  assert.strictEqual(branding.logoHref({}), 'assets/favicon.png');
  assert.strictEqual(branding.shopName(null), '我的电器店');
  assert.strictEqual(branding.shopName({ shopName: '   ' }), '我的电器店');
});

test('问题3-logo 可自定义：avatar 优先于默认图标', () => {
  const settings = { avatar: 'data:image/png;base64,AAAA' };
  assert.strictEqual(branding.logoHref(settings), 'data:image/png;base64,AAAA');
});

test('问题3-网页名称可自定义：跟随店名 + 页面名', () => {
  assert.strictEqual(branding.pageTitle({ shopName: '西安家电城' }, '首页'), '西安家电城 · 首页');
  assert.strictEqual(branding.pageTitle({}, '首页'), '我的电器店 · 首页');
});

test('问题3-店名 trim：空白店名回退默认', () => {
  assert.strictEqual(branding.shopName({ shopName: '  我的店  ' }), '我的店');
});
