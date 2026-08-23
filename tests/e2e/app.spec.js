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
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
  }

  return { electronApp, win, userDataDir };
}

async function closeApp(ctx) {
  await ctx.electronApp.close().catch(() => {});
  await ctx.userDataDir && fs.rm(ctx.userDataDir, { recursive: true, force: true }).catch(() => {});
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








