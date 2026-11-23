const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isValidDataShape } = require('./data-io.js');
const { MEDIA_DIRS, SCHEMES, parseMediaName, resolveMediaFile } = require('./media-protocol.js');
const { visitMediaReferences } = require('./renderer/logic.js');

// Version byte, manifest length (uint32 BE), UTF-8 manifest and SHA-256,
// then raw bytes and SHA-256 for each asset in manifest order.
const MAGIC = Buffer.from('NOTEMEMO\x01');
const MAX_MANIFEST = 64 * 1024 * 1024;
const CHUNK = 256 * 1024;
const HASH_BYTES = 32;
const digest = (bytes) => createHash('sha256').update(bytes).digest();
const mediaUrl = (scheme, name) => scheme + '://local/' + encodeURIComponent(name);

function assetUrl(scheme, name) {
  if (!SCHEMES.includes(scheme) || typeof name !== 'string' ||
      /[<>"|?*]/.test(name) || parseMediaName(mediaUrl(scheme, name), scheme) !== name) {
    throw new Error('Invalid media entry');
  }
  return mediaUrl(scheme, name);
}

function checkData(data) {
  if (!isValidDataShape(data) || !Array.isArray(data.notes)) throw new Error('Invalid notes data');
}

function visitAssets(data, visitor) {
  visitMediaReferences(data, (url) => {
    const scheme = url.split(':', 1)[0].toLowerCase();
    if (!SCHEMES.includes(scheme)) return;
    const name = parseMediaName(url, scheme);
    return visitor(assetUrl(scheme, name), scheme, name);
  });
}

async function readExact(file, length) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, null);
    if (!bytesRead) throw new Error('Incomplete backup');
    offset += bytesRead;
  }
  return buffer;
}

async function writeAll(file, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, null);
    if (!bytesWritten) throw new Error('Backup write failed');
    offset += bytesWritten;
  }
}

async function copyAsset(input, output, size) {
  const hash = createHash('sha256');
  for (let remaining = size; remaining > 0;) {
    const chunk = await readExact(input, Math.min(remaining, CHUNK));
    await writeAll(output, chunk);
    hash.update(chunk);
    remaining -= chunk.length;
  }
  return hash.digest();
}

async function exportBundle(destination, userDir, data) {
  checkData(data);
  const root = fs.realpathSync(userDir);
  const sources = new Map();
  visitAssets(data, (url, scheme, name) => {
    if (sources.has(url)) return;
    const resolved = resolveMediaFile(url, scheme, userDir);
    if (!resolved || path.relative(path.join(root, MEDIA_DIRS[scheme]), fs.realpathSync(resolved.dir)) !== '') {
      throw new Error('Missing media: ' + name);
    }
    sources.set(url, { file: resolved.file, scheme, name, size: fs.statSync(resolved.file).size });
  });
  const assets = Array.from(sources.values(), ({ scheme, name, size }) => ({ scheme, name, size }));
  const manifest = Buffer.from(JSON.stringify({ data, assets }));
  if (manifest.length > MAX_MANIFEST) throw new Error('Backup manifest is too large');

  const tempPath = destination + '.' + randomUUID() + '.tmp';
  const output = await fs.promises.open(tempPath, 'wx');
  try {
    try {
      const header = Buffer.alloc(MAGIC.length + 4);
      MAGIC.copy(header);
      header.writeUInt32BE(manifest.length, MAGIC.length);
      for (const buffer of [header, manifest, digest(manifest)]) await writeAll(output, buffer);
      for (const asset of sources.values()) {
        const input = await fs.promises.open(asset.file, 'r');
        try {
          await writeAll(output, await copyAsset(input, output, asset.size));
          if ((await input.stat()).size !== asset.size) throw new Error('Media changed during backup: ' + asset.name);
        } finally {
          await input.close();
        }
      }
      await output.sync();
    } finally {
      await output.close();
    }
    await fs.promises.rename(tempPath, destination);
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function prepareBundle(source, userDir) {
  const input = await fs.promises.open(source, 'r');
  let staging;
  try {
    const header = await readExact(input, MAGIC.length + 4);
    if (!MAGIC.equals(header.subarray(0, MAGIC.length))) throw new Error('Unknown backup format');
    const length = header.readUInt32BE(MAGIC.length);
    const fileSize = (await input.stat()).size;
    if (length > MAX_MANIFEST || length + header.length + HASH_BYTES > fileSize) {
      throw new Error('Invalid backup manifest size');
    }
    const manifest = await readExact(input, length);
    if (!digest(manifest).equals(await readExact(input, HASH_BYTES))) throw new Error('Backup manifest is damaged');
    const { data, assets } = JSON.parse(manifest.toString('utf8'));
    checkData(data);
    if (!Array.isArray(assets)) throw new Error('Invalid backup assets');
    const id = randomUUID();
    const entries = new Map();
    let remaining = fileSize - header.length - length - HASH_BYTES;
    for (const { scheme, name, size } of assets) {
      const url = assetUrl(scheme, name);
      if (entries.has(url) || !Number.isSafeInteger(size) || size < 0 || size > remaining - HASH_BYTES) {
        throw new Error('Invalid backup asset size or duplicate');
      }
      remaining -= size + HASH_BYTES;
      const ext = path.extname(name);
      const targetName = 'restored-' + id + '-' + entries.size + (/^\.[a-z0-9]{1,12}$/i.test(ext) ? ext : '');
      entries.set(url, { scheme, size, targetName, referenced: false });
    }
    if (remaining !== 0) throw new Error('Unexpected backup data');
    visitAssets(data, (url) => {
      const entry = entries.get(url);
      if (!entry) throw new Error('Referenced media is missing from the backup');
      entry.referenced = true;
      return mediaUrl(entry.scheme, entry.targetName);
    });
    if (data.settings) data.settings.backupDir = null;

    staging = await fs.promises.mkdtemp(path.join(userDir, '.restore-'));
    for (const entry of entries.values()) {
      if (!entry.referenced) throw new Error('Unreferenced backup asset');
      const output = await fs.promises.open(path.join(staging, entry.targetName), 'wx');
      try {
        if (!(await copyAsset(input, output, entry.size)).equals(await readExact(input, HASH_BYTES))) {
          throw new Error('Backup media is damaged');
        }
        await output.sync();
      } finally {
        await output.close();
      }
    }
    if ((await input.read(Buffer.alloc(1), 0, 1, null)).bytesRead) throw new Error('Unexpected backup data');
    return { data, staging, entries: Array.from(entries.values()), id };
  } catch (err) {
    if (staging) discardBundle({ staging });
    throw err;
  } finally {
    await input.close();
  }
}

function discardBundle(bundle) {
  try { fs.rmSync(bundle.staging, { recursive: true, force: true }); }
  catch (err) { console.warn('[backup] 临时媒体清理失败：', err.message); }
}

// Promote staged files and atomically write notes in the same main-process turn.
// New filenames keep old media available to both the current data and .bak.
function commitBundle(bundle, userDir, writeNotes) {
  const added = [];
  let saved = false;
  try {
    const root = fs.realpathSync(userDir);
    for (const { scheme, targetName } of bundle.entries) {
      const dir = path.join(root, MEDIA_DIRS[scheme]);
      fs.mkdirSync(dir, { recursive: true });
      if (path.relative(dir, fs.realpathSync(dir)) !== '') throw new Error('Unexpected media folder location');
      const target = path.join(dir, targetName);
      // Reserve the new filename exclusively before promoting the staged file.
      const fd = fs.openSync(target, 'wx');
      added.push(target);
      fs.closeSync(fd);
      fs.renameSync(path.join(bundle.staging, targetName), target);
    }
    saved = writeNotes();
    return saved;
  } finally {
    if (!saved) {
      for (const target of added) {
        try { fs.unlinkSync(target); }
        catch (err) { console.warn('[backup] 恢复媒体回滚失败：', err.message); }
      }
    }
    discardBundle(bundle);
  }
}

module.exports = { exportBundle, prepareBundle, commitBundle, discardBundle };
