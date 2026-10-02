const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { checkIpcContract } = require('../ipc-contract.js');

const ROOT = path.join(__dirname, '..');

test('IPC 契约：preload 每个 invoke/send channel 在 main 都有 handler', () => {
  const r = checkIpcContract(ROOT);
  assert.strictEqual(r.missingHandlers.length, 0, '缺少 handler: ' + r.missingHandlers.join(', '));
});

test('IPC 契约：preload 每个 on 监听 channel 在 main 都有对应的 send', () => {
  const r = checkIpcContract(ROOT);
  assert.strictEqual(r.missingSenders.length, 0, '缺少 sender: ' + r.missingSenders.join(', '));
});

test('IPC 契约：双向均无缺口', () => {
  const r = checkIpcContract(ROOT);
  assert.ok(r.ok);
});

test('IPC 契约：能识别出人为构造的缺漏（回归安全）', () => {
  // 用两个假 source 验证 extractChannels 与校验逻辑本身有效
  const { extractChannels } = require('../ipc-contract.js');
  const pre = "ipcRenderer.invoke('a:one'); ipcRenderer.on('e:two'); ipcRenderer.send('w:three');";
  const main = "ipcMain.handle('a:one'); mainWindow.webContents.send('e:two');";
  const pInvoke = extractChannels(pre, /ipcRenderer\.(?:invoke|send)\('([^']+)'/g);
  const pOn = extractChannels(pre, /ipcRenderer\.on\('([^']+)'/g);
  const mHandle = extractChannels(main, /ipcMain\.(?:handle|on)\('([^']+)'/g);
  const mSend = extractChannels(main, /(?:webContents|win\.webContents)\.send\('([^']+)'/g);
  assert.deepStrictEqual(pInvoke, ['a:one', 'w:three']);
  assert.deepStrictEqual(pOn, ['e:two']);
  assert.deepStrictEqual(mHandle, ['a:one']);
  assert.deepStrictEqual(mSend, ['e:two']);
  // w:three 有 handler? 无 -> missing
  const missing = pInvoke.filter((c) => !mHandle.includes(c));
  assert.deepStrictEqual(missing, ['w:three']);
});

// 用真实 checkIpcContract（读取文件）验证：能识别 sendSync 缺口，也能解析 guardedHandle/guardedOn。
// 夹具只写在本测试自建的 Temp 目录，结束时只删除该目录。
test('IPC 契约：真实 checkIpcContract 识别 sendSync 缺口并解析 guarded* 注册', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p004-ipc-contract-'));
  try {
    fs.writeFileSync(path.join(dir, 'preload.js'), [
      "ipcRenderer.invoke('guarded:chan');",
      "ipcRenderer.sendSync('sync:chan');",
      "ipcRenderer.sendSync('missing:sync');",
      "ipcRenderer.on('evt:chan', () => {});"
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'main.js'), [
      "guardedHandle('guarded:chan', () => {});",
      "guardedOn('sync:chan', () => {});",
      "mainWindow.webContents.send('evt:chan');"
    ].join('\n'));

    const r = checkIpcContract(dir);
    assert.deepStrictEqual(r.preloadInvokeSend, ['guarded:chan', 'missing:sync', 'sync:chan']);
    assert.ok(r.mainHandlers.includes('guarded:chan'), 'guardedHandle 注册应被解析');
    assert.ok(r.mainHandlers.includes('sync:chan'), 'guardedOn 注册应被解析');
    assert.deepStrictEqual(r.missingHandlers, ['missing:sync']); // sendSync 缺口被检出
    assert.deepStrictEqual(r.missingSenders, []);
    assert.strictEqual(r.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
