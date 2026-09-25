// 数据文件读写：原子写入 + 损坏回退。
// 纯函数模块，不依赖 electron，fs 可注入以便单元测试。
//
// 设计要点：
//   1. 原子写入用 tmp + renameSync。实测 Windows + Node v24 下 renameSync 可直接覆盖
//      已存在文件，因此「不要」先 unlink 再 rename —— 那会在两步之间制造非原子窗口，
//      正好重新引入断电丢数据的 bug。
//   2. 生成 .bak 前先校验旧文件能否解析。否则在「主文件损坏、.bak 完好」的恢复场景里，
//      会把损坏内容覆盖到唯一的好备份上，导致二次损坏时无从恢复。
//      损坏的旧文件由 safeRead 另存为 *.corrupt-<ts>.json 留证，不会丢失。
//   3. safeRead 必须区分「首次运行(ENOENT)」与「文件损坏」。两者都返回 data=null，
//      但语义相反：前者允许正常写入，后者必须锁定写入以防覆盖用户数据。
//   4. 读取前先剥 BOM。Windows 用户用记事本 / PowerShell 存过一次数据文件就会带上
//      U+FEFF，JSON.parse 会直接抛错，不剥就会被误判为「损坏」。
'use strict';

const nodeFs = require('fs');
const nodePath = require('path');

// 损坏文件留证最多保留份数，避免无限堆积
const MAX_CORRUPT_COPIES = 3;

function fsOf(fsx) {
  return fsx || nodeFs;
}

function pathOf(p) {
  return p || nodePath;
}

// 去掉 UTF-8 BOM；raw 非字符串时原样返回
function stripBom(raw) {
  return typeof raw === 'string' ? raw.replace(/^\uFEFF/, '') : raw;
}

// 能否安全解析成 JSON。空文件 / 纯空白视为不可解析（多半是被截断的写入）。
function parsesAsJson(raw) {
  const s = stripBom(raw);
  if (typeof s !== 'string' || s.trim() === '') return false;
  try {
    JSON.parse(s);
    return true;
  } catch (e) {
    return false;
  }
}

// 最小结构校验。
// 注意：这不是防数据丢失的主要手段 —— 「加载失败后写回空 notes:[]」里 notes 是合法
// 数组，形状校验拦不住，那要靠 main.js 的 _dataStatus（isDataLocked 拒绝写入）
// 与渲染层 renderDataAlert/enterDataReadonly 只读闸门。
// 这里只挡明显非法的入参（null、非对象、字段类型错），属纵深防御。
function isValidDataShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if ('notes' in data && !Array.isArray(data.notes)) return false;
  if ('groups' in data && !Array.isArray(data.groups)) return false;
  if ('trash' in data && !Array.isArray(data.trash)) return false;
  if ('settings' in data && data.settings !== null && typeof data.settings !== 'object') return false;
  return true;
}

// 损坏留证文件名：notes-data.corrupt-20260921-094300-123.json
// 时间戳部分可字典序排序，便于按新旧裁剪，不依赖 mtime。
function corruptCopyName(filePath, pathx) {
  const p = pathOf(pathx);
  const dir = p.dirname(filePath);
  const base = p.basename(filePath, '.json') || p.basename(filePath);
  const now = new Date();
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const ts =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) +
    '-' +
    pad(now.getMilliseconds(), 3);
  return p.join(dir, base + '.corrupt-' + ts + '.json');
}

// 只保留最近 MAX_CORRUPT_COPIES 份留证，删掉更旧的。裁剪失败不影响主流程。
function pruneCorruptCopies(filePath, fsx, pathx) {
  const fs = fsOf(fsx);
  const p = pathOf(pathx);
  try {
    const dir = p.dirname(filePath);
    const base = p.basename(filePath, '.json') || p.basename(filePath);
    const prefix = base + '.corrupt-';
    const names = fs.readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.json'));
    if (names.length <= MAX_CORRUPT_COPIES) return;
    names.sort().reverse(); // 时间戳可字典序排序，新的在前
    names.slice(MAX_CORRUPT_COPIES).forEach((n) => {
      try {
        fs.unlinkSync(p.join(dir, n));
      } catch (e) {
        /* 单份删除失败忽略，下次再裁 */
      }
    });
  } catch (e) {
    /* 目录不可读则跳过裁剪 */
  }
}

// 把当前（损坏的）主文件另存留证，然后裁剪。
function preserveCorruptFile(filePath, fsx, pathx) {
  const fs = fsOf(fsx);
  const p = pathOf(pathx);
  let corruptPath = null;
  try {
    corruptPath = corruptCopyName(filePath, p);
    fs.copyFileSync(filePath, corruptPath);
  } catch (e) {
    console.error('[data-io] 损坏文件留证失败：', e.message);
    corruptPath = null;
  }
  pruneCorruptCopies(filePath, fs, p);
  return corruptPath;
}

// 读取数据文件。
// 返回 { data, status, corruptPath }，status ∈ 'ok' | 'first-run' | 'recovered' | 'corrupt'
//   ok         正常解析
//   first-run  文件不存在（ENOENT），data=null，允许正常写入
//   recovered  主文件损坏但 .bak 可用，data 为 .bak 内容，损坏件已留证
//   corrupt    主文件损坏且 .bak 不可用，data=null，调用方必须锁定写入
function safeRead(filePath, fsx, pathx) {
  const fs = fsOf(fsx);
  const p = pathOf(pathx);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { data: null, status: 'first-run', corruptPath: null };
    // 权限错误等非 ENOENT：不能当成首次运行，否则会清空用户数据
    console.error('[data-io] 读取数据文件失败：', e.message);
    return { data: null, status: 'corrupt', corruptPath: null };
  }

  if (parsesAsJson(raw)) {
    try {
      return { data: JSON.parse(stripBom(raw)), status: 'ok', corruptPath: null };
    } catch (e) {
      /* 理论上 parsesAsJson 已保证可解析，兜底走损坏分支 */
    }
  }

  // 主文件损坏：先留证，再尝试 .bak
  console.error('[data-io] 数据文件损坏，无法解析');
  const corruptPath = preserveCorruptFile(filePath, fs, p);
  const bakPath = filePath + '.bak';
  try {
    const bakRaw = fs.readFileSync(bakPath, 'utf-8');
    if (parsesAsJson(bakRaw)) {
      const bakData = JSON.parse(stripBom(bakRaw));
      console.warn('[data-io] 已从 .bak 自动恢复');
      return { data: bakData, status: 'recovered', corruptPath };
    }
    console.error('[data-io] .bak 同样无法解析，保留原样以备人工恢复');
  } catch (e) {
    if (!e || e.code !== 'ENOENT') console.error('[data-io] 读取 .bak 失败：', e.message);
  }
  return { data: null, status: 'corrupt', corruptPath };
}

// 原子写入。成功返回 true，失败返回 false（不抛异常，避免调用方漏接）。
// 步骤：写 tmp → 旧文件校验通过才复制为 .bak → rename 覆盖 → 失败清理 tmp。
function atomicWrite(filePath, data, fsx, pathx) {
  const fs = fsOf(fsx);
  const p = pathOf(pathx);
  let json;
  try {
    json = JSON.stringify(data, null, 2);
  } catch (e) {
    console.error('[data-io] 数据无法序列化，已拒绝写入：', e.message);
    return false;
  }

  // 随机后缀避免并发写冲突（窗口状态防抖 300ms 可能与 data:save 重叠）
  const tmp = filePath + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 10) + '.tmp';
  try {
    fs.writeFileSync(tmp, json, 'utf-8');

    // 旧文件能解析才备份，避免把损坏内容覆盖到唯一的好备份上
    let shouldBackup = false;
    try {
      shouldBackup = parsesAsJson(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      shouldBackup = false; // ENOENT（首次运行）或不可读，都无需备份
    }
    if (shouldBackup) {
      try {
        fs.copyFileSync(filePath, filePath + '.bak');
      } catch (e) {
        // 备份失败不阻断写入：主文件写成功比留旧备份更重要
        console.error('[data-io] 生成 .bak 失败（继续写入）：', e.message);
      }
    }

    // Windows + Node 支持直接覆盖已存在目标，无需 unlink
    fs.renameSync(tmp, filePath);
    return true;
  } catch (e) {
    console.error('[data-io] 原子写入失败，原文件未受影响：', e.message);
    try {
      fs.unlinkSync(tmp);
    } catch (e2) {
      /* tmp 可能未创建成功，忽略 */
    }
    return false;
  }
}

module.exports = {
  atomicWrite,
  safeRead,
  isValidDataShape,
  parsesAsJson,
  stripBom,
  pruneCorruptCopies,
  corruptCopyName,
  MAX_CORRUPT_COPIES
};
