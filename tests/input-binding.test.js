/**
 * input-binding.test.js —— 静态检查所有页面输入框都有 value 绑定
 * 防止回归：输入框有 data-live/data-change/data-input 但缺 value 绑定，
 * 导致重渲染后输入内容被清空（登录页密码框、设置页密码框曾出现此 bug）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const UI_DIR = path.join(__dirname, '..', 'js', 'ui');

/** 读取一个文件中所有 <input> 和 <textarea> 的完整标签（跨行拼接） */
function extractInputTags(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const tags = [];
  // 匹配 <input ...> 或 <textarea ...>...</textarea>
  const re = /<(input|textarea)\b[^>]*>(?:[\s\S]*?<\/textarea>)?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    tags.push({ tag: m[1], full: m[0], file: path.basename(filePath) });
  }
  return tags;
}

/** 判断一个输入标签是否有 value 绑定 */
function hasValueBinding(t) {
  // 1. 直接写 value=
  if (/value\s*=/.test(t.full)) return true;
  // 2. 用 val() 函数生成（page-setting.js）
  if (/val\(/.test(t.full)) return true;
  // 3. textarea 的值写在标签外：<textarea ...> + esc(xxx) + </textarea>
  if (t.tag === 'textarea' && /<\/textarea>/.test(t.full)) {
    // 检查闭合标签前是否有非空内容（+ esc(...) + 或 + 'xxx' +）
    const inner = t.full.replace(/^[\s\S]*?>/, '').replace(/<\/textarea>.*$/, '');
    if (inner.trim().length > 0) return true;
  }
  return false;
}

/** 判断是否是需要 value 绑定的输入类型（排除 checkbox/radio/file/hidden/submit/button） */
function needsValueBinding(t) {
  const typeMatch = t.full.match(/type\s*=\s*["']?(\w+)/);
  const type = typeMatch ? typeMatch[1].toLowerCase() : 'text';
  const skipTypes = ['checkbox', 'radio', 'file', 'hidden', 'submit', 'button', 'reset', 'image', 'range', 'color'];
  // 分页跳转输入框是临时输入，用户输入后点击跳转，值会清空，不需要 value 绑定
  if (/pager-jump-input/.test(t.full)) return false;
  return !skipTypes.includes(type);
}

test('所有页面输入框都有 value 绑定（防止重渲染后输入清空）', () => {
  const files = fs.readdirSync(UI_DIR).filter(f => f.endsWith('.js'));
  const failures = [];
  let totalChecked = 0;

  for (const file of files) {
    const filePath = path.join(UI_DIR, file);
    const tags = extractInputTags(filePath);
    for (const t of tags) {
      if (!needsValueBinding(t)) continue;
      totalChecked++;
      if (!hasValueBinding(t)) {
        failures.push(`${t.file}: <${t.tag}> 缺 value 绑定 —— ${t.full.substring(0, 120).replace(/\s+/g, ' ')}`);
      }
    }
  }

  assert.ok(totalChecked > 0, `至少检查到一个输入框（实际 ${totalChecked} 个）`);
  assert.strictEqual(failures.length, 0,
    `发现 ${failures.length} 个输入框缺 value 绑定：\n` + failures.join('\n'));
});

test('设置页打开密码输入框有 value 绑定（回归测试）', () => {
  const src = fs.readFileSync(path.join(UI_DIR, 'page-setting.js'), 'utf8');
  // pwd 输入框
  assert.ok(src.includes('data-name="pwd"') && /data-name="pwd"[^>]*value=/.test(src),
    '设置页 pwd 输入框有 value 绑定');
  // pwd2 输入框
  assert.ok(src.includes('data-name="pwd2"') && /data-name="pwd2"[^>]*value=/.test(src),
    '设置页 pwd2 输入框有 value 绑定');
});

test('登录页密码输入框有 value 绑定（回归测试）', () => {
  const src = fs.readFileSync(path.join(UI_DIR, 'page-login.js'), 'utf8');
  assert.ok(src.includes('data-input="pwd"') && /data-input="pwd"[^>]*value=/.test(src),
    '登录页密码输入框有 value 绑定');
});
