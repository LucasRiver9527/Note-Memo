// P0-04 phase2b：媒体协议解析/可靠性单测（实际生产模块 media-protocol.js）。
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const MP = require('../media-protocol.js');

function makeUserData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p004-media-'));
  for (const sub of Object.values(MP.MEDIA_DIRS)) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const w = (rel, content) => fs.writeFileSync(path.join(dir, rel), Buffer.from(content));
  w('images/ok.png', 'IMG-OK');
  w('images/a b.png', 'IMG-SPACE');
  w('backgrounds/背景.png', 'BG-CN');
  w('fonts/f.woff', 'FONT');
  w('sounds/s.mp3', 'SOUND');
  fs.mkdirSync(path.join(dir, 'images', 'subdir'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'secret.png'), 'SECRET-OUTSIDE'); // userData 根，不在媒体目录
  return dir;
}

test('parseMediaName：四个 scheme 的合法文件名（含空格/中文/查询后缀/单次解码）', () => {
  for (const scheme of MP.SCHEMES) {
    assert.strictEqual(MP.parseMediaName(scheme + '://local/name.png', scheme), 'name.png');
    assert.strictEqual(MP.parseMediaName(scheme + '://LOCAL/name.png', scheme), 'name.png'); // host 大小写不敏感
    assert.strictEqual(MP.parseMediaName(scheme + '://local/a%20b.png', scheme), 'a b.png');
    assert.strictEqual(MP.parseMediaName(scheme + '://local/' + encodeURIComponent('背景.png'), scheme), '背景.png');
    assert.strictEqual(MP.parseMediaName(scheme + '://local/name.png?v=1#frag', scheme), 'name.png'); // 查询/片段忽略
    // 单次解码：%252f -> %2f（字面量，无分隔符）
    assert.strictEqual(MP.parseMediaName(scheme + '://local/%252f', scheme), '%2f');
  }
});

test('parseMediaName：拒绝错误 scheme/host/凭据/端口/编码与危险文件名', () => {
  const bad = [
    ['note-img://evil/ok.png', 'note-img'],           // 错误 host
    ['note-img://user:pw@local/ok.png', 'note-img'],  // userinfo
    ['note-img://local:8080/ok.png', 'note-img'],     // port
    ['note-bg://local/ok.png', 'note-img'],           // 错误 scheme（note-bg 传给 note-img）
    ['note-img://local/ok.png', 'note-bg'],           // 反向
    ['note-img://local/%zz.png', 'note-img'],         // 非法转义
    ['note-img://local/%2e%2e%2fsecret.png', 'note-img'], // 编码的 ../
    ['note-img://local/..%2f..%2fsecret.png', 'note-img'],
    ['note-img://local/a%2fb.png', 'note-img'],       // 编码 /
    ['note-img://local/a%5cb.png', 'note-img'],       // 编码 \
    ['note-img://local/a/b.png', 'note-img'],         // 嵌套路径
    ['note-img://local/a\\b.png', 'note-img'],        // 反斜杠
    ['note-img://local/..', 'note-img'],              // 点段
    ['note-img://local/.', 'note-img'],
    ['note-img://local/%00.png', 'note-img'],         // NUL/控制字符
    ['note-img://local/ok.png%3afoo', 'note-img'],    // 解码后含 ':'（ADS）
    ['note-img://local/C%3aok.png', 'note-img'],      // 盘符冒号
    ['note-img://local/ok.png.', 'note-img'],         // 结尾点
    ['note-img://local/ok.png%20', 'note-img'],       // 结尾空格
    ['note-img://local/NUL', 'note-img'],             // Windows 保留名
    ['note-img://local/con.png', 'note-img'],         // 保留名+扩展名
    ['note-img://local/', 'note-img'],                // 空名
    ['note-img://local', 'note-img'],                 // 无路径
    ['not a url', 'note-img'],                        // 非 URL
    ['', 'note-img']
  ];
  for (const [u, s] of bad) assert.strictEqual(MP.parseMediaName(u, s), null, u + ' (' + s + ')');
});

test('parseMediaName：URL 规范会先折叠点段，结果仍是单一目录内名字（不可穿越）', () => {
  // WHATWG URL 把 %2e%2e / .. 视为 dot segment 并在解析时折叠，handler 只看到折叠后的单段路径。
  assert.strictEqual(MP.parseMediaName('note-img://local/%2e%2e/secret.png', 'note-img'), 'secret.png');
  assert.strictEqual(MP.parseMediaName('note-img://local/../secret.png', 'note-img'), 'secret.png');
  assert.strictEqual(MP.parseMediaName('note-img://local/..', 'note-img'), null);      // 折叠为空 -> 拒绝
  assert.strictEqual(MP.parseMediaName('note-img://local/%2e%2e', 'note-img'), null);
});

test('resolveMediaFile：命中的文件在对应目录，缺失/目录/越界返回 null', () => {
  const ud = makeUserData();
  try {
    assert.strictEqual(path.basename(MP.resolveMediaFile('note-img://local/a%20b.png', 'note-img', ud).file), 'a b.png');
    assert.strictEqual(path.dirname(MP.resolveMediaFile('note-img://local/ok.png', 'note-img', ud).file), path.join(ud, 'images'));
    assert.strictEqual(path.basename(MP.resolveMediaFile('note-bg://local/' + encodeURIComponent('背景.png'), 'note-bg', ud).file), '背景.png');
    assert.strictEqual(path.basename(MP.resolveMediaFile('note-font://local/f.woff', 'note-font', ud).file), 'f.woff');
    assert.strictEqual(path.basename(MP.resolveMediaFile('note-sound://local/s.mp3', 'note-sound', ud).file), 's.mp3');
    assert.strictEqual(MP.resolveMediaFile('note-img://local/missing.png', 'note-img', ud), null);
    assert.strictEqual(MP.resolveMediaFile('note-img://local/subdir', 'note-img', ud), null); // 目录
    assert.strictEqual(MP.resolveMediaFile('note-img://local/%2e%2e%2fsecret.png', 'note-img', ud), null); // 越界
    assert.strictEqual(MP.resolveMediaFile('note-img://local/ok.png', 'unknown-scheme', ud), null);
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('createMediaProtocolHandler：命中返回真实字节；非法/缺失/失败统一 404 且不泄露路径', async () => {
  const ud = makeUserData();
  try {
    const calls = [];
    const net = { fetch: async (u) => { calls.push(u); return new Response(Buffer.from('BYTES'), { status: 200 }); } };
    const handler = MP.createMediaProtocolHandler('note-img', { userDataDir: ud, net, toFileURL: pathToFileURL });

    const ok = await handler({ url: 'note-img://local/ok.png' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(Buffer.from(await ok.arrayBuffer()).toString(), 'BYTES');
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].startsWith('file://'));

    // 非法 host：不得触达 fs/net，直接 404，正文不含本地路径
    const badHost = await handler({ url: 'note-img://evil/ok.png' });
    assert.strictEqual(badHost.status, 404);
    assert.strictEqual(await badHost.text(), 'Not Found');
    assert.strictEqual(calls.length, 1);

    const missing = await handler({ url: 'note-img://local/missing.png' });
    assert.strictEqual(missing.status, 404);
    const dir = await handler({ url: 'note-img://local/subdir' });
    assert.strictEqual(dir.status, 404);
    const noUrl = await handler({});
    assert.strictEqual(noUrl.status, 404);

    // fetch 抛错 / reject -> 404，无未处理拒绝
    const failing = MP.createMediaProtocolHandler('note-img', { userDataDir: ud, net: { fetch: async () => { throw new Error('boom'); } }, toFileURL: pathToFileURL });
    assert.strictEqual((await failing({ url: 'note-img://local/ok.png' })).status, 404);
    const rejecting = MP.createMediaProtocolHandler('note-img', { userDataDir: ud, net: { fetch: () => Promise.reject(new Error('boom')) }, toFileURL: pathToFileURL });
    assert.strictEqual((await rejecting({ url: 'note-img://local/ok.png' })).status, 404);
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('symlink 指向媒体目录外时拒绝（无创建权限则跳过）', (t) => {
  const ud = makeUserData();
  const outside = path.join(ud, 'secret.png');
  const link = path.join(ud, 'images', 'link.png');
  try {
    try { fs.symlinkSync(outside, link, 'file'); }
    catch (e) { t.skip('symlink 不可用：' + (e && e.code)); return; }
    assert.strictEqual(MP.resolveMediaFile('note-img://local/link.png', 'note-img', ud), null);
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});
