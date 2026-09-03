const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));

test('index.html：favicon / apple-touch-icon / manifest 引用完整', () => {
  assert.ok(indexHtml.includes('<link rel="icon" type="image/png" href="assets/icon-192.png">'), 'favicon 指向 icon-192.png');
  assert.ok(indexHtml.includes('<link rel="apple-touch-icon" href="assets/icon-192.png">'), 'apple-touch-icon 指向 icon-192.png');
  assert.ok(indexHtml.includes('<link rel="manifest" href="manifest.webmanifest">'), 'manifest 引用存在');
  assert.ok(indexHtml.includes('<meta name="theme-color" content="#2563eb">'), '主题色存在');
});

test('index.html：链接分享默认图（og:image / twitter:image）指向 icon-512.png', () => {
  assert.ok(indexHtml.includes('<meta property="og:image" content="assets/icon-512.png">'), 'og:image 指向 icon-512.png（链接默认分享图）');
  assert.ok(indexHtml.includes('<meta name="twitter:image" content="assets/icon-512.png">'), 'twitter:image 指向 icon-512.png');
  assert.ok(indexHtml.includes('<meta property="og:title" content="我的电器店 · 进销存记账">'), 'og:title 存在');
  assert.ok(indexHtml.includes('<meta property="og:description"'), 'og:description 存在');
});

test('manifest.webmanifest：桌面/PWA 图标引用 icon-192 与 icon-512 且为方形 PNG', () => {
  const sizes = manifest.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192'), 'manifest 含 192 图标');
  assert.ok(sizes.includes('512x512'), 'manifest 含 512 图标（桌面图标）');
  manifest.icons.forEach(i => {
    assert.ok(fs.existsSync(path.join(ROOT, i.src)), `图标文件存在：${i.src}`);
    assert.strictEqual(i.type, 'image/png');
  });
});
