const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { exportBundle, prepareBundle, commitBundle } = require('../backup-bundle.js');
const { resolveMediaFile } = require('../media-protocol.js');
const { atomicWrite } = require('../data-io.js');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mynotes-full-backup-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'old-pc');
  const target = path.join(base, 'new-pc');
  await fs.mkdir(source);
  await fs.mkdir(target);
  const backup = path.join(base, 'notes.notememo');
  const items = [
    ['note-img', 'images', '旅途照片.png', Buffer.alloc(700000, 42)],
    ['note-bg', 'backgrounds', 'paper.jpg', Buffer.from('wallpaper')],
    ['note-font', 'fonts', 'custom.ttf', Buffer.from('font')],
    ['note-sound', 'sounds', 'alarm.wav', Buffer.from('alarm')]
  ];
  for (const [scheme, dir, name, bytes] of items) {
    await fs.mkdir(path.join(source, dir));
    await fs.writeFile(path.join(source, dir, name), bytes);
  }
  const urls = items.map(([scheme, , name]) => scheme + '://local/' + encodeURIComponent(name));
  const [photo, backgroundImage, font, reminderSoundPath] = urls;
  const data = {
    settings: {
      backgroundImage, reminderSoundPath, customFonts: [{ url: font, family: 'Test' }],
      noteOrder: ['n1'], backupDir: 'D:\\My old backup folder'
    },
    notes: [{ id: 'n1', groupId: 'g1', content: '[[img:photo]]', positionAll: { x: 120, y: 140 },
      images: [{ id: 'photo', src: photo }], files: [{ id: 'attachment', path: 'D:\\My files\\reference.pdf' }],
      reminder: { enabled: true, time: 1893456000000 } }],
    groups: [{ id: 'g1', name: 'Trips' }],
    trash: [{ deletedAt: 1883456000000, note: { id: 'trash-note', images: [{ id: 'photo', src: photo }] } }]
  };
  return { source, target, backup, data, items };
}

test('full backup restores every media type, alternate filenames, trash and workspace state', async (t) => {
  const { source, target, backup, data, items } = await fixture(t);
  await fs.mkdir(path.join(target, 'images'));
  const existingPhoto = path.join(target, 'images', items[0][2]);
  await fs.writeFile(existingPhoto, 'existing photo');
  const storePath = path.join(target, 'notes-data.json');
  const previous = { notes: [{ title: 'Original note' }] };
  await fs.writeFile(storePath, JSON.stringify(previous));

  await exportBundle(backup, source, data);
  const restored = await prepareBundle(backup, target);
  assert.equal(restored.entries.length, 4);
  assert.equal(commitBundle(restored, target, () => atomicWrite(storePath, restored.data)), true);

  assert.equal(await fs.readFile(existingPhoto, 'utf8'), 'existing photo');
  assert.deepEqual(JSON.parse(await fs.readFile(storePath + '.bak', 'utf8')), previous);
  const disk = JSON.parse(await fs.readFile(storePath, 'utf8'));
  assert.deepEqual(disk.groups, data.groups);
  assert.deepEqual(disk.notes[0].positionAll, data.notes[0].positionAll);
  assert.deepEqual(disk.notes[0].reminder, data.notes[0].reminder);
  assert.deepEqual(disk.notes[0].files, data.notes[0].files);
  assert.equal(disk.settings.backupDir, null);
  assert.equal(disk.trash[0].note.images[0].src, disk.notes[0].images[0].src);
  const refs = [disk.notes[0].images[0].src, disk.settings.backgroundImage,
    disk.settings.customFonts[0].url, disk.settings.reminderSoundPath];
  for (const [index, [scheme, , name, bytes]] of items.entries()) {
    const resolved = resolveMediaFile(refs[index], scheme, target);
    assert.ok(resolved);
    assert.notEqual(path.basename(resolved.file), name);
    assert.deepEqual(await fs.readFile(resolved.file), bytes);
  }
});

test('corrupted or truncated full backup leaves original notes and media untouched', async (t) => {
  const { source, target, backup, data } = await fixture(t);
  await fs.writeFile(path.join(target, 'notes-data.json'), 'original data');
  await exportBundle(backup, source, data);
  const complete = await fs.readFile(backup);
  const damaged = Buffer.from(complete);
  damaged[damaged.length - 1] ^= 1;
  await fs.writeFile(backup, damaged);
  await assert.rejects(prepareBundle(backup, target), /media is damaged/);
  await fs.writeFile(backup, complete.subarray(0, -10));
  await assert.rejects(prepareBundle(backup, target), /Invalid backup asset size/);
  assert.deepEqual(await fs.readdir(target), ['notes-data.json']);
  assert.equal(await fs.readFile(path.join(target, 'notes-data.json'), 'utf8'), 'original data');
});

test('failed restore rolls back promoted media and leaves current notes available for retry', async (t) => {
  const { source, target, backup, data } = await fixture(t);
  const storePath = path.join(target, 'notes-data.json');
  await fs.writeFile(storePath, 'current data');
  await fs.mkdir(path.join(target, 'images'));
  await fs.writeFile(path.join(target, 'images', 'keep.png'), 'old image');

  await exportBundle(backup, source, data);
  const failedWrite = await prepareBundle(backup, target);
  assert.equal(commitBundle(failedWrite, target, () => false), false);
  assert.deepEqual(await fs.readdir(path.join(target, 'images')), ['keep.png']);
  assert.equal(await fs.readFile(storePath, 'utf8'), 'current data');
  assert.equal((await fs.readdir(target)).some((name) => name.startsWith('.restore-')), false);

  const retry = await prepareBundle(backup, target);
  assert.equal(commitBundle(retry, target, () => atomicWrite(storePath, retry.data)), true);
});

test('export with missing referenced media preserves an existing destination backup', async (t) => {
  const { source, backup, data } = await fixture(t);
  await fs.writeFile(backup, 'previous backup');
  await fs.unlink(path.join(source, 'sounds', 'alarm.wav'));
  await assert.rejects(exportBundle(backup, source, data), /Missing media: alarm.wav/);
  assert.equal(await fs.readFile(backup, 'utf8'), 'previous backup');
});
