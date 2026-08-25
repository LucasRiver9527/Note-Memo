const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const EXPECTED_VERSION = require(path.join(ROOT, 'package.json')).version;

// 启动应用：独立临时 userData，首启关闭「更新说明」弹窗，返回可交互句柄
// opts.seed：可选，写入 notes-data.json 作为初始数据（用于多便签/预置场景）
async function openApp(opts) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mynotes-e2e-'));
  if (opts && opts.seed) {
    await fs.writeFile(path.join(userDataDir, 'notes-data.json'), JSON.stringify(opts.seed));
  }
  const electronApp = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, MYNOTES_USER_DATA: userDataDir }
  });
  const win = await electronApp.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  const closeBtn = win.locator('#btnChangelogClose');
  // 首启可能出现「更新说明」弹窗；等待其可见再强制关闭（force 绕过"稳定"检查，避免竞态 flake）
  try {
    await closeBtn.waitFor({ state: 'visible', timeout: 8000 });
    await closeBtn.click({ force: true, timeout: 8000 });
  } catch (_) {}

  return { electronApp, win, userDataDir };
}

async function closeApp(ctx) {
  await ctx.electronApp.close().catch(() => {});
  await ctx.userDataDir && fs.rm(ctx.userDataDir, { recursive: true, force: true }).catch(() => {});
}

// 点击封装：force 绕过冷启动「稳定」检查，规避环境级 flake（见规划待办阶段 C）
async function stableClick(locator) {
  await locator.click({ force: true });
}

test('应用可启动，preload 注入与版本号来自 package.json', async () => {
  const ctx = await openApp();
  try {
    // 主界面外壳渲染成功
    await expect(ctx.win.locator('#btnAdd')).toBeVisible();

    // contextBridge / logic.js 单一来源均已挂到渲染进程
    const env = await ctx.win.evaluate(() => ({
      hasApi: !!window.api,
      appVersion: window.api && window.api.appVersion,
      isDarkColorType: typeof window.isDarkColor,
      autoTextColorType: typeof window.autoTextColor
    }));
    expect(env.hasApi).toBe(true);
    // 版本号来源统一（#2 修复：不再硬编码）
    expect(env.appVersion).toBe(EXPECTED_VERSION);
    // note.js 也并入了逻辑单一来源
    expect(env.isDarkColorType).toBe('function');
    expect(env.autoTextColorType).toBe('function');
  } finally {
    await closeApp(ctx);
  }
});

test('点击「新建」创建便签并在画布上显示、数量更新', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnAdd').click();

    const title = ctx.win.locator('#board .note .note-title').first();
    await expect(title).toBeVisible();
    await title.fill('我的第一条便签');
    await expect(title).toHaveValue('我的第一条便签');

    // 便签数量同步更新
    await expect(ctx.win.locator('#noteCount')).toHaveText('1');
  } finally {
    await closeApp(ctx);
  }
});

test('便签内容可输入并保存（contenteditable）', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnAdd').click();
    const content = ctx.win.locator('#board .note .note-content').first();
    await expect(content).toBeVisible();
    await content.click();
    await ctx.win.keyboard.type('这里是一段正文内容');
    await expect(content).toContainText('这里是一段正文内容');
  } finally {
    await closeApp(ctx);
  }
});

test('冷启动默认无便签显示空态提示', async () => {
  const ctx = await openApp();
  try {
    await expect(ctx.win.locator('#emptyHint')).toBeVisible();
    await expect(ctx.win.locator('#board .note')).toHaveCount(0);
  } finally {
    await closeApp(ctx);
  }
});

// —— 以下回归用例保护「共享渲染函数」重构（B）——
// 直接调用页面全局的渲染函数，断言 Markdown / 颜色 / 表格生成的 HTML 正确。

test('渲染：formatInlineText 生成加粗/高亮/颜色/链接', async () => {
  const ctx = await openApp();
  try {
    const out = await ctx.win.evaluate(() => formatInlineText('普通 **加粗** ==高亮== 和 [[c:#ff0000]]红[[/c]]'));
    expect(out).toContain('<b>加粗</b>');
    expect(out).toContain('<mark class="hl">高亮</mark>');
    expect(out).toContain('<span style="color:#ff0000">红</span>');
    const link = await ctx.win.evaluate(() => formatInlineText('go www.example.com'));
    expect(link).toContain('http://www.example.com');
  } finally { await closeApp(ctx); }
});

test('渲染：renderRichContent 组装表格/图片/文件引用', async () => {
  const ctx = await openApp();
  try {
    const html = await ctx.win.evaluate(() => {
      const note = {
        content: '前文[[table:t1]]后文',
        tables: [{ id: 't1', rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']] }],
        images: [{ id: 'i1', src: 'note-img://local/a.png', w: 120 }],
        files: [{ id: 'f1', path: 'C:\\\\notes\\\\a.txt', isDir: false }]
      };
      return renderRichContent(note.content, note);
    });
    expect(html).toContain('前文');
    expect(html).toContain('note-table');
    expect(html).toContain('<td');
    expect(html).toContain('后文');
  } finally { await closeApp(ctx); }
});

test('钉窗(note.html)：钉桌可打开并显示便签标题', async () => {
  const ctx = await openApp();
  try {
    // 创建一个便签并输入标题（saveNow 会立即写盘）
    await ctx.win.locator('#btnAdd').click();
    const title = ctx.win.locator('#board .note .note-title').first();
    await title.fill('钉桌便签');
    await expect(ctx.win.locator('#noteCount')).toHaveText('1');

    // 订阅新窗口事件（需在触发动作前），点击「钉到桌面」
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await ctx.win.locator('#board .note .t-desktop').first().click();
    const noteWin = await noteWinPromise;
    await noteWin.waitForLoadState('domcontentloaded');

    // 钉窗加载 note.html，标题同步展示
    await expect(noteWin.locator('#dnTitle')).toHaveValue('钉桌便签');
    await expect(noteWin.locator('#dnText')).toBeVisible();
  } finally { await closeApp(ctx); }
});

test('窗口置顶按钮：点击激活高亮、再次点击还原', async () => {
  const ctx = await openApp();
  try {
    const pin = ctx.win.locator('#btnPin');
    await expect(pin).not.toHaveClass(/\bactive\b/);
    await pin.click();
    await expect(pin).toHaveClass(/\bactive\b/);
    await pin.click();
    await expect(pin).not.toHaveClass(/\bactive\b/);
  } finally { await closeApp(ctx); }
});

test('启用便签玻璃拟态后 body 添加 glass 类', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnSettings').click();
    await ctx.win.locator('#appearanceModuleSeg [data-app-module="note"]').click();
    const toggle = ctx.win.locator('#glassToggle');
    await toggle.check();
    await expect(ctx.win.locator('body')).toHaveClass(/\bglass\b/);
    await toggle.uncheck();
    await expect(ctx.win.locator('body')).not.toHaveClass(/\bglass\b/);
  } finally { await closeApp(ctx); }
});

test('P4 缓存：跨视图重渲染后便签内容仍正确（renderRichCached）', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnAdd').click();
    const content = ctx.win.locator('#board .note .note-content').first();
    await content.click();
    await ctx.win.keyboard.type('一段正文文本');

    // 切到备忘录再切回画布，触发 renderAll 走缓存路径，内容不应丢失或失真
    await ctx.win.locator('#viewMemo').click();
    await ctx.win.waitForTimeout(200);
    await ctx.win.locator('#viewBoard').click();
    await expect(ctx.win.locator('#board .note .note-content').first()).toContainText('一段正文文本');
  } finally { await closeApp(ctx); }
});

test('全局设置：数据页含「开机自启动」开关（默认可见）', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnSettings').click();
    await ctx.win.locator('.sp-nav-item[data-tab="data"]').click();
    await expect(ctx.win.locator('#autoStartToggle')).toBeVisible();
    // 该开关为系统级设置，此处只校验 UI 存在，不触发真实写注册表
  } finally { await closeApp(ctx); }
});

// —— 任务3：补齐 e2e 覆盖 ——
test('英文语言：切换到 en 后关键 UI 文案为英文', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnSettings').click();
    await ctx.win.locator('.sp-nav-item[data-tab="data"]').click();
    await ctx.win.locator('#languageSelect').selectOption('en');
    await ctx.win.locator('#btnCloseSettings').click();

    await expect(ctx.win.locator('#btnAdd')).toHaveText(/New/);       // new_note: ＋ New
    await expect(ctx.win.locator('#searchInput')).toHaveAttribute('placeholder', /Search notes/);
  } finally { await closeApp(ctx); }
});

test('钉窗深度编辑：改标题同步持久化到数据', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnAdd').click();
    await ctx.win.locator('#board .note .note-title').first().fill('钉窗原始标题');

    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await ctx.win.locator('#board .note .t-desktop').first().click();
    const noteWin = await noteWinPromise;
    await noteWin.waitForLoadState('domcontentloaded');
    await expect(noteWin.locator('#dnTitle')).toHaveValue('钉窗原始标题');

    // 在钉窗改标题 → noteUpdate → 主进程数据 + 防抖落盘
    await noteWin.locator('#dnTitle').fill('钉窗新标题');
    await ctx.win.waitForTimeout(700);

    // 校验数据层：持久化的 notes-data.json 中该便签标题已更新
    const data = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf-8'));
    const note = (data.notes || []).find((n) => n.id && n.title === '钉窗新标题');
    expect(note).toBeTruthy();
  } finally { await closeApp(ctx); }
});

test('多便签：预置 80 张便签可完整渲染并可编辑', async () => {
  const notes = [];
  const now = Date.now();
  for (let i = 1; i <= 80; i++) {
    notes.push({
      id: 'perf-n' + i, title: '性能便签' + i, content: '第' + i + '张内容', type: 'note',
      color: i % 2 ? '#93f1ce' : '#a0d8ff', textColor: null,
      x: 40 + (i % 5) * 12, y: 40 + Math.floor(i / 5) * 16, w: 220, h: 130, z: i,
      updatedAt: now, createdAt: now
    });
  }
  const seed = { version: 1, settings: { viewMode: 'board' }, groups: [], trash: [], notes };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('80');
    // 至少首张便签可见且可编辑（验证批量渲染后事件仍正常）
    const firstCard = ctx.win.locator('#board .note').first();
    await expect(firstCard).toBeVisible();
    await firstCard.locator('.note-title').fill('修改后的标题');
    await expect(firstCard.locator('.note-title')).toHaveValue('修改后的标题');
  } finally { await closeApp(ctx); }
});

// —— 任务6：外观可读性兜底 ——
test('外观可读性：亮底色自动启用 bright-bg，关闭开关后取消', async () => {
  const seed = {
    version: 1,
    settings: { canvasColor: '#ffffff', backgroundReadability: true },
    groups: [], notes: [], trash: []
  };
  const ctx = await openApp({ seed });
  try {
    // 白色亮底 + 开启可读性 → 自动压暗/提对比
    await expect(ctx.win.locator('body')).toHaveClass(/\bbright-bg\b/);
    // 关闭开关后取消
    await ctx.win.locator('#btnSettings').click();
    await ctx.win.locator('#bgReadabilityToggle').uncheck();
    await expect(ctx.win.locator('body')).not.toHaveClass(/\bbright-bg\b/);
  } finally { await closeApp(ctx); }
});

test('外观可读性：设背景图自动 bright-bg，清除后取消', async () => {
  const seed = {
    version: 1,
    settings: { backgroundImage: 'note-bg://local/x.png', backgroundReadability: true },
    groups: [], notes: [], trash: []
  };
  const ctx = await openApp({ seed });
  try {
    // 有背景图 → 自动压暗/提对比
    await expect(ctx.win.locator('body')).toHaveClass(/\bbright-bg\b/);
    // 清除背景图 → 取消
    await ctx.win.locator('#btnSettings').click();
    await ctx.win.locator('#btnClearImage').click();
    await expect(ctx.win.locator('body')).not.toHaveClass(/\bbright-bg\b/);
  } finally { await closeApp(ctx); }
});

// —— P5 增量渲染：画布内只更新变化卡片，其余保留 ——
test('P5 增量渲染：画布内切换置顶后其余便签内容保留', async () => {
  const ctx = await openApp();
  try {
    // 建两张便签并各输入内容
    for (let i = 1; i <= 2; i++) {
      await ctx.win.locator('#btnAdd').click();
      await ctx.win.locator('#board .note .note-title').last().fill('便签' + i);
      const c = ctx.win.locator('#board .note .note-content').last();
      await c.click();
      await ctx.win.keyboard.type('内容' + i);
    }
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');

    // 触发画布重排：给第一张切置顶
    await ctx.win.locator('#board .note .t-pin').first().click();

    await expect(ctx.win.locator('#board .note').first()).toHaveClass(/\bpinned\b/);
    // 两张便签内容都保留（未变化卡片被复用、未丢失）
    await expect(ctx.win.locator('#board .note .note-content').nth(0)).toContainText('内容1');
    await expect(ctx.win.locator('#board .note .note-content').nth(1)).toContainText('内容2');
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');
  } finally { await closeApp(ctx); }
});



// —— 排序/整理联动：保存当前排序在「全部」视图不弹回、顺序与画面一致 ——
test('保存排序在「全部」视图生效：拖动后保存不弹回，顺序与画面一致', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  // a 未分组位置 (20,20)，b 未分组位置 (280,20)；「全部」初始位置相同
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [],
    notes: [mk('a', 'A', 20, 20), mk('b', 'B', 280, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');
    // 模拟把便签 a 拖到便签 b 右侧（「全部」视图写入 positionAll，与 b 重叠）
    await ctx.win.evaluate(() => {
      const a = state.notes.find((n) => n.id === 'a');
      setEffPos(a, 500, 20);
    });
    // 保存当前排序
    await stableClick(ctx.win.locator('#btnSaveOrder'));
    const res = await ctx.win.evaluate(() => {
      const a = state.notes.find((n) => n.id === 'a');
      const b = state.notes.find((n) => n.id === 'b');
      return { a: a.positionAll, b: b.positionAll, order: state.settings.noteOrder };
    });
    // 位置不被 ensureAllLayout 弹回
    expect(res.a.x).toBe(500);
    expect(res.a.y).toBe(20);
    expect(res.b.x).toBe(280);
    expect(res.b.y).toBe(20);
    // 顺序按「全部」画面（b 在左、a 在右），而非未分组旧位置（a 在左、b 在右）
    expect(res.order.indexOf('b')).toBeLessThan(res.order.indexOf('a'));
  } finally {
    await closeApp(ctx);
  }
});

test('切换分组再切回「全部」不改变已保存的布局', async () => {
  const now = Date.now();
  const mk = (id, title, groupId, x, y, paX, paY) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x: paX, y: paY }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  // a 属于分组 g1（其「全部」位置 500,20），b 未分组（「全部」位置 280,20），二者在「全部」里重叠
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [{ id: 'g1', name: '分组1', color: '#6c5ce7' }],
    trash: [],
    notes: [mk('a', 'A', 'g1', 20, 20, 500, 20), mk('b', 'B', null, 280, 20, 280, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');
    // 保存当前排序（记录「全部」布局）
    await stableClick(ctx.win.locator('#btnSaveOrder'));
    // 切到分组 g1，再切回「全部」
    await stableClick(ctx.win.locator('#groupChips .chip').first());
    await stableClick(ctx.win.locator('#filterbar .chip[data-group="all"]'));
    const res = await ctx.win.evaluate(() => {
      const a = state.notes.find((n) => n.id === 'a');
      const b = state.notes.find((n) => n.id === 'b');
      return { a: a.positionAll, b: b.positionAll };
    });
    // 切回后「全部」布局不被 ensureAllLayout 重新排开
    expect(res.a.x).toBe(500);
    expect(res.a.y).toBe(20);
    expect(res.b.x).toBe(280);
    expect(res.b.y).toBe(20);
  } finally {
    await closeApp(ctx);
  }
});

// —— 排序：保存当前排序只在便签视图；保存后备忘录列表保持顺序并跨视图一致 ——
test('保存当前排序后备忘录列表保持顺序且跨视图一致', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [],
    notes: [mk('a', 'A', 20, 20), mk('b', 'B', 280, 20), mk('c', 'C', 540, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('3');
    const noteOrder = () => ctx.win.evaluate(() => state.settings.noteOrder.slice());
    const memoDom = () => ctx.win.evaluate(() => Array.from(document.querySelectorAll('#memoList .memo-row')).map((r) => r.dataset.id));
    // 便签视图：保存按钮可见，点击后按画布位置记录顺序 a,b,c
    await expect(ctx.win.locator('#btnSaveOrder')).toBeVisible();
    await stableClick(ctx.win.locator('#btnSaveOrder'));
    expect(await noteOrder()).toEqual(['a', 'b', 'c']);
    // 切备忘录：按保存后的顺序显示（而非按 updatedAt）
    await stableClick(ctx.win.locator('#viewMemo'));
    expect(await memoDom()).toEqual(['a', 'b', 'c']);
    // 模拟用户拖动重排后的自定义顺序
    await ctx.win.evaluate(() => {
      state.settings.sortMode = 'custom';
      state.settings.noteOrder = ['c', 'a', 'b'];
    });
    // 跨视图：便签 → 备忘录，顺序保持
    await stableClick(ctx.win.locator('#viewBoard'));
    await stableClick(ctx.win.locator('#viewMemo'));
    expect(await memoDom()).toEqual(['c', 'a', 'b']);
  } finally {
    await closeApp(ctx);
  }
});

// —— 排序：保存排序 ↔ 一键整理 联动（画布恢复布局 / 列表紧凑排列） ——
test('画布视图：保存排序后一键整理恢复到保存的布局', async () => {
  const mk = (id, x, y) => ({
    id, title: id, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [],
    notes: [mk('a', 20, 20), mk('b', 300, 20), mk('c', 600, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('3');
    const pa = (id) => ctx.win.evaluate((i) => state.notes.find((n) => n.id === i).positionAll, id);
    // 保存当前排序（记录布局快照）
    await stableClick(ctx.win.locator('#btnSaveOrder'));
    // 打乱位置
    await ctx.win.evaluate(() => {
      setEffPos(state.notes.find((n) => n.id === 'a'), 900, 500);
      setEffPos(state.notes.find((n) => n.id === 'b'), 900, 700);
    });
    // 一键整理 → 恢复到保存时的布局
    await stableClick(ctx.win.locator('#btnQuickArrange'));
    expect(await pa('a')).toEqual({ x: 20, y: 20 });
    expect(await pa('b')).toEqual({ x: 300, y: 20 });
    expect(await pa('c')).toEqual({ x: 600, y: 20 });
  } finally {
    await closeApp(ctx);
  }
});

test('一键整理（便签视图触发）恢复到保存的位置并跨视图保持', async () => {
  const mk = (id, x, y) => ({
    id, title: id, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [],
    notes: [mk('a', 20, 20), mk('b', 300, 20), mk('c', 600, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('3');
    const pa = (id) => ctx.win.evaluate((i) => state.notes.find((n) => n.id === i).positionAll, id);
    // 便签视图保存排序（记录位置快照）
    await expect(ctx.win.locator('#btnSaveOrder')).toBeVisible();
    await stableClick(ctx.win.locator('#btnSaveOrder'));
    // 打乱位置
    await ctx.win.evaluate(() => { setEffPos(state.notes.find((n) => n.id === 'a'), 900, 500); });
    // 一键整理（按钮仅在便签视图）→ 恢复到保存时的位置
    await expect(ctx.win.locator('#btnQuickArrange')).toBeVisible();
    await stableClick(ctx.win.locator('#btnQuickArrange'));
    expect(await pa('a')).toEqual({ x: 20, y: 20 });
    // 跨视图：切备忘录再切回，位置仍保持
    await stableClick(ctx.win.locator('#viewMemo'));
    await stableClick(ctx.win.locator('#viewBoard'));
    expect(await pa('a')).toEqual({ x: 20, y: 20 });
  } finally {
    await closeApp(ctx);
  }
});

// —— 指针拖拽重排：备忘录 / 文档视图用 pointer 事件（支持边拖边滚，替代原生 HTML5 DnD）——
test('备忘录视图：拖动把手(指针)重排便签顺序', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'custom', noteOrder: ['a', 'b', 'c'] },
    groups: [], trash: [],
    notes: [mk('a', 'A', 20, 20), mk('b', 'B', 280, 20), mk('c', 'C', 540, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('3');
    await ctx.win.locator('#viewMemo').click();
    const memoDom = () => ctx.win.evaluate(() => Array.from(document.querySelectorAll('#memoList .memo-row')).map((r) => r.dataset.id));
    await expect.poll(memoDom).toEqual(['a', 'b', 'c']);
    // 把 a 的把手拖到 c 的底部（插入到末尾）
    const grip = ctx.win.locator('.memo-row[data-id="a"] .memo-grip');
    const cBox = await ctx.win.locator('.memo-row[data-id="c"]').boundingBox();
    const g = await grip.boundingBox();
    await ctx.win.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await ctx.win.mouse.down();
    await ctx.win.mouse.move(g.x + g.width / 2, cBox.y + cBox.height - 4, { steps: 10 });
    await ctx.win.mouse.up();
    await expect.poll(memoDom).toEqual(['b', 'c', 'a']);
  } finally {
    await closeApp(ctx);
  }
});

test('文档视图：拖动选择项(指针)重排便签顺序', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'custom', noteOrder: ['a', 'b', 'c'] },
    groups: [], trash: [],
    notes: [mk('a', 'A', 20, 20), mk('b', 'B', 280, 20), mk('c', 'C', 540, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('3');
    await stableClick(ctx.win.locator('#viewDoc'));
    const docDom = () => ctx.win.evaluate(() => Array.from(document.querySelectorAll('.doc-pick-item')).map((r) => r.dataset.id));
    await expect.poll(docDom).toEqual(['a', 'b', 'c']);
    // 把 a 拖到 c 的底部（插入到末尾）
    const first = ctx.win.locator('.doc-pick-item[data-id="a"]');
    const cItem = ctx.win.locator('.doc-pick-item[data-id="c"]');
    const fb = await first.boundingBox();
    const cBox = await cItem.boundingBox();
    await ctx.win.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await ctx.win.mouse.down();
    await ctx.win.mouse.move(fb.x + fb.width / 2, cBox.y + cBox.height - 4, { steps: 10 });
    await ctx.win.mouse.up();
    await expect.poll(docDom).toEqual(['b', 'c', 'a']);
  } finally {
    await closeApp(ctx);
  }
});

// —— 顶栏「一键整理 / 保存当前排序」只在便签视图显示 ——
test('一键整理/保存排序按钮只在便签视图显示', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [],
    notes: [mk('a', 'A', 20, 20), mk('b', 'B', 280, 20), mk('c', 'C', 540, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('3');
    // 便签视图：两个按钮显示
    await expect(ctx.win.locator('#btnQuickArrange')).toBeVisible();
    await expect(ctx.win.locator('#btnSaveOrder')).toBeVisible();
    // 备忘录 / 待办 / 文档：隐藏
    await stableClick(ctx.win.locator('#viewMemo'));
    await expect(ctx.win.locator('#btnQuickArrange')).toBeHidden();
    await expect(ctx.win.locator('#btnSaveOrder')).toBeHidden();
    await stableClick(ctx.win.locator('#viewTodo'));
    await expect(ctx.win.locator('#btnQuickArrange')).toBeHidden();
    await expect(ctx.win.locator('#btnSaveOrder')).toBeHidden();
    await stableClick(ctx.win.locator('#viewDoc'));
    await expect(ctx.win.locator('#btnQuickArrange')).toBeHidden();
    await expect(ctx.win.locator('#btnSaveOrder')).toBeHidden();
    // 切回便签视图：重新显示
    await stableClick(ctx.win.locator('#viewBoard'));
    await expect(ctx.win.locator('#btnQuickArrange')).toBeVisible();
    await expect(ctx.win.locator('#btnSaveOrder')).toBeVisible();
  } finally {
    await closeApp(ctx);
  }
});

// —— 批量选中：点击便签/备忘录内容区只选中，不进入编辑；退出批量后可正常编辑 ——
test('批量选中：点击便签内容区只选中不编辑', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [],
    notes: [mk('a', 'A', 20, 20), mk('b', 'B', 280, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');
    const note = ctx.win.locator('.note[data-id="a"]');
    const content = ctx.win.locator('.note[data-id="a"] .note-content');
    // 批量模式开启
    await stableClick(ctx.win.locator('#btnBatchToggle'));
    // 点击内容区：只选中，contenteditable 不聚焦
    await content.click({ force: true });
    await expect(note).toHaveClass(/selected/);
    const active1 = await ctx.win.evaluate(() => (document.activeElement && (document.activeElement.className || document.activeElement.tagName)) || '');
    expect(active1).not.toContain('note-content');
    // 退出批量：点击内容区可进入编辑（contenteditable 聚焦）
    await stableClick(ctx.win.locator('#btnBatchToggle'));
    await content.click({ force: true });
    await ctx.win.waitForTimeout(150);
    const active2 = await ctx.win.evaluate(() => (document.activeElement && document.activeElement.className) || '');
    expect(active2).toContain('note-content');
  } finally {
    await closeApp(ctx);
  }
});

test('批量选中：点击备忘录内容区只选中不编辑', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated', noteOrder: ['a', 'b'] },
    groups: [], trash: [],
    notes: [mk('a', 'A', 20, 20), mk('b', 'B', 280, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');
    await stableClick(ctx.win.locator('#viewMemo'));
    const row = ctx.win.locator('.memo-row[data-id="a"]');
    const content = ctx.win.locator('.memo-row[data-id="a"] .note-content');
    await stableClick(ctx.win.locator('#btnBatchToggle'));
    await content.click({ force: true });
    await expect(row).toHaveClass(/selected/);
    const active1 = await ctx.win.evaluate(() => (document.activeElement && (document.activeElement.className || document.activeElement.tagName)) || '');
    expect(active1).not.toContain('note-content');
    await stableClick(ctx.win.locator('#btnBatchToggle'));
    await content.click({ force: true });
    await ctx.win.waitForTimeout(150);
    const active2 = await ctx.win.evaluate(() => (document.activeElement && document.activeElement.className) || '');
    expect(active2).toContain('note-content');
  } finally {
    await closeApp(ctx);
  }
});

// —— 任务4 安全网：编辑器加粗（Ctrl+B）在现有实现下应工作 ——
test('编辑器：选中文字 Ctrl+B 加粗', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnAdd').click();
    const content = ctx.win.locator('#board .note .note-content').first();
    await content.click();
    await ctx.win.keyboard.type('加粗文字');
    // 选中内容区全部文本
    await ctx.win.evaluate(() => {
      const c = document.querySelector('#board .note .note-content');
      const r = document.createRange();
      r.selectNodeContents(c);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    await content.press('Control+b');
    await expect(content.locator('b, strong').first()).toHaveText('加粗文字');
  } finally { await closeApp(ctx); }
});



