#!/usr/bin/env node
'use strict';
/**
 * 离线旧版更新检测验证（独立脚本，不进测试套件）。
 *
 *   node scripts/release-old-update-check.js <旧版拷贝 exe 绝对路径> <新版构建目录绝对路径> <拷贝根目录绝对路径>
 *   node scripts/release-old-update-check.js --github-check <旧版拷贝 exe 绝对路径> <拷贝根目录绝对路径>
 *
 * 目的：在正式版发布前或发布后均可运行，用「当前已安装旧版（1.2.5 或 1.2.6）的一份拷贝」验证它能否 detect 到
 * 目标稳定版（默认取 ../package.json 的 version，当前候选为 1.2.7，latest 通道）。
 * 旧版与目标版本可用环境变量指定：
 *   MYNOTES_EXPECT_OLD_VERSION  旧拷贝应是的版本，默认 1.2.5；只接受 1.2.5 或 1.2.6。
 *   MYNOTES_EXPECT_NEW_VERSION  目标稳定版版本，默认读取 ../package.json 的 version；须为合法无后缀版本且高于旧版。
 * 默认离线模式：起本地 feed，验证 detect +（可确认关闭 autoInstallOnAppQuit 时）下载安装包字节。
 * `--github-check`：不建本地 feed、不注入 MYNOTES_UPDATE_URL，走旧拷贝内置的 GitHub provider 联网
 * 真实检测（只检测，不下载、不安装；目标版本能读到就核对，读不到不阻断）。全程只动脚本自己创建的
 * 临时 userData，且：
 *   - 旧版 exe 必须严格位于显式指定的拷贝根目录内，并额外拒绝落在本机已注册安装目录下的 exe，
 *     因此日常安装目录即使被误当作拷贝也会被挡下；
 * 绝不：
 *   - 触碰、启动或修改日常安装目录；
 *   - 运行下载到的安装包，或调用 update:install / quitAndInstall；
 *   - 走正常关闭/退出（一律 taskkill 强杀本次启动的拷贝进程树）。
 *
 * 安装动作始终未经验证：脚本只证明「能检测到目标稳定版」以及（在可确认关闭 autoInstallOnAppQuit
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

// 运行模式：默认离线本地 feed 模式；`--github-check` 走旧拷贝内置 GitHub provider 真实联网检测。
const LIVE_MODE = process.argv[2] === '--github-check';
const POSITIONAL = process.argv.slice(LIVE_MODE ? 3 : 2);

// 强制参数：旧版 exe 必须严格位于该拷贝根目录内（本地模式也支持环境变量 MYNOTES_OLD_COPY_ROOT）。
const OLD_EXE = POSITIONAL[0];
// 新版构建目录只在离线本地 feed 模式需要；live 模式不读本地构建产物。
const NEW_DIR = LIVE_MODE ? null : POSITIONAL[1];
const COPY_ROOT = (LIVE_MODE ? POSITIONAL[1] : POSITIONAL[2]) || process.env.MYNOTES_OLD_COPY_ROOT || '';

// 本应用 appId，以及 electron-builder NSIS 生成卸载表键名所用的固定命名空间：
// 据此推出注册表键，读取本机已注册安装目录（best-effort 第二道防线）。
const APP_ID = 'com.mynotes.app';
const ELECTRON_BUILDER_NS_UUID = '50e065bc-3134-11e6-9bab-38c9862bdaf3';

// 期望的旧拷贝版本与目标稳定版本，在 main() 开头解析（env 优先；旧默认 1.2.5，目标默认读 package.json）。
let EXPECTED_OLD = '1.2.5';
let EXPECTED_NEW = '';

/** 已启动的 Electron 句柄，供 finally / 超时兜底强杀进程树。 */
const apps = [];

function validateArgs() {
  const usage = LIVE_MODE
    ? '用法: node scripts/release-old-update-check.js --github-check <旧版拷贝 exe 绝对路径> <拷贝根目录绝对路径>'
    : '用法: node scripts/release-old-update-check.js <旧版拷贝 exe 绝对路径> <新版构建目录绝对路径> <拷贝根目录绝对路径>（拷贝根目录也可用环境变量 MYNOTES_OLD_COPY_ROOT 提供）';
  const versionHint = '；旧版版本用 MYNOTES_EXPECT_OLD_VERSION（默认 1.2.5，只接受 1.2.5/1.2.6），目标版本用 MYNOTES_EXPECT_NEW_VERSION（默认读 package.json）指定';
  if (!OLD_EXE) return `${usage}（缺少旧版 exe）${versionHint}`;
  if (!LIVE_MODE && !NEW_DIR) return `${usage}（缺少新版构建目录）${versionHint}`;
  if (!COPY_ROOT) return `${usage}（缺少拷贝根目录）${versionHint}`;
  if (process.platform !== 'win32') return 'release-old-update-check 仅支持在 Windows 上运行';
  if (!path.isAbsolute(OLD_EXE)) return `旧版 exe 必须是绝对路径：${OLD_EXE}`;
  if (!LIVE_MODE && !path.isAbsolute(NEW_DIR)) return `新版构建目录必须是绝对路径：${NEW_DIR}`;
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
  if (!LIVE_MODE) {
    try {
      stat = fs.statSync(NEW_DIR);
    } catch (_) {
      return `新版构建目录不存在：${NEW_DIR}`;
    }
    if (!stat.isDirectory()) return `新版构建目录不是目录：${NEW_DIR}`;
  }
  return null;
}

/** 稳定版本号：`x.y.z` 数字段（无前导零，各段在安全整数内），无预发布/构建后缀。 */
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_WITH_PRE_RE = /^\d+\.\d+\.\d+-/;

/** 版本分量是否在安全整数内（避免 Number 精度丢失导致的错误比较）。 */
function versionPartsSafe(v) {
  return VERSION_RE.test(String(v)) && String(v).split('.').every((p) => Number.isSafeInteger(Number(p)));
}

/** 点分数字比较；两者都应是合法稳定版本。返回 a-b 的符号语义（<0 a 更旧）。 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** 只接受 1.2.5 / 1.2.6 作为旧拷贝版本；默认 1.2.5。 */
function resolveExpectedOldVersion(raw) {
  const v = (raw == null ? '' : String(raw)).trim();
  if (v === '') return { ok: true, version: '1.2.5', source: 'default' };
  if (v === '1.2.5' || v === '1.2.6') return { ok: true, version: v, source: 'env' };
  return { ok: false, error: `MYNOTES_EXPECT_OLD_VERSION 只接受 1.2.5 或 1.2.6，实得：${JSON.stringify(v)}` };
}

/**
 * 目标版本：env 优先，否则读 ../package.json 的 version；须为合法无后缀稳定版且严格高于旧版。
 * 返回 { ok, version, source } 或 { ok:false, error }。
 */
function resolveExpectedNewVersion(raw, oldVersion, pkgVersion) {
  const v = (raw == null ? '' : String(raw)).trim();
  const source = v === '' ? 'package.json' : 'env';
  const resolved = v === '' ? (pkgVersion == null ? '' : String(pkgVersion).trim()) : v;
  if (resolved === '') {
    return { ok: false, error: '无法确定目标版本：MYNOTES_EXPECT_NEW_VERSION 为空且未从 ../package.json 读到 version' };
  }
  if (VERSION_WITH_PRE_RE.test(resolved)) {
    return { ok: false, error: `目标版本不得为预发布版：${resolved}` };
  }
  if (!versionPartsSafe(resolved)) {
    return { ok: false, error: `目标版本不是合法稳定版本（应为 x.y.z 无后缀、无前导零）：${resolved}` };
  }
  if (VERSION_RE.test(String(oldVersion)) && compareVersions(resolved, oldVersion) <= 0) {
    return { ok: false, error: `目标版本必须高于旧版 ${oldVersion}，实得 ${resolved}` };
  }
  return { ok: true, version: resolved, source };
}

/** 试读 ../package.json 的 version；读不到返回 null（不伪造）。 */
function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg && pkg.version ? String(pkg.version) : null;
  } catch (_) {
    return null;
  }
}

/**
 * 校验旧拷贝 app.asar 版本：只有真实读到且与期望旧版精确一致才继续；
 * asar 依赖缺失、文件不存在或读取/格式失败一律 fail closed（明确 ok:false，且说明「无法核对」，绝不写「通过」）。
 * 返回 { ok, message }。
 */
function checkOldAsarVersion(asar, expectedOld) {
  if (!asar || !asar.available) {
    return { ok: false, message: `旧拷贝 app.asar 无法核对（${(asar && asar.error) || '@electron/asar 不可用'}），拒绝继续` };
  }
  if (asar.error) {
    return { ok: false, message: `旧拷贝 app.asar 无法核对（${asar.error}），拒绝继续` };
  }
  if (!asar.version) {
    return { ok: false, message: '旧拷贝 app.asar 未读到 version，拒绝继续' };
  }
  if (asar.version === expectedOld) return { ok: true, message: `旧拷贝 app.asar 版本：${asar.version}` };
  return { ok: false, message: `旧拷贝版本不符：期望 ${expectedOld}，实际 ${asar.version}` };
}

/**
 * 校验新版构建目录 latest.yml 版本：读不到即拒绝（fail closed），读得到必须与目标精确一致。
 * 返回 { ok, message }。
 */
function checkBuildVersion(newBuild, expectedNew) {
  if (!newBuild || !newBuild.version) return { ok: false, message: 'latest.yml 未读到 version，无法核对目标版本' };
  if (newBuild.version === expectedNew) return { ok: true, message: `latest.yml 版本：${newBuild.version}` };
  return { ok: false, message: `latest.yml 版本不符：期望 ${expectedNew}，实际 ${newBuild.version}` };
}

/**
 * 校验运行时「检测到的版本」：读不到（null/空）返回无法核对（不阻断，不伪造）；读到但与目标不一致返回 mismatch（调用方须 throw）。
 * 返回 { kind: 'ok'|'unavailable'|'mismatch', message }。
 */
function checkDetectedVersion(detected, expectedNew) {
  if (detected == null || String(detected).trim() === '') {
    return { kind: 'unavailable', message: `检测到的版本无法读取，无法核对目标 ${expectedNew}` };
  }
  if (String(detected) === String(expectedNew)) {
    return { kind: 'ok', message: `检测到的版本：${detected}` };
  }
  return { kind: 'mismatch', message: `检测到版本 ${detected}，与目标 ${expectedNew} 不符` };
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

/**
 * 解析新版构建目录的 latest.yml，定位安装包与 blockmap。
 * 额外读取 latest.yml 声明的 sha512，并计算安装包真实 SHA512（base64）与字节大小，供下载后逐项核对。
 */
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
  const ymlSha512 = ymlValue(yml, 'sha512');
  const sha512 = crypto.createHash('sha512').update(fs.readFileSync(installerPath)).digest('base64');
  return { version, installerName, installerPath, blockmapPath, size, sha512, ymlSha512 };
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

/**
 * 隔离本次运行的 Electron 缓存根，返回本次临时目录下的独立目录并确保存在。
 * electron-updater 在 Windows 上用「%LOCALAPPDATA%\<updaterCacheDirName>」作下载缓存；若沿用真实
 * %LOCALAPPDATA%，重复运行会命中上次的已下载包，导致不再请求安装包字节而误报 FAIL。这里把
 * LOCALAPPDATA 与 APPDATA 都指向 userDataDir 下的空目录：只写进子进程 env，绝不改 process.env，
 * 也绝不读取、清空或修改用户真实缓存。
 */
function isolateAppDirs(userDataDir) {
  const localAppData = path.join(userDataDir, 'LocalAppData');
  const appData = path.join(userDataDir, 'AppData');
  fs.mkdirSync(localAppData, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  return { localAppData, appData };
}

/**
 * 强杀后短暂仍被占用的文件句柄会让 Windows 上删除本次临时 userData 抛 EPERM/EBUSY；
 * 用有界重试 + 退避吸收这段延迟。只删脚本自己 mkdtemp 出来的目录，绝不碰用户真实缓存。
 * 返回 {removed}：仍失败时 removed=false 并保留路径，调用方须如实报告，不得谎称已删除。
 * ponytail: 最多 5 次、累计退避约 3s；若真实机器上句柄释放更慢再上调。
 */
async function removeTempUserData(userDataDir) {
  const MAX_ATTEMPTS = 5;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return { removed: true };
    } catch (err) {
      lastError = (err && err.message) || String(err);
      if (attempt < MAX_ATTEMPTS) await sleep(300 * attempt);
    }
  }
  return { removed: false, error: lastError };
}

async function launchApp(exePath, userDataDir, feedUrl) {
  // feedUrl 为空即 live 模式：必须清掉可能从父进程继承的 MYNOTES_UPDATE_URL，
  // 否则旧拷贝会被迫走 generic feed 而不是内置 GitHub provider。
  const { localAppData, appData } = isolateAppDirs(userDataDir);
  const env = {
    ...process.env,
    MYNOTES_USER_DATA: userDataDir,
    LOCALAPPDATA: localAppData,
    APPDATA: appData,
  };
  if (feedUrl) env.MYNOTES_UPDATE_URL = feedUrl;
  else delete env.MYNOTES_UPDATE_URL;
  const electronApp = await electron.launch({
    executablePath: exePath,
    args: ['--no-sandbox', '--disable-gpu'],
    env,
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

/**
 * 只读观测 autoUpdater 事件：在显式 window.api.checkUpdate() 之前挂上 update-available / update-downloaded / error，
 * 把探测到的公开信息写入一个仅供本脚本使用的全局槽（unique key），不替换也不直接调用 updater 的 check/download。
 * 必须挂载成功，否则本地证据不成立（返回 ok:false，由调用方 fail）。
 */
function attachUpdaterObserver(electronApp) {
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
    const KEY = '__MYNOTES_OLD_UPDATE_OBS__'; // 测试专用全局槽，仅本脚本读写
    const obs = { available: null, downloaded: null, error: null, attachedAt: Date.now() };
    global[KEY] = obs;
    au.on('update-available', (info) => {
      obs.available = {
        version: (info && info.version) || null,
        at: Date.now(),
      };
    });
    au.on('update-downloaded', (info) => {
      obs.downloaded = {
        version: (info && info.version) || null,
        downloadedFile: (info && info.downloadedFile) || null,
        at: Date.now(),
      };
    });
    au.on('error', (err) => {
      obs.error = { message: (err && err.message) || String(err), at: Date.now() };
    });
    return { ok: true, key: KEY };
  }).catch((e) => ({ ok: false, reason: String((e && e.message) || e) }));
}

/** 读取观测到的 update-available 版本；从未观测到则不合成、返回 null。 */
function readObservedAvailableVersion(electronApp) {
  return electronApp.evaluate(() => {
    const obs = global.__MYNOTES_OLD_UPDATE_OBS__;
    return (obs && obs.available && obs.available.version) || null;
  }).catch(() => null);
}

/** 读取观测快照（available/downloaded/error），供等待与输出。 */
function readUpdaterObservation(electronApp) {
  return electronApp.evaluate(() => {
    const obs = global.__MYNOTES_OLD_UPDATE_OBS__;
    return obs ? JSON.parse(JSON.stringify(obs)) : null;
  }).catch(() => null);
}

/**
 * 「检测到的版本」一律取自观测到的 update-available 事件，绝不把期望版/latest.yml 合成进去。
 * 从未观测到则返回 null（无法核对）。
 */
function readDetectedVersion(electronApp) {
  return readObservedAvailableVersion(electronApp);
}

/**
 * 等待观测到的 update-downloaded（或 updater error / 超时）。
 * 使用真正 await 谓词的截止轮询；绝不把 Promise 当布尔（避免 Promise 恒真造成「立即成功」假象）。
 * 返回 {kind:'downloaded'|'error'|'timeout', ...}。
 */
async function waitForDownloadedObservation(electronApp, timeout, interval = 250) {
  const deadline = Date.now() + timeout;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let obs = null;
    try { obs = await readUpdaterObservation(electronApp); } catch (_) { obs = null; }
    if (obs && obs.error) return { kind: 'error', error: obs.error, obs };
    if (obs && obs.downloaded && obs.downloaded.downloadedFile) {
      return { kind: 'downloaded', downloaded: obs.downloaded, obs };
    }
    if (Date.now() >= deadline) return { kind: 'timeout', obs };
    await sleep(interval);
  }
}

/**
 * 同步/异步通用等待：谓词结果会被 await，返回真值才算满足。
 * 绝不再把返回 Promise 的谓词当作已满足（原缺陷）。超时 reject；谓词抛错即 reject（不吞掉）。
 */
function waitFor(cond, { timeout, interval = 250, message }) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      let ok;
      try {
        ok = await cond();
      } catch (err) {
        return reject(err);
      }
      if (ok) return resolve();
      if (Date.now() >= deadline) return reject(new Error(message || '等待超时'));
      setTimeout(tick, interval);
    };
    tick();
  });
}

/**
 * 校验下载完成的安装包文件：
 * - 路径先用 realpath 解析，必须严格落在本次脚本创建的隔离缓存根内（避免符号链接逃逸；相等不算「之内」），失败即拒绝；
 * - 缓存根必须存在且为目录；
 * - 必须是真实常规文件；
 * - 必须提供正整数 expectedSize，且字节大小与其相等；
 * - 必须提供 expectedSha512（候选安装包）与 ymlSha512（latest.yml 声明）两个显式哈希并都匹配，缺失即拒绝（不做可选跳过）。
 * 纯文件系统检查，绝不执行安装包。返回 { ok, message, size, sha512 } 或 { ok:false, message }。
 */
function verifyDownloadedFile({ file, cacheRoot, expectedSize, expectedSha512, ymlSha512, fsImpl = fs, cryptoImpl = crypto }) {
  if (!file || typeof file !== 'string') return { ok: false, message: '下载文件路径缺失' };
  if (!cacheRoot || typeof cacheRoot !== 'string') return { ok: false, message: '隔离缓存根缺失，拒绝核对' };
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
    return { ok: false, message: `缺少有效的候选安装包大小，拒绝核对：${expectedSize}` };
  }
  if (!expectedSha512 || typeof expectedSha512 !== 'string') {
    return { ok: false, message: '缺少候选安装包 SHA512，拒绝核对' };
  }
  if (!ymlSha512 || typeof ymlSha512 !== 'string') {
    return { ok: false, message: '缺少 latest.yml SHA512，拒绝核对' };
  }
  if (!fsImpl.existsSync(file)) return { ok: false, message: `下载文件不存在：${file}` };
  let rootStat;
  try {
    rootStat = fsImpl.statSync(cacheRoot);
  } catch (err) {
    return { ok: false, message: `隔离缓存根不可读取，拒绝核对：${(err && err.message) || err}` };
  }
  if (!rootStat.isDirectory()) return { ok: false, message: `隔离缓存根不是目录，拒绝核对：${cacheRoot}` };
  let real;
  let realRoot;
  try {
    real = fsImpl.realpathSync(file);
    realRoot = fsImpl.realpathSync(cacheRoot);
  } catch (err) {
    return { ok: false, message: `无法解析真实路径（拒绝）：${(err && err.message) || err}` };
  }
  const rl = realRoot.toLowerCase();
  const r = real.toLowerCase();
  // 严格子路径：相等（文件即缓存根）也算越界拒绝。
  if (!r.startsWith(rl + path.sep)) {
    return { ok: false, message: `下载文件不在隔离缓存根内（拒绝）：${real} ⊄ ${realRoot}` };
  }
  let stat;
  try {
    stat = fsImpl.statSync(real);
  } catch (err) {
    return { ok: false, message: `无法读取下载文件状态：${(err && err.message) || err}` };
  }
  if (!stat.isFile()) return { ok: false, message: `下载路径不是常规文件：${real}` };
  if (stat.size !== expectedSize) {
    return { ok: false, message: `下载文件大小不符：期望 ${expectedSize}，实际 ${stat.size}` };
  }
  let sha512;
  try {
    sha512 = cryptoImpl.createHash('sha512').update(fsImpl.readFileSync(real)).digest('base64');
  } catch (err) {
    return { ok: false, message: `无法计算下载文件 SHA512：${(err && err.message) || err}` };
  }
  if (sha512 !== expectedSha512) {
    return { ok: false, message: `下载文件 SHA512 与候选安装包不符` };
  }
  if (sha512 !== ymlSha512) {
    return { ok: false, message: `下载文件 SHA512 与 latest.yml 声明不符` };
  }
  return { ok: true, message: `下载文件已核对：size=${stat.size}, sha512=${sha512}`, size: stat.size, sha512 };
}

async function run(feed, newBuild, userDataDir, evidence) {
  const { electronApp, win } = await launchApp(OLD_EXE, userDataDir, feed ? feed.url : null);

  const appVersion = await win.evaluate(() => window.api && window.api.appVersion);
  evidence.runtimeVersion = appVersion;
  if (appVersion !== EXPECTED_OLD) {
    throw new Error(`运行时应用版本不符：期望 ${EXPECTED_OLD}，实际 ${appVersion}`);
  }

  const autoInstall = await disableAutoInstallOnQuit(electronApp);
  evidence.autoInstall = autoInstall;
  // live 模式在检测前必须正验证 autoInstallOnAppQuit 已由 true 改为 false；读不回即失败。
  if (LIVE_MODE && !autoInstall.ok) {
    throw new Error(`live 模式无法正验证 autoInstallOnAppQuit 已关闭（${autoInstall.reason || `${autoInstall.before}->${autoInstall.after}`}）`);
  }

  // 必须在显式 checkUpdate() 之前挂上只读观测；挂载失败即本地证据不成立。
  const observed = await attachUpdaterObserver(electronApp);
  evidence.observer = observed;
  if (!observed.ok) {
    throw new Error(`无法挂载更新观测器（本地证据不成立）：${observed.reason || '未知原因'}`);
  }

  const check = await win.evaluate(() => window.api.checkUpdate());
  evidence.check = check;
  if (!check || check.ok !== true) throw new Error(`checkUpdate 失败：${JSON.stringify(check)}`);
  if (check.isUpdateAvailable !== true) throw new Error(`未检测到可用更新：${JSON.stringify(check)}`);

  // 「检测到的版本」只来自观测到的 update-available 事件，绝不合成期望版/latest.yml。
  evidence.detectedVersion = await readDetectedVersion(electronApp);
  const detectedCheck = checkDetectedVersion(evidence.detectedVersion, EXPECTED_NEW);
  evidence.detectedCheck = detectedCheck.kind;
  if (detectedCheck.kind === 'mismatch') {
    throw new Error(`检测版本与目标不符：${detectedCheck.message}`);
  }
  if (detectedCheck.kind === 'unavailable') {
    if (LIVE_MODE) {
      // live 模式：观测未知可区分且不阻断（只检测，不下载）。
      console.warn(`[old-update-check] ${detectedCheck.message}`);
    } else {
      // 本地模式：没有观测到 update-available 就不能作为检测证据 → 明确失败，不合成版本。
      throw new Error(`未观测到 update-available，无法核对检测版本（本地证据不成立）`);
    }
  }

  if (LIVE_MODE) {
    evidence.download = { skipped: true, reason: 'live GitHub 模式不下载、不安装' };
    return;
  }

  if (!autoInstall.ok) {
    evidence.download = { skipped: true, reason: `无法正验证 autoInstallOnAppQuit 已关闭（${autoInstall.reason || `${autoInstall.before}->${autoInstall.after}`}）` };
    return;
  }

  // 请求（start）与实际完成（completion）区分：API 返回只是发起，必须等到观测到的 update-downloaded。
  const download = await win.evaluate(() => window.api.downloadUpdate());
  evidence.download = download; // 这只是「已发起」的证据
  if (!download || download.ok !== true) throw new Error(`downloadUpdate 失败：${JSON.stringify(download)}`);

  const waited = await waitForDownloadedObservation(electronApp, 90_000);
  evidence.downloadedObserved = waited.kind === 'downloaded' ? waited.downloaded : null;
  if (waited.kind === 'error') {
    throw new Error(`updater 报错（下载未完成）：${JSON.stringify(waited.error)}`);
  }
  if (waited.kind !== 'downloaded') {
    throw new Error(`未观测到 update-downloaded（下载未完成）：${waited.kind}`);
  }
  // update-downloaded 的版本必须等于目标版本（不得仅凭合成值判定）。
  const downloadedVersion = waited.downloaded.version;
  if (String(downloadedVersion) !== String(EXPECTED_NEW)) {
    throw new Error(`update-downloaded 版本与目标不符：期望 ${EXPECTED_NEW}，实际 ${downloadedVersion}`);
  }
  // 校验下载到的真实文件：位于隔离缓存内、常规文件、大小与 SHA512 与候选安装包/latest.yml 一致。
  const cacheRoot = path.join(userDataDir, 'LocalAppData');
  if (!newBuild || !Number.isSafeInteger(newBuild.size) || !newBuild.sha512 || !newBuild.ymlSha512) {
    throw new Error('候选安装包缺少 size/SHA512/latest.yml SHA512，无法核对下载文件');
  }
  const fileCheck = verifyDownloadedFile({
    file: waited.downloaded.downloadedFile,
    cacheRoot,
    expectedSize: newBuild.size,
    expectedSha512: newBuild.sha512,
    ymlSha512: newBuild.ymlSha512,
  });
  evidence.fileCheck = fileCheck;
  if (!fileCheck.ok) throw new Error(`下载文件核对失败：${fileCheck.message}`);
  // 仅用于输出：仍保留服务端字节计数（请求侧证据）。
  evidence.streamedBytes = feed.bytes.installer;
}

async function main() {
  const argError = validateArgs();
  if (argError) {
    console.error(`[old-update-check] FAIL: ${argError}`);
    process.exit(2);
  }

  const oldResolved = resolveExpectedOldVersion(process.env.MYNOTES_EXPECT_OLD_VERSION);
  if (!oldResolved.ok) {
    console.error(`[old-update-check] FAIL: ${oldResolved.error}`);
    process.exit(2);
  }
  EXPECTED_OLD = oldResolved.version;

  const newResolved = resolveExpectedNewVersion(process.env.MYNOTES_EXPECT_NEW_VERSION, EXPECTED_OLD, readPackageVersion());
  if (!newResolved.ok) {
    console.error(`[old-update-check] FAIL: ${newResolved.error}`);
    process.exit(2);
  }
  EXPECTED_NEW = newResolved.version;

  let newBuild = null;
  if (!LIVE_MODE) {
    try {
      newBuild = loadNewBuild(NEW_DIR);
    } catch (err) {
      console.error(`[old-update-check] FAIL: ${(err && err.message) || err}`);
      process.exit(2);
    }
    const buildCheck = checkBuildVersion(newBuild, EXPECTED_NEW);
    if (!buildCheck.ok) {
      console.error(`[old-update-check] FAIL: ${buildCheck.message}`);
      process.exit(2);
    }
  }

  const asar = readOldAsarVersion(OLD_EXE);
  const asarCheck = checkOldAsarVersion(asar, EXPECTED_OLD);
  console.log(`[old-update-check] ${asarCheck.message}`);
  if (!asarCheck.ok) {
    console.error(`[old-update-check] FAIL: ${asarCheck.message}`);
    process.exit(2);
  }

  // live 模式不建本地 feed；旧拷贝改用内置 GitHub provider 联网检测。
  const feed = LIVE_MODE ? null : await startFeed(NEW_DIR, newBuild.installerName);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mynotes-old-update-'));
  const evidence = {
    oldExe: OLD_EXE,
    newDir: NEW_DIR,
    latestVersion: newBuild ? newBuild.version : null,
    installerName: newBuild ? newBuild.installerName : null,
    installerSize: newBuild ? newBuild.size : null,
    feedUrl: feed ? feed.url : null,
    userDataDir,
    updaterCacheRoot: path.join(userDataDir, 'LocalAppData'),
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
    // 绝不走正常关闭/退出：仅强杀本次启动的拷贝进程树，再关本地 feed（live 模式无 feed）。
    const cleanup = await stopAllApps('finally');
    if (cleanup.some((r) => !r.ok)) passed = false;
    if (feed) await feed.close().catch(() => {});
  }

  console.log('[old-update-check] 证据');
  console.log(`  旧拷贝 exe      : ${evidence.oldExe}`);
  console.log(`  期望旧版/目标版 : ${EXPECTED_OLD} → ${EXPECTED_NEW}（旧版 ${oldResolved.source}，目标 ${newResolved.source}）`);
  console.log(`  临时 userData   : ${evidence.userDataDir}`);
  console.log(`  隔离缓存根      : ${evidence.updaterCacheRoot}（子进程 LOCALAPPDATA 指向此目录，含 electron-updater 缓存）`);
  if (LIVE_MODE) {
    console.log('  模式            : --github-check（旧拷贝内置 GitHub provider，联网真实检测；无本地 feed）');
  } else {
    console.log(`  新版构建目录    : ${evidence.newDir}`);
    console.log(`  latest.yml 版本 : ${evidence.latestVersion}（安装包 ${evidence.installerName}, ${evidence.installerSize} bytes）`);
  }
  console.log(`  运行时版本      : ${evidence.runtimeVersion}`);
  console.log(`  autoInstallOnAppQuit 关闭: ${evidence.autoInstall ? `${evidence.autoInstall.ok} (before=${evidence.autoInstall.before}, after=${evidence.autoInstall.after})` : '未知'}`);
  console.log(`  checkUpdate      : ${JSON.stringify(evidence.check)}`);
  console.log(`  检测到的版本    : ${evidence.detectedVersion || '（未观测到 update-available，无法核对）'}${evidence.detectedCheck ? ` [${evidence.detectedCheck}]` : ''}`);
  if (evidence.observer) {
    console.log(`  更新观测器      : ${evidence.observer.ok ? '已挂载（只读）' : `挂载失败：${evidence.observer.reason}`}`);
  }
  if (LIVE_MODE) {
    console.log('  下载/安装        : 跳过（live 模式不下载、不安装）');
  } else {
    console.log(`  downloadUpdate   : ${JSON.stringify(evidence.download)}（仅「已发起」，不等于完成）`);
    console.log(`  update-downloaded: ${evidence.downloadedObserved ? `version=${evidence.downloadedObserved.version} file=${evidence.downloadedObserved.downloadedFile}` : '（未观测到）'}`);
    console.log(`  完成核对        : ${evidence.fileCheck ? (evidence.fileCheck.ok ? `OK ${evidence.fileCheck.message}` : `失败 ${evidence.fileCheck.message}`) : '（未进行）'}`);
    console.log(`  服务端被请求数  : ${feed.requests.length}`);
    for (const r of feed.requests) console.log(`    ${r.status} ${r.method} ${r.url}${r.range ? ` [${r.range}]` : ''}`);
    console.log(`  安装包字节服务量: ${feed.bytes.installer}（请求侧流式字节，非完成证据）`);
  }
  console.log('[old-update-check] 注意：安装动作未验证（未运行安装包、未调用 update:install/quitAndInstall）。installed=false');

  if (passed) {
    // 功能验证已通过且无测试进程残留；临时目录清理失败只警告并保留，不改判功能结果，也绝不谎报已删除。
    const tempCleanup = await removeTempUserData(userDataDir);
    if (!tempCleanup.removed) {
      console.warn(`[old-update-check] 警告：功能检查通过，但临时 userData 清理失败（${tempCleanup.error}），已保留：${userDataDir}`);
    }
    if (LIVE_MODE) {
      console.log('[old-update-check] PASS（live GitHub 联网检测通过；install 仍未验证）');
    } else {
      console.log('[old-update-check] PASS（检测' + (evidence.download && evidence.download.ok === true ? '+下载' : '') + '通过；install 仍未验证）');
    }
    process.exit(0);
  }
  console.error(`[old-update-check] 临时 userData 已保留：${userDataDir}`);
  process.exit(1);
}

// 供回归测试直接调用（脚本仍以 `node scripts/...` 独立运行，这里不改变其行为）。
module.exports = {
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
  isInsideCopyRoot,
};

// 仅作为 CLI 直接运行时才执行 main()；被测试 require 时不启动 Electron/不触发参数校验退出。
if (require.main === module) main();
