#!/usr/bin/env node
'use strict';
/**
 * 离线旧版更新检测验证（独立脚本，不进测试套件）。
 *
 *   node scripts/release-old-update-check.js <旧版拷贝 exe 绝对路径> <新版构建目录绝对路径> <拷贝根目录绝对路径>
 *
 * 目的：在正式发布前，用「当前已安装 1.2.5 的一份拷贝」离线验证它能否 detect 并下载
 * 已构建好的 1.2.6（latest 通道）。全程只动脚本自己创建的临时 userData，且：
 *   - 旧版 exe 必须严格位于显式指定的拷贝根目录内，并额外拒绝落在本机已注册安装目录下的 exe，
 *     因此日常安装目录即使被误当作拷贝也会被挡下；
 * 绝不：
 *   - 触碰、启动或修改日常安装目录；
 *   - 运行下载到的安装包，或调用 update:install / quitAndInstall；
 *   - 走正常关闭/退出（一律 taskkill 强杀本次启动的拷贝进程树）。
 *
 * 安装动作始终未经验证：脚本只证明「能检测到 1.2.6」以及（在可确认关闭 autoInstallOnAppQuit
 * 的前提下）「能下载安装包字节」。输出会显式声明 install 未验证。
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('@playwright/test');

// 硬超时：整个流程不得超过该值。ponytail: 固定 180s；离线下载 82MB 若明显更慢再上调。
const TIMEOUT_MS = 180_000;
// 强杀后确认进程消失的最长等待；以及看门狗强杀阶段的总硬顶，确保退出是确定性的。
const KILL_VERIFY_TIMEOUT_MS = 5_000;
const HARD_KILL_CEILING_MS = 15_000;

// 强制参数：旧版 exe 必须严格位于该拷贝根目录内（也支持环境变量 MYNOTES_OLD_COPY_ROOT）。
const COPY_ROOT = process.argv[4] || process.env.MYNOTES_OLD_COPY_ROOT || '';

const OLD_EXE = process.argv[2];
const NEW_DIR = process.argv[3];

// 本应用 appId，以及 electron-builder NSIS 生成卸载表键名所用的固定命名空间：
// 据此推出注册表键，读取本机已注册安装目录（best-effort 第二道防线）。
const APP_ID = 'com.mynotes.app';
const ELECTRON_BUILDER_NS_UUID = '50e065bc-3134-11e6-9bab-38c9862bdaf3';

/** 已启动的 Electron 句柄，供 finally / 超时兜底强杀进程树。 */
const apps = [];

function validateArgs() {
  const usage = '用法: node scripts/release-old-update-check.js <旧版拷贝 exe 绝对路径> <新版构建目录绝对路径> <拷贝根目录绝对路径>（拷贝根目录也可用环境变量 MYNOTES_OLD_COPY_ROOT 提供）';
  if (!OLD_EXE || !NEW_DIR) return `${usage}（前两个参数都必填）`;
  if (!COPY_ROOT) return `${usage}（缺少拷贝根目录）`;
  if (process.platform !== 'win32') return 'release-old-update-check 仅支持在 Windows 上运行';
  if (!path.isAbsolute(OLD_EXE)) return `旧版 exe 必须是绝对路径：${OLD_EXE}`;
  if (!path.isAbsolute(NEW_DIR)) return `新版构建目录必须是绝对路径：${NEW_DIR}`;
  if (!path.isAbsolute(COPY_ROOT)) return `拷贝根目录必须是绝对路径：${COPY_ROOT}`;
  let stat;
  try {
    stat = fs.statSync(COPY_ROOT);
  } catch (_) {
    return `拷贝根目录不存在：${COPY_ROOT}`;
  }
  if (!stat.isDirectory()) return `拷贝根目录不是目录：${COPY_ROOT}`;
  if (!isInsideCopyRoot(OLD_EXE)) return `旧版 exe 必须严格位于拷贝根目录内：${OLD_EXE} ⊄ ${COPY_ROOT}`;
  if (isInRegisteredInstall(OLD_EXE)) return `拒绝操作本机已注册安装目录下的 exe：${OLD_EXE}`;
  try {
    stat = fs.statSync(OLD_EXE);
  } catch (_) {
    return `旧版 exe 不存在：${OLD_EXE}`;
  }
  if (!stat.isFile()) return `旧版 exe 不是文件：${OLD_EXE}`;
  try {
    stat = fs.statSync(NEW_DIR);
  } catch (_) {
    return `新版构建目录不存在：${NEW_DIR}`;
  }
  if (!stat.isDirectory()) return `新版构建目录不是目录：${NEW_DIR}`;
  return null;
}

/**
 * 返回 p 的真实路径；p 不存在返回 null（供调用方退回归一化绝对路径）。
 * p 存在但 realpath 失败则抛出，由 isUnder fail closed。
 */
function resolveReal(p) {
  if (!fs.existsSync(p)) return null;
  return fs.realpathSync(p);
}

/**
 * 判断 p 是否严格落在 root 之内（相等不算）。
 * root / p 存在时必须解析到真实路径后再比较，绝不用词法候选放行——否则 COPY_ROOT 内的
 * 符号链接/目录联接指向外部时，词法路径仍会通过。任一方存在却无法解析真实路径即 fail closed。
 */
function isUnder(root, p) {
  const resolvedRoot = path.resolve(root);
  const resolvedP = path.resolve(p);
  let realRoot;
  let realP;
  try {
    realRoot = resolveReal(resolvedRoot);
    realP = resolveReal(resolvedP);
  } catch (_) {
    return false;
  }
  const r = (realRoot || resolvedRoot).toLowerCase();
  const c = (realP || resolvedP).toLowerCase();
  return c.startsWith(r + path.sep);
}

/** 旧版 exe 必须严格位于显式拷贝根目录内，这是强制防线。 */
function isInsideCopyRoot(p) {
  return isUnder(COPY_ROOT, p);
}

/** 由 appId 按 electron-builder NSIS 的 UUID v5 规则推出卸载表键名（与本机注册表一致）。 */
function uuidV5(name, namespace) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(ns).update(name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * best-effort 读取本机已注册安装目录：查当前用户/本机卸载表里本 appId 对应的
 * UninstallString，取路径所在目录。读不到就跳过（强制防线仍是拷贝根目录包含关系）。
 */
function registeredInstallDirs() {
  const key = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${uuidV5(APP_ID, ELECTRON_BUILDER_NS_UUID)}`;
  const dirs = [];
  for (const hive of ['HKCU', 'HKLM']) {
    let out;
    try {
      out = execFileSync('reg', ['query', `${hive}\\${key}`, '/v', 'UninstallString'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5_000,
      });
    } catch (_) {
      continue;
    }
    const m = /UninstallString\s+REG_SZ\s+(.+)/i.exec(out || '');
    if (!m) continue;
    const value = m[1].trim();
    const quoted = /^"([^"]+)"/.exec(value);
    const exe = quoted ? quoted[1] : value.split(/\s+/)[0];
    if (!exe) continue;
    const dir = path.dirname(exe);
    if (dir && dir !== '.') dirs.push(dir);
  }
  return dirs;
}

/** 旧版 exe 是否落在本机已注册安装目录下（拒绝，避免误用日常安装）。 */
function isInRegisteredInstall(p) {
  return registeredInstallDirs().some((d) => isUnder(d, p));
}

/** 用 @electron/asar 读取旧拷贝 resources/app.asar 内 package.json 的版本。 */
function readOldAsarVersion(exePath) {
  let asar;
  try {
    asar = require('@electron/asar');
  } catch (_) {
    return { available: false, error: '@electron/asar 不可用' };
  }
  const asarPath = path.join(path.dirname(exePath), 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) return { available: true, error: `未找到 ${asarPath}` };
  try {
    const pkg = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
    return { available: true, version: pkg.version, asarPath };
  } catch (err) {
    return { available: true, error: `读取 app.asar 失败：${(err && err.message) || err}` };
  }
}

function ymlValue(yml, key) {
  const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(yml);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

/** 解析新版构建目录的 latest.yml，定位安装包与 blockmap。 */
function loadNewBuild(dir) {
  const ymlPath = path.join(dir, 'latest.yml');
  if (!fs.existsSync(ymlPath)) throw new Error(`缺少 latest.yml：${ymlPath}`);
  const yml = fs.readFileSync(ymlPath, 'utf8');
  const version = ymlValue(yml, 'version');
  const rel = ymlValue(yml, 'path') || (yml.match(/^\s*-\s*url:\s*(.+)$/m) || [])[1] || '';
  const installerName = path.basename(String(rel).trim().replace(/^['"]|['"]$/g, ''));
  if (!installerName) throw new Error('latest.yml 未声明安装包文件名');
  const installerPath = path.join(dir, installerName);
  const blockmapPath = installerPath + '.blockmap';
  if (!fs.existsSync(installerPath)) throw new Error(`缺少安装包：${installerPath}`);
  if (!fs.existsSync(blockmapPath)) throw new Error(`缺少 blockmap：${blockmapPath}`);
  const size = fs.statSync(installerPath).size;
  return { version, installerName, installerPath, blockmapPath, size };
}

/** 解析 Range 头，返回闭区间 [start,end]；非法返回 null。 */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, s, e] = m;
  if (s === '' && e === '') return null;
  let start;
  let end;
  if (s === '') {
    const len = Number(e);
    if (!Number.isFinite(len) || len <= 0) return null;
    start = Math.max(0, size - len);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === '' ? size - 1 : Number(e);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * 仅监听 127.0.0.1 的静态 feed：latest.yml + 安装包 + blockmap。
 * 支持 GET/HEAD 与 Range，按白名单精确映射路径（天然阻断目录穿越），记录请求与安装包字节数。
 */
function startFeed(dir, installerName) {
  const allow = new Map([
    ['latest.yml', { file: path.join(dir, 'latest.yml'), type: 'text/yaml; charset=utf-8', key: 'latest' }],
    [installerName, { file: path.join(dir, installerName), type: 'application/octet-stream', key: 'installer' }],
    [installerName + '.blockmap', { file: path.join(dir, installerName + '.blockmap'), type: 'application/octet-stream', key: 'blockmap' }],
  ]);
  const requests = [];
  const bytes = { latest: 0, installer: 0, blockmap: 0 };

  const server = http.createServer((req, res) => {
    const method = req.method || 'GET';
    const record = (status) => requests.push({ method, url: req.url, range: req.headers.range || null, status });

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('method not allowed');
      record(405);
      return;
    }
    let name;
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      name = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    } catch (_) {
      res.writeHead(400).end();
      record(400);
      return;
    }
    // 白名单之外（含 `..`、反斜杠、空字节）一律 404，避免目录穿越。
    const entry = allow.get(name);
    if (!entry || name.includes('\\') || name.includes('..') || name.includes('\0') || !fs.existsSync(entry.file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      record(404);
      return;
    }

    const size = fs.statSync(entry.file).size;
    const baseHeaders = { 'Content-Type': entry.type, 'Accept-Ranges': 'bytes' };
    const rangeHeader = req.headers.range;
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (rangeHeader) {
      const r = parseRange(rangeHeader, size);
      if (!r) {
        res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${size}` });
        res.end();
        record(416);
        return;
      }
      start = r.start;
      end = r.end;
      status = 206;
    }

    const headers = { ...baseHeaders, 'Content-Length': String(end - start + 1) };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    if (method === 'HEAD') {
      res.end();
      record(status);
      return;
    }

    const stream = fs.createReadStream(entry.file, { start, end });
    stream.on('data', (chunk) => { bytes[entry.key] += chunk.length; });
    stream.on('error', () => { try { res.destroy(); } catch (_) {} });
    stream.pipe(res);
    res.on('close', () => stream.destroy());
    record(status);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/`,
        requests,
        bytes,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** 轮询确认进程是否仍存活（PID 复用风险由 taskkill /T 的整树击杀降到最低）。 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 强杀该句柄对应的整个测试进程树。
 * 绝不调用 electronApp.close() 或任何 Electron 优雅退出路径——旧版 autoInstallOnAppQuit 可能
 * 为 true，一次普通退出就会运行安装器改写用户系统。仅对 PID 强制 taskkill /T /F。
 * 返回 {pid, ok, retained, error}；只有确认该进程已消失才 ok=true。
 */
async function forceStopOnce(electronApp) {
  const result = { pid: null, ok: false, retained: true, error: null };
  let pid = null;
  try {
    const proc = electronApp.process();
    pid = proc && proc.pid;
  } catch (_) {}
  result.pid = pid || null;
  if (!pid) {
    result.error = '无法取得拷贝进程 pid';
    return result;
  }
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 });
  } catch (err) {
    result.error = `taskkill 失败：${(err && err.message) || err}`;
  }
  // taskkill 失败或进程延迟退出都不得误报清理成功：必须确认 PID 已消失。
  const deadline = Date.now() + KILL_VERIFY_TIMEOUT_MS;
  while (isPidAlive(pid) && Date.now() < deadline) {
    await sleep(200);
  }
  if (isPidAlive(pid)) {
    result.retained = true;
    if (!result.error) result.error = 'taskkill 后进程仍存活';
  } else {
    result.ok = true;
    result.retained = false;
  }
  return result;
}

/** 同一句柄的并发强杀共享同一 Promise，避免重复 taskkill 与看门狗/finally 互相误报。 */
function forceStop(electronApp) {
  if (!electronApp) return Promise.resolve({ pid: null, ok: false, retained: false, error: '无句柄' });
  if (!electronApp.__stopPromise) electronApp.__stopPromise = forceStopOnce(electronApp);
  return electronApp.__stopPromise;
}

/** 逐条强杀所有已启动拷贝，记录并报告未清理成功的进程（绝不回落优雅退出）。 */
async function stopAllApps(phase) {
  const results = [];
  for (const a of apps) {
    let r;
    try {
      r = await forceStop(a);
    } catch (err) {
      r = { pid: null, ok: false, retained: true, error: String((err && err.message) || err) };
    }
    results.push(r);
    if (!r.ok) {
      console.error(`[old-update-check] 清理失败（${phase}）：pid=${r.pid || '未知'}${r.retained ? '，进程仍存活' : ''}${r.error ? `（${r.error}）` : ''}`);
    }
  }
  return results;
}

async function launchApp(exePath, userDataDir, feedUrl) {
  const electronApp = await electron.launch({
    executablePath: exePath,
    args: ['--no-sandbox', '--disable-gpu'],
    env: { ...process.env, MYNOTES_USER_DATA: userDataDir, MYNOTES_UPDATE_URL: feedUrl },
  });
  apps.push(electronApp);
  const win = await electronApp.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.addStyleTag({ content: '*{animation:none !important;transition:none !important;}' }).catch(() => {});
  return { electronApp, win };
}

/**
 * 尝试在主进程把 autoUpdater.autoInstallOnAppQuit 设为 false，并读回确认。
 * 只有「改前为 true、改后为 false」才算正验证到应用实例；否则允许跳过下载。
 */
function disableAutoInstallOnQuit(electronApp) {
  return electronApp.evaluate(() => {
    const resolveRequire = () => {
      if (typeof require === 'function') return require;
      if (process.mainModule && typeof process.mainModule.require === 'function') {
        return process.mainModule.require.bind(process.mainModule);
      }
      if (typeof module !== 'undefined' && module && typeof module.require === 'function') {
        return module.require.bind(module);
      }
      return null;
    };
    const req = resolveRequire();
    if (!req) return { ok: false, reason: '主进程无法访问 require' };
    let au;
    try {
      au = req('electron-updater').autoUpdater;
    } catch (e) {
      return { ok: false, reason: `require('electron-updater') 失败：${(e && e.message) || e}` };
    }
    if (!au) return { ok: false, reason: '未取到 autoUpdater 实例' };
    const before = au.autoInstallOnAppQuit;
    au.autoInstallOnAppQuit = false;
    const after = au.autoInstallOnAppQuit;
    return { ok: before === true && after === false, before, after };
  }).catch((e) => ({ ok: false, reason: String((e && e.message) || e) }));
}

/** 读回主进程 autoUpdater.updateInfo.version，用于尽量确认检测到的版本。 */
function readDetectedVersion(electronApp) {
  return electronApp.evaluate(() => {
    const resolveRequire = () => {
      if (typeof require === 'function') return require;
      if (process.mainModule && typeof process.mainModule.require === 'function') {
        return process.mainModule.require.bind(process.mainModule);
      }
      if (typeof module !== 'undefined' && module && typeof module.require === 'function') {
        return module.require.bind(module);
      }
      return null;
    };
    const req = resolveRequire();
    if (!req) return null;
    try {
      const au = req('electron-updater').autoUpdater;
      return (au && au.updateInfo && au.updateInfo.version) || null;
    } catch (_) {
      return null;
    }
  }).catch(() => null);
}

function waitFor(cond, { timeout, interval = 250, message }) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const tick = () => {
      let ok = false;
      try { ok = cond(); } catch (_) {}
      if (ok) return resolve();
      if (Date.now() >= deadline) return reject(new Error(message || '等待超时'));
      setTimeout(tick, interval);
    };
    tick();
  });
}

async function run(feed, newBuild, userDataDir, evidence) {
  const { electronApp, win } = await launchApp(OLD_EXE, userDataDir, feed.url);

  const appVersion = await win.evaluate(() => window.api && window.api.appVersion);
  evidence.runtimeVersion = appVersion;
  if (appVersion !== '1.2.5') {
    throw new Error(`运行时应用版本不符：期望 1.2.5，实际 ${appVersion}`);
  }

  const autoInstall = await disableAutoInstallOnQuit(electronApp);
  evidence.autoInstall = autoInstall;

  const check = await win.evaluate(() => window.api.checkUpdate());
  evidence.check = check;
  if (!check || check.ok !== true) throw new Error(`checkUpdate 失败：${JSON.stringify(check)}`);
  if (check.isUpdateAvailable !== true) throw new Error(`未检测到可用更新：${JSON.stringify(check)}`);

  evidence.detectedVersion = await readDetectedVersion(electronApp);
  if (evidence.detectedVersion && evidence.detectedVersion !== newBuild.version) {
    console.warn(`[old-update-check] 警告：检测到版本 ${evidence.detectedVersion}，latest.yml 为 ${newBuild.version}`);
  }

  if (!autoInstall.ok) {
    evidence.download = { skipped: true, reason: `无法正验证 autoInstallOnAppQuit 已关闭（${autoInstall.reason || `${autoInstall.before}->${autoInstall.after}`}）` };
    return;
  }

  const download = await win.evaluate(() => window.api.downloadUpdate());
  evidence.download = download;
  if (!download || download.ok !== true) throw new Error(`downloadUpdate 失败：${JSON.stringify(download)}`);
  await waitFor(() => feed.bytes.installer > 0, {
    timeout: 90_000,
    message: '下载完成后仍未观察到安装包字节被服务',
  });
}

async function main() {
  const argError = validateArgs();
  if (argError) {
    console.error(`[old-update-check] FAIL: ${argError}`);
    process.exit(2);
  }

  let newBuild;
  try {
    newBuild = loadNewBuild(NEW_DIR);
  } catch (err) {
    console.error(`[old-update-check] FAIL: ${(err && err.message) || err}`);
    process.exit(2);
  }
  if (newBuild.version !== '1.2.6') {
    console.error(`[old-update-check] FAIL: latest.yml 版本不符：期望 1.2.6，实际 ${newBuild.version}`);
    process.exit(2);
  }

  const asar = readOldAsarVersion(OLD_EXE);
  console.log(`[old-update-check] 旧拷贝 app.asar 版本：${asar.available ? (asar.version || asar.error) : `跳过（${asar.error}）`}`);
  if (asar.available && asar.version !== '1.2.5') {
    console.error(`[old-update-check] FAIL: 旧拷贝版本不符：期望 1.2.5，实际 ${asar.version}`);
    process.exit(2);
  }

  const feed = await startFeed(NEW_DIR, newBuild.installerName);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mynotes-old-update-'));
  const evidence = {
    oldExe: OLD_EXE,
    newDir: NEW_DIR,
    latestVersion: newBuild.version,
    installerName: newBuild.installerName,
    installerSize: newBuild.size,
    feedUrl: feed.url,
    userDataDir,
  };
  let passed = false;

  const watchdog = setTimeout(() => {
    console.error(`[old-update-check] FAIL: 超时（${TIMEOUT_MS}ms）`);
    console.error(`  temp userData: ${userDataDir} （已保留以便诊断）`);
    // 先完成强杀尝试（带硬顶）再退出；绝不调用优雅退出。
    Promise.race([stopAllApps('watchdog'), sleep(HARD_KILL_CEILING_MS)])
      .catch(() => {})
      .then(() => process.exit(1));
  }, TIMEOUT_MS);
  if (watchdog.unref) watchdog.unref();

  try {
    await run(feed, newBuild, userDataDir, evidence);
    passed = true;
  } catch (err) {
    evidence.error = (err && err.message) || String(err);
    console.error(`[old-update-check] FAIL: ${evidence.error}`);
  } finally {
    clearTimeout(watchdog);
    // 绝不走正常关闭/退出：仅强杀本次启动的拷贝进程树，再关本地 feed。
    const cleanup = await stopAllApps('finally');
    if (cleanup.some((r) => !r.ok)) passed = false;
    await feed.close().catch(() => {});
  }

  console.log('[old-update-check] 证据');
  console.log(`  旧拷贝 exe      : ${evidence.oldExe}`);
  console.log(`  新版构建目录    : ${evidence.newDir}`);
  console.log(`  latest.yml 版本 : ${evidence.latestVersion}（安装包 ${evidence.installerName}, ${evidence.installerSize} bytes）`);
  console.log(`  运行时版本      : ${evidence.runtimeVersion}`);
  console.log(`  autoInstallOnAppQuit 关闭: ${evidence.autoInstall ? `${evidence.autoInstall.ok} (before=${evidence.autoInstall.before}, after=${evidence.autoInstall.after})` : '未知'}`);
  console.log(`  checkUpdate      : ${JSON.stringify(evidence.check)}`);
  console.log(`  检测到的版本    : ${evidence.detectedVersion || '（无法读取，跳过）'}`);
  console.log(`  downloadUpdate   : ${JSON.stringify(evidence.download)}`);
  console.log(`  服务端被请求数  : ${feed.requests.length}`);
  for (const r of feed.requests) console.log(`    ${r.status} ${r.method} ${r.url}${r.range ? ` [${r.range}]` : ''}`);
  console.log(`  安装包字节服务量: ${feed.bytes.installer}`);
  console.log('[old-update-check] 注意：安装动作未验证（未运行安装包、未调用 update:install/quitAndInstall）。');

  if (passed) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    console.log('[old-update-check] PASS（检测' + (evidence.download && evidence.download.ok === true ? '+下载' : '') + '通过；install 仍未验证）');
    process.exit(0);
  }
  console.error(`[old-update-check] 临时 userData 已保留：${userDataDir}`);
  process.exit(1);
}

main();
