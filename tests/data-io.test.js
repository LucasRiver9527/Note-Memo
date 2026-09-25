const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  atomicWrite,
  safeRead,
  isValidDataShape,
  parsesAsJson,
  stripBom,
  MAX_CORRUPT_COPIES
} = require('../data-io.js');

// 用真实临时目录测试，顺带验证 Windows 下 renameSync 覆盖已存在文件的真实语义
function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-memo-io-'));
  try {
    return fn(path.join(dir, 'notes-data.json'), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD = { settings: { fontSize: 14 }, groups: [], notes: [{ id: 'n1' }], trash: [] };

// ---- isValidDataShape ----

test('isValidDataShape 拒绝 null / 数组 / 非对象', () => {
  assert.strictEqual(isValidDataShape(null), false);
  assert.strictEqual(isValidDataShape(undefined), false);
  assert.strictEqual(isValidDataShape([]), false);
  assert.strictEqual(isValidDataShape('str'), false);
  assert.strictEqual(isValidDataShape(42), false);
});

test('isValidDataShape 接受合法结构与空骨架', () => {
  assert.strictEqual(isValidDataShape(GOOD), true);
  assert.strictEqual(isValidDataShape({}), true);
  assert.strictEqual(isValidDataShape({ settings: null }), true);
});

test('isValidDataShape 拒绝字段类型错误', () => {
  assert.strictEqual(isValidDataShape({ notes: 'nope' }), false);
  assert.strictEqual(isValidDataShape({ notes: null }), false);
  assert.strictEqual(isValidDataShape({ groups: {} }), false);
  assert.strictEqual(isValidDataShape({ trash: 3 }), false);
  assert.strictEqual(isValidDataShape({ settings: 'x' }), false);
});

// ---- BOM 处理 ----

test('stripBom 去掉 U+FEFF，无 BOM 时原样返回', () => {
  assert.strictEqual(stripBom('\uFEFF{"a":1}'), '{"a":1}');
  assert.strictEqual(stripBom('{"a":1}'), '{"a":1}');
});

test('parsesAsJson 接受带 BOM 的 JSON，拒绝空白与非法内容', () => {
  assert.strictEqual(parsesAsJson('\uFEFF{"a":1}'), true);
  assert.strictEqual(parsesAsJson('{"a":1}'), true);
  assert.strictEqual(parsesAsJson(''), false);
  assert.strictEqual(parsesAsJson('   '), false);
  assert.strictEqual(parsesAsJson('{"a":'), false); // 被截断的写入
  assert.strictEqual(parsesAsJson(null), false);
});

test('safeRead 不把带 BOM 的文件误判为损坏', () => {
  withTmp((file) => {
    fs.writeFileSync(file, '\uFEFF' + JSON.stringify(GOOD), 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'ok');
    assert.deepStrictEqual(r.data.notes, GOOD.notes);
  });
});

// ---- safeRead 状态区分 ----

test('safeRead 首次运行（文件不存在）返回 first-run 且不锁定', () => {
  withTmp((file) => {
    const r = safeRead(file);
    assert.strictEqual(r.status, 'first-run');
    assert.strictEqual(r.data, null);
  });
});

test('safeRead 正常文件返回 ok', () => {
  withTmp((file) => {
    fs.writeFileSync(file, JSON.stringify(GOOD), 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.data.notes[0].id, 'n1');
  });
});

test('safeRead 损坏且无 .bak 返回 corrupt，与首次运行可区分', () => {
  withTmp((file) => {
    fs.writeFileSync(file, '{"notes": [ 损坏了', 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'corrupt');
    assert.strictEqual(r.data, null);
  });
});

test('safeRead 损坏且有可用 .bak 时自动回退为 recovered', () => {
  withTmp((file) => {
    fs.writeFileSync(file, '{"notes": [ 损坏了', 'utf-8');
    fs.writeFileSync(file + '.bak', JSON.stringify(GOOD), 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'recovered');
    assert.deepStrictEqual(r.data.notes, GOOD.notes);
    assert.ok(r.corruptPath, '应返回损坏件留证路径');
  });
});

test('safeRead 主文件与 .bak 同时损坏时返回 corrupt 且保留 .bak 原样', () => {
  withTmp((file) => {
    fs.writeFileSync(file, '坏的', 'utf-8');
    fs.writeFileSync(file + '.bak', '也坏的', 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'corrupt');
    assert.strictEqual(r.data, null);
    // .bak 未被破坏，保留人工恢复的可能
    assert.strictEqual(fs.readFileSync(file + '.bak', 'utf-8'), '也坏的');
  });
});

test('safeRead 损坏时把原文件另存留证，可人工恢复', () => {
  withTmp((file, dir) => {
    const corruptContent = '{"notes": [ 损坏了';
    fs.writeFileSync(file, corruptContent, 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'corrupt');
    assert.ok(r.corruptPath && fs.existsSync(r.corruptPath), '留证文件应存在');
    assert.strictEqual(fs.readFileSync(r.corruptPath, 'utf-8'), corruptContent);
    assert.ok(/\.corrupt-\d{8}-\d{6}-\d{3}\.json$/.test(r.corruptPath), '留证文件名应含时间戳');
  });
});

test('safeRead 留证超过上限时只保留最近若干份', () => {
  withTmp((file, dir) => {
    // 预置 4 份旧留证（时间戳递增），加上本次新增共 5 份
    const old = ['20200101-000000-001', '20200102-000000-002', '20200103-000000-003', '20200104-000000-004'];
    old.forEach((ts) => fs.writeFileSync(path.join(dir, 'notes-data.corrupt-' + ts + '.json'), '{}', 'utf-8'));
    fs.writeFileSync(file, '坏的', 'utf-8');
    safeRead(file);

    const left = fs.readdirSync(dir).filter((n) => n.includes('.corrupt-'));
    assert.strictEqual(left.length, MAX_CORRUPT_COPIES, '应裁剪到上限份数');
    // 最旧的一份应被删掉
    assert.ok(!left.some((n) => n.includes('20200101')), '最旧留证应被清理');
  });
});

test('safeRead 非 ENOENT 读取错误不当成首次运行', () => {
  withTmp((file) => {
    const fakeFs = {
      readFileSync() {
        const e = new Error('permission denied');
        e.code = 'EACCES';
        throw e;
      }
    };
    const r = safeRead(file, fakeFs, path);
    assert.strictEqual(r.status, 'corrupt', '权限错误必须锁定写入，不能当首次运行清空数据');
  });
});

// ---- atomicWrite ----

test('atomicWrite 正常写入并可读回', () => {
  withTmp((file) => {
    assert.strictEqual(atomicWrite(file, GOOD), true);
    const back = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.deepStrictEqual(back.notes, GOOD.notes);
  });
});

test('atomicWrite 首次写入不产生 .bak（无旧文件可备份）', () => {
  withTmp((file) => {
    assert.strictEqual(atomicWrite(file, GOOD), true);
    assert.strictEqual(fs.existsSync(file + '.bak'), false);
  });
});

test('atomicWrite 覆盖已有好数据时生成 .bak，内容为上一版', () => {
  withTmp((file) => {
    atomicWrite(file, GOOD);
    const next = { ...GOOD, notes: [{ id: 'n2' }] };
    assert.strictEqual(atomicWrite(file, next), true);
    assert.strictEqual(fs.existsSync(file + '.bak'), true);
    const bak = JSON.parse(fs.readFileSync(file + '.bak', 'utf-8'));
    assert.strictEqual(bak.notes[0].id, 'n1', '.bak 应是上一版内容');
    const cur = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(cur.notes[0].id, 'n2');
  });
});

test('atomicWrite 直接覆盖已存在文件（验证 Windows rename 语义）', () => {
  withTmp((file) => {
    fs.writeFileSync(file, '{"old":true}', 'utf-8');
    assert.strictEqual(atomicWrite(file, GOOD), true, 'Windows 下 renameSync 应能覆盖已存在文件');
    const cur = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(cur.old, undefined);
    assert.deepStrictEqual(cur.notes, GOOD.notes);
  });
});

test('atomicWrite 旧文件损坏时不用损坏内容覆盖好 .bak', () => {
  withTmp((file) => {
    // 先建立一份完好的 .bak
    fs.writeFileSync(file + '.bak', JSON.stringify(GOOD), 'utf-8');
    // 主文件损坏
    fs.writeFileSync(file, '坏的', 'utf-8');
    assert.strictEqual(atomicWrite(file, { ...GOOD, notes: [] }), true);
    // .bak 仍是完好内容，没有被损坏主文件污染
    const bak = JSON.parse(fs.readFileSync(file + '.bak', 'utf-8'));
    assert.strictEqual(bak.notes[0].id, 'n1', '.bak 必须保持完好，供二次损坏时恢复');
  });
});

test('atomicWrite 成功后不残留 tmp 文件', () => {
  withTmp((file, dir) => {
    atomicWrite(file, GOOD);
    const tmps = fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
    assert.deepStrictEqual(tmps, []);
  });
});

test('atomicWrite 在 rename 失败时保持原文件完好并清理 tmp', () => {
  withTmp((file, dir) => {
    atomicWrite(file, GOOD); // 建立原文件
    const before = fs.readFileSync(file, 'utf-8');

    const failingFs = {
      writeFileSync: fs.writeFileSync,
      copyFileSync: fs.copyFileSync,
      unlinkSync: fs.unlinkSync,
      readFileSync: fs.readFileSync,
      renameSync() {
        const e = new Error('EPERM: rename failed');
        e.code = 'EPERM';
        throw e;
      }
    };
    assert.strictEqual(atomicWrite(file, { notes: 'should-not-land' }, failingFs), false);
    // 原文件未被破坏，这是原子性的核心保证
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), before);
    const tmps = fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
    assert.deepStrictEqual(tmps, [], 'tmp 应被清理');
  });
});

test('atomicWrite 拒绝循环引用等不可序列化数据且不破坏原文件', () => {
  withTmp((file) => {
    atomicWrite(file, GOOD);
    const before = fs.readFileSync(file, 'utf-8');
    const cyclic = { notes: [] };
    cyclic.self = cyclic;
    assert.strictEqual(atomicWrite(file, cyclic), false);
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), before);
  });
});

test('atomicWrite 用随机 tmp 名避免并发写互相覆盖', () => {
  withTmp((file, dir) => {
    const names = [];
    const spyFs = {
      writeFileSync(p, ...rest) {
        names.push(p);
        return fs.writeFileSync(p, ...rest);
      },
      copyFileSync: fs.copyFileSync,
      unlinkSync: fs.unlinkSync,
      readFileSync: fs.readFileSync,
      renameSync: fs.renameSync
    };
    atomicWrite(file, GOOD, spyFs);
    atomicWrite(file, GOOD, spyFs);
    assert.strictEqual(names.length, 2);
    assert.notStrictEqual(names[0], names[1], '两次写入的 tmp 名应不同');
  });
});

// ---- 端到端：损坏 → 恢复 → 再损坏 ----

test('损坏后写入成功时 .bak 不会被损坏内容污染，仍可二次恢复', () => {
  withTmp((file) => {
    // .bak 从第二次写入起才存在（首次写入无旧文件可备份）
    atomicWrite(file, GOOD); // v1
    atomicWrite(file, { ...GOOD, notes: [{ id: 'n2' }] }); // v2，此时 .bak = v1
    assert.strictEqual(fs.existsSync(file + '.bak'), true, '两次写入后应已有 .bak');

    // 模拟损坏：主文件写坏，.bak 仍是 v1
    fs.writeFileSync(file, '坏了', 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'recovered', '.bak 应能恢复到 v1');
    assert.strictEqual(r.data.notes[0].id, 'n1');

    // 用恢复出的数据重新落盘；旧文件此刻仍是损坏内容，不得被备份成 .bak
    assert.strictEqual(atomicWrite(file, r.data), true);
    const bak = JSON.parse(fs.readFileSync(file + '.bak', 'utf-8'));
    assert.strictEqual(bak.notes[0].id, 'n1', '.bak 必须仍是完好内容，未被损坏件污染');

    const back = safeRead(file);
    assert.strictEqual(back.status, 'ok');
    assert.strictEqual(back.data.notes[0].id, 'n1');
  });
});
