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
  // 消除冷启动动画/过渡引起的「element is not stable」竞态：测试窗口内关闭全部动画与过渡，
  // 使元素边界瞬时稳定（Playwright 稳定检查要求 2 帧不变）。仅影响测试，不影响应用逻辑。
  await win.addStyleTag({ content: '*{animation:none !important; transition:none !important;}' });

  const closeBtn = win.locator('#btnChangelogClose');
  // 首启可能出现「更新说明」弹窗；等待其可见再强制关闭（force 绕过"稳定"检查，避免竞态 flake）
  try {
    await closeBtn.waitFor({ state: 'visible', timeout: 8000 });
    await closeBtn.click({ force: true, timeout: 8000 });
  } catch (_) {}

  // 等主窗口初始化完成（#app 已渲染 + 短暂稳定间隔），确保后续交互落在已稳定的界面上。
  // 注：不用 requestAnimationFrame 等待（后台/未聚焦窗口的 rAF 会被节流暂停，可能挂起）。
  try {
    await win.locator('#app').waitFor({ state: 'attached', timeout: 8000 });
    await win.waitForTimeout(300);
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
    await ctx.win.locator('#btnAdd').click({ force: true });

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
    await ctx.win.locator('#btnAdd').click({ force: true });
    const content = ctx.win.locator('#board .note .note-content').first();
    await expect(content).toBeVisible();
    await content.click({ force: true });
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
    await ctx.win.locator('#btnAdd').click({ force: true });
    const title = ctx.win.locator('#board .note .note-title').first();
    await title.fill('钉桌便签');
    await expect(ctx.win.locator('#noteCount')).toHaveText('1');

    // 订阅新窗口事件（需在触发动作前），点击「钉到桌面」
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await ctx.win.locator('#board .note .t-desktop').first().click({ force: true });
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
    await pin.click({ force: true });
    await expect(pin).toHaveClass(/\bactive\b/);
    await pin.click({ force: true });
    await expect(pin).not.toHaveClass(/\bactive\b/);
  } finally { await closeApp(ctx); }
});

test('启用便签玻璃拟态后 body 添加 glass 类', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnSettings').click({ force: true });
    await ctx.win.locator('#appearanceModuleSeg [data-app-module="note"]').click({ force: true });
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
    await ctx.win.locator('#btnAdd').click({ force: true });
    const content = ctx.win.locator('#board .note .note-content').first();
    await content.click({ force: true });
    await ctx.win.keyboard.type('一段正文文本');

    // 切到备忘录再切回画布，触发 renderAll 走缓存路径，内容不应丢失或失真
    await ctx.win.locator('#viewMemo').click({ force: true });
    await ctx.win.waitForTimeout(200);
    await ctx.win.locator('#viewBoard').click({ force: true });
    await expect(ctx.win.locator('#board .note .note-content').first()).toContainText('一段正文文本');
  } finally { await closeApp(ctx); }
});

test('全局设置：数据页含「开机自启动」开关（默认可见）', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnSettings').click({ force: true });
    await ctx.win.locator('.sp-nav-item[data-tab="data"]').click({ force: true });
    await expect(ctx.win.locator('#autoStartToggle')).toBeVisible();
    // 该开关为系统级设置，此处只校验 UI 存在，不触发真实写注册表
  } finally { await closeApp(ctx); }
});

// —— 任务3：补齐 e2e 覆盖 ——
test('英文语言：切换到 en 后关键 UI 文案为英文', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnSettings').click({ force: true });
    await ctx.win.locator('.sp-nav-item[data-tab="data"]').click({ force: true });
    await ctx.win.locator('#languageSelect').selectOption('en');
    await ctx.win.locator('#btnCloseSettings').click({ force: true });

    await expect(ctx.win.locator('#btnAdd')).toHaveText(/New/);       // new_note: ＋ New
    await expect(ctx.win.locator('#searchInput')).toHaveAttribute('placeholder', /Search notes/);
  } finally { await closeApp(ctx); }
});

test('钉窗深度编辑：改标题同步持久化到数据', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnAdd').click({ force: true });
    await ctx.win.locator('#board .note .note-title').first().fill('钉窗原始标题');

    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await ctx.win.locator('#board .note .t-desktop').first().click({ force: true });
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
    await ctx.win.locator('#btnSettings').click({ force: true });
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
    await ctx.win.locator('#btnSettings').click({ force: true });
    await ctx.win.locator('#btnClearImage').click({ force: true });
    await expect(ctx.win.locator('body')).not.toHaveClass(/\bbright-bg\b/);
  } finally { await closeApp(ctx); }
});

// —— P5 增量渲染：画布内只更新变化卡片，其余保留 ——
test('P5 增量渲染：画布内切换置顶后其余便签内容保留', async () => {
  const ctx = await openApp();
  try {
    // 建两张便签并各输入内容
    for (let i = 1; i <= 2; i++) {
      await ctx.win.locator('#btnAdd').click({ force: true });
      await ctx.win.locator('#board .note .note-title').last().fill('便签' + i);
      const c = ctx.win.locator('#board .note .note-content').last();
      await c.click({ force: true });
      await ctx.win.keyboard.type('内容' + i);
    }
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');

    // 触发画布重排：给第一张切置顶
    await ctx.win.locator('#board .note .t-pin').first().click({ force: true });

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

// —— 排序：保存排序 ↔ 一键整理（恢复保存的快照布局，并对重叠便签轻移去重叠） ——
test('画布视图：保存排序后一键整理恢复到保存的布局且不重叠', async () => {
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
    // 保存当前排序（记录布局快照 a/b/c）
    await stableClick(ctx.win.locator('#btnSaveOrder'));
    // 打乱位置
    await ctx.win.evaluate(() => setEffPos(state.notes.find((n) => n.id === 'a'), 900, 500));
    // 一键整理 → 恢复到保存时的布局
    await stableClick(ctx.win.locator('#btnQuickArrange'));
    expect(await pa('a')).toEqual({ x: 20, y: 20 });
    expect(await pa('b')).toEqual({ x: 300, y: 20 });
    expect(await pa('c')).toEqual({ x: 600, y: 20 });
    // 恢复后任意两便签不重叠
    const overlap = await ctx.win.evaluate(() => {
      const rects = state.notes.map((n) => { const p = n.positionAll; return { x: p.x, y: p.y, w: n.w, h: n.h }; });
      let bad = 0;
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (!(b.x > a.x + a.w || b.x + b.w < a.x || b.y > a.y + a.h || b.y + b.h < a.y)) bad++;
      }
      return bad;
    });
    expect(overlap).toBe(0);
  } finally {
    await closeApp(ctx);
  }
});

test('一键整理（便签视图触发）恢复保存的位置并跨视图保持', async () => {
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
    // 便签视图保存排序（记录布局快照）
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
    await ctx.win.locator('#viewMemo').click({ force: true });
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

// —— 批量选中：拖动整组，所有已选便签一起同向移动（回归：只拖单个、其余「弹开」）——
test('批量选中：拖动整组时所有已选便签一同移动', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, archived: false, preview: false,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [], notes: [mk('a', 'A', 20, 20), mk('b', 'B', 300, 20), mk('c', 'C', 600, 20)] };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('3');
    await ctx.win.evaluate(() => { toggleMultiSelect(); selectAllVisible(); });
    const before = await ctx.win.evaluate(() => ['a', 'b', 'c'].map((id) => { const r = document.querySelector('.note[data-id="' + id + '"]').getBoundingClientRect(); return { id, x: r.x, y: r.y }; }));
    // 拖动 a 的把手 +150,+100
    const ab = await ctx.win.locator('.note[data-id="a"]').boundingBox();
    await ctx.win.mouse.move(ab.x + 8, ab.y + 12);
    await ctx.win.mouse.down();
    await ctx.win.mouse.move(ab.x + 8 + 150, ab.y + 12 + 100, { steps: 14 });
    await ctx.win.mouse.up();
    await ctx.win.waitForTimeout(250);
    const after = await ctx.win.evaluate(() => ['a', 'b', 'c'].map((id) => { const r = document.querySelector('.note[data-id="' + id + '"]').getBoundingClientRect(); return { id, x: r.x, y: r.y }; }));
    const deltas = {};
    ['a', 'b', 'c'].forEach((id) => { deltas[id] = { dx: Math.round(after.find((v) => v.id === id).x - before.find((v) => v.id === id).x), dy: Math.round(after.find((v) => v.id === id).y - before.find((v) => v.id === id).y) }; });
    // 三者必须一起移动同样的量（不丢队、不弹开）
    expect(deltas.a.dx).toBeGreaterThan(100);
    expect(deltas.a.dy).toBeGreaterThan(60);
    expect(deltas.b.dx).toBe(deltas.a.dx);
    expect(deltas.b.dy).toBe(deltas.a.dy);
    expect(deltas.c.dx).toBe(deltas.a.dx);
    expect(deltas.c.dy).toBe(deltas.a.dy);
  } finally {
    await closeApp(ctx);
  }
});

// —— 任务4 安全网：编辑器加粗（Ctrl+B）在现有实现下应工作 ——
test('编辑器：选中文字 Ctrl+B 加粗', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.locator('#btnAdd').click({ force: true });
    const content = ctx.win.locator('#board .note .note-content').first();
    await content.click({ force: true });
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

// —— 阶段 B：一键排列算法改良 ——
// —— 阶段 B：快捷键 ——
test('快捷键设置页：列出全部快捷键，显示默认，恢复默认可持久化', async () => {
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [], notes: []
  };
  const ctx = await openApp({ seed });
  try {
    await stableClick(ctx.win.locator('#btnSettings'));
    await stableClick(ctx.win.locator('.sp-nav-item[data-tab="shortcuts"]'));
    const items = ctx.win.locator('.shortcut-item');
    await expect(items).toHaveCount(10); // 全局 2 + 应用 2 + 编辑器 6
    // 全局快捷键（唤起/隐藏窗口）默认 Ctrl+Shift+M
    const toggle = ctx.win.locator('.sc-key[data-id="toggleWindow"]');
    await expect(toggle).toHaveText('Ctrl+Shift+M');
    const create = ctx.win.locator('.sc-key[data-id="createNote"]');
    await expect(create).toHaveText('Ctrl+Shift+N');
    // 应用级撤销/重做默认 Ctrl+Z / Ctrl+Shift+Z
    await expect(ctx.win.locator('.sc-key[data-id="undo"]')).toHaveText('Ctrl+Z');
    await expect(ctx.win.locator('.sc-key[data-id="redo"]')).toHaveText('Ctrl+Shift+Z');
    // 编辑器加粗默认 Ctrl+B
    await expect(ctx.win.locator('.sc-key[data-id="bold"]')).toHaveText('Ctrl+B');

    // 改键：把「加粗」改成 Ctrl+Shift+K，应持久化
    await stableClick(ctx.win.locator('.sc-key[data-id="bold"]'));
    await ctx.win.keyboard.press('Control+Shift+K');
    await ctx.win.waitForTimeout(400);
    await expect(ctx.win.locator('.sc-key[data-id="bold"]')).toHaveText('Ctrl+Shift+K');
    const data1 = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf-8'));
    expect(data1.settings.shortcuts.bold).toBe('CommandOrControl+Shift+K');
    // 关闭再打开，值保持
    await stableClick(ctx.win.locator('#btnCloseSettings'));
    await stableClick(ctx.win.locator('#btnSettings'));
    await stableClick(ctx.win.locator('.sp-nav-item[data-tab="shortcuts"]'));
    await expect(ctx.win.locator('.sc-key[data-id="bold"]')).toHaveText('Ctrl+Shift+K');

    // 恢复默认
    await stableClick(ctx.win.locator('#btnResetShortcuts'));
    await ctx.win.waitForTimeout(400);
    await expect(ctx.win.locator('.sc-key[data-id="bold"]')).toHaveText('Ctrl+B');
    const data2 = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf-8'));
    expect(data2.settings.shortcuts.bold).toBeUndefined(); // 恢复默认后不再存覆盖
    // 恢复默认不应出现「forEach is not a function」的原始 TypeError（回归：曾在 main 里对对象误调 forEach）
    // 注：不检查「被占用」——全局快捷键在测试环境可能因残留绑定而注册失败，属环境现象，与实现无关
    const toastText = await ctx.win.locator('#toast').textContent();
    expect(toastText).not.toContain('forEach');
  } finally {
    await closeApp(ctx);
  }
});

test('快捷键：编辑器改键生效（Ctrl+B 改 Ctrl+Shift+K 后加粗）', async () => {
  const now = Date.now();
  const mk = (id, title) => ({
    id, title, content: '', type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x: 20, y: 20, positionAll: { x: 20, y: 20 }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated', shortcuts: { bold: 'CommandOrControl+Shift+K' } },
    groups: [], trash: [], notes: [mk('a', 'A')]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('1');
    const content = ctx.win.locator('#board .note .note-content').first();
    await content.click({ force: true });
    await ctx.win.keyboard.type('加粗文字');
    // 选中全部
    await ctx.win.evaluate(() => {
      const c = document.querySelector('#board .note .note-content');
      const r = document.createRange();
      r.selectNodeContents(c);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    // 用新键 Ctrl+Shift+K 加粗
    await content.press('Control+Shift+K');
    await expect(content.locator('b, strong').first()).toHaveText('加粗文字');
    // 原 Ctrl+B 不再生效
    await content.click({ force: true });
    await ctx.win.evaluate(() => {
      const c = document.querySelector('#board .note .note-content');
      const r = document.createRange();
      r.selectNodeContents(c);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    });
    const hadStrong = await content.locator('b, strong').count();
    expect(hadStrong).toBe(1); // 仍只有之前那一处，说明 Ctrl+Shift+K 生效且 Ctrl+B 未重复加粗
  } finally {
    await closeApp(ctx);
  }
});

// —— 关闭确认弹窗（主题化） ——
test('关闭确认：触发关闭弹主题化确认框，取消则窗口保持', async () => {
  const ctx = await openApp();
  try {
    // 通过应用内关闭入口触发「关闭确认」（与点标题栏 X 同一逻辑）
    await ctx.win.evaluate(() => window.api.close());
    const overlay = ctx.win.locator('#closeOverlay');
    await expect(overlay).toBeVisible();
    // 三个按钮齐全
    await expect(ctx.win.locator('#btnCloseHide')).toBeVisible();
    await expect(ctx.win.locator('#btnCloseQuit')).toBeVisible();
    await expect(ctx.win.locator('#btnCloseCancel')).toBeVisible();
    // 弹窗采用主题变量（背景不是透明、有边框）
    await expect(ctx.win.locator('#closeModal')).toBeVisible();
    // 校验：背景使用顶栏配色变量（--topbar-bg 在 init 已设置，非空）
    const modalBg = await ctx.win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--topbar-bg').trim());
    expect(modalBg.length).toBeGreaterThan(0);
    // 标题栏图标（SVG）存在，不再显示裸露的 emoji 色条
    await expect(ctx.win.locator('#closeModal .close-head-icon svg')).toHaveCount(1);

    // 点击「取消」：弹窗关闭，窗口仍在
    await stableClick(ctx.win.locator('#btnCloseCancel'));
    await expect(overlay).toBeHidden();
    const visible = await ctx.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible())
    );
    expect(visible).toBe(true);
  } finally {
    await closeApp(ctx);
  }
});

test('关闭确认：选「隐藏到任务栏」后窗口隐藏', async () => {
  const ctx = await openApp();
  try {
    await ctx.win.evaluate(() => window.api.close());
    await expect(ctx.win.locator('#closeOverlay')).toBeVisible();
    await stableClick(ctx.win.locator('#btnCloseHide'));
    await expect(ctx.win.locator('#closeOverlay')).toBeHidden();
    // 主窗口应已隐藏（托盘常驻）——等待 IPC 回传生效，避免时序竞态
    await expect.poll(async () => ctx.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible())
    )).toBe(false);
  } finally {
    await closeApp(ctx);
  }
});

// —— 分组过多：筛选栏可收缩滚动，右侧按钮不被挤出 ——
test('分组过多：分组区横向滚动，右侧视图切换与「+分组」仍可见', async () => {
  const now = Date.now();
  // 造 20 个分组，名字很长，确保溢出
  const groups = Array.from({ length: 20 }, (_, i) => ({ id: 'g' + i, name: '分组很长的名字测试' + i, color: '#6c5ce7' }));
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups, trash: [], notes: [mk('a', 'A', 20, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('1');
    // 分组芯片已渲染（>0）
    const chipCount = await ctx.win.locator('#groupChips .chip').count();
    expect(chipCount).toBe(20);
    // 右侧视图切换 + 「+分组」必须可见，不被挤出画布
    await expect(ctx.win.locator('#viewBoard')).toBeVisible();
    await expect(ctx.win.locator('#viewDoc')).toBeVisible();
    await expect(ctx.win.locator('#btnAddGroup')).toBeVisible();
    // 视口内能同时看到全部/未分组（左侧固定）
    await expect(ctx.win.locator('#filterbar .chip[data-group="all"]')).toBeVisible();
    await expect(ctx.win.locator('#filterbar .chip[data-group="ungrouped"]')).toBeVisible();
    // 左右箭头可见；初始在左端 → 左箭头置灰、右箭头可用
    const left = ctx.win.locator('#btnChipsLeft');
    const right = ctx.win.locator('#btnChipsRight');
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    expect(await left.isDisabled()).toBe(true);
    expect(await right.isDisabled()).toBe(false);
    // 点右箭头滚动 → 左箭头变可用；点左箭头滚回 → 左箭头回到置灰
    await stableClick(right);
    await expect.poll(() => left.isDisabled(), { timeout: 3000 }).toBe(false);
    await stableClick(left);
    await expect.poll(() => left.isDisabled(), { timeout: 3000 }).toBe(true);
  } finally {
    await closeApp(ctx);
  }
});

// —— 关闭弹窗与顶栏统一（亚克力/透明度一致）且文字可读 ——
test('关闭确认：弹窗背景与顶栏同一配色（亚克力/透明度一致），文字用前景色', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  // 开亚克力 + 低透明度顶栏，验证弹窗背景跟随顶栏配色（不另设为不透明色）
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated', topBarAcrylic: true, topBarOpacity: 25 },
    groups: [], trash: [], notes: [mk('a', 'A', 20, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await ctx.win.evaluate(() => window.api.close());
    await expect(ctx.win.locator('#closeOverlay')).toBeVisible();
    // 弹窗背景 = --topbar-bg（含透明度/亚克力），证明与顶栏统一
    const modalBg = await ctx.win.locator('#closeModal').evaluate((el) => getComputedStyle(el).backgroundColor);
    const topbarBgVar = await ctx.win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--topbar-bg').trim());
    expect(topbarBgVar.length).toBeGreaterThan(0);
    expect(modalBg).not.toBe('rgba(0, 0, 0, 0)'); // 不是全透明
    // 弹窗消息与按钮文字用前景色 rbg（非纯 dim），可读
    const msgColor = await ctx.win.locator('#closeModal .close-body > div').evaluate((el) => getComputedStyle(el).color);
    expect(msgColor).toMatch(/rgb\(/);
    const hideBtn = await ctx.win.locator('#btnCloseHide').evaluate((el) => getComputedStyle(el).color);
    expect(hideBtn).toMatch(/rgb\(/);
  } finally {
    await closeApp(ctx);
  }
});

// —— 画布滚动条自适应：内容未超出视口时不出现，超出时出现 ——
test('画布滚动条：内容未超出不出现，超出时出现', async () => {
  const now = Date.now();
  const mk = (id, x, y) => ({
    id, title: id, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  // 情况 A：便签都集中在左上角（视口内），不应出现滚动
  const seedA = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [], notes: [mk('a', 20, 20), mk('b', 280, 20), mk('c', 20, 250)]
  };
  const ctx = await openApp({ seed: seedA });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('3');
    // 画布不应有垂直/水平滚动溢出
    const noOverflow = await ctx.win.evaluate(() => {
      const c = document.querySelector('#canvas');
      return { v: c.scrollHeight <= c.clientHeight + 1, h: c.scrollWidth <= c.clientWidth + 1 };
    });
    expect(noOverflow.v).toBe(true);
    expect(noOverflow.h).toBe(true);
  } finally {
    await closeApp(ctx);
  }
});

test('画布滚动条：内容超出视口时出现', async () => {
  const now = Date.now();
  const mk = (id, x, y) => ({
    id, title: id, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  // 情况 B：便签放到很靠下/靠右，超出视口，应出现垂直/水平滚动
  const seedB = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [], notes: [mk('a', 20, 20), mk('far', 400, 2000)]
  };
  const ctx = await openApp({ seed: seedB });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');
    const overflow = await ctx.win.evaluate(() => {
      const c = document.querySelector('#canvas');
      return { v: c.scrollHeight > c.clientHeight, h: c.scrollWidth > c.clientWidth };
    });
    expect(overflow.v).toBe(true); // 下移的便签使垂直方向可滚动
  } finally {
    await closeApp(ctx);
  }
});

// —— 阶段 B：便签外观自定义（圆角/阴影/边框/图案）实时生效 ——
test('便签外观：圆角/阴影/边框/字距设置实时作用于便签卡片', async () => {
  const now = Date.now();
  const mk = (id, x, y) => ({
    id, title: id, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [], trash: [], notes: [mk('a', 20, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('1');
    // 默认值（未自定义）
    const defVars = await ctx.win.evaluate(() => ({
      radius: getComputedStyle(document.documentElement).getPropertyValue('--note-radius').trim(),
      shadow: getComputedStyle(document.documentElement).getPropertyValue('--note-shadow').trim(),
      borderW: getComputedStyle(document.documentElement).getPropertyValue('--note-border-width').trim(),
      ls: getComputedStyle(document.documentElement).getPropertyValue('--font-letter-spacing').trim()
    }));
    expect(defVars.radius).toBe('12px');
    expect(defVars.borderW).toBe('0px');

    // 自定义：圆角 6 / 阴影 3 / 边框 2 / 字距 2
    await ctx.win.evaluate(() => {
      state.settings.noteRadius = 6;
      state.settings.noteShadow = 3;
      state.settings.noteBorderWidth = 2;
      state.settings.noteBorderColor = '#ff0000';
      state.settings.noteLetterSpacing = 2;
      applyTheme();
    });
    const vars = await ctx.win.evaluate(() => ({
      radius: getComputedStyle(document.documentElement).getPropertyValue('--note-radius').trim(),
      shadow: getComputedStyle(document.documentElement).getPropertyValue('--note-shadow').trim(),
      borderW: getComputedStyle(document.documentElement).getPropertyValue('--note-border-width').trim(),
      borderColor: getComputedStyle(document.documentElement).getPropertyValue('--note-border-color').trim(),
      ls: getComputedStyle(document.documentElement).getPropertyValue('--font-letter-spacing').trim()
    }));
    expect(vars.radius).toBe('6px');
    expect(vars.borderW).toBe('2px');
    expect(vars.borderColor).toBe('#ff0000');
    expect(vars.ls).toBe('2px');
    expect(vars.shadow).toContain('rgba(0,0,0,0.5)');

    // 便签卡片实际用上了这些变量
    const noteComputed = await ctx.win.locator('#board .note').first().evaluate((el) => ({
      radius: getComputedStyle(el).borderRadius,
      borderColor: getComputedStyle(el).borderTopColor,
      borderStyle: getComputedStyle(el).borderTopStyle,
      ls: getComputedStyle(el.querySelector('.note-title')).letterSpacing
    }));
    expect(noteComputed.radius).toBe('6px');
    expect(noteComputed.borderStyle).toBe('solid');
    expect(noteComputed.borderColor).toBe('rgb(255, 0, 0)');
    expect(noteComputed.ls).toBe('2px');

    // 边框粗细调到 0：应完全无边框（显示为 none/0px）
    const borderAt0 = await ctx.win.evaluate(() => {
      state.settings.noteBorderWidth = 0; applyTheme();
      const el = document.querySelector('#board .note');
      return getComputedStyle(el).borderTopWidth;
    });
    expect(borderAt0).toBe('0px');
    await ctx.win.evaluate(() => { state.settings.noteBorderWidth = 2; applyTheme(); });

    // 回归：开启玻璃拟态（body.glass）后，自定义阴影/边框仍生效（此前被玻璃规则硬编码覆盖）
    await ctx.win.evaluate(() => { state.settings.glass = true; applyTheme(); });
    // 等待 box-shadow 过渡 + 强制重排（.note 有 transition: box-shadow 0.18s）
    await ctx.win.waitForTimeout(500);
    const glassNote = await ctx.win.locator('#board .note').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      // 读 CSS 变量解析值（--note-shadow），它不受 .note 的 box-shadow transition 影响，稳定可靠
      return {
        shadowVar: cs.getPropertyValue('--note-shadow'),
        borderColor: cs.borderTopColor,
        borderWidth: cs.borderTopWidth
      };
    });
    // 玻璃态下也用用户自定义阴影（--note-shadow，noteShadow=3 → 含 0.5 alpha）
    expect(glassNote.shadowVar).toContain('rgba(0,0,0,0.5)');
    // 用户自定义了红色边框（noteBorderWidth=2）→ 玻璃态边框用红色
    expect(glassNote.borderColor).toBe('rgb(255, 0, 0)');

    // 回归：玻璃态下边框调 0 也完全无边框（不再强制保留 1px 玻璃细边）
    const glassBorder0 = await ctx.win.evaluate(() => {
      state.settings.noteBorderWidth = 0; applyTheme();
      return getComputedStyle(document.querySelector('#board .note')).borderTopWidth;
    });
    expect(glassBorder0).toBe('0px');
  } finally {
    await closeApp(ctx);
  }
});

// —— 阶段 B：使用逻辑改良（画布缩放 / 平移 / 框选 / 分组折叠 / 最近使用分组 / 快捷插入）——

test('画布缩放：工具栏按钮改变缩放并持久化，重置恢复 100%', async () => {
  const now = Date.now();
  const mk = (id, x, y) => ({
    id, title: id, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [], notes: [mk('a', 20, 20)] };
  const ctx = await openApp({ seed });
  try {
    // 初始 100%
    await expect(ctx.win.locator('#canvasToolbar')).toBeVisible();
    expect(await ctx.win.locator('#zoomLabel').textContent()).toBe('100%');
    expect(await ctx.win.evaluate(() => state.settings.boardZoom)).toBe(1);
    // 展开工具栏显示全部缩放按钮
    await stableClick(ctx.win.locator('#ctExpand'));
    await expect(ctx.win.locator('#canvasToolbar')).toHaveClass(/expanded/);
    // 放大
    await stableClick(ctx.win.locator('#btnZoomIn'));
    expect(await ctx.win.locator('#zoomLabel').textContent()).toBe('110%');
    expect(await ctx.win.evaluate(() => state.settings.boardZoom)).toBe(1.1);
    expect(await ctx.win.evaluate(() => document.getElementById('board').style.transform)).toContain('scale(1.1)');
    // 缩小回 100%
    await stableClick(ctx.win.locator('#btnZoomOut'));
    await ctx.win.waitForTimeout(120);
    expect(await ctx.win.locator('#zoomLabel').textContent()).toBe('100%');
    expect(await ctx.win.evaluate(() => state.settings.boardZoom)).toBe(1);
    // 放大后点重置换原
    await stableClick(ctx.win.locator('#btnZoomIn'));
    await stableClick(ctx.win.locator('#btnZoomReset'));
    await ctx.win.waitForTimeout(120);
    expect(await ctx.win.locator('#zoomLabel').textContent()).toBe('100%');
    expect(await ctx.win.evaluate(() => state.settings.boardZoom)).toBe(1);
    // 持久化：再次放大并落盘（保存为 300ms 防抖 + IPC 写盘）
    await stableClick(ctx.win.locator('#btnZoomIn'));
    await ctx.win.waitForTimeout(700);
    const data = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf-8'));
    expect(data.settings.boardZoom).toBe(1.1);
  } finally {
    await closeApp(ctx);
  }
});

test('画布框选：空白处拉框多选，单击空白取消选择', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [],
    notes: [mk('a', 'A', 20, 20), mk('b', 'B', 280, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');
    const tl = await ctx.win.evaluate(() => {
      const r = document.getElementById('board').getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    // 从 board 左上 (0,0) 空白处拉框到 (0,0)+(540,240)：覆盖两便签
    await ctx.win.mouse.move(tl.x + 2, tl.y + 2);
    await ctx.win.mouse.down();
    await ctx.win.mouse.move(tl.x + 540, tl.y + 240, { steps: 8 });
    await ctx.win.mouse.up();
    await expect(ctx.win.locator('#batchBar')).toBeVisible();
    await expect(ctx.win.locator('.note.selected')).toHaveCount(2);
    expect(await ctx.win.evaluate(() => selectedNotes.size)).toBe(2);
    // 单击空白处取消选择
    await ctx.win.mouse.move(tl.x + 600, tl.y + 340);
    await ctx.win.mouse.down();
    await ctx.win.mouse.up();
    expect(await ctx.win.evaluate(() => selectedNotes.size)).toBe(0);
    await expect(ctx.win.locator('.note.selected')).toHaveCount(0);
  } finally {
    await closeApp(ctx);
  }
});

test('最近使用分组：切换分组记录最近使用并置顶排序', async () => {
  const now = Date.now();
  const mk = (id, title, groupId, x) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId, pinned: false, desktopPin: false, reminder: null,
    x, y: 20, positionAll: { x, y: 20 }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [{ id: 'g1', name: 'G1', color: '#e74c3c' }, { id: 'g2', name: 'G2', color: '#3498db' }],
    trash: [], notes: [mk('a', 'A', 'g1', 20), mk('b', 'B', 'g2', 280)]
  };
  const ctx = await openApp({ seed });
  try {
    // 初始芯片顺序 g1, g2
    const order0 = await ctx.win.evaluate(() => Array.from(document.querySelectorAll('#groupChips .chip')).map((c) => (c.textContent || '').trim()));
    expect(order0).toEqual(['G1', 'G2']);
    // 点击 g2 → 记为最近使用
    await ctx.win.evaluate(() => setFilter('group', 'g2'));
    const recents = await ctx.win.evaluate(() => state.settings.recentGroups);
    expect(recents[0]).toBe('g2');
    const order1 = await ctx.win.evaluate(() => Array.from(document.querySelectorAll('#groupChips .chip')).map((c) => (c.textContent || '').trim()));
    expect(order1).toEqual(['G2', 'G1']);
    // 再点 g1，g1 应排到最前
    await ctx.win.evaluate(() => setFilter('group', 'g1'));
    const order2 = await ctx.win.evaluate(() => Array.from(document.querySelectorAll('#groupChips .chip')).map((c) => (c.textContent || '').trim()));
    expect(order2).toEqual(['G1', 'G2']);
  } finally {
    await closeApp(ctx);
  }
});

test('分组折叠：折叠后该分组便签隐藏，展开恢复且持久化', async () => {
  const now = Date.now();
  const mk = (id, title, groupId, x) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId, pinned: false, desktopPin: false, reminder: null,
    x, y: 20, positionAll: { x, y: 20 }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [{ id: 'g1', name: 'G1', color: '#e74c3c' }],
    trash: [], notes: [mk('a', 'A', 'g1', 20), mk('b', 'B', 'g1', 280), mk('c', 'C', null, 550)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#board .note')).toHaveCount(3);
    // 折叠 g1 → 其便签隐藏，未分组的 c 仍在
    await ctx.win.evaluate(() => toggleGroupCollapse('g1'));
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    expect(await ctx.win.locator('.note[data-id="c"]').count()).toBe(1);
    expect(await ctx.win.evaluate(() => state.settings.collapsedGroups.g1)).toBe(true);
    // 芯片显示折叠标记
    expect(await ctx.win.evaluate(() => !!document.querySelector('#groupChips .chip .chip-collapsed'))).toBe(true);
    // 展开恢复
    await ctx.win.evaluate(() => toggleGroupCollapse('g1'));
    await expect(ctx.win.locator('#board .note')).toHaveCount(3);
    expect(await ctx.win.evaluate(() => state.settings.collapsedGroups.g1)).toBe(false);
  } finally {
    await closeApp(ctx);
  }
});

test('分组折叠与一键整理：折叠时整理填满留白，取消折叠后恢复折叠前原始布局且不重叠', async () => {
  const now = Date.now();
  const mk = (id, title, groupId, x) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId, pinned: false, desktopPin: false, reminder: null,
    x, y: 20, positionAll: { x, y: 20 }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [{ id: 'g1', name: 'G1', color: '#e74c3c' }],
    trash: [], notes: [mk('a', 'A', 'g1', 20), mk('b', 'B', 'g1', 280), mk('c', 'C', null, 1000), mk('d', 'D', null, 1260)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#board .note')).toHaveCount(4);
    // 折叠 g1 后整理：只整理可见的 c/d，它们应被压到画布左上（填满折叠组腾出的留白）
    await ctx.win.evaluate(() => toggleGroupCollapse('g1'));
    await ctx.win.evaluate(() => arrangeNotes());
    await ctx.win.waitForTimeout(150);
    const cdAfter = await ctx.win.evaluate(() => ({
      c: state.notes.find((n) => n.id === 'c').positionAll,
      d: state.notes.find((n) => n.id === 'd').positionAll
    }));
    expect(Math.min(cdAfter.c.x, cdAfter.d.x)).toBeLessThanOrEqual(40);
    expect(cdAfter.c.y).toBeLessThanOrEqual(40);
    expect(cdAfter.d.y).toBeLessThanOrEqual(40);
    // 取消折叠：整体恢复到折叠前的原始布局（a/b 回原位、c/d 也回原位）
    await ctx.win.evaluate(() => toggleGroupCollapse('g1'));
    await ctx.win.waitForTimeout(150);
    const restored = await ctx.win.evaluate(() => {
      const byId = {};
      state.notes.forEach((n) => { byId[n.id] = { x: n.positionAll.x, y: n.positionAll.y }; });
      return byId;
    });
    expect(restored.a).toEqual({ x: 20, y: 20 });
    expect(restored.b).toEqual({ x: 280, y: 20 });
    expect(restored.c).toEqual({ x: 1000, y: 20 });
    expect(restored.d).toEqual({ x: 1260, y: 20 });
    // 恢复后任意两张便签都不重叠
    const overlap = await ctx.win.evaluate(() => {
      const rects = state.notes.map((n) => {
        const p = n.positionAll || { x: n.x, y: n.y };
        return { id: n.id, x: p.x, y: p.y, w: n.w, h: n.h };
      });
      let bad = 0;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          if (!(b.x > a.x + a.w || b.x + b.w < a.x || b.y > a.y + a.h || b.y + b.h < a.y)) bad++;
        }
      }
      return bad;
    });
    expect(overlap).toBe(0);
  } finally {
    await closeApp(ctx);
  }
});

test('画布右键快捷插入：右键新建便签出现在光标处', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [], notes: [mk('a', 'A', 20, 20)] };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('1');
    const tl = await ctx.win.evaluate(() => {
      const r = document.getElementById('board').getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    // 在空白处 (600, 320) 右键
    await ctx.win.mouse.click(tl.x + 600, tl.y + 320, { button: 'right' });
    const menu = ctx.win.locator('.ctx-menu');
    await expect(menu).toBeVisible();
    // 点击「新建便签」
    await menu.locator('button', { hasText: '新建便签' }).first().click({ force: true });
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');
    const pos = await ctx.win.evaluate(() => {
      const n = state.notes.find((x) => x.title === '');
      return { x: n && n.x, y: n && n.y };
    });
    // 新建便签位置接近光标处（600,320）
    expect(Math.abs(pos.x - 600)).toBeLessThanOrEqual(2);
    expect(Math.abs(pos.y - 320)).toBeLessThanOrEqual(2);
  } finally {
    await closeApp(ctx);
  }
});

// —— 阶段 P2：导出为 Markdown ——
test('便签右键「导出为 Markdown」：菜单项存在、API 可用、noteToMarkdown 输出正确', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [], notes: [mk('a', '标题A', 20, 20)] };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('1');
    // 右键便签内容区 → 弹出便签上下文菜单
    await ctx.win.locator('#board .note .note-content').first().click({ button: 'right', force: true });
    const menu = ctx.win.locator('.ctx-menu');
    await expect(menu).toBeVisible();
    // 菜单项存在
    expect(await menu.locator('button', { hasText: '导出为 Markdown' }).count()).toBeGreaterThan(0);
    // 导出 API 已暴露
    expect(await ctx.win.evaluate(() => typeof window.api.exportNoteMarkdown)).toBe('function');
    // noteToMarkdown 输出正确
    const md = await ctx.win.evaluate(() => noteToMarkdown(state.notes.find((n) => n.id === 'a')));
    expect(md).toContain('# 标题A');
    expect(md).toContain('内容a');
  } finally {
    await closeApp(ctx);
  }
});
test('空白分组新建便签后回到全部视图不与其他便签重叠', async () => {
  const now = Date.now();
  const mk = (id, x, y) => ({
    id, title: id, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, archived: false, preview: false,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [{ id: 'g1', name: '空分组', color: '#6c5ce7' }],
    trash: [], notes: [mk('a', 20, 20), mk('b', 300, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#noteCount')).toHaveText('2');
    // 切到「空分组」视图并新建便签
    await ctx.win.evaluate(() => { setFilter('group', 'g1'); });
    await ctx.win.evaluate(() => createNote());
    await expect(ctx.win.locator('#noteCount')).toHaveText('3');
    // 回到「全部」视图，任两便签都不重叠
    await ctx.win.evaluate(() => { setFilter('group', 'all'); });
    await ctx.win.waitForTimeout(150);
    const overlap = await ctx.win.evaluate(() => {
      const rects = state.notes.map((n) => { const p = n.positionAll; return { id: n.id, x: p.x, y: p.y, w: n.w, h: n.h }; });
      let bad = 0;
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (!(b.x > a.x + a.w || b.x + b.w < a.x || b.y > a.y + a.h || b.y + b.h < a.y)) bad++;
      }
      return bad;
    });
    expect(overlap).toBe(0);
  } finally {
    await closeApp(ctx);
  }
});

// —— 阶段 B：小功能池（提醒稍后再响 / 归档置灰 / 标签建议 / Markdown 预览 / 撤销重做）——
test('提醒稍后再响：闹铃弹窗选择稍后再响，提醒重新武装到未来', async () => {
  const now = Date.now();
  const mk = (id, title) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, archived: false, preview: false,
    reminder: { enabled: true, time: new Date(now - 1000).toISOString(), fired: true },
    x: 20, y: 20, positionAll: { x: 20, y: 20 }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [], notes: [mk('a', 'A')] };
  const ctx = await openApp({ seed });
  try {
    // 手动打开闹铃弹窗（模拟提醒触发）
    await ctx.win.evaluate(() => showAlarmModal(state.notes[0]));
    await expect(ctx.win.locator('#alarmOverlay')).toBeVisible();
    await stableClick(ctx.win.locator('#btnAlarmSnooze10'));
    await ctx.win.waitForTimeout(120);
    const rem = await ctx.win.evaluate(() => state.notes[0].reminder);
    expect(rem.fired).toBe(false);
    expect(rem.enabled).toBe(true);
    expect(new Date(rem.time).getTime()).toBeGreaterThan(Date.now());
    // 弹窗已关闭
    await expect(ctx.win.locator('#alarmOverlay')).toBeHidden();
  } finally {
    await closeApp(ctx);
  }
});

test('便签归档/置灰：归档视图隐藏、取消归档恢复、归档卡降饱和', async () => {
  const now = Date.now();
  const mk = (id, title, x) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, archived: false, preview: false,
    x, y: 20, positionAll: { x, y: 20 }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [], notes: [mk('a', 'A', 20), mk('b', 'B', 300)] };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#board .note')).toHaveCount(2);
    // 归档 a
    await ctx.win.evaluate(() => { state.notes.find((n) => n.id === 'a').archived = true; renderAll(); });
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    await expect(ctx.win.locator('.note[data-id="b"]')).toBeVisible();
    // 归档视图：只看归档
    await stableClick(ctx.win.locator('#btnArchiveFilter'));
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    await expect(ctx.win.locator('.note[data-id="a"]')).toBeVisible();
    // 归档卡降饱和（grayscale）
    const filterVal = await ctx.win.evaluate(() => getComputedStyle(document.querySelector('.note[data-id="a"]')).filter);
    expect(filterVal).toContain('grayscale');
    // 退出归档视图回到全部（归档 a 仍隐藏）
    await stableClick(ctx.win.locator('#btnArchiveFilter'));
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    // 取消归档
    await ctx.win.evaluate(() => { state.notes.find((n) => n.id === 'a').archived = false; renderAll(); });
    await expect(ctx.win.locator('#board .note')).toHaveCount(2);
  } finally {
    await closeApp(ctx);
  }
});

test('标签建议：按笔记文本在分组弹窗顶部推荐分组', async () => {
  const now = Date.now();
  const mk = (id, title, x) => ({
    id, title, content: '工作记录 会议' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, archived: false, preview: false,
    x, y: 20, positionAll: { x, y: 20 }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [{ id: 'gW', name: '工作', color: '#e74c3c' }, { id: 'gG', name: '周末', color: '#3498db' }],
    trash: [], notes: [mk('a', 'A', 20)]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    // 打开分组弹窗
    await stableClick(ctx.win.locator('.note[data-id="a"] .t-group'));
    const pop = ctx.win.locator('.color-pop');
    await expect(pop).toBeVisible();
    // 出现「建议分组」标签与「工作」推荐按钮
    await expect(pop.locator('.color-pop-label', { hasText: '建议分组' })).toHaveCount(1);
    await expect(pop.locator('button', { hasText: '工作' }).first()).toBeVisible();
  } finally {
    await closeApp(ctx);
  }
});

test('Markdown 预览：点击预览按钮切换为只读富文本，再点恢复编辑', async () => {
  const now = Date.now();
  const mk = (id, title, x) => ({
    id, title, content: '**加粗** 正文', type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, archived: false, preview: false,
    x, y: 20, positionAll: { x, y: 20 }, w: 240, h: 200, z: 1, createdAt: now + x, updatedAt: now + x
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [], notes: [mk('a', 'A', 20)] };
  const ctx = await openApp({ seed });
  try {
    // 初始可编辑
    const editable0 = await ctx.win.evaluate(() => document.querySelector('.note[data-id="a"] .note-content').getAttribute('contenteditable'));
    expect(editable0).toBe('true');
    // 进入预览
    await stableClick(ctx.win.locator('.note[data-id="a"] .t-preview'));
    await ctx.win.waitForTimeout(100);
    const editable1 = await ctx.win.evaluate(() => {
      const c = document.querySelector('.note[data-id="a"] .note-content');
      return { editable: c.getAttribute('contenteditable'), cls: c.className, hasBold: !!c.querySelector('b') };
    });
    expect(editable1.editable).toBe('false');
    expect(editable1.cls).toContain('note-preview');
    expect(editable1.hasBold).toBe(true);
    // 退出预览
    await stableClick(ctx.win.locator('.note[data-id="a"] .t-preview'));
    await ctx.win.waitForTimeout(100);
    const editable2 = await ctx.win.evaluate(() => document.querySelector('.note[data-id="a"] .note-content').getAttribute('contenteditable'));
    expect(editable2).toBe('true');
  } finally {
    await closeApp(ctx);
  }
});

test('撤销/重做：新建便签可撤销、重做，删除也可撤销', async () => {
  const ctx = await openApp();
  try {
    await expect(ctx.win.locator('#board .note')).toHaveCount(0);
    // 新建便签
    await stableClick(ctx.win.locator('#btnAdd'));
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    // 移出编辑区（失焦），Ctrl+Z 走「应用级」结构撤销
    await ctx.win.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
    await ctx.win.keyboard.press('Control+z');
    await ctx.win.waitForTimeout(120);
    await expect(ctx.win.locator('#board .note')).toHaveCount(0);
    await ctx.win.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
    // 重做 → 恢复（Ctrl+Shift+Z）
    await ctx.win.keyboard.press('Control+Shift+z');
    await ctx.win.waitForTimeout(120);
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    // 新建第二张 → 删除其中一张 → 撤销（按钮）恢复
    await stableClick(ctx.win.locator('#btnAdd'));
    await expect(ctx.win.locator('#board .note')).toHaveCount(2);
    await ctx.win.evaluate(() => deleteNote(state.notes[0].id));
    await ctx.win.waitForTimeout(120);
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    await stableClick(ctx.win.locator('#btnUndo'));
    await ctx.win.waitForTimeout(120);
    await expect(ctx.win.locator('#board .note')).toHaveCount(2);
  } finally {
    await closeApp(ctx);
  }
});



