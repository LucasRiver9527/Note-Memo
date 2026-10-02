/* media-protocol.js
   P0-04 phase2b：note-bg / note-img / note-font / note-sound 四个自定义协议的统一、可单测解析。
   纯主进程模块：把渲染层/主进程生成的合法 URL 解析成对应媒体目录内的真实文件；只读，不写盘。
   安全规则（只收紧异常输入，不改动正常生成 URL）：
     - scheme 必须精确匹配；host 必须恰为 local；无 userinfo、无 port；
     - pathname 只允许一段文件名并做「单次」percent 解码；解码后不得含目录分隔符（/ \）、控制字符、
       ':'（ADS/盘符）、点段（. / ..）、结尾点/空格，或 Windows 保留设备名；
     - 解析结果必须位于对应媒体目录内；必须存在且是普通文件（目录/非文件拒绝）；
     - symlink 解析（realpath）后仍须落在媒体目录内，否则拒绝。
   fetch/读取失败统一返回通用 404（正文不含任何本地路径），不产生未处理拒绝。 */
'use strict';

const path = require('path');
const nodeFs = require('fs');
const { pathToFileURL } = require('url');

const MEDIA_DIRS = {
  'note-bg': 'backgrounds',
  'note-img': 'images',
  'note-font': 'fonts',
  'note-sound': 'sounds'
};
const SCHEMES = Object.keys(MEDIA_DIRS);
// Windows 保留设备名（含带扩展名形式）不可作为普通文件读取。
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

// 解析合法 URL 得到单个文件名；任何可疑输入返回 null。
function parseMediaName(rawUrl, scheme) {
  if (typeof rawUrl !== 'string' || rawUrl === '') return null;
  let u;
  try { u = new URL(rawUrl); } catch (e) { return null; }
  if (u.protocol !== scheme + ':') return null;
  if (String(u.hostname).toLowerCase() !== 'local') return null;
  if (u.username || u.password || u.port) return null;
  let raw = u.pathname;
  if (typeof raw !== 'string' || raw.length < 2 || raw[0] !== '/') return null;
  raw = raw.slice(1);
  if (raw === '') return null;
  let name;
  try { name = decodeURIComponent(raw); } catch (e) { return null; }
  if (name === '') return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) return null;
  if (name.indexOf(':') !== -1) return null;
  if (name === '.' || name === '..') return null;
  if (/[ .]$/.test(name)) return null;
  if (WINDOWS_RESERVED.test(name)) return null;
  return name;
}

// 解析到媒体目录内真实文件：返回 { file, dir }；失败（含不存在/目录/越界/symlink 逃逸）返回 null。
function resolveMediaFile(rawUrl, scheme, userDataDir, fsImpl) {
  const dirName = MEDIA_DIRS[scheme];
  if (!dirName) return null;
  const name = parseMediaName(rawUrl, scheme);
  if (!name) return null;
  const fsx = fsImpl || nodeFs;
  const dir = path.join(userDataDir, dirName);
  const file = path.join(dir, name);
  const rel = path.relative(dir, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  let st;
  try { st = fsx.statSync(file); } catch (e) { return null; }
  if (!st.isFile()) return null;
  try {
    const realDir = fsx.realpathSync(dir);
    const realFile = fsx.realpathSync(file);
    const rrel = path.relative(realDir, realFile);
    if (rrel === '' || rrel.startsWith('..') || path.isAbsolute(rrel)) return null;
  } catch (e) { return null; }
  return { file, dir };
}

function notFound() {
  return new Response('Not Found', { status: 404 });
}

// 生成某个 scheme 的 protocol.handle 回调；deps 便于单测注入 { userDataDir, fs, net, toFileURL }。
function createMediaProtocolHandler(scheme, deps) {
  const fsx = (deps && deps.fs) || nodeFs;
  const netx = deps && deps.net;
  const toFileURL = (deps && deps.toFileURL) || pathToFileURL;
  const userDataDir = deps && deps.userDataDir;
  return async function mediaProtocolHandler(request) {
    try {
      const resolved = resolveMediaFile(request && request.url, scheme, userDataDir, fsx);
      if (!resolved) return notFound();
      return await netx.fetch(toFileURL(resolved.file).toString());
    } catch (e) {
      return notFound();
    }
  };
}

module.exports = { MEDIA_DIRS, SCHEMES, parseMediaName, resolveMediaFile, createMediaProtocolHandler };
