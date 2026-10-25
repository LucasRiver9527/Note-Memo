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
  assert.strictEqual(isValidDataShape({ settings: [] }), false);
  assert.strictEqual(isValidDataShape({ notes: [null] }), false);
  assert.strictEqual(isValidDataShape({ notes: [{ id: 'n1', images: {} }] }), false);
  assert.strictEqual(isValidDataShape({ notes: [{ content: 42, images: [{ id: 'i1' }] }] }), false);
  assert.strictEqual(isValidDataShape({ groups: [null] }), false);
  assert.strictEqual(isValidDataShape({ trash: [{ note: null }] }), false);
});

test('isValidDataShape 保留旧版缺字段便签供迁移', () => {
  assert.strictEqual(isValidDataShape({ notes: [{ content: 'old' }], groups: [], trash: [] }), true);
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

test('safeRead 合法 JSON 中的错误结构进入损坏锁，保留原文件', () => {
  withTmp((file) => {
    const raw = JSON.stringify({ notes: [null], groups: [], trash: [] });
    fs.writeFileSync(file, raw, 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'corrupt');
    assert.strictEqual(r.data, null);
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), raw);
    assert.strictEqual(fs.readFileSync(r.corruptPath, 'utf-8'), raw);
  });
});

test('safeRead 主文件结构错误时只从结构有效的 .bak 恢复', () => {
  withTmp((file) => {
    fs.writeFileSync(file, JSON.stringify({ notes: [null] }), 'utf-8');
    fs.writeFileSync(file + '.bak', JSON.stringify(GOOD), 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'recovered');
    assert.deepStrictEqual(r.data.notes, GOOD.notes);
  });
});

test('safeRead 拒绝结构错误的 .bak，不以它覆盖损坏主文件', () => {
  withTmp((file) => {
    const raw = JSON.stringify({ notes: [null] });
    fs.writeFileSync(file, raw, 'utf-8');
    fs.writeFileSync(file + '.bak', JSON.stringify({ notes: 'bad' }), 'utf-8');
    const r = safeRead(file);
    assert.strictEqual(r.status, 'corrupt');
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), raw);
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

test('atomicWrite 拒绝错误结构，不覆盖现有存档', () => {
  withTmp((file) => {
    fs.writeFileSync(file, JSON.stringify(GOOD), 'utf-8');
    assert.strictEqual(atomicWrite(file, { notes: [null] }), false);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), GOOD);
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

test('atomicWrite 不把结构错误的旧文件写进唯一好备份', () => {
  withTmp((file) => {
    fs.writeFileSync(file + '.bak', JSON.stringify(GOOD), 'utf-8');
    fs.writeFileSync(file, JSON.stringify({ notes: [null] }), 'utf-8');
    assert.strictEqual(atomicWrite(file, { ...GOOD, notes: [{ id: 'n2' }] }), true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file + '.bak', 'utf-8')), GOOD);
  });
});

test('atomicWrite 成功后不残留 tmp 文件', () => {
  withTmp((file, dir) => {
    atomicWrite(file, GOOD);
    const tmps = fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
    assert.deepStrictEqual(tmps, []);
  });
});

// ---- atomicWrite 临时文件清理：故障注入 ----

// 只清理本次调用创建的 tmp：断言目录里没有 .tmp，且不触碰原文件/.bak
function tmpNames(dir) { return fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')); }
const GOOD_V2 = { ...GOOD, notes: [{ id: 'n2' }] };

// 通用故障注入 fs 工厂：记录 rename 源路径与每次 unlink 目标；可自定义 rename 与 unlink 行为。
function injectFs({ onRename, onUnlink }) {
  const rec = { renameCalls: [], renameSourceExisted: [], unlinkTargets: [] };
  const fsx = {
    writeFileSync: fs.writeFileSync,
    copyFileSync: fs.copyFileSync,
    readFileSync: fs.readFileSync,
    renameSync(from, to) {
      rec.renameCalls.push(from);
      rec.renameSourceExisted.push(fs.existsSync(from));
      return onRename(from, to);
    },
    unlinkSync(target) {
      rec.unlinkTargets.push(target);
      return onUnlink(target);
    }
  };
  return { fsx, rec };
}

const renameEperm = () => { const e = new Error('EPERM: rename blocked'); e.code = 'EPERM'; throw e; };

// 捕获 console.error 行；fn() 执行完毕后返回捕获到的所有行（try/finally 保证恢复）。
function withConsoleErrorSpy(fn) {
  const origErr = console.error;
  const lines = [];
  console.error = (...a) => { lines.push(a.join(' ')); };
  try { fn(); } finally { console.error = origErr; }
  return lines;
}

test('atomicWrite 在 rename 失败时保持原文件完好并清理 tmp', () => {
  withTmp((file, dir) => {
    atomicWrite(file, GOOD); // 建立原文件
    const before = fs.readFileSync(file, 'utf-8');
    const { fsx, rec } = injectFs({ onRename: renameEperm, onUnlink: (t) => fs.unlinkSync(t) });
    assert.strictEqual(atomicWrite(file, GOOD_V2, fsx), false);
    assert.strictEqual(rec.renameCalls.length, 1, 'rename 必须被调用');
    assert.strictEqual(rec.renameSourceExisted[0], true, 'rename 前本次 tmp 必须已存在');
    assert.deepStrictEqual([...new Set(rec.unlinkTargets)], [rec.renameCalls[0]], '清理只应针对本次的一个 tmp');
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), before);
    assert.deepStrictEqual(tmpNames(dir), [], 'tmp 应被清理');
  });
});

test('atomicWrite 清理：瞬时 unlink 失败后重试成功（EACCES 与 EBUSY 均可恢复，无残留告警）', () => {
  for (const code of ['EACCES', 'EBUSY']) {
    withTmp((file, dir) => {
      atomicWrite(file, GOOD);
      const before = fs.readFileSync(file, 'utf-8');
      let n = 0;
      const { fsx, rec } = injectFs({
        onRename: renameEperm,
        onUnlink: (t) => { n++; if (n === 1) { const e = new Error(`${code}: transient`); e.code = code; throw e; } return fs.unlinkSync(t); }
      });
      const lines = withConsoleErrorSpy(() => atomicWrite(file, GOOD_V2, fsx));
      assert.strictEqual(lines.filter((l) => l.includes('临时文件清理失败')).length, 0, `${code} 恢复后不应有残留告警`);
      assert.strictEqual(rec.renameCalls.length, 1);
      assert.strictEqual(rec.unlinkTargets.length, 2, '第一次瞬时失败后应重试一次并成功');
      assert.deepStrictEqual([...new Set(rec.unlinkTargets)], [rec.renameCalls[0]]);
      assert.strictEqual(fs.readFileSync(file, 'utf-8'), before);
      assert.deepStrictEqual(tmpNames(dir), [], 'tmp 最终应被清除');
    });
  }
});

test('atomicWrite 清理：持续性瞬时失败达上限（含完整路径与错误、恰一条残留告警、原文件不变、残留存在、返回 false）', () => {
  withTmp((file, dir) => {
    atomicWrite(file, GOOD);
    const before = fs.readFileSync(file, 'utf-8');
    const sentinel = path.join(dir, 'unrelated-old.tmp');
    fs.writeFileSync(sentinel, 'sentinel');
    const { fsx, rec } = injectFs({ onRename: renameEperm, onUnlink: () => { const e = new Error('EPERM: still locked'); e.code = 'EPERM'; throw e; } });
    const lines = withConsoleErrorSpy(() => atomicWrite(file, GOOD_V2, fsx));
    assert.strictEqual(rec.unlinkTargets.length, 3, '合计最多 3 次 unlink');
    assert.deepStrictEqual([...new Set(rec.unlinkTargets)], [rec.renameCalls[0]], '只针对本次的一个 tmp');
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), before);
    const leftovers = tmpNames(dir).filter((n) => n !== 'unrelated-old.tmp');
    assert.strictEqual(leftovers.length, 1, '清理失败时应留下本次的 tmp');
    assert.strictEqual(fs.readFileSync(sentinel, 'utf-8'), 'sentinel', '无关旧 tmp 不得被触碰');
    const residual = lines.filter((l) => l.includes('临时文件清理失败'));
    assert.strictEqual(residual.length, 1, '应恰有一条残留告警');
    assert.ok(residual[0].includes(leftovers[0]), '告警应含完整 tmp 文件名');
    assert.ok(residual[0].includes(dir), '告警应含完整路径（目录），而非仅 basename');
    assert.match(residual[0], /EPERM/);
    assert.doesNotMatch(residual[0], /n2/, '告警不得含数据内容');
  });
});

test('atomicWrite 清理：tmp 真实消失（注入 rename 时删除源）→ unlink 得真实 ENOENT，不告警', () => {
  withTmp((file, dir) => {
    atomicWrite(file, GOOD);
    const before = fs.readFileSync(file, 'utf-8');
    let deletedSource = null;
    const { fsx, rec } = injectFs({
      onRename: (from) => {
        assert.strictEqual(fs.existsSync(from), true, '注入删除前源 tmp 必须存在');
        deletedSource = from;
        fs.unlinkSync(from);
        const e = new Error('EPERM: rename blocked'); e.code = 'EPERM'; throw e;
      },
      onUnlink: (t) => fs.unlinkSync(t)
    });
    const lines = withConsoleErrorSpy(() => atomicWrite(file, GOOD_V2, fsx));
    assert.strictEqual(rec.unlinkTargets.length, 1, 'ENOENT 应立即结束，不重试');
    assert.strictEqual(rec.unlinkTargets[0], deletedSource, '清理目标应为被删除的源 tmp');
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), before);
    assert.deepStrictEqual(tmpNames(dir), [], '无 tmp 残留');
    assert.strictEqual(lines.filter((l) => l.includes('临时文件清理失败')).length, 0, 'ENOENT 不应告警');
  });
});

test('atomicWrite 清理：意外错误立即停止（仅一次 unlink）、含完整路径并告警、原文件不变、残留存在', () => {
  withTmp((file, dir) => {
    atomicWrite(file, GOOD);
    const before = fs.readFileSync(file, 'utf-8');
    const { fsx, rec } = injectFs({
      onRename: renameEperm,
      onUnlink: () => { const e = new Error('EIO: disk error'); e.code = 'EIO'; throw e; }
    });
    const lines = withConsoleErrorSpy(() => atomicWrite(file, GOOD_V2, fsx));
    assert.strictEqual(rec.unlinkTargets.length, 1, '未知错误应立即停止，不重试');
    assert.deepStrictEqual([...new Set(rec.unlinkTargets)], [rec.renameCalls[0]]);
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), before);
    const leftovers = tmpNames(dir);
    assert.strictEqual(leftovers.length, 1, '未知错误应留下本次 tmp');
    const residual = lines.filter((l) => l.includes('临时文件清理失败'));
    assert.strictEqual(residual.length, 1, '应恰有一条残留告警');
    assert.ok(residual[0].includes(dir), '告警应含完整路径（目录），而非仅 basename');
    assert.match(residual[0], /EIO/);
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
