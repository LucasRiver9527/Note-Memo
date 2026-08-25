// IPC 契约校验：确保 renderer 用到的每个 IPC channel 在 main 都有对应实现。
// 双向检查：
//   - preload 里 ipcRenderer.invoke / send 的 channel  → main 必须有 ipcMain.handle / on
//   - preload 里 ipcRenderer.on 监听的 channel       → main 必须有 webContents.send / win.webContents.send 发出
// 该模块可在 main.js 启动时调用（dev 下快速失败），也可被 node:test 单测。
'use strict';

const fs = require('fs');
const path = require('path');

// 从源码中抽取符合 pattern（含一个捕获组=channel 名）的所有字符串去重升序。
function extractChannels(source, pattern) {
  const re = new RegExp(pattern, 'g');
  const out = new Set();
  let m;
  while ((m = re.exec(source)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  return Array.from(out).sort();
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return '';
  }
}

// 校验 main 与 preload 的 IPC 契约，返回 { missingHandlers, missingSenders }。
function checkIpcContract(rootDir) {
  const preloadPath = path.join(rootDir, 'preload.js');
  const mainPath = path.join(rootDir, 'main.js');
  const pre = readFileSafe(preloadPath);
  const main = readFileSafe(mainPath);

  const preInvokeSend = extractChannels(pre, /ipcRenderer\.(?:invoke|send)\('([^']+)'/g);
  const preOn = extractChannels(pre, /ipcRenderer\.on\('([^']+)'/g);
  const mainHandleOn = extractChannels(main, /ipcMain\.(?:handle|on)\('([^']+)'/g);
  const mainSend = extractChannels(main, /(?:webContents|win\.webContents|mainWindow\.webContents)\.send\('([^']+)'/g);

  const missingHandlers = preInvokeSend.filter((c) => !mainHandleOn.includes(c));
  const missingSenders = preOn.filter((c) => !mainSend.includes(c));

  return {
    preloadInvokeSend: preInvokeSend,
    preloadOn: preOn,
    mainHandlers: mainHandleOn,
    mainSenders: mainSend,
    missingHandlers,
    missingSenders,
    ok: missingHandlers.length === 0 && missingSenders.length === 0
  };
}

module.exports = { checkIpcContract, extractChannels };
