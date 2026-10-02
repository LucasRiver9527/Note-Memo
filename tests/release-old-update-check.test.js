/* R-01B：release-old-update-check.js 的版本选择与校验回归（纯函数，不启动 Electron、不碰真实 exe）。
   覆盖：两个旧版选择、目标合法/不高于旧版/预发布拒绝、旧 asar 与 latest 不匹配拒绝、路径边界保持。
   require 该脚本时 main() 不执行（require.main !== module），因此导入无副作用、无 exit。 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const mod = require('../scripts/release-old-update-check.js');

const {
  VERSION_RE,
  resolveExpectedOldVersion,
  resolveExpectedNewVersion,
  checkOldAsarVersion,
  checkBuildVersion,
  checkDetectedVersion,
  versionPartsSafe,
  compareVersions,
  verifyDownloadedFile,
  waitFor,
  waitForDownloadedObservation,
  isUnder,
} = mod;

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

test('R-01B 脚本导出纯校验函数', () => {
  assert.strictEqual(typeof resolveExpectedOldVersion, 'function');
  assert.strictEqual(typeof resolveExpectedNewVersion, 'function');
  assert.strictEqual(typeof checkOldAsarVersion, 'function');
  assert.strictEqual(typeof checkBuildVersion, 'function');
  assert.ok(VERSION_RE instanceof RegExp);
});

test('R-01B 旧版选择：默认 1.2.5，接受 1.2.5/1.2.6，拒绝其它与预发布', () => {
  assert.deepStrictEqual(resolveExpectedOldVersion(undefined), { ok: true, version: '1.2.5', source: 'default' });
  assert.deepStrictEqual(resolveExpectedOldVersion(''), { ok: true, version: '1.2.5', source: 'default' });
  assert.deepStrictEqual(resolveExpectedOldVersion('  '), { ok: true, version: '1.2.5', source: 'default' });
  assert.deepStrictEqual(resolveExpectedOldVersion('1.2.5'), { ok: true, version: '1.2.5', source: 'env' });
  assert.deepStrictEqual(resolveExpectedOldVersion('1.2.6'), { ok: true, version: '1.2.6', source: 'env' });
  for (const bad of ['1.2.7', '1.2.4', '1.2.6-preview', 'v1.2.6', 'abc', '1.2']) {
    const r = resolveExpectedOldVersion(bad);
    assert.strictEqual(r.ok, false, `应拒绝旧版值 ${bad}`);
  }
});

test('R-01B 目标版本：env 优先、缺省读 package.json、预发布与非法拒绝', () => {
  // env 覆盖 package.json
  assert.deepStrictEqual(resolveExpectedNewVersion('1.2.7', '1.2.5', '9.9.9'), { ok: true, version: '1.2.7', source: 'env' });
  // 空 env → 回退 package.json
  assert.deepStrictEqual(resolveExpectedNewVersion('', '1.2.6', '1.2.7'), { ok: true, version: '1.2.7', source: 'package.json' });
  // 空 env 且 package.json 读不到 → 明确失败，不伪造
  assert.strictEqual(resolveExpectedNewVersion('', '1.2.5', null).ok, false);
  // 空白 env 视为未设置
  assert.deepStrictEqual(resolveExpectedNewVersion('   ', '1.2.5', '1.2.7'), { ok: true, version: '1.2.7', source: 'package.json' });
  // 预发布后缀拒绝
  for (const bad of ['1.2.7-preview', '1.2.8-beta.1', '1.2.7+build']) {
    const r = resolveExpectedNewVersion(bad, '1.2.5', '1.2.7');
    assert.strictEqual(r.ok, false, `应拒绝预发布/非法目标 ${bad}`);
  }
  // 前导零与超安全整数分量拒绝（合法稳定版本要求）
  for (const bad of ['01.2.7', '1.02.7', '1.2.07', '1.2.99999999999999999999']) {
    const r = resolveExpectedNewVersion(bad, '1.2.5', '1.2.7');
    assert.strictEqual(r.ok, false, `应拒绝非法稳定版本 ${bad}`);
  }
  assert.strictEqual(versionPartsSafe('1.2.7'), true);
  assert.strictEqual(versionPartsSafe('01.2.7'), false);
  assert.strictEqual(versionPartsSafe('1.2.99999999999999999999'), false);
});

test('R-01B 目标必须严格高于旧版（1.2.5 或 1.2.6 → 1.2.7 通过）', () => {
  assert.deepStrictEqual(resolveExpectedNewVersion('1.2.7', '1.2.5', '1.2.7'), { ok: true, version: '1.2.7', source: 'env' });
  assert.deepStrictEqual(resolveExpectedNewVersion('1.2.7', '1.2.6', '1.2.7'), { ok: true, version: '1.2.7', source: 'env' });
  assert.strictEqual(resolveExpectedNewVersion('1.2.5', '1.2.5', '1.2.7').ok, false); // 等于旧版
  assert.strictEqual(resolveExpectedNewVersion('1.2.6', '1.2.6', '1.2.7').ok, false); // 等于旧版
  assert.strictEqual(resolveExpectedNewVersion('1.2.6', '1.2.7', '1.2.7').ok, false); // 低于旧版
  // 高于旧版即通过（脚本只要求「合法稳定版且高于旧版」，不写死必须 1.2.7）
  assert.deepStrictEqual(resolveExpectedNewVersion('1.2.6', '1.2.5', '1.2.7'), { ok: true, version: '1.2.6', source: 'env' });
});

test('R-01B 旧 asar 版本：匹配通过、不匹配拒绝、缺失/损坏一律 fail closed', () => {
  assert.deepStrictEqual(checkOldAsarVersion({ available: true, version: '1.2.6' }, '1.2.6'), { ok: true, message: '旧拷贝 app.asar 版本：1.2.6' });
  const mismatch = checkOldAsarVersion({ available: true, version: '1.2.5' }, '1.2.6');
  assert.strictEqual(mismatch.ok, false);
  assert.match(mismatch.message, /不符/);
  // 缺失/损坏必须拒绝（不得弱化为通过），且说明「无法核对」
  const dep = checkOldAsarVersion({ available: false, error: '@electron/asar 不可用' }, '1.2.5');
  assert.strictEqual(dep.ok, false);
  assert.match(dep.message, /无法核对/);
  const bad = checkOldAsarVersion({ available: true, error: 'bad archive' }, '1.2.5');
  assert.strictEqual(bad.ok, false);
  assert.match(bad.message, /无法核对/);
  assert.strictEqual(checkOldAsarVersion({ available: true, error: '未找到 app.asar' }, '1.2.5').ok, false);
  assert.strictEqual(checkOldAsarVersion({ available: true }, '1.2.5').ok, false); // available 却无 version
  assert.strictEqual(checkOldAsarVersion(null, '1.2.5').ok, false);
  assert.strictEqual(checkOldAsarVersion(undefined, '1.2.5').ok, false);
});

test('R-01B latest.yml 版本：匹配通过、不匹配或读不到一律拒绝（fail closed）', () => {
  assert.deepStrictEqual(checkBuildVersion({ version: '1.2.7' }, '1.2.7'), { ok: true, message: 'latest.yml 版本：1.2.7' });
  assert.strictEqual(checkBuildVersion({ version: '1.2.6' }, '1.2.7').ok, false);
  assert.strictEqual(checkBuildVersion({ version: '' }, '1.2.7').ok, false);   // 读不到 → 拒绝
  assert.strictEqual(checkBuildVersion(null, '1.2.7').ok, false);               // 无对象 → 拒绝
});

test('R-01B 路径边界：isUnder 严格包含（相等/外部/空字节仍正确），不读取真实 exe', () => {
  const root = process.platform === 'win32' ? 'C:\\copyroot' : '/copyroot';
  assert.strictEqual(isUnder(root, path.join(root, 'sub', 'x.exe')), true);
  assert.strictEqual(isUnder(root, root), false);                                  // 相等不算「之内」
  assert.strictEqual(isUnder(root, path.join(root, '..', 'outside.exe')), false);  // 逃逸拒绝
  assert.strictEqual(isUnder(root, 'C:\\Windows\\evil.exe'), false);               // 完全无关路径拒绝
});

test('R-01B 检测版本核对：一致 ok、读不到 unavailable、不一致 mismatch（调用方须 throw）', () => {
  assert.strictEqual(checkDetectedVersion('1.2.7', '1.2.7').kind, 'ok');
  assert.strictEqual(checkDetectedVersion('1.2.6', '1.2.7').kind, 'mismatch');
  assert.strictEqual(checkDetectedVersion('1.2.8', '1.2.7').kind, 'mismatch');
  // 读不到保持原始 null/空 → unavailable（无法核对），绝不伪造匹配
  assert.strictEqual(checkDetectedVersion(null, '1.2.7').kind, 'unavailable');
  assert.strictEqual(checkDetectedVersion('', '1.2.7').kind, 'unavailable');
  assert.strictEqual(checkDetectedVersion(undefined, '1.2.7').kind, 'unavailable');
});

test('R-01B compareVersions 语义（目标高于旧版的判定基础）', () => {
  assert.ok(compareVersions('1.2.7', '1.2.5') > 0);
  assert.ok(compareVersions('1.2.7', '1.2.6') > 0);
  assert.strictEqual(compareVersions('1.2.6', '1.2.6'), 0);
  assert.ok(compareVersions('1.2.5', '1.2.6') < 0);
});

// —— R-01B2：下载文件核对（纯文件系统，使用临时 dummy 文件，绝不用真实 exe/用户数据）——

function withTmpDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mynotes-verify-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}

const sha512b64 = (buf) => crypto.createHash('sha512').update(buf).digest('base64');

test('R-01B2 下载文件核对：缓存内真实文件、大小与两个 SHA512 相符才通过', () => {
  withTmpDir((root) => {
    const cache = path.join(root, 'LocalAppData', 'updater');
    fs.mkdirSync(cache, { recursive: true });
    const buf = Buffer.from('dummy-installer-bytes');
    const file = path.join(cache, 'MyNotes-Setup-1.2.7.exe');
    fs.writeFileSync(file, buf);
    const h = sha512b64(buf);
    const r = verifyDownloadedFile({ file, cacheRoot: path.join(root, 'LocalAppData'), expectedSize: buf.length, expectedSha512: h, ymlSha512: h });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.size, buf.length);
    assert.strictEqual(r.sha512, h);
  });
});

test('R-01B2 下载文件核对：部分/损坏文件被拒绝（大小或哈希不符）', () => {
  withTmpDir((root) => {
    const cache = path.join(root, 'LocalAppData');
    fs.mkdirSync(cache, { recursive: true });
    const full = Buffer.from('the-complete-installer');
    const file = path.join(cache, 'partial.exe');
    fs.writeFileSync(file, full.subarray(0, 5)); // 截断
    const sizeBad = verifyDownloadedFile({ file, cacheRoot: cache, expectedSize: full.length, expectedSha512: sha512b64(full), ymlSha512: sha512b64(full) });
    assert.strictEqual(sizeBad.ok, false);
    assert.match(sizeBad.message, /大小不符/);
    // 大小相同但内容不同（损坏）
    fs.writeFileSync(file, Buffer.alloc(full.length, 0x41));
    const hashBad = verifyDownloadedFile({ file, cacheRoot: cache, expectedSize: full.length, expectedSha512: sha512b64(full), ymlSha512: sha512b64(full) });
    assert.strictEqual(hashBad.ok, false);
    assert.match(hashBad.message, /SHA512/);
  });
});

test('R-01B2 下载文件核对：缓存根之外（含符号链接逃逸）被拒绝', () => {
  withTmpDir((root) => {
    const cache = path.join(root, 'LocalAppData');
    fs.mkdirSync(cache, { recursive: true });
    const outside = path.join(root, 'outside.exe');
    const ob = Buffer.from('outside');
    fs.writeFileSync(outside, ob);
    const r = verifyDownloadedFile({ file: outside, cacheRoot: cache, expectedSize: ob.length, expectedSha512: sha512b64(ob), ymlSha512: sha512b64(ob) });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /不在隔离缓存根内/);
    // 符号链接逃逸（若环境允许创建 symlink；否则跳过该子断言）
    const link = path.join(cache, 'link.exe');
    let made = false;
    try { fs.symlinkSync(outside, link); made = true; } catch (_) {}
    if (made) {
      const rl = verifyDownloadedFile({ file: link, cacheRoot: cache, expectedSize: ob.length, expectedSha512: sha512b64(ob), ymlSha512: sha512b64(ob) });
      assert.strictEqual(rl.ok, false);
      assert.match(rl.message, /不在隔离缓存根内/);
    }
  });
});

test('R-01B2 下载文件核对：缺失/不可用路径与 latest.yml 哈希不符均被拒绝', () => {
  withTmpDir((root) => {
    const cache = path.join(root, 'LocalAppData');
    fs.mkdirSync(cache, { recursive: true });
    const buf = Buffer.from('installer');
    const h = sha512b64(buf);
    assert.strictEqual(verifyDownloadedFile({ file: path.join(cache, 'nope.exe'), cacheRoot: cache, expectedSize: buf.length, expectedSha512: h, ymlSha512: h }).ok, false);
    assert.strictEqual(verifyDownloadedFile({ file: null, cacheRoot: cache, expectedSize: buf.length, expectedSha512: h, ymlSha512: h }).ok, false);
    assert.strictEqual(verifyDownloadedFile({ file: path.join(cache, 'x.exe'), cacheRoot: path.join(root, 'missing-root'), expectedSize: buf.length, expectedSha512: h, ymlSha512: h }).ok, false);
    // latest.yml 声明的哈希不符
    const file = path.join(cache, 'f.exe');
    fs.writeFileSync(file, buf);
    const ymlBad = verifyDownloadedFile({ file, cacheRoot: cache, expectedSize: buf.length, expectedSha512: h, ymlSha512: 'AAAA' });
    assert.strictEqual(ymlBad.ok, false);
    assert.match(ymlBad.message, /latest\.yml/);
  });
});

test('R-01B2 下载文件核对：缺失校验参数一律拒绝（不做可选跳过）', () => {
  withTmpDir((root) => {
    const cache = path.join(root, 'LocalAppData');
    fs.mkdirSync(cache, { recursive: true });
    const buf = Buffer.from('installer');
    const h = sha512b64(buf);
    const file = path.join(cache, 'f.exe');
    fs.writeFileSync(file, buf);
    // 缺 size / 非法 size
    assert.strictEqual(verifyDownloadedFile({ file, cacheRoot: cache, expectedSha512: h, ymlSha512: h }).ok, false);
    assert.strictEqual(verifyDownloadedFile({ file, cacheRoot: cache, expectedSize: -1, expectedSha512: h, ymlSha512: h }).ok, false);
    assert.strictEqual(verifyDownloadedFile({ file, cacheRoot: cache, expectedSize: 0, expectedSha512: h, ymlSha512: h }).ok, false);
    assert.strictEqual(verifyDownloadedFile({ file, cacheRoot: cache, expectedSize: 1.5, expectedSha512: h, ymlSha512: h }).ok, false);
    // 缺候选 SHA512 / 缺 latest.yml SHA512
    assert.strictEqual(verifyDownloadedFile({ file, cacheRoot: cache, expectedSize: buf.length, ymlSha512: h }).ok, false);
    assert.strictEqual(verifyDownloadedFile({ file, cacheRoot: cache, expectedSize: buf.length, expectedSha512: h }).ok, false);
    // 候选 SHA512 与 latest.yml 哈希不一致
    assert.strictEqual(verifyDownloadedFile({ file, cacheRoot: cache, expectedSize: buf.length, expectedSha512: h, ymlSha512: 'AAAA' }).ok, false);
  });
});

test('R-01B2 下载文件核对：文件即缓存根（相等）与根非目录一律拒绝', () => {
  withTmpDir((root) => {
    const cache = path.join(root, 'LocalAppData');
    fs.mkdirSync(cache, { recursive: true });
    const buf = Buffer.from('x');
    const h = sha512b64(buf);
    // file === cacheRoot（严格子路径要求，相等应拒绝）
    const eq = verifyDownloadedFile({ file: cache, cacheRoot: cache, expectedSize: buf.length, expectedSha512: h, ymlSha512: h });
    assert.strictEqual(eq.ok, false);
    // 根不是目录（用普通文件当根）；文件需存在以走到根检查
    const notDir = path.join(root, 'root.txt');
    fs.writeFileSync(notDir, 'not a dir');
    fs.writeFileSync(path.join(cache, 'f.exe'), buf);
    const r = verifyDownloadedFile({ file: path.join(cache, 'f.exe'), cacheRoot: notDir, expectedSize: buf.length, expectedSha512: h, ymlSha512: h });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /不是目录/);
  });
});

// —— R-01B2：异步观测等待（假 electron：先 pending，后 downloaded 必须等待并最终成功）——

function fakeElectron(initial, updateAfterMs, updated) {
  let obs = initial;
  if (updated && Number.isFinite(updateAfterMs)) {
    setTimeout(() => { obs = updated; }, updateAfterMs);
  }
  return {
    evaluate: async () => JSON.parse(JSON.stringify(obs)),
  };
}

test('R-01B2 异步等待：先 pending 后 downloaded 会等待并最终成功（捕捉 Promise 恒真回归）', async () => {
  const t0 = Date.now();
  const fake = fakeElectron({ available: { version: '1.2.7' }, downloaded: null, error: null }, 300,
    { available: { version: '1.2.7' }, downloaded: { version: '1.2.7', downloadedFile: 'C:/cache/x.exe' }, error: null });
  const r = await waitForDownloadedObservation(fake, 3_000, 50);
  assert.strictEqual(r.kind, 'downloaded');
  assert.strictEqual(r.downloaded.version, '1.2.7');
  assert.ok(Date.now() - t0 >= 250, '必须真正等待约 300ms，而不是立即返回');
});

test('R-01B2 异步等待：始终 pending 会超时（不立即假成功）', async () => {
  const fake = fakeElectron({ available: { version: '1.2.7' }, downloaded: null, error: null }, null, null);
  const t0 = Date.now();
  const r = await waitForDownloadedObservation(fake, 250, 50);
  assert.strictEqual(r.kind, 'timeout');
  assert.ok(Date.now() - t0 >= 200, '超时应发生在接近 250ms 时，而非立即返回');
});

test('R-01B2 异步等待：观测到 error 立即失败（不等待，也不假成功）', async () => {
  const fake = fakeElectron({ available: null, downloaded: null, error: { message: 'boom' } }, null, null);
  const r = await waitForDownloadedObservation(fake, 3_000, 50);
  assert.strictEqual(r.kind, 'error');
  assert.strictEqual(r.error.message, 'boom');
});

test('R-01B2 waitFor：异步谓词被真正 await（第 N 次为真才 resolve；谓词抛错 reject）', async () => {
  let n = 0;
  await waitFor(async () => { n++; return n >= 3; }, { timeout: 2_000, interval: 20 });
  assert.strictEqual(n, 3);
  await assert.rejects(
    waitFor(async () => { throw new Error('predicate-boom'); }, { timeout: 1_000, interval: 10 })
  );
  // 同步谓词仍可用
  await waitFor(() => true, { timeout: 1_000, interval: 10 });
});
