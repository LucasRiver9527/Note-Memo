const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
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
