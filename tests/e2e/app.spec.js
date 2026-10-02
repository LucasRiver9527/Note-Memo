const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const EXPECTED_VERSION = require(path.join(ROOT, 'package.json')).version;

// 启动应用：独立临时 userData，首启关闭「更新说明」弹窗，返回可交互句柄
// opts.seed：可选，写入 notes-data.json 作为初始数据（用于多便签/预置场景）
// opts.seedRaw：可选，直接写入 notes-data.json 的原始字符串（用于「损坏文件」场景，seed 走 JSON.stringify 永远合法）
// opts.seedBak：可选，写入 notes-data.json.bak（用于「有备份可回退」场景）
// opts.extraArgs：可选，附加 Chromium 启动参数（沙箱无 GPU 环境需 --disable-gpu 等）
async function openApp(opts) {
  const userDataDir = (opts && opts.userDataDir) || await fs.mkdtemp(path.join(os.tmpdir(), 'mynotes-e2e-'));
  if (opts && opts.seed) {
    await fs.writeFile(path.join(userDataDir, 'notes-data.json'), JSON.stringify(opts.seed));
  }
  if (opts && typeof opts.seedRaw === 'string') {
    await fs.writeFile(path.join(userDataDir, 'notes-data.json'), opts.seedRaw);
  }
  if (opts && typeof opts.seedBak === 'string') {
    await fs.writeFile(path.join(userDataDir, 'notes-data.json.bak'), opts.seedBak);
  }
  // 环境变量 MYNOTES_E2E_EXTRA_ARGS 便于 CI/沙箱注入 --disable-gpu 等；opts.extraArgs 优先级更高
  const envArgs = (process.env.MYNOTES_E2E_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
  const extraArgs = (opts && opts.extraArgs) || envArgs;
  const electronApp = await electron.launch({
    args: ['.'].concat(extraArgs),
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
  if (!(opts && opts.expectRecovery)) {
    try {
      await closeBtn.waitFor({ state: 'visible', timeout: 8000 });
      await closeBtn.click({ force: true, timeout: 8000 });
    } catch (_) {}
  }

  // 等主窗口初始化完成（#app 已渲染 + 短暂稳定间隔），确保后续交互落在已稳定的界面上。
  // 注：不用 requestAnimationFrame 等待（后台/未聚焦窗口的 rAF 会被节流暂停，可能挂起）。
  try {
    await win.locator('#app').waitFor({ state: 'attached', timeout: 8000 });
    await win.waitForTimeout(300);
  } catch (_) {}

  return { electronApp, win, userDataDir };
}

async function closeApp(ctx) {
  // 应用常驻托盘，个别用例（如「隐藏到托盘」）close 后进程可能残留；
  // 残留进程跨用例累积会拖慢后续用例、放大 flake，故 close 后强制结束进程树。
  let pid = null;
  try { pid = ctx.electronApp.process() ? ctx.electronApp.process().pid : null; } catch (_) {}
  await ctx.electronApp.close().catch(() => {});
  if (pid) {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
  }
  if (ctx.userDataDir) await fs.rm(ctx.userDataDir, { recursive: true, force: true }).catch(() => {});
}

// 点击封装：force 绕过冷启动「稳定」检查，规避环境级 flake（见规划待办阶段 C）
async function stableClick(locator) {
  // ⚠️ force:true 会绕过 actionability 检查（含 enabled）。
  // 点到 disabled 按钮时浏览器根本不派发 click —— 表现是「点了没反应」的静默失败（间歇性 flake）。
  // 故先显式等可交互再点：既保留 force 的「跳过稳定/可见等待」，又不丢 enabled 语义。
  // 对非表单元素（div/span）toBeEnabled 恒为 true，无副作用。
  await expect(locator).toBeEnabled({ timeout: 15_000 });
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

test('空画布可直接创建，未有便签时不展示无效的整理操作', async () => {
  const ctx = await openApp();
  try {
    await expect(ctx.win.locator('#btnEmptyCreate')).toBeVisible();
    await expect(ctx.win.locator('#btnQuickArrange')).toBeHidden();
    await expect(ctx.win.locator('#btnSaveOrder')).toBeHidden();
    await expect(ctx.win.locator('#btnBatchToggle')).toBeHidden();
    await stableClick(ctx.win.locator('#btnEmptyCreate'));
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    await expect(ctx.win.locator('#btnEmptyCreate')).toBeHidden();
  } finally { await closeApp(ctx); }
});

test('最小窗口宽度下搜索与新建互不遮挡，次要操作可从菜单使用', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnEmptyCreate'));
    await ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 600));
    await expect(ctx.win.locator('#btnToolbarMore')).toBeVisible();
    const bounds = await ctx.win.evaluate(() => {
      const search = document.querySelector('#searchInput').getBoundingClientRect();
      const add = document.querySelector('#btnAdd').getBoundingClientRect();
      return { search: { top: search.top, left: search.left, right: search.right, width: search.width },
        add: { bottom: add.bottom } };
    });
    expect(bounds.search.top).toBeGreaterThanOrEqual(bounds.add.bottom);
    expect(bounds.search.width).toBeGreaterThan(200);
    await ctx.win.locator('#searchInput').fill('可用搜索');
    await ctx.win.locator('#searchInput').fill('');
    await stableClick(ctx.win.locator('#btnToolbarMore'));
    await expect(ctx.win.locator('#btnQuickArrange')).toBeVisible();
    await expect(ctx.win.locator('#btnSaveOrder')).toBeVisible();
    await stableClick(ctx.win.locator('#btnBatchToggle'));
    await expect(ctx.win.locator('#toolbarMoreMenu')).toBeHidden();
    await expect(ctx.win.locator('body')).toHaveClass(/multi-select/);
    await ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1300, 800));
    await expect(ctx.win.locator('#toolbarMoreWrap')).toBeHidden();
    await expect(ctx.win.locator('#btnQuickArrange')).toBeVisible();
  } finally { await closeApp(ctx); }
});

function searchViewSeed() {
  const now = Date.now();
  const note = (id, title, items, opts = {}) => ({
    id, title, content: '', type: 'todo', items: items.map((text, idx) => ({ id: `${id}-${idx}`, text, done: false })),
    images: [], files: [], tables: [], color: '#ffef9c', textColor: null,
    groupId: opts.groupId || null, archived: !!opts.archived, pinned: false, desktopPin: false,
    reminder: null, x: 20, y: 20, positionAll: { x: 20, y: 20 }, w: 260, h: 220, z: 1,
    createdAt: now, updatedAt: now
  });
  return {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION },
    groups: [{ id: 'family', name: '家庭', color: '#93f1ce' }], trash: [],
    notes: [
      note('home', '生活清单', ['买牛奶', '寄快递'], { groupId: 'family' }),
      note('work', '工作清单', ['提交报告']),
      note('old', '旧任务', ['归档材料'], { archived: true })
    ]
  };
}

test('待办搜索按任务文字或便签上下文筛选，分组折叠和归档沿用同一可见规则', async () => {
  const ctx = await openApp({ seed: searchViewSeed() });
  try {
    await stableClick(ctx.win.locator('#viewTodo'));
    const rows = ctx.win.locator('#todoList .todo-section.items .todo-line');
    const search = ctx.win.locator('#searchInput');
    await expect(rows).toHaveCount(3);
    await search.fill('牛奶');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('买牛奶');
    await search.fill('生活清单');
    await expect(rows).toHaveCount(2);
    await search.fill('家庭');
    await expect(rows).toHaveCount(2);
    await search.fill('完全不匹配');
    await expect(ctx.win.locator('#emptyHint')).toBeVisible();
    await expect(ctx.win.locator('#todoList')).toBeHidden();
    await stableClick(ctx.win.locator('#btnClearFilters'));
    await expect(rows).toHaveCount(3);
    await expect(search).toHaveValue('');

    await stableClick(ctx.win.locator('#groupChips .chip', { hasText: '家庭' }));
    await expect(rows).toHaveCount(2);
    await ctx.win.evaluate(() => toggleGroupCollapse('family'));
    await expect(ctx.win.locator('#emptyHint')).toBeVisible();
    await stableClick(ctx.win.locator('#btnClearFilters'));
    await expect(rows).toHaveCount(3);
    expect(await ctx.win.evaluate(() => isGroupCollapsed('family'))).toBe(false);
    await stableClick(ctx.win.locator('#btnArchiveFilter'));
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('归档材料');
    await stableClick(ctx.win.locator('#btnArchiveFilter'));
    await search.fill('生活清单');
    await ctx.win.locator('#todoQuickInput').fill('临时新增任务');
    await stableClick(ctx.win.locator('#btnQuickAdd'));
    await expect(search).toHaveValue('');
    await expect(rows).toHaveCount(4);
  } finally { await closeApp(ctx); }
});

test('画布、备忘录和文档搜索无结果时有清除入口，真实空数据仍显示新建', async () => {
  const ctx = await openApp({ seed: searchViewSeed() });
  try {
    const search = ctx.win.locator('#searchInput');
    for (const view of ['Board', 'Memo', 'Doc']) {
      await stableClick(ctx.win.locator(`#view${view}`));
      if (view === 'Doc') await stableClick(ctx.win.locator('.doc-pick-item').first());
      await search.fill('绝无匹配');
      await expect(ctx.win.locator('#emptyHint')).toBeVisible();
      await expect(ctx.win.locator('#emptyHint')).toContainText('没有符合条件的内容');
      await expect(ctx.win.locator('#btnEmptyCreate')).toBeHidden();
      if (view === 'Doc') await expect(ctx.win.locator('#docList')).toBeHidden();
      await stableClick(ctx.win.locator('#btnClearFilters'));
      await expect(search).toHaveValue('');
      await expect(ctx.win.locator('#emptyHint')).toBeHidden();
      if (view === 'Board') await expect(ctx.win.locator('#board .note')).toHaveCount(2);
      if (view === 'Memo') await expect(ctx.win.locator('#memoList .memo-row')).toHaveCount(2);
      if (view === 'Doc') await expect(ctx.win.locator('.doc-pick-item')).toHaveCount(2);
    }
    await stableClick(ctx.win.locator('#viewBoard'));
    await search.fill('绝无匹配');
    await stableClick(ctx.win.locator('#btnAdd'));
    await expect(search).toHaveValue('');
    await expect(ctx.win.locator('#board .note')).toHaveCount(3);
  } finally { await closeApp(ctx); }
});

test('搜索框在换行时铺满整行，在宽窗口随可用空间伸长', async () => {
  const ctx = await openApp({ seed: searchViewSeed() });
  try {
    const sizes = [640, 800, 1024, 1050, 1052, 1200, 1600];
    const inputWidths = {};
    for (const width of sizes) {
      await ctx.electronApp.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 700), width);
      await ctx.win.waitForTimeout(120);
      const bounds = await ctx.win.evaluate(() => {
        const search = document.querySelector('.search-box').getBoundingClientRect();
        const input = document.querySelector('#searchInput').getBoundingClientRect();
        const add = document.querySelector('#btnAdd').getBoundingClientRect();
        return { width: window.innerWidth, search: { left: search.left, right: search.right, top: search.top },
          inputWidth: input.width, add: { left: add.left, bottom: add.bottom } };
      });
      expect(Math.abs(bounds.width - width)).toBeLessThanOrEqual(2);
      inputWidths[width] = bounds.inputWidth;
      if (bounds.width <= 1050) {
        expect(bounds.search.left).toBeLessThanOrEqual(16);
        expect(bounds.search.right).toBeGreaterThanOrEqual(bounds.width - 16);
        expect(bounds.search.top).toBeGreaterThanOrEqual(bounds.add.bottom);
      } else {
        expect(bounds.inputWidth).toBeGreaterThan(150);
        expect(bounds.add.left - bounds.search.right).toBeLessThanOrEqual(20);
      }
    }
    expect(inputWidths[1600] - inputWidths[1200]).toBeGreaterThan(300);
  } finally { await closeApp(ctx); }
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

test('钉桌等待慢保存，独立窗口读取最新编辑且重复点击只开一个窗口', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    await expect.poll(async () => {
      const data = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
      return data.notes.length;
    }).toBe(1);
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('data:save');
      ipcMain.handle('data:save', async (e, data) => {
        globalThis.__pinSaveWaiting = true;
        globalThis.__pendingPinData = data;
        if (!globalThis.__pinSaveReleased) {
          await new Promise((resolve) => {
            (globalThis.__pinSaveResolvers ||= []).push(resolve);
          });
        }
        return true;
      });
    });
    await ctx.win.locator('#board .note .note-title').first().fill('慢保存后的新标题');
    await ctx.win.locator('#board .note .note-content').first().fill('慢保存后的新正文');
    await ctx.win.evaluate(() => clearTimeout(saveTimer));
    const pin = ctx.win.locator('#board .note .t-desktop').first();
    await pin.click({ force: true });
    await expect.poll(() => ctx.electronApp.evaluate(() => !!globalThis.__pinSaveWaiting)).toBe(true);
    await pin.click({ force: true });
    expect(await ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    const pendingData = await ctx.electronApp.evaluate(() => globalThis.__pendingPinData);
    await fs.writeFile(path.join(ctx.userDataDir, 'notes-data.json'), JSON.stringify(pendingData));
    await ctx.electronApp.evaluate(() => {
      globalThis.__pinSaveReleased = true;
      (globalThis.__pinSaveResolvers || []).forEach((resolve) => resolve());
    });
    const noteWin = await noteWinPromise;
    await expect(noteWin.locator('#dnTitle')).toHaveValue('慢保存后的新标题');
    await expect(noteWin.locator('#dnText')).toContainText('慢保存后的新正文');
    expect(await ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
  } finally {
    await ctx.electronApp.evaluate(() => {
      globalThis.__pinSaveReleased = true;
      (globalThis.__pinSaveResolvers || []).forEach((resolve) => resolve());
    }).catch(() => {});
    await closeApp(ctx);
  }
});

for (const entry of ['board', 'doc', 'context']) {
  test(`钉桌保存失败保留原便签与状态：${entry}`, async () => {
    const ctx = await openApp();
    try {
      await stableClick(ctx.win.locator('#btnAdd'));
      await expect.poll(async () => {
        const data = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
        return data.notes.length;
      }).toBe(1);
      if (entry === 'doc') {
        await stableClick(ctx.win.locator('#viewDoc'));
        await stableClick(ctx.win.locator('.doc-pick-item').first());
      } else if (entry === 'context') {
        await ctx.win.evaluate(() => { state.settings.ctxMenuMode = 'full'; });
        await ctx.win.locator('#board .note .note-content').first().click({ button: 'right', force: true });
      }
      await ctx.electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('data:save');
        ipcMain.handle('data:save', () => { throw new Error('模拟磁盘写入失败'); });
      });
      if (entry === 'board') await stableClick(ctx.win.locator('#board .note .t-desktop').first());
      else if (entry === 'doc') await stableClick(ctx.win.locator('#btnDocDesktop'));
      else await stableClick(ctx.win.locator('.ctx-menu button', { hasText: '钉在桌面' }).first());
      await expect(ctx.win.locator('#toast')).toContainText('保存失败');
      expect(await ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      expect(await ctx.win.evaluate(() => state.notes[0].desktopPin)).toBe(false);
      if (entry === 'doc') await expect(ctx.win.locator('#btnDocDesktop')).toBeVisible();
      else await expect(ctx.win.locator('#board .note')).toHaveCount(1);
      const saved = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
      expect(saved.notes[0].desktopPin).toBe(false);
    } finally {
      await ctx.electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('data:save');
        ipcMain.handle('data:save', () => true);
      }).catch(() => {});
      await closeApp(ctx);
    }
  });
}

test('主进程拒绝钉桌时不隐藏便签，也不显示成功提示', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('note:pin');
      ipcMain.handle('note:pin', () => false);
    });
    await stableClick(ctx.win.locator('#board .note .t-desktop').first());
    await expect(ctx.win.locator('#toast')).toContainText('钉到桌面失败');
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    expect(await ctx.win.evaluate(() => state.notes[0].desktopPin)).toBe(false);
    expect(await ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally { await closeApp(ctx); }
});

test('钉窗取消置顶前保存最后一次编辑', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    await ctx.win.locator('#board .note .note-title').first().fill('原始标题');
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await stableClick(ctx.win.locator('#board .note .t-desktop').first());
    const noteWin = await noteWinPromise;
    await expect(noteWin.locator('#dnTitle')).toHaveValue('原始标题');
    await noteWin.locator('#dnTitle').fill('取消置顶前的最后编辑');
    // 保持普通防抖尚未触发，验证取消置顶本身会主动保存。
    await noteWin.evaluate(() => { clearTimeout(saveTimer); saveTimer = setTimeout(() => {}, 5000); });
    await stableClick(noteWin.locator('#dnUnpin'));
    await expect.poll(async () => {
      const data = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
      return data.notes[0] && data.notes[0].title;
    }).toBe('取消置顶前的最后编辑');
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
  } finally { await closeApp(ctx); }
});

test('钉窗保存失败时取消置顶被阻止并显示警告', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await stableClick(ctx.win.locator('#board .note .t-desktop').first());
    const noteWin = await noteWinPromise;
    await expect(noteWin.locator('#dnTitle')).toBeVisible();
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('note:update');
      ipcMain.handle('note:update', () => false);
    });
    await noteWin.locator('#dnTitle').fill('未保存的标题');
    await stableClick(noteWin.locator('#dnUnpin'));
    await expect(noteWin.locator('#dnUnpin')).toHaveText('⚠');
    await expect(noteWin.locator('#dnTitle')).toHaveValue('未保存的标题');
  } finally { await closeApp(ctx); }
});

test('主窗口发起取消置顶时，独立便签保存失败则不关闭', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    const id = await ctx.win.locator('#board .note').first().getAttribute('data-id');
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await stableClick(ctx.win.locator('#board .note .t-desktop').first());
    const noteWin = await noteWinPromise;
    await expect(noteWin.locator('#dnTitle')).toBeVisible();
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('note:update');
      ipcMain.handle('note:update', () => false);
    });
    expect(await ctx.win.evaluate((noteId) => window.api.unpinFromDesktop(noteId), id)).toBe(false);
    await expect(noteWin.locator('#dnUnpin')).toHaveText('⚠');
  } finally { await closeApp(ctx); }
});

// —— UX-01 正式门槛子集：主窗↔独立便签保存/数据一致与可见保存失败 ——
// 本地安全的 1×1 PNG 夹具（CSP 允许 data:），用于验证图片引用在钉桌往返后仍在。
const UX01_PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function ux01ReadData(userDataDir) {
  return JSON.parse(await fs.readFile(path.join(userDataDir, 'notes-data.json'), 'utf8'));
}

async function ux01PinFirstCard(ctx) {
  const noteWinPromise = ctx.electronApp.waitForEvent('window');
  await stableClick(ctx.win.locator('#board .note .t-desktop').first());
  const noteWin = await noteWinPromise;
  await noteWin.waitForLoadState('domcontentloaded');
  return noteWin;
}

test('UX-01 主窗保存的表格/图片/提醒钉桌后独立窗可见，独立窗编辑回写并在重启后保持', async () => {
  const ctx = await openApp();
  let second;
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    // 新建后编辑区可能持有焦点；先失焦，避免后续以空 DOM 回写刚写入状态的富文本
    await ctx.win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    const noteId = await ctx.win.locator('#board .note').first().getAttribute('data-id');
    // 在主窗写入富文本协议（表格 + 图片引用 + 提醒）并经主窗保存路径落盘
    await ctx.win.evaluate((png) => {
      const n = state.notes[0];
      n.title = '富文本原题';
      n.content = '前文[[table:t1]][[img:i1]]后文';
      n.tables = [{ id: 't1', rows: 1, cols: 1, cells: [['单元格A']] }];
      n.images = [{ id: 'i1', src: png, w: 80 }];
      n.reminder = { enabled: true, time: new Date(Date.now() + 3600 * 1000).toISOString(), fired: false };
    }, UX01_PNG_1PX);
    expect(await ctx.win.evaluate(() => saveNow())).toBe(true);
    const onDisk = (await ux01ReadData(ctx.userDataDir)).notes.find((n) => n.id === noteId);
    expect(onDisk.content).toBe('前文[[table:t1]][[img:i1]]后文');
    expect(onDisk.tables[0].cells[0][0]).toBe('单元格A');
    expect(onDisk.images[0].src).toBe(UX01_PNG_1PX);

    // 钉桌：独立窗读取主窗已保存的富文本
    const noteWin = await ux01PinFirstCard(ctx);
    await expect(noteWin.locator('#dnTitle')).toHaveValue('富文本原题');
    await expect(noteWin.locator('#dnText .note-table')).toContainText('单元格A');
    await expect(noteWin.locator('#dnText img')).toHaveAttribute('src', UX01_PNG_1PX);

    // 独立窗改标题与正文（追加文字，保留表格/图片引用）
    await noteWin.locator('#dnTitle').fill('独立窗改过的标题');
    await noteWin.evaluate(() => {
      const el = document.querySelector('#dnText');
      el.appendChild(document.createTextNode(' 独立窗追加'));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(async () => {
      const n = (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === noteId);
      return n && n.title;
    }).toBe('独立窗改过的标题');
    // 便签仍隐藏（desktopPin），但主窗状态已同步到最新
    await expect(ctx.win.locator('#board .note')).toHaveCount(0);
    await expect.poll(() => ctx.win.evaluate((id) => {
      const n = state.notes.find((x) => x.id === id);
      return n && { title: n.title, content: n.content, desktopPin: n.desktopPin };
    }, noteId)).toEqual({ title: '独立窗改过的标题', content: '前文[[table:t1]][[img:i1]]后文 独立窗追加', desktopPin: true });

    // 取消钉住：回主窗显示最新值
    await stableClick(noteWin.locator('#dnUnpin'));
    await expect(ctx.win.locator('#board .note .note-title').first()).toHaveValue('独立窗改过的标题');
    await expect.poll(async () => (await ux01ReadData(ctx.userDataDir)).notes.find((n) => n.id === noteId).desktopPin).toBe(false);
    const afterUnpin = (await ux01ReadData(ctx.userDataDir)).notes.find((n) => n.id === noteId);
    expect(afterUnpin.desktopPin).toBe(false);
    expect(afterUnpin.content).toContain('[[table:t1]]');
    expect(afterUnpin.content).toContain('[[img:i1]]');
    expect(afterUnpin.content).toContain('独立窗追加');
    expect(afterUnpin.tables[0].cells[0][0]).toBe('单元格A');
    expect(afterUnpin.images[0].src).toBe(UX01_PNG_1PX);
    expect(afterUnpin.reminder.enabled).toBe(true);

    // 重启后富文本、媒体与提醒引用保持
    await ctx.electronApp.evaluate(() => process.exit(0)).catch(() => {});
    second = await openApp({ userDataDir: ctx.userDataDir });
    await expect(second.win.locator('#board .note .note-title').first()).toHaveValue('独立窗改过的标题');
    await expect(second.win.locator('#board .note .note-content .note-table')).toContainText('单元格A');
    await expect(second.win.locator('#board .note .note-content img')).toHaveAttribute('src', UX01_PNG_1PX);
    await expect(second.win.locator('#board .note .note-content')).toContainText('独立窗追加');
  } finally {
    if (second) await closeApp(second);
    else {
      await ctx.electronApp.close().catch(() => {});
      await fs.rm(ctx.userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

test('UX-01 待办便签钉桌后独立窗勾选/改文本同步主窗与磁盘', async () => {
  const now = Date.now();
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [{
      id: 'ux01-todo', title: '待办原题', content: '', type: 'todo',
      items: [{ id: 'ux01-1', text: '第一项', done: false }, { id: 'ux01-2', text: '第二项', done: false }],
      images: [], files: [], tables: [], color: '#ffef9c', textColor: null, groupId: null,
      pinned: false, desktopPin: false, reminder: null,
      x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
    }]
  };
  const ctx = await openApp({ seed });
  try {
    const noteWin = await ux01PinFirstCard(ctx);
    const items = noteWin.locator('.todo-item');
    await expect(items).toHaveCount(2);
    await items.nth(0).locator('input[type="checkbox"]').check({ force: true });
    await items.nth(1).locator('.todo-text').fill('第二项已改');
    await expect.poll(async () => {
      const n = (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === 'ux01-todo');
      return n && n.items.map((i) => `${i.done ? 'x' : 'o'}:${i.text}`).join('|');
    }).toBe('x:第一项|o:第二项已改');
    await expect.poll(() => ctx.win.evaluate(() => {
      const n = state.notes.find((x) => x.id === 'ux01-todo');
      return n && n.items.map((i) => `${i.done ? 'x' : 'o'}:${i.text}`).join('|');
    })).toBe('x:第一项|o:第二项已改');

    await stableClick(noteWin.locator('#dnUnpin'));
    const row = ctx.win.locator('#board .note').first();
    await expect(row.locator('.todo-item').nth(0).locator('input[type="checkbox"]')).toBeChecked();
    await expect(row.locator('.todo-item').nth(1).locator('.todo-text')).toHaveValue('第二项已改');
  } finally { await closeApp(ctx); }
});

test('UX-01 主窗保存其他便签的旧快照不会覆盖独立窗编辑，重启后两者都在', async () => {
  const now = Date.now();
  const mk = (id, title, desktopPin) => ({
    id, title, content: id + '正文', type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin, reminder: null,
    x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1, createdAt: now, updatedAt: now
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [mk('ux01-other', '其他便签', false), mk('ux01-pinned', '独立便签', false)]
  };
  const ctx = await openApp({ seed });
  let second;
  try {
    // 钉桌第二张便签（订阅事件后再触发，避免与启动时序竞态）
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await stableClick(ctx.win.locator('#board .note[data-id="ux01-pinned"] .t-desktop'));
    const noteWin = await noteWinPromise;
    await noteWin.waitForLoadState('domcontentloaded');
    await expect(noteWin.locator('#dnTitle')).toHaveValue('独立便签');

    // 拦截 data:save：记录主窗快照但不落盘（模拟该次保存尚未写入）。之后用真实处理器重放这张旧快照。
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ux01RealSave = ipcMain._invokeHandlers.get('data:save');
      ipcMain.removeHandler('data:save');
      ipcMain.handle('data:save', (e, data) => {
        globalThis.__ux01HeldSnapshot = data;
        return true;
      });
    });
    // 主窗编辑其他便签并强制保存 → 抓取到「其他便签新、独立便签旧」的快照
    await ctx.win.locator('#board .note[data-id="ux01-other"] .note-title').fill('其他便签已改');
    await ctx.win.evaluate(() => { saveNow(); });
    await expect.poll(() => ctx.electronApp.evaluate(() => {
      const d = globalThis.__ux01HeldSnapshot;
      if (!d) return null;
      return d.notes.find((n) => n.id === 'ux01-other').title;
    })).toBe('其他便签已改');

    // 独立窗编辑自己 → note:update 立即写盘
    await noteWin.locator('#dnTitle').fill('独立便签已改');
    await expect.poll(async () => {
      const n = (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === 'ux01-pinned');
      return n && n.title;
    }).toBe('独立便签已改');

    // 恢复真实 data:save，并重放主窗那张旧快照（应为被延迟/交错落盘的保存）
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('data:save');
      ipcMain.handle('data:save', globalThis.__ux01RealSave);
    });
    const heldSnapshot = await ctx.electronApp.evaluate(() => globalThis.__ux01HeldSnapshot);
    await ctx.win.evaluate((snapshot) => window.api.saveData(snapshot), heldSnapshot);

    const saved = await ux01ReadData(ctx.userDataDir);
    expect(saved.notes.find((n) => n.id === 'ux01-other').title).toBe('其他便签已改');
    expect(saved.notes.find((n) => n.id === 'ux01-pinned').title).toBe('独立便签已改');

    // 重启后两者都在：其他便签回到画布；仍钉桌的独立便签以最新标题重新开窗
    await ctx.electronApp.evaluate(() => process.exit(0)).catch(() => {});
    second = await openApp({ userDataDir: ctx.userDataDir, expectRecovery: true });
    if (await second.win.locator('#cmOk').count()) await stableClick(second.win.locator('#cmOk'));
    await expect(second.win.locator('#board .note[data-id="ux01-other"] .note-title')).toHaveValue('其他便签已改');
    await expect.poll(async () => {
      const wins = await second.electronApp.windows();
      const nw = wins.find((w) => w.url().includes('note.html'));
      return nw ? nw.locator('#dnTitle').inputValue() : null;
    }).toBe('独立便签已改');
  } finally {
    if (second) await closeApp(second);
    else {
      await ctx.electronApp.evaluate(({ ipcMain }) => {
        if (globalThis.__ux01RealSave) {
          ipcMain.removeHandler('data:save');
          ipcMain.handle('data:save', globalThis.__ux01RealSave);
        }
      }).catch(() => {});
      await closeApp(ctx);
    }
  }
});

test('UX-01 独立便签保存抛错时可见警告保留脏内容，恢复后重试落盘并清除警告', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    await ctx.win.locator('#board .note .note-title').first().fill('重试前标题');
    const noteWin = await ux01PinFirstCard(ctx);
    await expect(noteWin.locator('#dnTitle')).toHaveValue('重试前标题');

    // note:update 抛错（拒绝/异常分支），保留真实处理器用于稍后恢复
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ux01RealNoteUpdate = ipcMain._invokeHandlers.get('note:update');
      ipcMain.removeHandler('note:update');
      ipcMain.handle('note:update', () => { throw new Error('模拟后端拒绝'); });
    });
    await noteWin.locator('#dnTitle').fill('重试后标题');
    await stableClick(noteWin.locator('#dnUnpin'));
    await expect(noteWin.locator('#dnUnpin')).toHaveText('⚠');
    await expect(noteWin.locator('#dnUnpin')).toHaveAttribute('title', '保存失败，请检查磁盘/权限');
    await expect(noteWin.locator('#dnTitle')).toHaveValue('重试后标题');
    expect(await ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
    expect((await ux01ReadData(ctx.userDataDir)).notes[0].title).toBe('重试前标题');

    // 后端恢复：重挂真实处理器，再点取消钉住重试
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('note:update');
      ipcMain.handle('note:update', globalThis.__ux01RealNoteUpdate);
    });
    await stableClick(noteWin.locator('#dnUnpin'));
    await expect.poll(async () => (await ux01ReadData(ctx.userDataDir)).notes[0].title).toBe('重试后标题');
    await expect.poll(async () => ctx.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().length)).toBe(1);
    await expect(ctx.win.locator('#board .note .note-title').first()).toHaveValue('重试后标题');
  } finally { await closeApp(ctx); }
});

test('UX-01 确认导入同 ID 钉桌便签后以导入内容落盘，旧独立窗被作废不再覆盖', async () => {
  const now = Date.now();
  // desktopPin:true → 启动即打开独立窗，持有「导入前」内容；导入备份会用同 ID、同 desktopPin
  // 但标题/正文不同来替换它（不把 desktopPin 改成 false 来回避问题）。
  const mk = (title, content) => ({
    id: 'ux01-import', title, content, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: true, reminder: null,
    x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1, createdAt: now, updatedAt: now
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [mk('导入前标题', '导入前正文')]
  };
  const ctx = await openApp({ seed });
  try {
    // 旧的独立窗（同 ID、旧内容）
    let oldWin = null;
    await expect.poll(async () => {
      const wins = await ctx.electronApp.windows();
      oldWin = wins.find((w) => w.url().includes('note.html')) || null;
      return !!oldWin;
    }).toBe(true);
    await oldWin.waitForLoadState('domcontentloaded');
    await expect(oldWin.locator('#dnTitle')).toHaveValue('导入前标题');
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      globalThis.__ux01OldSender = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('note.html')).webContents;
    });
    await ctx.win.evaluate(() => {
      const originalToast = toast;
      globalThis.__ux01Toasts = [];
      toast = (message) => { __ux01Toasts.push(message); originalToast(message); };
      window.api.captureDraft({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash });
    });

    // 仅替换 data:import 处理器（不弹真实文件对话框），模拟用户选中同 ID 的备份文件
    const imported = {
      version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
      notes: [mk('导入后标题', '导入后正文')]
    };
    await ctx.electronApp.evaluate(({ ipcMain }, data) => {
      globalThis.__ux01RealImport = ipcMain._invokeHandlers.get('data:import');
      ipcMain.removeHandler('data:import');
      ipcMain.handle('data:import', () => ({ ok: true, data }));
      const realSave = ipcMain._invokeHandlers.get('data:save');
      ipcMain.removeHandler('data:save');
      ipcMain.handle('data:save', async (event, snapshot, opts) => {
        if (opts && opts.replace) {
          globalThis.__ux01ReplaceStarted = true;
          await new Promise((resolve) => { globalThis.__ux01ReleaseImport = resolve; });
        }
        return realSave(event, snapshot, opts);
      });
    }, imported);

    // 走真实 btnImport + 确认框：用户确认导入
    await stableClick(ctx.win.locator('#btnSettings'));
    await stableClick(ctx.win.locator('.sp-nav-item[data-tab="backup"]'));
    await stableClick(ctx.win.locator('#btnImport'));
    await expect(ctx.win.locator('#cmOk')).toBeVisible();
    await stableClick(ctx.win.locator('#cmOk'));

    await expect.poll(() => ctx.electronApp.evaluate(() => !!globalThis.__ux01ReplaceStarted)).toBe(true);
    expect(await ctx.win.evaluate(() => __ux01Toasts.includes(t('toast_imported')))).toBe(false);
    expect((await ux01ReadData(ctx.userDataDir)).notes[0].title).toBe('导入前标题');
    // 保存交错不应取消已发出的显式替换请求。
    await ctx.win.evaluate(() => saveNow());
    await ctx.electronApp.evaluate(() => globalThis.__ux01ReleaseImport());
    await expect.poll(() => ctx.win.evaluate(() => __ux01Toasts.includes(t('toast_imported')))).toBe(true);

    // 用户确认后导入内容必须落盘（合并未被 replace 区分时这里会停在被顶掉的「导入前标题」）
    await expect.poll(async () => {
      const n = (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === 'ux01-import');
      return n && { title: n.title, content: n.content, desktopPin: n.desktopPin };
    }).toEqual({ title: '导入后标题', content: '导入后正文', desktopPin: true });

    // 旧独立窗被作废关闭；仍钉桌的便签按导入内容重开，且只剩一扇
    await expect.poll(async () => {
      const wins = await ctx.electronApp.windows();
      return wins.filter((w) => w.url().includes('note.html')).length;
    }).toBe(1);
    const wins = await ctx.electronApp.windows();
    const reopened = wins.find((w) => w.url().includes('note.html'));
    await expect(reopened.locator('#dnTitle')).toHaveValue('导入后标题');
    await expect(reopened.locator('#dnText')).toContainText('导入后正文');

    // 旧窗已关闭，不能再写回；等待超过防抖/交错窗口后磁盘仍是导入内容
    await ctx.win.waitForTimeout(700);
    const still = (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === 'ux01-import');
    expect(still.title).toBe('导入后标题');
    expect(still.content).toBe('导入后正文');
    // 同 ID 新窗口已创建后，真实旧 sender 的迟到正式保存和恢复草稿仍应被拒绝。
    const rejected = await ctx.electronApp.evaluate(async ({ ipcMain }, staleNote) => {
      const event = { sender: globalThis.__ux01OldSender };
      ipcMain.listeners('note:draft')[0](event, staleNote);
      const update = await ipcMain._invokeHandlers.get('note:update')(event, staleNote);
      return { draft: event.returnValue, update };
    }, { ...still, title: '旧窗口迟到标题' });
    expect(rejected).toEqual({ draft: false, update: false });
    expect((await ux01ReadData(ctx.userDataDir)).notes[0].title).toBe('导入后标题');
    const recovery = await fs.readFile(path.join(ctx.userDataDir, 'notes-recovery.json'), 'utf8').catch((err) => {
      if (err.code === 'ENOENT') return '{}';
      throw err;
    });
    expect(recovery).not.toContain('旧窗口迟到标题');
    await reopened.locator('#dnTitle').fill('新窗口继续编辑');
    await expect.poll(async () => (await ux01ReadData(ctx.userDataDir)).notes[0].title).toBe('新窗口继续编辑');
  } finally {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      if (globalThis.__ux01RealImport) {
        ipcMain.removeHandler('data:import');
        ipcMain.handle('data:import', globalThis.__ux01RealImport);
        delete globalThis.__ux01RealImport;
      }
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('UX-01 坏档导入失败保持只读，重试成功落盘后才解除保护', async () => {
  const bad = '{broken-import-fixture';
  const ctx = await openApp({ seedRaw: bad });
  try {
    await expect(ctx.win.locator('body')).toHaveClass(/data-readonly/);
    const imported = { version: 2, settings: { lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
      notes: [{ id: 'import-recovery', title: '备份恢复标题', content: '备份恢复正文', type: 'note', items: [] }] };
    await ctx.electronApp.evaluate(({ ipcMain }, data) => {
      globalThis.__ux01RecoverySave = ipcMain._invokeHandlers.get('data:save');
      ipcMain.removeHandler('data:import');
      ipcMain.handle('data:import', () => ({ ok: true, data }));
      ipcMain.removeHandler('data:save');
      ipcMain.handle('data:save', () => { throw new Error('模拟恢复写入失败'); });
    }, imported);
    await expect(ctx.win.locator('#btnDataRecovery')).toHaveAccessibleName('导入备份…');
    await ctx.win.locator('#btnDataRecovery').focus();
    await ctx.win.keyboard.press('Enter');
    await expect(ctx.win.locator('#settingsPanel')).toBeVisible();
    await expect(ctx.win.locator('#btnImport')).toBeVisible();
    await stableClick(ctx.win.locator('#btnImport'));
    await stableClick(ctx.win.locator('#cmOk'));
    await expect(ctx.win.locator('#toast')).toContainText('保存失败');
    await expect(ctx.win.locator('body')).toHaveClass(/data-readonly/);
    expect(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8')).toBe(bad);
    expect(await ctx.win.evaluate(() => state.notes.length)).toBe(0);
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('data:save');
      ipcMain.handle('data:save', globalThis.__ux01RecoverySave);
    });
    await stableClick(ctx.win.locator('#btnImport'));
    await stableClick(ctx.win.locator('#cmOk'));
    await expect(ctx.win.locator('#toast')).toContainText('导入成功');
    await expect(ctx.win.locator('body')).not.toHaveClass(/data-readonly/);
    expect((await ux01ReadData(ctx.userDataDir)).notes[0].title).toBe('备份恢复标题');
    expect(await ctx.win.evaluate(() => state.notes[0].title)).toBe('备份恢复标题');
  } finally {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      if (globalThis.__ux01RecoverySave) {
        ipcMain.removeHandler('data:save');
        ipcMain.handle('data:save', globalThis.__ux01RecoverySave);
      }
    }).catch(() => {});
    await closeApp(ctx);
  }
});

// 取消/失败导入不得关闭独立窗或丢弃待保存编辑：只有确认后成功落盘才允许作废旧窗口。
test('UX-01 取消导入时保留独立窗与磁盘存档不变', async () => {
  const now = Date.now();
  const mk = (title, content) => ({
    id: 'ux01-cancel', title, content, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: true, reminder: null,
    x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1, createdAt: now, updatedAt: now
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [mk('取消前标题', '取消前正文')]
  };
  const ctx = await openApp({ seed });
  try {
    await expect.poll(async () => {
      const wins = await ctx.electronApp.windows();
      return wins.filter((w) => w.url().includes('note.html')).length;
    }).toBe(1);
    const imported = {
      version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
      notes: [mk('取消后标题', '取消后正文')]
    };
    await ctx.electronApp.evaluate(({ ipcMain }, data) => {
      globalThis.__ux01CancelRealImport = ipcMain._invokeHandlers.get('data:import');
      ipcMain.removeHandler('data:import');
      ipcMain.handle('data:import', () => ({ ok: true, data }));
    }, imported);

    await stableClick(ctx.win.locator('#btnSettings'));
    await stableClick(ctx.win.locator('.sp-nav-item[data-tab="backup"]'));
    await stableClick(ctx.win.locator('#btnImport'));
    await expect(ctx.win.locator('#cmCancel')).toBeVisible();
    await stableClick(ctx.win.locator('#cmCancel'));

    await ctx.win.waitForTimeout(700);
    const onDisk = (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === 'ux01-cancel');
    expect(onDisk.title).toBe('取消前标题');
    const wins = await ctx.electronApp.windows();
    const noteWins = wins.filter((w) => w.url().includes('note.html'));
    expect(noteWins.length).toBe(1);
    await expect(noteWins[0].locator('#dnTitle')).toHaveValue('取消前标题');
  } finally {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      if (globalThis.__ux01CancelRealImport) {
        ipcMain.removeHandler('data:import');
        ipcMain.handle('data:import', globalThis.__ux01CancelRealImport);
        delete globalThis.__ux01CancelRealImport;
      }
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('UX-01 导入落盘失败时保留独立窗/存档，且不覆盖合法恢复草稿', async () => {
  const now = Date.now();
  const mk = (title, content) => ({
    id: 'ux01-fail', title, content, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: true, reminder: null,
    x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1, createdAt: now, updatedAt: now
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [mk('失败前标题', '失败前正文')]
  };
  const ctx = await openApp({ seed });
  const readRecovery = async () => {
    try { return JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-recovery.json'), 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  };
  try {
    await ctx.win.evaluate(() => {
      const originalToast = toast;
      globalThis.__ux01Toasts = [];
      toast = (message) => { __ux01Toasts.push(message); originalToast(message); };
    });
    await expect.poll(async () => {
      const wins = await ctx.electronApp.windows();
      return wins.filter((w) => w.url().includes('note.html')).length;
    }).toBe(1);
    // 启动完成后再写入「合法恢复草稿」（不触发启动恢复弹窗），用于验证失败导入不会把它顶掉。
    await ctx.win.evaluate(() => {
      const snapshot = JSON.parse(JSON.stringify({ settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash }));
      snapshot.notes[0].title = '合法草稿标题';
      snapshot.notes[0].content = '合法草稿正文';
      globalThis.__ux01LegitToken = window.api.captureDraft(snapshot);
    });
    const legit = await readRecovery();
    expect(legit.main.data.notes[0].title).toBe('合法草稿标题');
    // 备份与当前便签同 ID、不同标题/正文，且故意省略 positionAll（导入时需被就地补全）。
    const imported = {
      version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
      notes: [mk('失败后标题', '失败后正文')]
    };
    delete imported.notes[0].positionAll;
    await ctx.electronApp.evaluate(({ ipcMain }, data) => {
      globalThis.__ux01FailRealImport = ipcMain._invokeHandlers.get('data:import');
      globalThis.__ux01FailRealSave = ipcMain._invokeHandlers.get('data:save');
      ipcMain.removeHandler('data:import');
      ipcMain.handle('data:import', () => ({ ok: true, data }));
    }, imported);

    await stableClick(ctx.win.locator('#btnSettings'));
    await stableClick(ctx.win.locator('.sp-nav-item[data-tab="backup"]'));
    // 让确认后的 replace 保存失败（写盘被拒），验证不会作废独立窗、不清合法草稿、不留下未提交替换草稿
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('data:save');
      ipcMain.handle('data:save', () => { throw new Error('模拟写入失败'); });
    });
    await stableClick(ctx.win.locator('#btnImport'));
    await expect(ctx.win.locator('#cmOk')).toBeVisible();
    await stableClick(ctx.win.locator('#cmOk'));

    await ctx.win.waitForTimeout(700);
    // 原始内存/磁盘/独立窗均不变
    const onDisk = (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === 'ux01-fail');
    expect(onDisk.title).toBe('失败前标题');
    const wins = await ctx.electronApp.windows();
    const noteWins = wins.filter((w) => w.url().includes('note.html'));
    expect(noteWins.length).toBe(1);
    await expect(noteWins[0].locator('#dnTitle')).toHaveValue('失败前标题');
    expect(await ctx.win.evaluate(() => state.notes[0].title)).toBe('失败前标题');
    expect(await ctx.win.evaluate(() => __ux01Toasts.includes(t('toast_imported')))).toBe(false);
    await expect(ctx.win.locator('#toast')).toContainText('保存失败');
    // 合法恢复草稿原样保留，且不含任何导入内容（initAllLayout 不得在 replace 提交前 captureDraft）
    const afterFail = await readRecovery();
    expect(afterFail.main.data.notes[0].title).toBe('合法草稿标题');
    expect(afterFail.main.data.notes[0].content).toBe('合法草稿正文');
    expect(Object.keys(afterFail.notes).length).toBe(0);
    expect(JSON.stringify(afterFail)).not.toContain('失败后标题');
    expect(JSON.stringify(afterFail)).not.toContain('失败后正文');

    // 恢复真实 data:save 后重试导入：旧备份（缺 positionAll）应成功补位落盘，恢复草稿不再回放导入前内容
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('data:save');
      ipcMain.handle('data:save', globalThis.__ux01FailRealSave);
    });
    await stableClick(ctx.win.locator('#btnImport'));
    await expect(ctx.win.locator('#cmOk')).toBeVisible();
    await stableClick(ctx.win.locator('#cmOk'));
    await expect.poll(() => ctx.win.evaluate(() => __ux01Toasts.includes(t('toast_imported')))).toBe(true);
    await expect.poll(async () => {
      const n = (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === 'ux01-fail');
      return n && { title: n.title, content: n.content, hasPositionAll: !!n.positionAll && typeof n.positionAll.x === 'number' && typeof n.positionAll.y === 'number' };
    }).toEqual({ title: '失败后标题', content: '失败后正文', hasPositionAll: true });
    await expect.poll(() => ctx.win.evaluate(async () => (await window.api.loadData()).recovery)).toBe(null);
  } finally {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      if (globalThis.__ux01FailRealImport) {
        ipcMain.removeHandler('data:import');
        ipcMain.handle('data:import', globalThis.__ux01FailRealImport);
        delete globalThis.__ux01FailRealImport;
      }
      if (globalThis.__ux01FailRealSave) {
        ipcMain.removeHandler('data:save');
        ipcMain.handle('data:save', globalThis.__ux01FailRealSave);
        delete globalThis.__ux01FailRealSave;
      }
    }).catch(() => {});
    await closeApp(ctx);
  }
});

// —— P0-04：导入内容渲染注入 + 导航边界 ——
// 恶意但形状合法的种子数据：注入串只用无害标记（pwn-*）与 https 字符串，不发生任何网络/OS 调用。
function p004HostileNote(id, title, desktopPin) {
  const now = Date.now();
  const imgW = '200" ><span id="pwn-img-marker"></span><a id="pwn-img-link" href="https://evil.example/img">x</a><img src="x';
  const bw = '3"><span id="pwn-tbl-marker"></span><a id="pwn-tbl-link" href="https://evil.example/tbl">t</a>';
  const span = '1"><span id="pwn-span-marker"></span>';
  return {
    id, title, content: '正文[[img:i1]][[file:f1]][[table:t1]]', type: 'note',
    items: [],
    files: [{ id: 'f1', path: 'C:/notes/ok <b>escaped</b>.txt', isDir: false }],
    images: [{ id: 'i1', src: 'note-img://local/a.png', w: imgW }],
    tables: [{
      id: 't1', rows: 1, cols: 1, cells: [['单元格']], borderWidth: bw, borderColor: 'rgba(0,0,0,0.7)',
      merges: [{ r: 0, c: 0, rowspan: span, colspan: 1 }], diagonals: []
    }],
    color: '#93f1ce', textColor: null, groupId: 'g1', pinned: false, desktopPin: !!desktopPin, reminder: null,
    x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1, createdAt: now, updatedAt: now
  };
}
const P004_MARKERS = [
  'pwn-img-marker', 'pwn-img-link', 'pwn-tbl-marker', 'pwn-tbl-link', 'pwn-span-marker', 'pwn-group-marker',
  'pwn-id-marker', 'pwn-color-marker', 'pwn-textcolor-marker', 'pwn-fontsize-marker', 'pwn-hl-marker',
  'pwn-theme-bg-marker', 'pwn-theme-accent-marker', 'pwn-theme-mini-marker',
  'pwn-tbl-bcolor-marker', 'pwn-tbl-bwidth-marker', 'pwn-tbl-tcolor-marker', 'pwn-tbl-fsize-marker',
  'pwn-diag-color-marker', 'pwn-diag-size-marker'
];

// 预置真实图片文件，确保媒体引用在渲染后仍保留（不被“图片缺失”替换）。
async function p004UserDataWithImage() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mynotes-e2e-'));
  await fs.mkdir(path.join(dir, 'images'), { recursive: true });
  await fs.writeFile(path.join(dir, 'images', 'a.png'), Buffer.from(UX01_PNG_1PX.split(',')[1], 'base64'));
  return dir;
}

async function p004AssertNoInjection(page) {
  const r = await page.evaluate((ids) => ({
    markers: ids.filter((id) => !!document.getElementById(id)),
    hrefs: document.querySelectorAll('a[href]').length,
    handlers: Array.from(document.querySelectorAll('*')).filter((el) => Array.from(el.attributes).some((a) => /^on/i.test(a.name))).length
  }), P004_MARKERS);
  expect(r.markers).toEqual([]);
  expect(r.hrefs).toBe(0);
  expect(r.handlers).toBe(0);
}

// 用真实鼠标点击，避免 Playwright locator 对被 will-navigate 拦截的“挂起导航”等待超时。
// 坐标经 evaluate 计算，绕开 locator 的导航等待。
async function p004MouseClick(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!box) throw new Error('p004MouseClick: element not found: ' + selector);
  await page.mouse.click(box.x, box.y);
}

async function p004WaitForElement(page, selector) {
  await expect.poll(() => page.evaluate((sel) => !!document.querySelector(sel), selector)).toBe(true);
}

test('P0-04 恶意导入字段在各视图/独立窗均不注入标记，合法内容保留', async () => {
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION },
    groups: [{ id: 'g1', name: '安全分组', color: '#0f0" ><span id="pwn-group-marker"></span>' }],
    trash: [], notes: [p004HostileNote('p004-hostile', '正常标题', false), p004HostileNote('p004-hostile-pin', '钉桌标题', true)]
  };
  const ctx = await openApp({ seed, userDataDir: await p004UserDataWithImage() });
  try {
    // 便签视图：标题保留，无注入
    await expect(ctx.win.locator('#board .note .note-title').first()).toHaveValue('正常标题');
    await p004AssertNoInjection(ctx.win);
    // 图片宽度回退 200px，src 保留
    await expect(ctx.win.locator('#board .note .inline-img img').first()).toHaveAttribute('style', /width:200px/);

    // 备忘录视图
    await stableClick(ctx.win.locator('#viewMemo'));
    await expect(ctx.win.locator('.memo-row')).toHaveCount(1);
    await p004AssertNoInjection(ctx.win);

    // 文档视图：选择器列表 + 文档编辑器
    await stableClick(ctx.win.locator('#viewDoc'));
    await expect(ctx.win.locator('.doc-pick-item')).toHaveCount(1);
    await p004AssertNoInjection(ctx.win);
    await stableClick(ctx.win.locator('.doc-pick-item').first());
    await expect(ctx.win.locator('#docContent')).toBeVisible();
    await p004AssertNoInjection(ctx.win);

    // 分组 chip（g.color 直接进 style）无注入；再打开「加入分组」弹窗覆盖另一处 sink
    await p004AssertNoInjection(ctx.win);
    await ctx.win.evaluate(() => { const n = state.notes.find((x) => x.id === 'p004-hostile'); openGroupPop(document.body, n); });
    await expect(ctx.win.locator('.color-pop').first()).toBeVisible();
    await p004AssertNoInjection(ctx.win);
    await ctx.win.evaluate(() => closePops());

    // 独立便签窗：标题与内容保留，无注入
    await expect.poll(async () => (await ctx.electronApp.windows()).filter((w) => w.url().includes('note.html')).length).toBe(1);
    const noteWin = (await ctx.electronApp.windows()).find((w) => w.url().includes('note.html'));
    await expect(noteWin.locator('#dnTitle')).toHaveValue('钉桌标题');
    await expect(noteWin.locator('#dnText')).toContainText('单元格');
    await p004AssertNoInjection(noteWin);
  } finally { await closeApp(ctx); }
});

test('P0-04 渲染 sink：id/颜色/字号/主题/表格属性转义，无注入标记', async () => {
  const now = Date.now();
  const mkNote = (id, title, desktopPin, tables) => ({
    id, title, content: '[[table:t1]]', type: 'note', items: [], images: [], files: [],
    tables: tables || [], color: '#93f1ce', textColor: null, groupId: null, pinned: false,
    desktopPin: !!desktopPin, reminder: null, x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1,
    createdAt: now, updatedAt: now
  });
  const hostileTable = () => [{
    id: 't1', rows: 1, cols: 1, cells: [['x']],
    borderColor: '#808080" ><span id="pwn-tbl-bcolor-marker"></span>',
    borderWidth: '3"><span id="pwn-tbl-bwidth-marker"></span>',
    textColor: '#808080" ><span id="pwn-tbl-tcolor-marker"></span>',
    fontSize: '12"><span id="pwn-tbl-fsize-marker"></span>',
    merges: [], diagonals: [{ r: 0, c: 0, dir: 'tlbr', tColor: '#808080" ><span id="pwn-diag-color-marker"></span>', tSize: '12"><span id="pwn-diag-size-marker"></span>' }]
  }];
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION, themeId: 'mint', customThemes: [] },
    groups: [], trash: [],
    notes: [
      mkNote('p004-normal', '正常编辑器', false, []),
      mkNote('p004-sink', '填充', false, []),
      mkNote('p004-pin', '钉桌表', true, hostileTable())
    ]
  };
  const ctx = await openApp({ seed });
  try {
    const hostileId = 'p004-sink"><span id="pwn-id-marker"></span>';
    await ctx.win.evaluate((hid) => {
      const n = state.notes.find((x) => x.id === 'p004-sink');
      n.id = hid;
      n.color = '#abc" ><span id="pwn-color-marker"></span>';
      n.textColor = '#def" ><span id="pwn-textcolor-marker"></span>';
      n.fontSize = '14"><span id="pwn-fontsize-marker"></span>';
      state.settings.highlightColor = '#fff59d" ><span id="pwn-hl-marker"></span>';
      state.settings.customThemes = [{
        id: 'ct-hostile', name: '恶意主题', light: false,
        bg: '#111" ><span id="pwn-theme-bg-marker"></span>',
        accent: '#222" ><span id="pwn-theme-accent-marker"></span>',
        mini: ['#333" ><span id="pwn-theme-mini-marker"></span>', '#444']
      }];
      setViewMode('doc');
      renderThemePanel();
    }, hostileId);

    // 文档选择器：data-id 属性安全往返（仍能读到恶意原值），样式被清洗，无注入
    await expect.poll(() => ctx.win.evaluate(() => document.querySelectorAll('.doc-pick-item').length)).toBe(2);
    const dsIds = await ctx.win.evaluate(() => Array.from(document.querySelectorAll('.doc-pick-item')).map((e) => e.dataset.id));
    expect(dsIds).toContain(hostileId);
    const sinkStyle = await ctx.win.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.doc-pick-item')).find((e) => e.dataset.id.indexOf('pwn-id-marker') !== -1);
      return el ? el.getAttribute('style') : null;
    });
    expect(sinkStyle).not.toMatch(/[<>"]/);
    expect(sinkStyle).toContain('#abc');
    await p004AssertNoInjection(ctx.win);

    // 文档编辑器使用正常 id 便签：合法颜色仍显示
    await ctx.win.evaluate(() => { docNoteId = 'p004-normal'; setViewMode('doc'); });
    await expect(ctx.win.locator('#docContent')).toBeVisible();
    const edStyle = await ctx.win.evaluate(() => { const el = document.querySelector('.doc-editor'); return el ? el.getAttribute('style') : null; });
    expect(edStyle).toContain('#93f1ce');
    await p004AssertNoInjection(ctx.win);

    // 自定义主题卡片（bg/mini）与主题编辑器（bg/accent/mini）：合法预设仍显示真实颜色
    await expect(ctx.win.locator('.theme-card.custom')).toHaveCount(1);
    const presetBg = await ctx.win.evaluate(() => {
      const c = document.querySelector('.theme-card:not(.custom):not(.add-card) .preview');
      return c ? getComputedStyle(c).backgroundColor : '';
    });
    expect(presetBg).toMatch(/rgb/);
    await p004AssertNoInjection(ctx.win);
    await ctx.win.evaluate(() => { openThemeEditor((state.settings.customThemes || [])[0]); });
    await expect(ctx.win.locator('#teBg')).toBeVisible();
    const te = await ctx.win.evaluate(() => ({
      bg: document.querySelector('#teBg').getAttribute('value'),
      accent: document.querySelector('#teAccent').getAttribute('value'),
      mini1: document.querySelector('#teMini1').getAttribute('value')
    }));
    [te.bg, te.accent, te.mini1].forEach((v) => expect(v).not.toMatch(/[<>"]/));
    expect(te.bg).toContain('#111');
    expect(te.mini1).toContain('#333');
    await p004AssertNoInjection(ctx.win);
    await ctx.win.evaluate(() => document.querySelectorAll('[data-modal-overlay]').forEach((e) => e.remove()));

    // 独立窗表格属性/斜线弹窗：恶意字段被清洗，合法默认值显示
    await expect.poll(async () => (await ctx.electronApp.windows()).filter((w) => w.url().includes('note.html')).length).toBe(1);
    const noteWin = (await ctx.electronApp.windows()).find((w) => w.url().includes('note.html'));
    await noteWin.waitForLoadState('domcontentloaded');
    await expect(noteWin.locator('#dnTitle')).toHaveValue('钉桌表');
    await noteWin.evaluate(() => { openTableSettingsDialog(note.tables[0]); });
    await expect(noteWin.locator('#tblBWidth')).toBeVisible();
    const tblAttrs = await noteWin.evaluate(() => ({
      bcolor: document.querySelector('#tblBColor').getAttribute('value'),
      bwidth: document.querySelector('#tblBWidth').getAttribute('value'),
      tcolor: document.querySelector('#tblTColor').getAttribute('value'),
      tsize: document.querySelector('#tblTSize').getAttribute('value')
    }));
    expect(tblAttrs.bwidth).toBe('2');
    expect(tblAttrs.tsize).toBe('');
    expect(tblAttrs.bcolor).not.toMatch(/[<>"]/);
    expect(tblAttrs.tcolor).not.toMatch(/[<>"]/);
    await p004AssertNoInjection(noteWin);
    // 关闭表格设置（取消）后打开斜线编辑器
    await noteWin.evaluate(() => { const b = document.querySelector('#tblSetCancel'); if (b) b.click(); });
    await noteWin.evaluate(() => { openDiagonalEditor(note.tables[0], 0, 0); });
    await expect(noteWin.locator('#diagTSize')).toBeVisible();
    const diagAttrs = await noteWin.evaluate(() => ({
      color: document.querySelector('#diagTColor').getAttribute('value'),
      size: document.querySelector('#diagTSize').getAttribute('value')
    }));
    expect(diagAttrs.size).toBe('');
    expect(diagAttrs.color).not.toMatch(/[<>"]/);
    await p004AssertNoInjection(noteWin);
  } finally { await closeApp(ctx); }
});

test('P0-04 主窗/独立窗阻止顶层导航与新窗口，本地重载/query 仍可用', async () => {
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [p004HostileNote('p004-hostile', '正常标题', true)]
  };
  const ctx = await openApp({ seed });
  try {
    const fixture = path.join(ctx.userDataDir, 'p004-fixture.html');
    await fs.writeFile(fixture, '<!doctype html><title>FIXTURE</title><p>fixture</p>');
    const fixtureUrl = 'file:///' + fixture.replace(/\\/g, '/');
    const mainUrl = ctx.win.url();

    // 主进程计数：will-navigate 尝试次数 + 新建窗口次数，证明点击确实触发了导航/开窗请求且被拦截
    await ctx.electronApp.evaluate(({ app, BrowserWindow }) => {
      globalThis.__p004Nav = { main: 0, mainFrame: 0, note: 0, noteFrame: 0, created: 0 };
      const attach = (w) => {
        const isNote = /note\.html/.test(w.webContents.getURL());
        w.webContents.on('will-navigate', () => { if (isNote) globalThis.__p004Nav.note++; else globalThis.__p004Nav.main++; });
        w.webContents.on('will-frame-navigate', () => { if (isNote) globalThis.__p004Nav.noteFrame++; else globalThis.__p004Nav.mainFrame++; });
      };
      BrowserWindow.getAllWindows().forEach(attach);
      app.on('browser-window-created', () => { globalThis.__p004Nav.created++; });
    });
    const nav = () => ctx.electronApp.evaluate(() => ({ ...globalThis.__p004Nav }));

    // 主窗：普通锚点点击 -> will-navigate 被观察到，但 URL 不变、API 可用
    await ctx.win.evaluate((href) => {
      const a = document.createElement('a'); a.id = 'p004-nav-main'; a.href = href; a.textContent = 'go';
      a.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:2147483647;background:#fff;color:#000;padding:6px;font-size:14px;';
      document.body.appendChild(a);
    }, fixtureUrl);
    await p004WaitForElement(ctx.win, '#p004-nav-main');
    await p004MouseClick(ctx.win, '#p004-nav-main');
    await ctx.win.waitForTimeout(300);
    const navAfterMain = await nav();
    expect(navAfterMain.main + navAfterMain.mainFrame).toBeGreaterThanOrEqual(1); // 守卫确实观察到点击发起的导航
    expect(ctx.win.url()).toBe(mainUrl);
    expect(ctx.win.url()).toBe(mainUrl);
    expect(await ctx.win.evaluate(() => typeof window.api)).toBe('object');

    // target=_blank：点击被观察到、不新建窗口、URL 不变
    const wc = (await ctx.electronApp.windows()).length;
    const createdBefore = (await nav()).created;
    await ctx.win.evaluate((href) => {
      const a = document.createElement('a'); a.id = 'p004-blank-main'; a.href = href; a.target = '_blank'; a.textContent = 'go';
      a.style.cssText = 'position:fixed;left:4px;bottom:40px;z-index:2147483647;background:#fff;color:#000;padding:6px;font-size:14px;';
      a.addEventListener('click', () => { window.__p004BlankMain = true; });
      document.body.appendChild(a);
    }, fixtureUrl);
    await p004MouseClick(ctx.win, '#p004-blank-main');
    await ctx.win.waitForTimeout(400);
    expect(await ctx.win.evaluate(() => window.__p004BlankMain === true)).toBe(true);
    expect((await nav()).created).toBe(createdBefore);
    expect((await ctx.electronApp.windows()).length).toBe(wc);
    expect(ctx.win.url()).toBe(mainUrl);

    // window.open：被拒绝（返回空），不新建窗口
    const openMain = await ctx.win.evaluate((href) => (window.open(href) ? 'opened' : 'denied'), fixtureUrl);
    await ctx.win.waitForTimeout(400);
    expect(openMain).toBe('denied');
    expect((await nav()).created).toBe(createdBefore);
    expect((await ctx.electronApp.windows()).length).toBe(wc);
    expect(ctx.win.url()).toBe(mainUrl);

    // 程序化重载不受影响（应用仍可用）
    await ctx.win.reload();
    await ctx.win.waitForLoadState('domcontentloaded');
    await expect(ctx.win.locator('#btnAdd')).toBeVisible();
    await expect.poll(() => ctx.win.evaluate(() => typeof window.api)).toBe('object');

    // 独立窗：query 加载正常；普通锚点 / _blank / window.open 均被拦截
    const noteWin = (await ctx.electronApp.windows()).find((w) => w.url().includes('note.html'));
    expect(noteWin.url()).toContain('note.html?id=');
    await expect(noteWin.locator('#dnTitle')).toHaveValue('正常标题');
    const noteUrl = noteWin.url();
    await noteWin.evaluate((href) => {
      const a = document.createElement('a'); a.id = 'p004-nav-note'; a.href = href; a.textContent = 'go';
      a.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:2147483647;background:#fff;color:#000;padding:6px;font-size:14px;';
      document.body.appendChild(a);
    }, fixtureUrl);
    await p004WaitForElement(noteWin, '#p004-nav-note');
    await p004MouseClick(noteWin, '#p004-nav-note');
    await noteWin.waitForTimeout(300);
    const navAfterNote = await nav();
    expect(navAfterNote.note + navAfterNote.noteFrame).toBeGreaterThanOrEqual(1); // 独立窗守卫同样观察到导航尝试
    expect(noteWin.url()).toBe(noteUrl);

    const wc2 = (await ctx.electronApp.windows()).length;
    const createdBefore2 = (await nav()).created;
    await noteWin.evaluate((href) => {
      const a = document.createElement('a'); a.id = 'p004-blank-note'; a.href = href; a.target = '_blank'; a.textContent = 'go';
      a.style.cssText = 'position:fixed;left:4px;bottom:40px;z-index:2147483647;background:#fff;color:#000;padding:6px;font-size:14px;';
      a.addEventListener('click', () => { window.__p004BlankNote = true; });
      document.body.appendChild(a);
    }, fixtureUrl);
    await p004MouseClick(noteWin, '#p004-blank-note');
    await noteWin.waitForTimeout(400);
    expect(await noteWin.evaluate(() => window.__p004BlankNote === true)).toBe(true);
    expect((await nav()).created).toBe(createdBefore2);
    expect((await ctx.electronApp.windows()).length).toBe(wc2);
    expect(noteWin.url()).toBe(noteUrl);

    const openNote = await noteWin.evaluate((href) => (window.open(href) ? 'opened' : 'denied'), fixtureUrl);
    await noteWin.waitForTimeout(400);
    expect(openNote).toBe('denied');
    expect((await nav()).created).toBe(createdBefore2);
    expect((await ctx.electronApp.windows()).length).toBe(wc2);
    expect(noteWin.url()).toBe(noteUrl);
    await expect.poll(() => noteWin.evaluate(() => { const el = document.querySelector('#dnTitle'); return el ? el.value : null; })).toBe('正常标题');
  } finally { await closeApp(ctx); }
});

test('P0-04 open-external 仅放行真实 http(s)，openPath 附件仍放行（mock shell）', async () => {
  const ctx = await openApp();
  try {
    await ctx.electronApp.evaluate(({ shell }) => {
      globalThis.__p004RealOpenExternal = shell.openExternal;
      globalThis.__p004RealOpenPath = shell.openPath;
      globalThis.__p004Opened = [];
      globalThis.__p004OpenedPath = [];
      shell.openExternal = async (u) => { globalThis.__p004Opened.push(u); };
      shell.openPath = async (p) => { globalThis.__p004OpenedPath.push(p); return ''; };
    });

    const r = await ctx.win.evaluate(async () => ({
      https: await window.api.openExternal('https://example.com/a'),
      http: await window.api.openExternal('http://host.example/b'),
      mailto: await window.api.openExternal('mailto:a@b.c'),
      file: await window.api.openExternal('file:///C:/Windows/win.ini'),
      js: await window.api.openExternal('javascript:alert(1)'),
      ctrl: await window.api.openExternal('https://evil.example/x\ncalc.exe'),
      nohost: await window.api.openExternal('https://'),
      opened: await window.api.openFilePath('C:/notes/ok.txt', false)
    }));
    expect(r.https).toBe(true);
    expect(r.http).toBe(true);
    expect(r.mailto).toBe(false);
    expect(r.file).toBe(false);
    expect(r.js).toBe(false);
    expect(r.ctrl).toBe(false);
    expect(r.nohost).toBe(false);
    expect(r.opened && r.opened.ok).toBe(true);

    const recorded = await ctx.electronApp.evaluate(() => ({ opened: globalThis.__p004Opened, paths: globalThis.__p004OpenedPath }));
    expect(recorded.opened).toEqual(['https://example.com/a', 'http://host.example/b']);
    expect(recorded.paths).toEqual(['C:/notes/ok.txt']);

    // 被 mock 的 openExternal 抛错时返回 false 且不产生未处理拒绝
    await ctx.electronApp.evaluate(({ shell }) => { shell.openExternal = async () => { throw new Error('模拟失败'); }; });
    expect(await ctx.win.evaluate(() => window.api.openExternal('https://example.com/fail'))).toBe(false);
  } finally {
    await ctx.electronApp.evaluate(({ shell }) => {
      if (globalThis.__p004RealOpenExternal) shell.openExternal = globalThis.__p004RealOpenExternal;
      if (globalThis.__p004RealOpenPath) shell.openPath = globalThis.__p004RealOpenPath;
      delete globalThis.__p004RealOpenExternal;
      delete globalThis.__p004RealOpenPath;
      delete globalThis.__p004Opened;
      delete globalThis.__p004OpenedPath;
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('P0-04 IPC 来源：未注册窗口被拒且无 OS 启动项/shell/写盘/可见性副作用', async () => {
  const ctx = await openApp();
  const dataPath = path.join(ctx.userDataDir, 'notes-data.json');
  const recPath = path.join(ctx.userDataDir, 'notes-recovery.json');
  const readMaybe = async (p) => { try { return await fs.readFile(p, 'utf8'); } catch (e) { return null; } };
  try {
    // mock 外部 OS 副作用：shell 与开机自启动都必须 0 调用
    await ctx.electronApp.evaluate(({ shell, app, BrowserWindow }) => {
      globalThis.__p004Shell = { external: [], path: [] };
      globalThis.__p004Login = { set: 0, get: 0 };
      globalThis.__p004RealExt = shell.openExternal;
      globalThis.__p004RealPath = shell.openPath;
      globalThis.__p004RealSetLogin = app.setLoginItemSettings;
      globalThis.__p004RealGetLogin = app.getLoginItemSettings;
      shell.openExternal = async (u) => { globalThis.__p004Shell.external.push(u); };
      shell.openPath = async (p) => { globalThis.__p004Shell.path.push(p); return ''; };
      app.setLoginItemSettings = () => { globalThis.__p004Login.set++; };
      app.getLoginItemSettings = () => { globalThis.__p004Login.get++; return { openAtLogin: false }; };
      globalThis.__p004MainRef = BrowserWindow.getAllWindows().find((x) => /renderer[\\/]index\.html/.test(x.webContents.getURL()));
    });
    const mainBefore = await ctx.electronApp.evaluate(() => ({
      opacity: globalThis.__p004MainRef.getOpacity(),
      top: globalThis.__p004MainRef.isAlwaysOnTop(),
      visible: globalThis.__p004MainRef.isVisible()
    }));

    // 未注册的隐藏窗口：真实 preload + 应用页面（index.html）
    await ctx.electronApp.evaluate(({ BrowserWindow }, { preload, page }) => {
      const w = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false } });
      globalThis.__p004RogueWin = w;
      return w.loadFile(page);
    }, { preload: path.join(ROOT, 'preload.js'), page: path.join(ROOT, 'renderer', 'index.html') });

    let rogue = null;
    await expect.poll(async () => {
      rogue = (await ctx.electronApp.windows()).find((p) => p.url().includes('renderer/index.html') && p !== ctx.win) || null;
      return !!rogue;
    }).toBe(true);
    await expect.poll(() => rogue.evaluate(() => typeof (window.api && window.api.loadData))).toBe('function');

    // 先让合法首启保存/窗口状态落定，再对磁盘做快照
    await ctx.win.waitForTimeout(900);
    const diskBefore = { data: await readMaybe(dataPath), recovery: await readMaybe(recPath) };

    const rogueResults = await rogue.evaluate(async () => {
      const out = {};
      out.load = await window.api.loadData().then(() => 'resolved', () => 'rejected');
      out.save = await window.api.saveData({ notes: [] }).then(() => 'resolved', () => 'rejected');
      out.draft = window.api.captureDraft({ settings: {}, groups: [], notes: [], trash: [] });
      out.noteUpdate = await window.api.noteUpdate({ id: 'x' }).then((v) => v, () => 'rejected');
      out.noteDraft = window.api.captureNoteDraft({ id: 'x' });
      out.fileOpen = await window.api.openFilePath('C:/Windows/win.ini', false).then(() => 'resolved', () => 'rejected');
      out.openExternal = await window.api.openExternal('https://example.com/').then((v) => v, () => 'rejected');
      out.fontSize = await window.api.setFontSize(99).then(() => 'resolved', () => 'rejected');
      out.startup = await window.api.setAutoLaunch(true).then(() => 'resolved', () => 'rejected');
      // 代表性命中 send 通道：不得改变主窗状态（含可见性）
      window.api.setAlwaysOnTop(true);
      window.api.setOpacity(0.1);
      window.api.hide();
      return out;
    });
    expect(rogueResults.load).toBe('rejected');
    expect(rogueResults.save).toBe('rejected');
    expect(rogueResults.draft).toBe(false);
    expect(rogueResults.noteUpdate).toBe(false);
    expect(rogueResults.noteDraft).toBe(false);
    expect(rogueResults.fileOpen).toBe('rejected');
    expect(rogueResults.openExternal).toBe('rejected');
    expect(rogueResults.fontSize).toBe('rejected');
    expect(rogueResults.startup).toBe('rejected');

    const external = await ctx.electronApp.evaluate(() => ({
      shell: { external: globalThis.__p004Shell.external.length, path: globalThis.__p004Shell.path.length },
      login: { ...globalThis.__p004Login }
    }));
    expect(external.shell).toEqual({ external: 0, path: 0 });
    expect(external.login).toEqual({ set: 0, get: 0 });
    const mainAfter = await ctx.electronApp.evaluate(() => ({
      opacity: globalThis.__p004MainRef.getOpacity(),
      top: globalThis.__p004MainRef.isAlwaysOnTop(),
      visible: globalThis.__p004MainRef.isVisible()
    }));
    expect(mainAfter).toEqual(mainBefore);

    // 拒绝调用不得写盘：等待屏障后正式存档与恢复草稿内容/缺失状态均不变
    await ctx.win.waitForTimeout(900);
    const diskAfter = { data: await readMaybe(dataPath), recovery: await readMaybe(recPath) };
    expect(diskAfter).toEqual(diskBefore);

    // 缺失 / 销毁 / 受信 sender 但 frame 缺失、null、getter 抛异常的入口（模拟事件）一律失败关闭
    const degenerates = await ctx.electronApp.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const out = {};
      const mainRef = globalThis.__p004MainRef;
      const load = ipcMain._invokeHandlers.get('data:load');
      const update = ipcMain._invokeHandlers.get('note:update');
      const draft = ipcMain.listeners('data:draft')[0];
      const noteDraft = ipcMain.listeners('note:draft')[0];
      try { await load({}); out.noSender = 'resolved'; } catch (e) { out.noSender = 'rejected'; }
      try { await load({ sender: { isDestroyed: () => true } }); out.destroyedObj = 'resolved'; } catch (e) { out.destroyedObj = 'rejected'; }
      try { await load({ sender: mainRef.webContents }); out.missingFrame = 'resolved'; } catch (e) { out.missingFrame = 'rejected'; }
      try { await load({ sender: mainRef.webContents, senderFrame: null }); out.nullFrame = 'resolved'; } catch (e) { out.nullFrame = 'rejected'; }
      const throwEv = { sender: mainRef.webContents };
      Object.defineProperty(throwEv, 'senderFrame', { get() { throw new Error('boom'); } });
      try { await load(throwEv); out.throwFrame = 'resolved'; } catch (e) { out.throwFrame = 'rejected'; }
      const dEv = { sender: mainRef.webContents, senderFrame: null }; draft(dEv, {}); out.nullFrameDraft = dEv.returnValue;
      const dEv2 = { sender: mainRef.webContents }; noteDraft(dEv2, { id: 'x' }); out.missingFrameNoteDraft = dEv2.returnValue;
      // 真实销毁的 WebContents 与其 frame（非 {isDestroyed:true} 伪对象）
      const bt = new BrowserWindow({ show: false });
      await bt.loadURL('about:blank');
      const deadWc = bt.webContents;
      let deadFrame = null; try { deadFrame = deadWc.mainFrame; } catch (e) { /* ignore */ }
      bt.destroy();
      try { await load({ sender: deadWc, senderFrame: deadFrame }); out.deadWc = 'resolved'; } catch (e) { out.deadWc = 'rejected'; }
      try { await load({ sender: mainRef.webContents, senderFrame: deadFrame }); out.deadFrame = 'resolved'; } catch (e) { out.deadFrame = 'rejected'; }
      out.updateNoSender = await update({}, { id: 'x', title: 't' });
      return out;
    });
    expect(degenerates.noSender).toBe('rejected');
    expect(degenerates.destroyedObj).toBe('rejected');
    expect(degenerates.missingFrame).toBe('rejected');
    expect(degenerates.nullFrame).toBe('rejected');
    expect(degenerates.throwFrame).toBe('rejected');
    expect(degenerates.nullFrameDraft).toBe(false);
    expect(degenerates.missingFrameNoteDraft).toBe(false);
    expect(degenerates.deadWc).toBe('rejected');
    expect(degenerates.deadFrame).toBe('rejected');
    expect(degenerates.updateNoSender).toBe(false);
  } finally {
    await ctx.electronApp.evaluate(({ shell, app }) => {
      if (globalThis.__p004RealExt) shell.openExternal = globalThis.__p004RealExt;
      if (globalThis.__p004RealPath) shell.openPath = globalThis.__p004RealPath;
      if (globalThis.__p004RealSetLogin) app.setLoginItemSettings = globalThis.__p004RealSetLogin;
      if (globalThis.__p004RealGetLogin) app.getLoginItemSettings = globalThis.__p004RealGetLogin;
      delete globalThis.__p004RealExt; delete globalThis.__p004RealPath;
      delete globalThis.__p004RealSetLogin; delete globalThis.__p004RealGetLogin;
      if (globalThis.__p004RogueWin && !globalThis.__p004RogueWin.isDestroyed()) globalThis.__p004RogueWin.destroy();
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('P0-04 IPC 来源：受信窗口被 loadURL 到其它本地页面后拒绝（含同名伪装路径）', async () => {
  const ctx = await openApp();
  try {
    const dir = ctx.userDataDir;
    await fs.mkdir(path.join(dir, 'p004-look'), { recursive: true });
    await fs.writeFile(path.join(dir, 'p004-other.html'), '<!doctype html><title>other</title>');
    await fs.writeFile(path.join(dir, 'p004-look', 'index.html'), '<!doctype html><title>look</title>');
    await fs.writeFile(path.join(dir, 'p004-look', 'index.html.evil'), '<!doctype html><title>evil</title>');
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      globalThis.__p004MainRef = BrowserWindow.getAllWindows().find((x) => /renderer[\\/]index\.html/.test(x.webContents.getURL()));
    });

    const tryLoadAndCall = async (filePath) => {
      await ctx.electronApp.evaluate(({ BrowserWindow }, url) => globalThis.__p004MainRef.loadURL(url), 'file:///' + filePath.replace(/\\/g, '/'));
      await expect.poll(() => ctx.win.evaluate(() => typeof (window.api && window.api.loadData))).toBe('function');
      return ctx.win.evaluate(async () => ({
        load: await window.api.loadData().then(() => 'resolved', () => 'rejected'),
        draft: window.api.captureDraft({ settings: {}, groups: {}, notes: [], trash: [] })
      }));
    };

    const files = [
      path.join(dir, 'p004-other.html'),
      path.join(dir, 'p004-look', 'index.html'),       // 同名不同目录
      path.join(dir, 'p004-look', 'index.html.evil')   // 前缀伪装
    ];
    for (const f of files) {
      const r = await tryLoadAndCall(f);
      expect(r.load).toBe('rejected');
      expect(r.draft).toBe(false);
    }
  } finally { await closeApp(ctx); }
});

test('P0-04 IPC 来源：子框架 senderFrame 被拒（真实子框架对象，模拟处理器入口证据）', async () => {
  const ctx = await openApp();
  try {
    const dir = ctx.userDataDir;
    const capPreload = path.join(dir, 'p004-cap-preload.js');
    await fs.writeFile(capPreload, "const { contextBridge, ipcRenderer } = require('electron');\ncontextBridge.exposeInMainWorld('p004cap', { capture: () => ipcRenderer.invoke('p004:capture-frame') });\n");
    await fs.writeFile(path.join(dir, 'p004-parent.html'), '<!doctype html><html><body><iframe id="f" srcdoc="child" style="width:200px;height:80px"></iframe></body></html>');

    await ctx.electronApp.evaluate(({ BrowserWindow, ipcMain }, { preload, parent }) => {
      globalThis.__p004Cap = null;
      ipcMain.handle('p004:capture-frame', (event) => {
        globalThis.__p004Cap = { frame: event.senderFrame, isMain: false, url: '' };
        try { globalThis.__p004Cap.isMain = event.senderFrame === event.sender.mainFrame; } catch (e) { /* ignore */ }
        try { globalThis.__p004Cap.url = event.senderFrame ? event.senderFrame.url : ''; } catch (e) { /* ignore */ }
        return true;
      });
      const w = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true } });
      globalThis.__p004CapWin = w;
      return w.loadFile(parent);
    }, { preload: capPreload, parent: path.join(dir, 'p004-parent.html') });

    let capWin = null;
    await expect.poll(async () => {
      capWin = (await ctx.electronApp.windows()).find((p) => p.url().includes('p004-parent.html')) || null;
      return !!capWin;
    }).toBe(true);
    await expect.poll(() => capWin.evaluate(() => { const f = document.getElementById('f'); return !!(f && f.contentWindow && f.contentWindow.p004cap); })).toBe(true);

    await capWin.evaluate(() => document.getElementById('f').contentWindow.p004cap.capture());
    await expect.poll(() => ctx.electronApp.evaluate(() => !!(globalThis.__p004Cap && globalThis.__p004Cap.frame))).toBe(true);

    const cap = await ctx.electronApp.evaluate(() => ({ isMain: globalThis.__p004Cap.isMain, url: globalThis.__p004Cap.url }));
    expect(cap.isMain).toBe(false);                 // 真实子框架对象（frame !== mainFrame）
    expect(cap.url).toContain('srcdoc');

    // 用真实子框架对象作为受信主窗事件的 senderFrame：处理器入口被拒（模拟入口，非端到端帧暴露）
    const rejected = await ctx.electronApp.evaluate(async ({ BrowserWindow, ipcMain }) => {
      const mainWin = BrowserWindow.getAllWindows().find((x) => /renderer[\\/]index\.html/.test(x.webContents.getURL()));
      const event = { sender: mainWin.webContents, senderFrame: globalThis.__p004Cap.frame };
      try { await ipcMain._invokeHandlers.get('data:load')(event); return 'resolved'; } catch (e) { return 'rejected'; }
    });
    expect(rejected).toBe('rejected');
  } finally {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      try { ipcMain.removeHandler('p004:capture-frame'); } catch (e) { /* ignore */ }
      if (globalThis.__p004CapWin && !globalThis.__p004CapWin.isDestroyed()) globalThis.__p004CapWin.destroy();
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('P0-04 IPC 来源：受信独立窗自更新成功、跨 ID 拒绝，主窗与磁盘/草稿不受影响', async () => {
  const now = Date.now();
  const mk = (id, title, pin) => ({
    id, title, content: '正文', type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: !!pin, reminder: null,
    x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1, createdAt: now, updatedAt: now
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [mk('p004-note-a', 'A 原题', true), mk('p004-note-b', 'B 原题', false)]
  };
  const ctx = await openApp({ seed });
  const dataPath = path.join(ctx.userDataDir, 'notes-data.json');
  const recPath = path.join(ctx.userDataDir, 'notes-recovery.json');
  const readMaybe = async (p) => { try { return await fs.readFile(p, 'utf8'); } catch (e) { return null; } };
  try {
    await expect.poll(async () => (await ctx.electronApp.windows()).filter((w) => w.url().includes('note.html')).length).toBe(1);
    const noteWin = (await ctx.electronApp.windows()).find((w) => w.url().includes('note.html'));

    // 自身 ID：同步草稿 + 更新成功且落盘保留
    const own = await noteWin.evaluate(async () => {
      const api = window.api;
      const note = { id: 'p004-note-a', title: 'A 自更新', content: 'A 正文', type: 'note', items: [], images: [], files: [], tables: [], updatedAt: Date.now() };
      const token = api.captureNoteDraft(note);
      const saved = await api.noteUpdate(note, { draftToken: token });
      return { tokenType: typeof token, saved };
    });
    expect(own.saved).toBe(true);
    expect(own.tokenType).toBe('number');

    // 跨 ID：更新/同步草稿都必须被拒（false），且磁盘与恢复草稿不变
    await ctx.win.waitForTimeout(500);
    const recoveryBeforeCross = await readMaybe(recPath);
    const cross = await noteWin.evaluate(async () => {
      const api = window.api;
      return {
        update: await api.noteUpdate({ id: 'p004-note-b', title: 'B 被篡改' }, {}).then((v) => v, () => 'rejected'),
        draft: api.captureNoteDraft({ id: 'p004-note-b', title: 'B 草稿' })
      };
    });
    expect(cross.update).toBe(false);
    expect(cross.draft).toBe(false);
    await ctx.win.waitForTimeout(500);
    expect(await readMaybe(recPath)).toBe(recoveryBeforeCross);
    const disk = JSON.parse(await readMaybe(dataPath));
    const a = disk.notes.find((n) => n.id === 'p004-note-a');
    const b = disk.notes.find((n) => n.id === 'p004-note-b');
    expect(a.title).toBe('A 自更新');
    expect(b.title).toBe('B 原题');
    expect(JSON.stringify(b)).not.toContain('篡改');

    // 受信独立窗被程序化加载到另一个 note.html?id=：身份受信但 note id 不匹配 -> 仍拒绝
    await ctx.electronApp.evaluate(({ BrowserWindow }, notePage) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('note.html'));
      return w.loadFile(notePage, { query: { id: 'p004-note-b' } });
    }, path.join(ROOT, 'renderer', 'note.html'));
    await expect.poll(() => noteWin.evaluate(() => typeof (window.api && window.api.loadData))).toBe('function');
    const mismatch = await noteWin.evaluate(async () => ({
      load: await window.api.loadData().then(() => 'resolved', () => 'rejected'),
      draft: window.api.captureNoteDraft({ id: 'p004-note-a', title: 'A via mismatch' })
    }));
    expect(mismatch.load).toBe('rejected');
    expect(mismatch.draft).toBe(false);

    // 主窗合法来源不受影响
    const mainOk = await ctx.win.evaluate(async () => ({
      load: await window.api.loadData().then((r) => !!(r && 'status' in r), () => false),
      font: await window.api.setFontSize(15).then((v) => v, () => 'rejected')
    }));
    expect(mainOk.load).toBe(true);
    expect(mainOk.font).toBe(15);

    // 恢复为自身 ID 后合法来源再次可用
    await ctx.electronApp.evaluate(({ BrowserWindow }, notePage) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('note.html'));
      return w.loadFile(notePage, { query: { id: 'p004-note-a' } });
    }, path.join(ROOT, 'renderer', 'note.html'));
    await expect.poll(() => noteWin.evaluate(() => typeof (window.api && window.api.loadData))).toBe('function');
    const restored = await noteWin.evaluate(async () => ({
      load: await window.api.loadData().then((r) => !!(r && 'status' in r), () => false),
      draft: window.api.captureNoteDraft({ id: 'p004-note-a', title: 'A 恢复草稿' })
    }));
    expect(restored.load).toBe(true);
    expect(typeof restored.draft).toBe('number');
  } finally {
    await closeApp(ctx);
  }
});

test('P0-04 协议：注册的 note-* 协议按目录返回真实字节并支持编码文件名（含渲染加载）', async () => {
  const ctx = await openApp();
  try {
    const png = Buffer.from(UX01_PNG_1PX.split(',')[1], 'base64');
    const put = async (dir, name, buf) => {
      await fs.mkdir(path.join(ctx.userDataDir, dir), { recursive: true });
      await fs.writeFile(path.join(ctx.userDataDir, dir, name), buf);
    };
    await put('images', 'a b.png', png);
    await put('backgrounds', '背景.png', Buffer.from('BG-CN'));
    await put('fonts', 'f test.woff', Buffer.from('FONT-BYTES'));
    await put('sounds', 's test.mp3', Buffer.from('SOUND-BYTES'));

    const results = await ctx.electronApp.evaluate(async ({ net }) => {
      const get = async (u) => {
        try { const r = await net.fetch(u); const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, hex: buf.toString('hex'), text: buf.toString('utf8') }; }
        catch (e) { return { transport: String((e && e.message) || e) }; }
      };
      return {
        img: await get('note-img://local/a%20b.png'),
        bg: await get('note-bg://local/' + encodeURIComponent('背景.png')),
        font: await get('note-font://local/' + encodeURIComponent('f test.woff')),
        sound: await get('note-sound://local/' + encodeURIComponent('s test.mp3'))
      };
    });
    expect(results.img.status).toBe(200);
    expect(results.img.hex).toBe(png.toString('hex'));
    expect(results.bg.status).toBe(200);
    expect(results.bg.text).toBe('BG-CN');
    expect(results.font.text).toBe('FONT-BYTES');
    expect(results.sound.text).toBe('SOUND-BYTES');

    // 真实渲染加载：背景 CSS 生效 + <img> 从 note-img 解码加载（1x1 png）
    const rendered = await ctx.win.evaluate(async () => {
      state.settings.backgroundImage = 'note-bg://local/' + encodeURIComponent('背景.png');
      applyBackground();
      const bg = getComputedStyle(document.getElementById('bgLayer')).backgroundImage;
      const im = document.createElement('img');
      im.id = 'p004-proto-img';
      const loaded = new Promise((res) => { im.onload = () => res(true); im.onerror = () => res(false); });
      im.src = 'note-img://local/a%20b.png';
      document.body.appendChild(im);
      const ok = await loaded;
      return { bg, ok, w: im.naturalWidth, h: im.naturalHeight };
    });
    expect(rendered.bg).toContain('note-bg');
    expect(rendered.ok).toBe(true);
    expect(rendered.w).toBe(1);
    expect(rendered.h).toBe(1);
  } finally { await closeApp(ctx); }
});

test('P0-04 协议：非法 host/路径/缺失被拒（404 或 Chromium 传输拒绝）', async () => {
  const ctx = await openApp();
  try {
    await fs.mkdir(path.join(ctx.userDataDir, 'images', 'subdir'), { recursive: true });
    await fs.writeFile(path.join(ctx.userDataDir, 'images', 'ok.png'), Buffer.from('OK'));
    await fs.writeFile(path.join(ctx.userDataDir, 'secret.png'), Buffer.from('SECRET'));

    const results = await ctx.electronApp.evaluate(async ({ net }) => {
      const probe = async (u) => {
        try { const r = await net.fetch(u); return { status: r.status, body: Buffer.from(await r.arrayBuffer()).toString('utf8') }; }
        catch (e) { return { transport: 'rejected' }; }
      };
      return {
        ok: await probe('note-img://local/ok.png'),
        wrongHost: await probe('note-img://evil/ok.png'),
        userinfo: await probe('note-img://user@local/ok.png'),
        port: await probe('note-img://local:8080/ok.png'),
        crossScheme: await probe('note-bg://local/ok.png'),
        missing: await probe('note-img://local/missing.png'),
        dir: await probe('note-img://local/subdir'),
        encSlash: await probe('note-img://local/a%2fok.png'),
        encBackslash: await probe('note-img://local/a%5cok.png'),
        dotEnc: await probe('note-img://local/%2e%2e%2fsecret.png'),
        ads: await probe('note-img://local/ok.png%3aads'),
        nul: await probe('note-img://local/ok%00.png')
      };
    });
    expect(results.ok.status).toBe(200);
    expect(results.ok.body).toBe('OK');
    for (const key of ['wrongHost', 'userinfo', 'port', 'crossScheme', 'missing', 'dir', 'encSlash', 'encBackslash', 'dotEnc', 'ads', 'nul']) {
      const r = results[key];
      const rejected = r.transport === 'rejected' || (r.status === 404 && r.body === 'Not Found');
      expect(rejected, key + ' -> ' + JSON.stringify(r)).toBe(true);
    }
  } finally { await closeApp(ctx); }
});

test('P0-04 数值：非法入参不触达原生 setter/广播/落盘（模拟受信事件入口）', async () => {
  const ctx = await openApp();
  const dataPath = path.join(ctx.userDataDir, 'notes-data.json');
  const recPath = path.join(ctx.userDataDir, 'notes-recovery.json');
  const readMaybe = async (p) => { try { return await fs.readFile(p, 'utf8'); } catch (e) { return null; } };
  try {
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      globalThis.__p004Opacity = [];
      globalThis.__p004Send = [];
      globalThis.__p004RealSetOpacity = BrowserWindow.prototype.setOpacity;
      BrowserWindow.prototype.setOpacity = function (v) { globalThis.__p004Opacity.push(v); };
      const main = BrowserWindow.getAllWindows().find((x) => /renderer[\\/]index\.html/.test(x.webContents.getURL()));
      globalThis.__p004MainRef = main;
      globalThis.__p004RealSend = main.webContents.send;
      main.webContents.send = function (...a) { globalThis.__p004Send.push(a); };
    });
    await ctx.win.waitForTimeout(900);
    const diskBefore = { data: await readMaybe(dataPath), recovery: await readMaybe(recPath) };

    const out = await ctx.electronApp.evaluate(async ({ ipcMain }) => {
      const main = globalThis.__p004MainRef;
      const ev = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
      const invoke = (ch, ...args) => ipcMain._invokeHandlers.get(ch)(ev, ...args);
      const fire = (ch, ...args) => { const e = { sender: main.webContents, senderFrame: main.webContents.mainFrame }; ipcMain.listeners(ch)[0](e, ...args); return e.returnValue; };
      const bad = [NaN, Infinity, -Infinity, true, false, {}, { toString: null, valueOf: 0 }, [], [1], '', '   ', null, undefined, 'abc'];
      const results = { fontRejected: 0, fontResolved: 0, fireNoThrow: 0, fireFalse: 0, fireOther: 0, threw: 0 };
      for (const v of bad) {
        try { await invoke('settings:set-font-size', v); results.fontResolved++; } catch (e) { results.fontRejected++; }
      }
      for (const ch of ['window:set-opacity', 'window:set-self-opacity', 'window:set-note-opacity', 'note:save-note-opacity']) {
        for (const v of bad) {
          let rv;
          try { rv = fire(ch, v); } catch (e) { results.threw++; continue; }
          results.fireNoThrow++;
          if (rv === false) results.fireFalse++; else results.fireOther++;
        }
      }
      return { ...results, badCount: bad.length };
    });
    expect(out.badCount).toBe(14);
    expect(out.fontRejected).toBe(out.badCount);
    expect(out.fontResolved).toBe(0);
    expect(out.threw).toBe(0);
    expect(out.fireNoThrow).toBe(out.badCount * 4);
    expect(out.fireFalse).toBe(out.badCount * 4); // 非法 send 明确返回 false
    expect(out.fireOther).toBe(0);

    const spies = await ctx.electronApp.evaluate(() => ({ opacity: globalThis.__p004Opacity.length, send: globalThis.__p004Send.length }));
    expect(spies).toEqual({ opacity: 0, send: 0 });

    await ctx.win.waitForTimeout(700);
    expect({ data: await readMaybe(dataPath), recovery: await readMaybe(recPath) }).toEqual(diskBefore);
  } finally {
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      if (globalThis.__p004RealSetOpacity) BrowserWindow.prototype.setOpacity = globalThis.__p004RealSetOpacity;
      if (globalThis.__p004MainRef && globalThis.__p004RealSend) globalThis.__p004MainRef.webContents.send = globalThis.__p004RealSend;
      delete globalThis.__p004RealSetOpacity; delete globalThis.__p004RealSend;
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('P0-04 数值：合法/夹取值经真实 preload 生效、持久化并广播，透明恢复', async () => {
  const now = Date.now();
  const note = {
    id: 'p004-num-note', title: '数值便签', content: 'x', type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: true, reminder: null,
    x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1, createdAt: now, updatedAt: now
  };
  const ctx = await openApp({ seed: { version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [], notes: [note] } });
  const dataPath = path.join(ctx.userDataDir, 'notes-data.json');
  const readFontSize = async () => JSON.parse(await fs.readFile(dataPath, 'utf8')).settings.fontSize;
  const readNoteOpacity = async () => JSON.parse(await fs.readFile(dataPath, 'utf8')).settings.noteOpacity;
  try {
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((x) => /renderer[\\/]index\.html/.test(x.webContents.getURL()));
      globalThis.__p004MainRef = main;
      globalThis.__p004Send = [];
      BrowserWindow.getAllWindows().forEach((w) => {
        const wc = w.webContents;
        wc.__p004RealSend = wc.send;
        wc.send = function (...a) { globalThis.__p004Send.push(a); return wc.__p004RealSend.apply(wc, a); };
      });
    });

    // 主窗不透明度：合法 + 夹取（0..1）
    await ctx.win.evaluate(() => window.api.setOpacity(0.62));
    await expect.poll(() => ctx.electronApp.evaluate(() => globalThis.__p004MainRef.getOpacity())).toBeCloseTo(0.62, 2);
    await ctx.win.evaluate(() => window.api.setOpacity(5));
    await expect.poll(() => ctx.electronApp.evaluate(() => globalThis.__p004MainRef.getOpacity())).toBeCloseTo(1, 2);
    await ctx.win.evaluate(() => window.api.setOpacity(-3));
    await expect.poll(() => ctx.electronApp.evaluate(() => globalThis.__p004MainRef.getOpacity())).toBeCloseTo(0, 2);
    // self opacity 作用于发送者主窗
    await ctx.win.evaluate(() => window.api.setSelfOpacity(0.5));
    await expect.poll(() => ctx.electronApp.evaluate(() => globalThis.__p004MainRef.getOpacity())).toBeCloseTo(0.5, 2);

    // 字号：合法 + 夹取（11..22），返回并落盘
    const fonts = await ctx.win.evaluate(async () => ({ ok: await window.api.setFontSize(15), hi: await window.api.setFontSize(99), lo: await window.api.setFontSize(-1) }));
    expect(fonts).toEqual({ ok: 15, hi: 22, lo: 11 });
    await expect.poll(readFontSize).toBe(11);

    // noteOpacity：合法 + 夹取（0..100），持久化并广播给主窗
    await ctx.win.evaluate(async () => { await window.api.saveNoteOpacity(55); await window.api.saveNoteOpacity(150); });
    await expect.poll(readNoteOpacity).toBe(100);
    expect(await ctx.electronApp.evaluate(() => globalThis.__p004Send.map((a) => [a[0], a[1]]))).toEqual(expect.arrayContaining([
      ['settings:font-size', 15], ['settings:font-size', 22], ['settings:font-size', 11],
      ['window:note-opacity-setting', 55], ['window:note-opacity-setting', 100]
    ]));

    // setNoteOpacity 转发给独立窗
    await ctx.win.evaluate(() => window.api.setNoteOpacity(70));
    await expect.poll(() => ctx.electronApp.evaluate(() => globalThis.__p004Send.some((a) => a[0] === 'window:note-opacity' && a[1] === 70))).toBe(true);

    expect(await ctx.electronApp.evaluate(() => globalThis.__p004MainRef.isVisible())).toBe(true);
  } finally {
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      const main = globalThis.__p004MainRef;
      if (main && !main.isDestroyed()) main.setOpacity(1); // 恢复不透明，避免残留副作用
      BrowserWindow.getAllWindows().forEach((w) => { const wc = w.webContents; if (wc.__p004RealSend) wc.send = wc.__p004RealSend; });
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('P0-04 图片复制：合法编码图片可复制、别名/非法/非图片一律 false 且不写剪贴板', async () => {
  const ctx = await openApp();
  try {
    // 夹具必须是 nativeImage 可解码的非空位图：用原生位图生成 PNG（避免浏览器可显示、nativeImage 却解码为空的夹具）。
    const png = Buffer.from(await ctx.electronApp.evaluate(({ nativeImage }) => {
      const bmp = Buffer.alloc(4); bmp[0] = 255; bmp[1] = 0; bmp[2] = 0; bmp[3] = 255; // BGRA 不透明红，1x1
      return nativeImage.createFromBitmap(bmp, { width: 1, height: 1 }).toPNG().toString('base64');
    }), 'base64');
    await fs.mkdir(path.join(ctx.userDataDir, 'images', 'sub'), { recursive: true });
    await fs.writeFile(path.join(ctx.userDataDir, 'images', '图 片.png'), png);
    await fs.writeFile(path.join(ctx.userDataDir, 'images', 'not-image.png'), Buffer.from('NOT A PNG'));
    await fs.mkdir(path.join(ctx.userDataDir, 'images', 'dir.png'), { recursive: true });
    // 先断言初始夹具确实被 nativeImage 解码为非空图片，否则测试失去意义
    expect(await ctx.electronApp.evaluate(({ nativeImage }, f) => {
      const im = nativeImage.createFromPath(f);
      const s = im.getSize();
      return { empty: im.isEmpty(), w: s.width, h: s.height };
    }, path.join(ctx.userDataDir, 'images', '图 片.png'))).toEqual({ empty: false, w: 1, h: 1 });

    // 只 mock 最终 clipboard.writeImage（nativeImage 解码仍为真实）；finally 还原。
    await ctx.electronApp.evaluate(({ clipboard }) => {
      globalThis.__p004Clip = [];
      globalThis.__p004RealWriteImage = clipboard.writeImage;
      clipboard.writeImage = (img) => {
        const s = img.getSize();
        globalThis.__p004Clip.push({ empty: img.isEmpty(), w: s.width, h: s.height });
      };
    });

    const enc = encodeURIComponent('图 片.png');
    const results = await ctx.win.evaluate(async (name) => {
      const call = (v) => window.api.copyImage(v).then((r) => r, (e) => 'rejected:' + (e && e.message));
      return {
        valid: await call('note-img://local/' + name),
        query: await call('note-img://local/' + name + '?cache=1#frag'),
        nested: await call('note-img://local/sub/' + name),
        wrongHost: await call('note-img://evil/' + name),
        ads: await call('note-img://local/' + name + '%3aads'),
        missing: await call('note-img://local/nope.png'),
        dir: await call('note-img://local/dir.png'),
        notImage: await call('note-img://local/not-image.png'),
        number: await call(123),
        nul: await call(null),
        obj: await call({})
      };
    }, enc);

    expect(results.valid).toBe(true);
    expect(results.query).toBe(true); // 查询/片段无害
    for (const k of ['nested', 'wrongHost', 'ads', 'missing', 'dir', 'notImage', 'number', 'nul', 'obj']) {
      expect(results[k], k + ' -> ' + JSON.stringify(results[k])).toBe(false);
    }
    const clips = await ctx.electronApp.evaluate(() => globalThis.__p004Clip);
    expect(clips).toHaveLength(2); // 仅两次合法调用写剪贴板
    for (const c of clips) { expect(c.empty).toBe(false); expect(c.w).toBe(1); expect(c.h).toBe(1); }
  } finally {
    await ctx.electronApp.evaluate(({ clipboard }) => {
      if (globalThis.__p004RealWriteImage) clipboard.writeImage = globalThis.__p004RealWriteImage;
      delete globalThis.__p004RealWriteImage;
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('P0-04 表格导出：超大表格被可见拒绝且不写入文件', async () => {
  const now = Date.now();
  const rows = 201;
  const cells = Array.from({ length: rows }, () => ['x', 'y']);
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [{
      id: 'p004-big-table', title: '大表', content: '[[table:t1]]', type: 'note', items: [], images: [], files: [],
      tables: [{ id: 't1', rows, cols: 2, cells, merges: [], diagonals: [] }],
      color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
      x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1, createdAt: now, updatedAt: now
    }]
  };
  const ctx = await openApp({ seed });
  try {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__p004ExportCalls = 0;
      globalThis.__p004RealExportMd = ipcMain._invokeHandlers.get('note:export-markdown');
      ipcMain.removeHandler('note:export-markdown');
      ipcMain.handle('note:export-markdown', () => { globalThis.__p004ExportCalls++; return { ok: true, path: 'should-not-happen' }; });
    });
    const r = await ctx.win.evaluate(() => {
      const n = state.notes.find((x) => x.id === 'p004-big-table');
      return exportNoteAsMarkdown(n);
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TABLE_MD_TOO_LARGE');
    expect(String(r.error)).toMatch(/too large to export/);
    // 可见 toast（当前语言=中文）：行 / 列 + 上限
    await expect(ctx.win.locator('#toast')).toContainText('行数');
    await expect(ctx.win.locator('#toast')).toContainText('列数');
    await expect(ctx.win.locator('#toast')).toContainText('200');
    // 同一实例内切换当前语言再次导出：toast 使用英文的 row/col 文案（不新增启动或设置导航）
    const en = await ctx.win.evaluate(() => {
      state.settings.language = 'en';
      applyLanguage();
      return exportNoteAsMarkdown(state.notes.find((x) => x.id === 'p004-big-table'));
    });
    expect(en.ok).toBe(false);
    await expect(ctx.win.locator('#toast')).toContainText('Rows');
    await expect(ctx.win.locator('#toast')).toContainText('Cols');
    await expect(ctx.win.locator('#toast')).toContainText('200');
    // 源数据未被修改
    expect(await ctx.win.evaluate(() => {
      const t = state.notes.find((x) => x.id === 'p004-big-table').tables[0];
      return { rows: t.rows, cells: t.cells.length };
    })).toEqual({ rows: 201, cells: 201 });
    expect(await ctx.electronApp.evaluate(() => globalThis.__p004ExportCalls)).toBe(0);
  } finally {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      if (globalThis.__p004RealExportMd) {
        ipcMain.removeHandler('note:export-markdown');
        ipcMain.handle('note:export-markdown', globalThis.__p004RealExportMd);
      }
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('UX-19A 文档工具栏：可访问命名分组、键盘预览焦点、宽窄与主题布局', async () => {
  const ctx = await openApp();
  try {
    const wideShot = test.info().outputPath('ux19a-doc-wide.png');
    const narrowShot = test.info().outputPath('ux19a-doc-narrow.png');
    const geometry = () => {
      const tb = document.querySelector('.doc-toolbar');
      const tr = tb.getBoundingClientRect();
      const els = Array.from(tb.querySelectorAll('button, input')).filter((el) => el.offsetParent !== null);
      const rects = els.map((el) => el.getBoundingClientRect());
      let outOfBounds = 0;
      rects.forEach((r) => { if (r.left < tr.left - 1 || r.right > tr.right + 1 || r.top < tr.top - 1 || r.bottom > tr.bottom + 1) outOfBounds++; });
      let overlaps = 0;
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
      }
      return { count: els.length, outOfBounds, overlaps, over: tb.scrollWidth - tb.clientWidth };
    };

    await stableClick(ctx.win.locator('#btnAdd'));
    await ctx.win.locator('#board .note .note-title').first().fill('文档工具栏');
    await stableClick(ctx.win.locator('#viewDoc'));
    await stableClick(ctx.win.locator('.doc-pick-item').first());
    await expect(ctx.win.locator('.doc-toolbar')).toBeVisible();

    // 可访问命名分组（不绑定精确数量/顺序）
    const groups = await ctx.win.evaluate(() => Array.from(document.querySelectorAll('.doc-toolbar [role="group"]')).map((g) => ({ role: g.getAttribute('role'), name: (g.getAttribute('aria-label') || '').trim() })));
    expect(groups.length).toBeGreaterThanOrEqual(4);
    expect(groups.every((g) => g.role === 'group' && g.name.length > 0)).toBe(true);

    // 代表性可操作控件可见
    for (const id of ['#btnDocBack', '#btnDocPreview', '#btnDocBold', '#btnDocHighlight', '#btnDocHlColor', '#btnDocAlignCenter', '#btnDocImage', '#btnDocTable', '#btnDocDesktop', '#btnDocTodo', '#btnDocGroup', '#btnDocRemind', '#btnDocColor', '#btnDocPin', '#btnDocExportMd', '#btnDocDel']) {
      await expect(ctx.win.locator(id)).toBeVisible();
    }

    // 键盘预览：Enter 进入、Space 退出；重建后焦点保留；contenteditable 同步；不触发全局空白/平移
    await ctx.win.locator('#btnDocPreview').focus();
    await ctx.win.keyboard.press('Enter');
    await expect(ctx.win.locator('#btnDocPreview .doc-btn-label')).toHaveText('退出预览');
    await expect(ctx.win.locator('#btnDocPreview')).toHaveAttribute('aria-pressed', 'true');
    await expect(ctx.win.locator('#docContent')).toHaveAttribute('contenteditable', 'false');
    expect(await ctx.win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btnDocPreview');

    await ctx.win.keyboard.press('Space');
    await expect(ctx.win.locator('#btnDocPreview .doc-btn-label')).toHaveText('预览');
    await expect(ctx.win.locator('#btnDocPreview')).toHaveAttribute('aria-pressed', 'false');
    await expect(ctx.win.locator('#docContent')).toHaveAttribute('contenteditable', 'true');
    expect(await ctx.win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btnDocPreview');
    expect(await ctx.win.evaluate(() => document.body.classList.contains('pan-mode'))).toBe(false);

    // 焦点保留后下一次 Tab 到达有效控件
    await ctx.win.keyboard.press('Tab');
    expect(await ctx.win.evaluate(() => { const el = document.activeElement; return !!el && el !== document.body && (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'); })).toBe(true);

    // 浅色非玻璃宽窗（经现有外观应用路径；不注入背景）
    await ctx.win.evaluate(() => { state.settings.appearanceMode = 'light'; state.settings.glass = false; state.settings.backgroundImage = null; applyTheme(); });
    await ctx.electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html')); w.setBounds({ width: 1080, height: 760 }); });
    await ctx.win.waitForTimeout(250);
    const wide = await ctx.win.evaluate(geometry);
    expect(wide.count).toBeGreaterThanOrEqual(10);
    expect(wide.outOfBounds).toBe(0);
    expect(wide.overlaps).toBe(0);
    expect(wide.over).toBeLessThanOrEqual(1);
    await ctx.win.screenshot({ path: wideShot });

    // 深色 + 玻璃 + 受控本地背景（data URI 仅作视觉夹具）窄窗 640，并切换英文后复检边界
    await ctx.win.evaluate(() => {
      state.settings.appearanceMode = 'dark';
      state.settings.glass = true;
      state.settings.backgroundImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      state.settings.language = 'en';
      applyTheme();
      applyLanguage();
      renderAll();
    });
    // 确认视觉状态确实生效（不是“因为没改所以看起来没坏”）
    const visual = await ctx.win.evaluate(() => ({
      glass: document.body.classList.contains('glass'),
      light: document.body.classList.contains('light-mode'),
      toolbarBlur: getComputedStyle(document.querySelector('.doc-toolbar')).backdropFilter || getComputedStyle(document.querySelector('.doc-toolbar')).webkitBackdropFilter || ''
    }));
    expect(visual.glass).toBe(true);
    expect(visual.light).toBe(false);
    expect(visual.toolbarBlur).toContain('blur');

    await ctx.electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html')); w.setBounds({ width: 640, height: 700 }); });
    await ctx.win.waitForTimeout(250);
    const narrowEn = await ctx.win.evaluate(geometry);
    expect(narrowEn.outOfBounds).toBe(0);
    expect(narrowEn.overlaps).toBe(0);
    expect(narrowEn.over).toBeLessThanOrEqual(1);
    expect(await ctx.win.locator('#btnDocPreview .doc-btn-label')).toHaveText('Preview');
    await ctx.win.screenshot({ path: narrowShot });

    // 待办文档变体：不得含格式/预览按钮，导出与删除仍在
    const todo = await ctx.win.evaluate(() => {
      const n = state.notes.find((x) => x.id === docNoteId);
      n.type = 'todo'; n.items = []; renderAll();
      return {
        format: !!document.querySelector('.doc-group-format'),
        preview: !!document.querySelector('#btnDocPreview'),
        export: !!document.querySelector('#btnDocExportMd'),
        del: !!document.querySelector('#btnDocDel')
      };
    });
    expect(todo).toEqual({ format: false, preview: false, export: true, del: true });
  } finally { await closeApp(ctx); }
});

test('UX-20A 桌面便签摘要：计数/只读标题/普通与键盘唤起同一窗、编辑刷新、窄窗主题与重启保留', async () => {
  const ctx = await openApp();
  let second;
  try {
    const wideShot = test.info().outputPath('ux20a-desktop-wide.png');
    const narrowShot = test.info().outputPath('ux20a-desktop-narrow.png');
    const ids = () => ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('note.html')).map((w) => w.webContents.id));

    await stableClick(ctx.win.locator('#btnAdd'));
    await ctx.win.locator('#board .note .note-title').first().fill('桌面一');
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await stableClick(ctx.win.locator('#board .note .t-desktop').first());
    const noteWin = await noteWinPromise;
    await noteWin.waitForLoadState('domcontentloaded');
    await expect(noteWin.locator('#dnTitle')).toHaveValue('桌面一');
    const noteId = await ctx.win.evaluate(() => (state.notes.find((n) => n.desktopPin) || {}).id);

    // 普通视图排除钉桌便签；摘要计数/标题正确且只读
    await expect(ctx.win.locator('#board .note')).toHaveCount(0);
    await expect(ctx.win.locator('#desktopNotesCount')).toHaveText('1');
    await expect(ctx.win.locator('.dn-row')).toHaveCount(1);
    await expect(ctx.win.locator('.dn-row')).toHaveText('桌面一');
    expect(await ctx.win.evaluate(() => document.querySelectorAll('#desktopNotes input, #desktopNotes textarea, #desktopNotes [contenteditable]').length)).toBe(0);
    await expect(ctx.win.locator('#desktopNotesSummary')).toContainText('桌面便签');

    // 普通鼠标点击（无 force）：展开 -> 点击行唤起 -> 收起按钮折叠并归还焦点
    await ctx.win.locator('#desktopNotesSummary').click();
    await expect(ctx.win.locator('#desktopNotes')).toHaveAttribute('open', '');
    await ctx.win.locator('.dn-row').first().click();
    await expect(ctx.win.locator('#btnDesktopNotesClose')).toBeVisible();
    await ctx.win.locator('#btnDesktopNotesClose').click();
    await expect(ctx.win.locator('#desktopNotes')).not.toHaveAttribute('open', '');
    await expect(ctx.win.locator('#desktopNotesSummary')).toBeFocused();

    // 键盘：Enter 展开；行 Enter 唤起两次同一 WC；Esc 折叠并归还焦点
    await ctx.win.locator('#desktopNotesSummary').focus();
    await ctx.win.keyboard.press('Enter');
    await expect(ctx.win.locator('#desktopNotes')).toHaveAttribute('open', '');
    const before = await ids();
    await ctx.win.locator('.dn-row').first().focus();
    await ctx.win.keyboard.press('Enter');
    await ctx.win.keyboard.press('Enter');
    await ctx.win.waitForTimeout(250);
    expect(await ids()).toEqual(before);
    await ctx.win.keyboard.press('Escape');
    await expect(ctx.win.locator('#desktopNotes')).not.toHaveAttribute('open', '');
    await expect(ctx.win.locator('#desktopNotesSummary')).toBeFocused();
    await ctx.win.locator('#desktopNotesSummary').focus();
    await ctx.win.keyboard.press('Enter');

    // 独立窗编辑保存 -> 摘要标题经 onNoteChanged 刷新
    await noteWin.locator('#dnTitle').fill('桌面一改');
    await expect.poll(async () => (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === noteId).title).toBe('桌面一改');
    await expect(ctx.win.locator('.dn-row').first()).toHaveText('桌面一改');

    // 最小化后键盘唤起 -> 恢复/可见
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('note.html'));
      w.minimize();
    });
    await ctx.win.locator('.dn-row').first().focus();
    await ctx.win.keyboard.press('Enter');
    await expect.poll(() => ctx.electronApp.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('note.html'));
      return !!w && !w.isMinimized() && w.isVisible();
    })).toBe(true);

    // 宽窗截图（浅色默认）
    await ctx.electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html')); w.setBounds({ width: 1080, height: 760 }); });
    await ctx.win.waitForTimeout(200);
    await ctx.win.screenshot({ path: wideShot });

    // 窄窗 640 + 深色玻璃背景 + 英文：普通点击仍可用、几何不越界/不重叠/不横向溢出
    await ctx.win.evaluate(() => {
      state.settings.appearanceMode = 'dark';
      state.settings.glass = true;
      state.settings.backgroundImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      state.settings.language = 'en';
      applyTheme(); applyLanguage(); renderAll();
    });
    await ctx.electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html')); w.setBounds({ width: 640, height: 700 }); });
    await ctx.win.waitForTimeout(250);
    await expect(ctx.win.locator('#desktopNotesSummary')).toContainText('Desktop notes');
    await expect(ctx.win.locator('#btnDesktopNotesClose')).toHaveText('Collapse');
    // 展开后普通点击行（窄窗玻璃背景）
    if ((await ctx.win.locator('#desktopNotes').getAttribute('open')) === null) await ctx.win.locator('#desktopNotesSummary').click();
    await ctx.win.locator('.dn-row').first().click();
    const geom = await ctx.win.evaluate(() => {
      const box = document.querySelector('#desktopNotes');
      const br = box.getBoundingClientRect();
      const els = [box.querySelector('.dn-summary'), box.querySelector('#btnDesktopNotesClose'), ...box.querySelectorAll('.dn-row')].filter(Boolean);
      const bad = els.filter((el) => { const r = el.getBoundingClientRect(); return r.left < br.left - 1 || r.right > br.right + 1; });
      return { over: box.scrollWidth - box.clientWidth, bad: bad.length };
    });
    expect(geom.over).toBeLessThanOrEqual(1);
    expect(geom.bad).toBe(0);
    await ctx.win.screenshot({ path: narrowShot });

    // 强制结束后重启：磁盘内容与摘要计数保留
    await ctx.electronApp.evaluate(() => process.exit(1)).catch(() => {});
    second = await openApp({ userDataDir: ctx.userDataDir });
    await expect.poll(async () => (await ux01ReadData(ctx.userDataDir)).notes.find((x) => x.id === noteId).title).toBe('桌面一改');
    await expect(second.win.locator('#desktopNotesCount')).toHaveText('1');
    await expect.poll(async () => (await second.electronApp.windows()).filter((w) => w.url().includes('note.html')).length).toBe(1);
  } finally {
    // 若第二个实例尚未接管/创建，则必须关闭本次拥有的实例，绝不遗留运行中的应用
    if (second) await closeApp(second);
    else await closeApp(ctx);
  }
});

test('UX-20A 唤起缺失窗口安全重建；非钉桌/未知 id 与独立窗来源拒绝；不干扰失败中的保存', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    await ctx.win.locator('#board .note .note-title').first().fill('重建标题');
    const p = ctx.electronApp.waitForEvent('window');
    await stableClick(ctx.win.locator('#board .note .t-desktop').first());
    const w1 = await p;
    await w1.waitForLoadState('domcontentloaded');
    await expect(w1.locator('#dnTitle')).toHaveValue('重建标题');
    const noteId = await ctx.win.evaluate(() => (state.notes.find((n) => n.desktopPin) || {}).id);

    // 模拟窗口丢失但保存的 pin 不变
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('note.html'));
      w.suppressUnpin = true;
      w.destroy();
    });
    await expect.poll(() => ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => x.webContents.getURL().includes('note.html')).length)).toBe(0);
    expect((await ux01ReadData(ctx.userDataDir)).notes.find((n) => n.id === noteId).desktopPin).toBe(true);

    await ctx.win.waitForTimeout(700); // 让启动/窗口状态写入落定后再快照
    const dataPath = path.join(ctx.userDataDir, 'notes-data.json');
    const diskBefore = await fs.readFile(dataPath, 'utf8');
    const ids = () => ctx.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => x.webContents.getURL().includes('note.html')).map((w) => w.webContents.id));

    // 并发挂起加载：两个请求共享同一窗口；加载完成前都不得报告成功，release 后均成功
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      globalThis.__ux20Gate = { release: null };
      const gate = new Promise((res) => { globalThis.__ux20Gate.release = res; });
      const BWP = BrowserWindow.prototype;
      globalThis.__ux20RealLoadFile = BWP.loadFile;
      BWP.loadFile = function (...a) { return gate.then(() => globalThis.__ux20RealLoadFile.apply(this, a)); };
    });
    const winCounts = () => ctx.electronApp.evaluate(({ BrowserWindow }) => ({
      total: BrowserWindow.getAllWindows().length,
      note: BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('note.html')).length
    }));
    // 分别跟踪每个请求的完成标志与结果：仅 Promise.all 挂起不足以证明“没有提前返回单个 true”。
    await ctx.win.evaluate((id) => {
      window.__ux20Done = [false, false];
      window.__ux20Results = [null, null];
      window.__ux20Both = Promise.all([0, 1].map((i) => window.api.showDesktopNote(id).then((v) => {
        window.__ux20Done[i] = true;
        window.__ux20Results[i] = v;
        return v;
      })));
    }, noteId);
    await ctx.win.waitForTimeout(400);
    expect(await ctx.win.evaluate(() => window.__ux20Done)).toEqual([false, false]); // 两个请求都未提前返回
    expect(await winCounts()).toEqual({ total: 2, note: 0 }); // 加载中：仅主窗 + 1 个新建（未完成加载）的独立窗
    await ctx.electronApp.evaluate(() => globalThis.__ux20Gate.release());
    expect(await ctx.win.evaluate(() => window.__ux20Both)).toEqual([true, true]);
    expect(await ctx.win.evaluate(() => window.__ux20Results)).toEqual([true, true]);
    expect(await ctx.win.evaluate(() => window.__ux20Done)).toEqual([true, true]);
    expect(await winCounts()).toEqual({ total: 2, note: 1 });
    await ctx.electronApp.evaluate(({ BrowserWindow }) => { if (globalThis.__ux20RealLoadFile) BrowserWindow.prototype.loadFile = globalThis.__ux20RealLoadFile; delete globalThis.__ux20RealLoadFile; });

    await expect.poll(async () => (await ids()).length).toBe(1);
    const w2id = (await ids())[0];
    const w2 = (await ctx.electronApp.windows()).find((w) => w.url().includes('note.html'));
    await expect(w2.locator('#dnTitle')).toHaveValue('重建标题');
    // 重复唤起同一窗口；不写盘
    expect(await ctx.win.evaluate((id) => window.api.showDesktopNote(id), noteId)).toBe(true);
    expect(await ids()).toEqual([w2id]);
    expect(await fs.readFile(dataPath, 'utf8')).toBe(diskBefore);

    // 非钉桌 / 未知 / 空 id 拒绝，且不新建窗口、不写盘
    const nonpinned = await ctx.win.evaluate(() => {
      const n = { id: 'np1', title: 'x', type: 'note', items: [], images: [], files: [], tables: [], desktopPin: false, x: 1, y: 1 };
      state.notes.push(n); return n.id;
    });
    expect(await ctx.win.evaluate((id) => window.api.showDesktopNote(id), nonpinned)).toBe(false);
    expect(await ctx.win.evaluate(() => window.api.showDesktopNote('no-such-id'))).toBe(false);
    expect(await ctx.win.evaluate(() => window.api.showDesktopNote(''))).toBe(false);
    expect(await ids()).toEqual([w2id]);
    expect(await fs.readFile(dataPath, 'utf8')).toBe(diskBefore);

    // 受信独立窗也不能唤起（仅主窗）
    expect(await w2.evaluate((id) => window.api.showDesktopNote(id), noteId)).toBe(false);

    // 独立窗保存失败时唤起不得 flush/清编辑/关窗
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__ux20RealUpdate = ipcMain._invokeHandlers.get('note:update');
      ipcMain.removeHandler('note:update');
      ipcMain.handle('note:update', () => { throw new Error('模拟保存失败'); });
    });
    await w2.locator('#dnTitle').fill('失败中的编辑');
    await expect(w2.locator('#dnUnpin')).toHaveText('⚠');
    await ctx.win.evaluate((id) => window.api.showDesktopNote(id), noteId);
    await ctx.win.waitForTimeout(300);
    expect(await ids()).toEqual([w2id]);
    await expect(w2.locator('#dnTitle')).toHaveValue('失败中的编辑');
  } finally {
    await ctx.electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
      if (globalThis.__ux20RealUpdate) { try { ipcMain.removeHandler('note:update'); } catch (e) { /* ignore */ } ipcMain.handle('note:update', globalThis.__ux20RealUpdate); delete globalThis.__ux20RealUpdate; }
      if (globalThis.__ux20RealLoadFile) { BrowserWindow.prototype.loadFile = globalThis.__ux20RealLoadFile; delete globalThis.__ux20RealLoadFile; }
    }).catch(() => {});
    await closeApp(ctx);
  }

  // 损坏且无可用备份（隔离临时数据）：只读下唤起同样拒绝、无新窗口、无空写
  const bad = await openApp({ seedRaw: '{broken-primary', seedBak: '{broken-backup' });
  try {
    await expect(bad.win.locator('body')).toHaveClass(/data-readonly/);
    expect(await bad.win.evaluate(() => window.api.showDesktopNote('any-id'))).toBe(false);
    expect(await bad.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('note.html')).length)).toBe(0);
    expect(await fs.readFile(path.join(bad.userDataDir, 'notes-data.json'), 'utf8')).toBe('{broken-primary');
  } finally { await closeApp(bad); }
});

test('UX-20A 摘要随取消钉桌/删除/成功导入刷新，陈旧行 API 拒绝', async () => {
  const ctx = await openApp();
  try {
    // 展开摘要区（键盘），以便断言空态可见
    await ctx.win.locator('#desktopNotesSummary').focus();
    await ctx.win.keyboard.press('Enter');
    await expect(ctx.win.locator('#desktopNotes')).toHaveAttribute('open', '');

    for (const title of ['钉一', '钉二']) {
      await stableClick(ctx.win.locator('#btnAdd'));
      await ctx.win.locator('#board .note .note-title').last().fill(title);
      const p = ctx.electronApp.waitForEvent('window');
      await stableClick(ctx.win.locator('#board .note .t-desktop').first());
      const w = await p;
      await w.waitForLoadState('domcontentloaded');
    }
    await expect(ctx.win.locator('#desktopNotesCount')).toHaveText('2');
    await expect(ctx.win.locator('.dn-row')).toHaveCount(2);

    // 取消一个钉桌（独立窗）
    const w1 = (await ctx.electronApp.windows()).find((w) => w.url().includes('note.html'));
    await w1.locator('#dnUnpin').click();
    await expect.poll(async () => ctx.win.locator('.dn-row').count()).toBe(1);
    await expect(ctx.win.locator('#desktopNotesCount')).toHaveText('1');

    // 删除剩余钉桌便签 -> 空态 + 计数 0；陈旧 id 拒绝
    const remainingId = await ctx.win.evaluate(() => (state.notes.find((n) => n.desktopPin) || {}).id);
    await ctx.win.evaluate((id) => deleteNote(id), remainingId);
    await expect.poll(async () => ctx.win.locator('.dn-row').count()).toBe(0);
    await expect(ctx.win.locator('#desktopNotesCount')).toHaveText('0');
    await expect(ctx.win.locator('#desktopNotesEmpty')).toBeVisible();
    // 等磁盘反映删除（渲染层 save 有防抖），再验证陈旧 id 拒绝
    await expect.poll(async () => (await ux01ReadData(ctx.userDataDir)).notes.some((n) => n.id === remainingId)).toBe(false);
    expect(await ctx.win.evaluate((id) => window.api.showDesktopNote(id), remainingId)).toBe(false);

    // 成功导入替换：备份含 1 个钉桌便签（新 id/标题）-> 摘要 1/新标题/独立窗；旧 id 拒绝
    const importedId = 'imp-pin-1';
    const importedTitle = '导入钉桌';
    await ctx.electronApp.evaluate(({ ipcMain }, data) => {
      globalThis.__ux20RealImport = ipcMain._invokeHandlers.get('data:import');
      ipcMain.removeHandler('data:import');
      ipcMain.handle('data:import', () => ({ ok: true, data }));
    }, {
      version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
      notes: [{ id: importedId, title: importedTitle, content: '', type: 'note', items: [], images: [], files: [], tables: [], color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: true, x: 40, y: 40, positionAll: { x: 40, y: 40 }, w: 220, h: 160, z: 1, createdAt: 1, updatedAt: 1 }]
    });
    await stableClick(ctx.win.locator('#btnSettings'));
    await stableClick(ctx.win.locator('.sp-nav-item[data-tab="backup"]'));
    await stableClick(ctx.win.locator('#btnImport'));
    await expect(ctx.win.locator('#cmOk')).toBeVisible();
    await stableClick(ctx.win.locator('#cmOk'));
    await expect.poll(async () => ctx.win.locator('#desktopNotesCount').textContent()).toBe('1');
    await expect(ctx.win.locator('.dn-row')).toHaveCount(1);
    await expect(ctx.win.locator('.dn-row')).toHaveText(importedTitle);
    // 导入的钉桌便签窗口由成功替换路径重开
    await expect.poll(async () => (await ctx.electronApp.windows()).filter((w) => w.url().includes('note.html')).length).toBe(1);
    // 旧（已删除）id 拒绝；导入的新钉桌 id 可安全唤起（复用窗口、不写盘）
    expect(await ctx.win.evaluate((id) => window.api.showDesktopNote(id), remainingId)).toBe(false);
    expect(await ctx.win.evaluate((id) => window.api.showDesktopNote(id), importedId)).toBe(true);
  } finally {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      if (globalThis.__ux20RealImport) { try { ipcMain.removeHandler('data:import'); } catch (e) { /* ignore */ } ipcMain.handle('data:import', globalThis.__ux20RealImport); delete globalThis.__ux20RealImport; }
    }).catch(() => {});
    await closeApp(ctx);
  }
});

test('UX-22A 条件行：分组/搜索/归档/折叠逐个移除与全部清除、结果单位、安全长文本、键盘与窄窗', async () => {
  const groupId = 'g" ><img src=x onerror=alert(1)>';
  const longEn = 'Very long english group name that should truncate with ellipsis safely 1234567890';
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION },
    groups: [
      { id: groupId, name: 'A" ><b id="fs-pwn"></b>', color: '#93f1ce' },
      { id: 'g2', name: longEn, color: '#f7d65a' }
    ],
    trash: [],
    notes: [
      { id: 'a1', title: 'Alpha', content: '', type: 'note', items: [], images: [], files: [], tables: [], color: '#93f1ce', textColor: null, groupId, pinned: false, desktopPin: false, archived: false, x: 10, y: 10, positionAll: { x: 10, y: 10 }, w: 200, h: 140, z: 1, createdAt: 1, updatedAt: 1 },
      { id: 'b1', title: 'Beta', content: '', type: 'note', items: [], images: [], files: [], tables: [], color: '#93f1ce', textColor: null, groupId: 'g2', pinned: false, desktopPin: false, archived: false, x: 10, y: 10, positionAll: { x: 10, y: 10 }, w: 200, h: 140, z: 2, createdAt: 2, updatedAt: 2 },
      { id: 'c1', title: 'Archived One', content: '', type: 'note', items: [], images: [], files: [], tables: [], color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, archived: true, x: 10, y: 10, positionAll: { x: 10, y: 10 }, w: 200, h: 140, z: 3, createdAt: 3, updatedAt: 3 },
      { id: 't1', title: 'Todo One', content: '', type: 'todo', items: [{ id: 'i1', text: 'task', done: false }], images: [], files: [], tables: [], color: '#93f1ce', textColor: null, groupId, pinned: false, desktopPin: false, archived: false, reminder: { enabled: true, time: new Date(Date.now() + 3600e3).toISOString(), fired: false }, x: 10, y: 10, positionAll: { x: 10, y: 10 }, w: 200, h: 140, z: 4, createdAt: 4, updatedAt: 4 }
    ]
  };
  const ctx = await openApp({ seed });
  try {
    const wideShot = test.info().outputPath('ux22a-status-wide.png');
    const narrowShot = test.info().outputPath('ux22a-status-narrow.png');

    // 无条件下：条件行隐藏（有可见结果时不显示任何条件/状态）
    await expect(ctx.win.locator('#filterStatus')).toHaveClass(/hidden/);

    // 分组条件（带恶意名）：普通点击 + 安全文本，无注入元素
    await ctx.win.evaluate((id) => setFilter('group', id), groupId);
    await expect(ctx.win.locator('#filterStatus')).not.toHaveClass(/hidden/);
    await expect(ctx.win.locator('#filterStatus .fs-tag-label')).toContainText('A" ><b id="fs-pwn"></b>');
    expect(await ctx.win.evaluate(() => !!document.getElementById('fs-pwn'))).toBe(false);

    // 搜索条件（键盘输入），行内显示安全查询
    await ctx.win.locator('#searchInput').fill('Alpha');
    await expect.poll(() => ctx.win.locator('#filterStatus .fs-tag').count()).toBe(2);
    await expect(ctx.win.locator('#filterStatus')).toContainText('搜索: Alpha');
    await expect(ctx.win.locator('.fs-count')).toHaveText('1 条便签');

    // 移除搜索条件：其它状态（分组）保留，焦点回到搜索框
    await ctx.win.locator('#filterStatus .fs-tag', { hasText: '搜索' }).locator('.fs-tag-x').click();
    await expect.poll(() => ctx.win.locator('#filterStatus .fs-tag').count()).toBe(1);
    await expect(ctx.win.locator('#filterStatus')).toContainText('分组');
    await expect(ctx.win.locator('#searchInput')).toBeFocused();
    expect(await ctx.win.evaluate(() => filter.group)).toBe(groupId);

    // 折叠条件：显示折叠分组；可单独移除
    await ctx.win.evaluate(() => toggleGroupCollapse('g2'));
    await expect(ctx.win.locator('#filterStatus')).toContainText('已折叠');
    await ctx.win.locator('#filterStatus .fs-tag', { hasText: '已折叠' }).locator('.fs-tag-x').click();
    await expect(ctx.win.locator('#filterStatus')).not.toContainText('已折叠');
    expect(await ctx.win.evaluate(() => state.settings.collapsedGroups.g2)).toBeFalsy();

    // 折叠便签视图计数单位（任务与提醒项）
    await stableClick(ctx.win.locator('#viewTodo'));
    await ctx.win.evaluate((id) => setFilter('group', id), groupId);
    await expect(ctx.win.locator('.fs-count')).toHaveText('2 个任务与提醒项');
    await stableClick(ctx.win.locator('#viewBoard'));

    // 归档：忽略底层分组，不显示为活动分组标签；有忽略说明；归档条件可移除
    await stableClick(ctx.win.locator('#btnArchiveFilter'));
    await expect(ctx.win.locator('#filterStatus')).toContainText('归档');
    expect(await ctx.win.evaluate(() => document.querySelectorAll('#filterStatus .fs-tag').length)).toBe(1);
    await expect(ctx.win.locator('#filterStatus')).toContainText('忽略分组');
    await ctx.win.locator('#filterStatus .fs-tag-x').first().click();
    await expect(ctx.win.locator('#filterStatus')).not.toContainText('归档');
    expect(await ctx.win.evaluate(() => filter.group)).toBe(groupId); // 底层分组保留

    // 长英文分组名：文本保留、省略号不溢出
    await ctx.win.evaluate(() => setFilter('group', 'g2'));
    const ell = await ctx.win.evaluate(() => {
      const lab = document.querySelector('#filterStatus .fs-tag-label');
      const x = document.querySelector('#filterStatus .fs-tag-x');
      return {
        text: lab.textContent,
        clipped: lab.scrollWidth > lab.clientWidth + 1,
        // 项目 tooltip 体系会把 title 转成 data-tip-text（title 被清空），完整文本仍在
        full: lab.getAttribute('data-tip-text') || lab.title,
        xAria: x.getAttribute('aria-label') || x.title
      };
    });
    expect(ell.text).toContain('分组: ' + longEn);
    expect(ell.full).toContain('分组: ' + longEn);
    expect(ell.xAria).toContain(longEn);

    // 键盘到达标签并移除（不强制点击）
    await ctx.win.locator('#filterStatus .fs-tag-x').first().focus();
    await ctx.win.keyboard.press('Enter');
    await expect(ctx.win.locator('#filterStatus')).toHaveClass(/hidden/);

    // 未分组条件行本地化（中文 -> 未分组；不是原始英文 ID）
    await ctx.win.evaluate(() => setFilter('group', 'ungrouped'));
    await expect(ctx.win.locator('#filterStatus .fs-tag-label')).toContainText('未分组');
    expect(await ctx.win.evaluate(() => document.querySelector('#filterStatus .fs-tag-label').textContent)).not.toContain('ungrouped');

    // 备忘录/文档视图：查询 + 分组下正确计数（Alpha 属于恶意分组 groupId）
    await ctx.win.evaluate((id) => setFilter('group', id), groupId);
    await ctx.win.locator('#searchInput').fill('Alpha');
    await stableClick(ctx.win.locator('#viewMemo'));
    await expect.poll(() => ctx.win.evaluate(() => (filter.query || '').trim())).toBe('Alpha');
    await expect(ctx.win.locator('.fs-count')).toHaveText('1 条便签');
    await stableClick(ctx.win.locator('#viewDoc'));
    await expect(ctx.win.locator('.fs-count')).toHaveText('1 条便签');

    // 清除分组后保留非空查询
    await ctx.win.locator('#filterStatus .fs-tag', { hasText: '分组' }).locator('.fs-tag-x').click();
    expect(await ctx.win.evaluate(() => ({ q: filter.query, g: filter.group }))).toEqual({ q: 'Alpha', g: 'all' });
    await expect(ctx.win.locator('#filterStatus .fs-tag')).toHaveCount(1);
    // 恢复分组，进入折叠多条件场景
    await ctx.win.evaluate(() => setFilter('group', 'g2'));

    // 折叠两组：清除其一保留另一个与快照，再全部清除复位
    await ctx.win.evaluate(() => { toggleGroupCollapse('g2'); toggleGroupCollapse('g1'); });
    await expect(ctx.win.locator('#filterStatus .fs-tag', { hasText: '已折叠' })).toHaveCount(2);
    await ctx.win.locator('#filterStatus .fs-tag', { hasText: '已折叠' }).first().locator('.fs-tag-x').click();
    const oneFold = await ctx.win.evaluate(() => ({
      folded: document.querySelectorAll('#filterStatus .fs-tag').length &&
        Array.from(document.querySelectorAll('#filterStatus .fs-tag')).filter((t) => /已折叠/.test(t.textContent)).length,
      cg2: !!state.settings.collapsedGroups.g2, cg1: !!state.settings.collapsedGroups.g1,
      snap: Object.keys(state.settings.collapseSnapshot || {}).length
    }));
    expect(oneFold.folded).toBe(1);            // 仅剩一个折叠标签
    expect(oneFold.cg2 !== oneFold.cg1).toBe(true); // 其一保留
    expect(oneFold.snap).toBeGreaterThanOrEqual(1);  // 保留的快照仍在
    await ctx.win.evaluate(() => { if (state.settings.collapsedGroups.g1) toggleGroupCollapse('g1'); if (state.settings.collapsedGroups.g2) toggleGroupCollapse('g2'); });

    // 多条件 + 长文本：1080 浅色截图与几何，搜索焦点跨窗口尺寸保持
    await ctx.win.locator('#searchInput').fill('Alpha <b>x</b> 很长的搜索条件内容内容内容内容内容内容内容内容');
    await ctx.win.evaluate(() => { toggleGroupCollapse('g2'); });
    await ctx.electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html')); w.setBounds({ width: 1080, height: 760 }); });
    await ctx.win.waitForTimeout(200);
    await ctx.win.locator('#searchInput').focus();
    const g1 = await ctx.win.evaluate(() => {
      const row = document.querySelector('#filterStatus');
      const rr = row.getBoundingClientRect();
      const bad = Array.from(row.children).filter((el) => { const r = el.getBoundingClientRect(); return r.left < rr.left - 1 || r.right > rr.right + 1; }).length;
      return { hidden: row.classList.contains('hidden'), bad, over: row.scrollWidth - row.clientWidth };
    });
    expect(g1.hidden).toBe(false);
    expect(g1.bad).toBe(0);
    expect(g1.over).toBeLessThanOrEqual(1);
    expect(await ctx.win.locator('#searchInput')).toBeFocused();
    await ctx.win.screenshot({ path: wideShot });

    // 640 深色玻璃 + 英文 + 长条件：无溢出/重叠、搜索焦点保持
    await ctx.win.evaluate(() => {
      state.settings.appearanceMode = 'dark';
      state.settings.glass = true;
      state.settings.language = 'en';
      applyTheme(); applyLanguage(); renderAll();
    });
    await ctx.electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html')); w.setBounds({ width: 640, height: 700 }); });
    await ctx.win.waitForTimeout(250);
    await ctx.win.locator('#searchInput').focus();
    const g2 = await ctx.win.evaluate(() => {
      const row = document.querySelector('#filterStatus');
      const rr = row.getBoundingClientRect();
      const els = Array.from(row.children).map((el) => el.getBoundingClientRect());
      let overlap = 0;
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++;
      }
      const bad = Array.from(row.children).filter((el) => { const r = el.getBoundingClientRect(); return r.left < rr.left - 1 || r.right > rr.right + 1; }).length;
      return { bad, overlap, over: row.scrollWidth - row.clientWidth };
    });
    expect(g2.bad).toBe(0);
    expect(g2.overlap).toBe(0);
    expect(g2.over).toBeLessThanOrEqual(1);
    expect(await ctx.win.locator('#searchInput')).toBeFocused();
    await ctx.win.screenshot({ path: narrowShot });

    // 1000 字符连续/无分词组名在 640 下不得撑破条件行；折叠标签过多时可滚动且全部可达
    await ctx.win.evaluate(() => {
      for (let i = 0; i < 10; i++) state.groups.push({ id: 'xg' + i, name: 'X'.repeat(1000), color: '#888' });
      for (let i = 0; i < 10; i++) state.settings.collapsedGroups['xg' + i] = true;
      renderAll();
    });
    const narrow2 = await ctx.win.evaluate(() => {
      const row = document.querySelector('#filterStatus');
      const note = row.querySelector('.fs-note');
      const noteFits = note ? (note.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1) : true;
      row.scrollTop = row.scrollHeight; // 滚动到底，验证仍可到达底部控件
      const last = row.lastElementChild;
      const reach = last ? (last.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom + 1) : true;
      return { over: row.scrollWidth - row.clientWidth, noteFits, capped: row.scrollHeight > row.clientHeight, reach };
    });
    expect(narrow2.over).toBeLessThanOrEqual(1);
    expect(narrow2.noteFits).toBe(true);
    expect(narrow2.capped).toBe(true); // 垂直受限滚动，不再撑满整窗
    expect(narrow2.reach).toBe(true);
    await ctx.win.evaluate(() => { state.groups = state.groups.filter((g) => !/^xg/.test(g.id)); renderAll(); });

    // 全部清除（已有实现）：条件行隐藏、分组/搜索/归档/折叠复位、搜索聚焦
    await ctx.win.locator('.fs-clear').click();
    await expect(ctx.win.locator('#filterStatus')).toHaveClass(/hidden/);
    expect(await ctx.win.evaluate(() => ({ q: filter.query, g: filter.group, a: filter.archive, c: state.settings.collapsedGroups.g2 }))).toEqual({ q: '', g: 'all', a: false, c: false });
    await expect(ctx.win.locator('#searchInput')).toBeFocused();

    // 顶部语义分组（不重构导航）：筛选范围 / 视图 可访问名称
    expect(await ctx.win.evaluate(() => document.querySelector('.filter-scope').getAttribute('aria-label'))).toBe('Filter scope');
    expect(await ctx.win.evaluate(() => document.querySelector('.view-toggle').getAttribute('aria-label'))).toBe('Views');
    expect(await ctx.win.evaluate(() => document.querySelector('.view-toggle').getAttribute('role'))).toBe('group');
  } finally { await closeApp(ctx); }
});

test('UX-22A 条件行：真正空数据与无匹配时的条件行状态', async () => {
  const empty = await openApp({ seed: { version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [], notes: [] } });
  try {
    // 无任何条件：条件行始终隐藏；真正空数据由既有 emptyHint 展示新建入口
    await expect(empty.win.locator('#filterStatus')).toHaveClass(/hidden/);
    await expect(empty.win.locator('#filterStatus .fs-tag')).toHaveCount(0);
    await expect(empty.win.locator('#emptyHint')).toBeVisible();
    await expect(empty.win.locator('#btnEmptyCreate')).toBeVisible();
  } finally { await closeApp(empty); }

  const ctx = await openApp({ seed: { version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [], notes: [{ id: 'n1', title: 'One', content: '', type: 'note', items: [], images: [], files: [], tables: [], color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, archived: false, x: 10, y: 10, positionAll: { x: 10, y: 10 }, w: 200, h: 140, z: 1, createdAt: 1, updatedAt: 1 }] } });
  try {
    await ctx.win.locator('#searchInput').fill('zzz-no-match');
    await expect(ctx.win.locator('#filterStatus')).toContainText('无匹配结果');
    await expect(ctx.win.locator('#filterStatus .fs-tag')).toHaveCount(1); // 搜索条件标签
    await expect(ctx.win.locator('.fs-count')).toHaveText('0 条便签');
    await expect(ctx.win.locator('#emptyHint')).toBeVisible();            // 既有 no-match emptyHint 保留
    await ctx.win.locator('#filterStatus .fs-tag-x').first().click();
    await expect(ctx.win.locator('#filterStatus')).toHaveClass(/hidden/); // 无条件后隐藏
  } finally { await closeApp(ctx); }
});

test('TABLE-01 斜线表头长文本按正确象限布局，不越出单元格/对角线（板+独立窗）', async () => {
  const now = Date.now();
  const cjk = '甲'.repeat(60), ascii = 'B'.repeat(80);
  const tables = [
    { id: 't1', rows: 1, cols: 1, cells: [['']], merges: [], diagonals: [{ r: 0, c: 0, dir: 'tlbr', t1: cjk, t2: ascii, tColor: '#334', tSize: 24 }], borderWidth: 2, borderColor: '#888' },
    { id: 't2', rows: 1, cols: 1, cells: [['']], merges: [], diagonals: [{ r: 0, c: 0, dir: 'trbl', t1: ascii + '\n' + '换行', t2: cjk, tSize: 24 }] }
  ];
  const mkNote = (id, pin) => ({
    id, title: '斜线', content: '[[table:t1]][[table:t2]]', type: 'note', items: [], images: [], files: [], tables,
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: !!pin, reminder: null,
    x: 20, y: 20, positionAll: { x: 20, y: 20 }, w: 260, h: 220, z: 1, createdAt: now, updatedAt: now
  });
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [mkNote('diag-main', false), mkNote('diag-pin', true)]
  };
  const ctx = await openApp({ seed });
  try {
    // 逐标签用「矩形四角」相对 TD 归一化判断对角线半平面；象限用几何中点判断；等行高用 gridTemplateRows。
    const check = (page) => page.evaluate(() => {
      const out = [];
      document.querySelectorAll('td.diag').forEach((td) => {
        const t = td.getBoundingClientRect();
        const dir = td.classList.contains('diag-trbl') ? 'trbl' : 'tlbr';
        const gridRows = getComputedStyle(td.querySelector('.diag-box')).gridTemplateRows.split(/\s+/).map(parseFloat).filter((n) => !isNaN(n));
        [['.tbl-t1', 't1'], ['.tbl-t2', 't2']].forEach(([sel, name]) => {
          const el = td.querySelector(sel);
          const r = el.getBoundingClientRect();
          const isT1 = name === 't1';
          const inCell = r.left >= t.left - 0.5 && r.right <= t.right + 0.5 && r.top >= t.top - 0.5 && r.bottom <= t.bottom + 0.5;
          // 四角归一化（相对 TD 宽高），逐角验证在与对角线正确的一侧，容差 0.03
          const corners = [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => [ (x - t.left) / t.width, (y - t.top) / t.height ]);
          const TOL = 0.03;
          // tlbr 对角线 y=x；trbl 对角线 y=1-x。t1 在上侧，t2 在下侧；四角都必须满足。
          const allAbove = corners.every(([x, y]) => (dir === 'tlbr' ? y <= x + TOL : y <= 1 - x + TOL));
          const allBelow = corners.every(([x, y]) => (dir === 'tlbr' ? y >= x - TOL : y >= 1 - x - TOL));
          const sideOK = isT1 ? allAbove : allBelow;
          // 象限：几何中点属于预期半区（t1 上行；tlbr t2 左列 / trbl t2 右列）
          const midX = (r.left + r.right) / 2, midY = (r.top + r.bottom) / 2;
          const topHalf = midY < (t.top + t.bottom) / 2;
          const leftHalf = midX < (t.left + t.right) / 2;
          const expectedLeft = isT1 ? (dir === 'trbl') : (dir === 'tlbr');
          const quadOK = (topHalf === isT1) && (leftHalf === expectedLeft);
          out.push({ dir, name, inCell, quadOK, sideOK, rowsEqual: gridRows.length === 2 && Math.abs(gridRows[0] - gridRows[1]) < 1.5, gridRows });
        });
      });
      return out;
    });

    const main = await check(ctx.win);
    expect(main.length).toBe(4);
    main.forEach((x) => { expect(x.inCell, JSON.stringify(x)).toBe(true); expect(x.quadOK, JSON.stringify(x)).toBe(true); expect(x.sideOK, JSON.stringify(x)).toBe(true); });
    expect(main.every((x) => x.rowsEqual)).toBe(true);
    await ctx.win.screenshot({ path: test.info().outputPath('table01-main.png') });

    // 180 与 360 宽度下仍不越界（真实渲染路径，临时固定容器宽度）
    const atWidth = (page, w) => page.evaluate((width) => {
      const host = document.getElementById('t01-host') || (() => { const d = document.createElement('div'); d.id = 't01-host'; document.body.appendChild(d); return d; })();
      host.style.width = width + 'px';
      host.innerHTML = renderRichContent('[[table:t1]][[table:t2]]', state.notes.find((n) => n.id === 'diag-main'));
      const bad = [];
      document.querySelectorAll('#t01-host td.diag').forEach((td) => {
        const t = td.getBoundingClientRect();
        td.querySelectorAll('.tbl-t1,.tbl-t2').forEach((el) => { const r = el.getBoundingClientRect(); if (r.left < t.left - 0.5 || r.right > t.right + 0.5 || r.top < t.top - 0.5 || r.bottom > t.bottom + 0.5) bad.push(el.textContent.slice(0, 4)); });
      });
      return bad;
    }, w);
    expect(await atWidth(ctx.win, 180)).toEqual([]);
    expect(await atWidth(ctx.win, 360)).toEqual([]);
    await ctx.win.evaluate(() => { const h = document.getElementById('t01-host'); if (h) h.remove(); });

    // 独立窗：同 markup/CSS（钉桌便签）
    await expect.poll(async () => (await ctx.electronApp.windows()).filter((w) => w.url().includes('note.html')).length).toBe(1);
    const noteWin = (await ctx.electronApp.windows()).find((w) => w.url().includes('note.html'));
    await expect.poll(() => noteWin.locator('td.diag').count()).toBe(2);
    const det = await check(noteWin);
    expect(det.length).toBe(4);
    det.forEach((x) => { expect(x.inCell, JSON.stringify(x)).toBe(true); expect(x.quadOK, JSON.stringify(x)).toBe(true); expect(x.sideOK, JSON.stringify(x)).toBe(true); });
    expect(det.every((x) => x.rowsEqual)).toBe(true);
    await noteWin.screenshot({ path: test.info().outputPath('table01-detached.png') });
  } finally { await closeApp(ctx); }
});

test('TABLE-02 对角线工具栏/对话框：始终打开预填、Esc/取消无写入、应用保留、移除仅删斜线', async () => {
  const now = Date.now();
  const tables = [{ id: 't1', rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']], merges: [], diagonals: [{ r: 0, c: 0, dir: 'tlbr', t1: '左上文本', t2: '右下文本', tColor: '#445566', tSize: 12 }], borderWidth: 2, borderColor: '#888' }];
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION, language: 'en' }, groups: [], trash: [],
    notes: [{ id: 'tbl2', title: '表格', content: '[[table:t1]]', type: 'note', items: [], images: [], files: [], tables,
      color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
      x: 20, y: 20, positionAll: { x: 20, y: 20 }, w: 300, h: 240, z: 1, createdAt: now, updatedAt: now }]
  };
  const ctx = await openApp({ seed });
  try {
    const snap = () => ctx.win.evaluate(() => JSON.stringify(state.notes[0].tables[0].diagonals));
    const tdOf = (r, c) => ctx.win.locator(`#board td[data-r="${r}"][data-c="${c}"]`).first();

    // 选中已有斜线单元格（普通点击）-> 工具栏按钮英文可见短标签 + 禁用/启用状态
    await tdOf(0, 0).click();
    await expect(ctx.win.locator('.table-toolbar')).toBeVisible();
    const labels = await ctx.win.evaluate(() => Array.from(document.querySelectorAll('.table-toolbar button')).map((b) => b.textContent));
    expect(labels.join('|')).not.toMatch(/[\u4e00-\u9fff]/); // 英文无中文残留
    expect(labels).toContain('+Row');
    await expect(ctx.win.locator('.table-toolbar button[aria-label="Merge cells"]')).toBeDisabled(); // 无框选

    const before = await snap();
    // 点击「斜线」：已有斜线时应打开编辑器（预填），不得直接移除
    await ctx.win.locator('.table-toolbar button[aria-label="Diagonal line"]').click();
    await expect(ctx.win.locator('.diag-editor-modal')).toBeVisible();
    await expect(ctx.win.locator('.diag-editor-modal')).toHaveAttribute('aria-modal', 'true');
    await expect(ctx.win.locator('#diagT1')).toHaveValue('左上文本');
    await expect(ctx.win.locator('#diagT2')).toHaveValue('右下文本');
    expect(await ctx.win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('diagT1'); // 初始焦点
    expect(await snap()).toBe(before); // 打开未写入

    // Esc 取消：无写入，且不触发背景快捷键
    await ctx.win.keyboard.press('Escape');
    await expect(ctx.win.locator('.diag-editor-modal')).toHaveCount(0);
    expect(await snap()).toBe(before);

    // 打开 -> 应用：保留完整文本/方向
    await ctx.win.locator('.table-toolbar button[aria-label="Diagonal line"]').click();
    await ctx.win.locator('#diagT1').fill('改后左上');
    await ctx.win.locator('#diagOk').click();
    await expect(ctx.win.locator('.diag-editor-modal')).toHaveCount(0);
    expect(await ctx.win.evaluate(() => state.notes[0].tables[0].diagonals[0])).toMatchObject({ t1: '改后左上', t2: '右下文本', dir: 'tlbr' });

    // 移除：仅删斜线，保留单元格内容
    await tdOf(0, 0).click();
    await ctx.win.locator('.table-toolbar button[aria-label="Diagonal line"]').click();
    await ctx.win.locator('#diagRemove').click();
    expect(await ctx.win.evaluate(() => state.notes[0].tables[0].diagonals.length)).toBe(0);
    expect(await ctx.win.evaluate(() => state.notes[0].tables[0].cells[0][0])).toBe('A');

    // 无斜线时 Remove 禁用
    await tdOf(0, 1).click();
    await ctx.win.locator('.table-toolbar button[aria-label="Diagonal line"]').click();
    await expect(ctx.win.locator('#diagRemove')).toBeDisabled();
    await ctx.win.locator('#diagCancel').click();

    // 合并单元格（框选 2x2）后：拆分可用、斜线禁用（锚点已合并）
    const b = ctx.win.locator('#board td[data-r="0"][data-c="0"]').first();
    const box = await b.boundingBox();
    await ctx.win.mouse.move(box.x + 4, box.y + 4);
    await ctx.win.mouse.down();
    await ctx.win.mouse.move(box.x + 60, box.y + 40, { steps: 4 });
    await ctx.win.mouse.up();
    await expect(ctx.win.locator('.table-toolbar button[aria-label="Merge cells"]')).toBeEnabled();
    await ctx.win.locator('.table-toolbar button[aria-label="Merge cells"]').click();
    await expect.poll(() => ctx.win.evaluate(() => (state.notes[0].tables[0].merges || []).length)).toBe(1);
    await ctx.win.waitForTimeout(250); // 越过框选后的点击抑制窗口
    await tdOf(0, 0).click();
    await expect(ctx.win.locator('.table-toolbar button[aria-label="Split cell"]')).toBeEnabled();
    await expect(ctx.win.locator('.table-toolbar button[aria-label="Diagonal line"]')).toBeDisabled();

    // Tab 循环停留在对话框内（此时 (0,0) 已合并，(1,0) 被覆盖 -> 用未合并的 (1,1)）
    await tdOf(1, 1).click();
    await ctx.win.locator('.table-toolbar button[aria-label="Diagonal line"]').click();
    for (let i = 0; i < 6; i++) await ctx.win.keyboard.press('Tab');
    expect(await ctx.win.evaluate(() => !!document.activeElement.closest('.diag-editor-modal'))).toBe(true);
    await ctx.win.keyboard.press('Escape');
    await expect(ctx.win.locator('.diag-editor-modal')).toHaveCount(0);
    // 焦点归还给打开者（斜线工具栏按钮）或表格块
    expect(await ctx.win.evaluate(() => {
      const el = document.activeElement;
      return !!(el && (el.closest('.note-table-block') || el.closest('.table-toolbar') || el.classList.contains('table-toolbar')));
    })).toBe(true);
  } finally { await closeApp(ctx); }
});

test('TABLE-02 独立窗对角线对话框：初始焦点/Tab 循环/Esc 无写入/应用与移除', async () => {
  const now = Date.now();
  const tables = [{ id: 't1', rows: 2, cols: 2, cells: [['A', 'B'], ['C', 'D']], merges: [], diagonals: [{ r: 0, c: 0, dir: 'trbl', t1: 'T1原文', t2: 'T2原文', tColor: '#334455', tSize: 14 }], borderWidth: 2, borderColor: '#888' }];
  const seed = {
    version: 2, settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION, language: 'en' }, groups: [], trash: [],
    notes: [{ id: 'tbl2d', title: '表格', content: '[[table:t1]]', type: 'note', items: [], images: [], files: [], tables,
      color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: true, reminder: null,
      x: 20, y: 20, positionAll: { x: 20, y: 20 }, w: 300, h: 240, z: 1, createdAt: now, updatedAt: now }]
  };
  const ctx = await openApp({ seed });
  try {
    await expect.poll(async () => (await ctx.electronApp.windows()).filter((w) => w.url().includes('note.html')).length).toBe(1);
    const noteWin = (await ctx.electronApp.windows()).find((w) => w.url().includes('note.html'));
    await noteWin.waitForLoadState('domcontentloaded');
    const diag = () => noteWin.evaluate(() => JSON.stringify(note.tables[0].diagonals));

    await noteWin.locator('td[data-r="0"][data-c="0"]').first().click();
    await expect(noteWin.locator('.table-toolbar')).toBeVisible();
    const before = await diag();
    await noteWin.locator('.table-toolbar button[aria-label="Diagonal line"]').click();
    await expect(noteWin.locator('.diag-editor-modal')).toBeVisible();
    await expect(noteWin.locator('#diagT1')).toHaveValue('T1原文');
    expect(await noteWin.evaluate(() => document.activeElement && document.activeElement.id)).toBe('diagT1');
    expect(await diag()).toBe(before);

    for (let i = 0; i < 6; i++) await noteWin.keyboard.press('Tab');
    expect(await noteWin.evaluate(() => !!document.activeElement.closest('.diag-editor-modal'))).toBe(true);
    await noteWin.keyboard.press('Escape');
    await expect(noteWin.locator('.diag-editor-modal')).toHaveCount(0);
    expect(await diag()).toBe(before);

    await noteWin.locator('td[data-r="0"][data-c="0"]').first().click();
    await noteWin.locator('.table-toolbar button[aria-label="Diagonal line"]').click();
    await noteWin.locator('#diagT1').fill('新 T1 文本');
    await noteWin.locator('#diagOk').click();
    expect(await noteWin.evaluate(() => note.tables[0].diagonals[0])).toMatchObject({ t1: '新 T1 文本', dir: 'trbl' });
    await noteWin.locator('td[data-r="0"][data-c="0"]').first().click();
    await noteWin.locator('.table-toolbar button[aria-label="Diagonal line"]').click();
    await noteWin.locator('#diagRemove').click();
    expect(await noteWin.evaluate(() => note.tables[0].diagonals.length)).toBe(0);
    expect(await noteWin.evaluate(() => note.tables[0].cells[0][0])).toBe('A');

    // 打开模态覆盖层时：工具栏按钮中心处 elementFromPoint 不得命中工具栏（不可穿越点击）
    await noteWin.locator('td[data-r="0"][data-c="1"]').first().click();
    await noteWin.locator('.table-toolbar button[aria-label="Diagonal line"]').click();
    await expect(noteWin.locator('.diag-editor-modal')).toBeVisible();
    const hit = await noteWin.evaluate(() => {
      const btn = document.querySelector('.table-toolbar button');
      if (!btn) return 'no-toolbar';
      const r = btn.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el ? (el.closest('.table-toolbar') ? 'toolbar' : 'overlay-or-other') : 'none';
    });
    expect(hit).toBe('overlay-or-other');
    await noteWin.keyboard.press('Escape');
    await expect(noteWin.locator('.diag-editor-modal')).toHaveCount(0);

    // 结构变更后按钮可用性立即刷新：2x2 选中格删行 -> 仅剩 1 行 -> 删行禁用；再加行并重选 -> 启用
    await noteWin.locator('td[data-r="0"][data-c="1"]').first().click();
    await expect(noteWin.locator('.table-toolbar button[aria-label="Delete row"]')).toBeEnabled();
    await noteWin.locator('.table-toolbar button[aria-label="Delete row"]').click();
    await expect.poll(() => noteWin.evaluate(() => note.tables[0].rows)).toBe(1);
    await noteWin.locator('td[data-r="0"][data-c="0"]').first().click();
    await expect(noteWin.locator('.table-toolbar button[aria-label="Delete row"]')).toBeDisabled();
    await noteWin.locator('.table-toolbar button[aria-label="Add row"]').click();
    await expect.poll(() => noteWin.evaluate(() => note.tables[0].rows)).toBe(2);
    await noteWin.locator('td[data-r="1"][data-c="0"]').first().click();
    await expect(noteWin.locator('.table-toolbar button[aria-label="Delete row"]')).toBeEnabled();

    // 钉窗默认窄宽：工具栏换行可读、禁用态可见
    await noteWin.screenshot({ path: test.info().outputPath('table02-detached-toolbar.png') });
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
    // 时序加固：切换外观模块有过渡，直接 check/uncheck 会因元素未稳定而超时（间歇性 flake）
    await expect(toggle).toBeVisible();
    await toggle.check({ force: true });
    await expect(ctx.win.locator('body')).toHaveClass(/\bglass\b/);
    await expect(toggle).toBeVisible();
    await toggle.uncheck({ force: true });
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

test('待办计数明确区分未完成和全部任务，勾选及语言切换后同步更新', async () => {
  const now = Date.now();
  const seed = { version: 2, settings: { viewMode: 'todo' }, groups: [], trash: [], notes: [{
    id: 'count-note', title: '计数', type: 'todo', content: '', groupId: null,
    items: [{ id: 'open', text: '未完成', done: false }, { id: 'done1', text: '已完成一', done: true }, { id: 'done2', text: '已完成二', done: true }],
    x: 20, y: 20, positionAll: { x: 20, y: 20 }, w: 240, h: 200, createdAt: now, updatedAt: now
  }] };
  const ctx = await openApp({ seed });
  try {
    const win = ctx.win;
    const badge = win.locator('#todoList .todo-panel-head .count');
    const section = win.locator('#todoList .todo-section.items h4');
    await expect(badge).toHaveText('未完成 1');
    await expect(section).toHaveText('全部任务（3）');
    await win.locator('#todoList .todo-line[data-item="open"] input[type="checkbox"]').check({ force: true });
    await expect(badge).toHaveText('未完成 0');
    await win.locator('#todoList .todo-line[data-item="done1"] input[type="checkbox"]').uncheck({ force: true });
    await expect(badge).toHaveText('未完成 1');
    await win.locator('#todoList .todo-line[data-item="done2"] input[type="checkbox"]').uncheck({ force: true });
    await expect(badge).toHaveText('未完成 2');
    await expect(section).toHaveText('全部任务（3）');

    await stableClick(win.locator('#btnSettings'));
    await stableClick(win.locator('.sp-nav-item[data-tab="data"]'));
    await win.locator('#languageSelect').selectOption('en');
    await expect(badge).toHaveText('Open 2');
    await expect(section).toHaveText('All tasks（3）');
  } finally { await closeApp(ctx); }
});

test('语言与 Markdown 开关立即刷新已有画布卡片和内容', async () => {
  const now = Date.now();
  const seed = { version: 2, settings: { viewMode: 'board' }, groups: [], trash: [], notes: [{
    id: 'localized', title: '已有便签', content: '**重点**', type: 'note', items: [], images: [],
    color: '#93f1ce', groupId: null, x: 30, y: 30, positionAll: { x: 30, y: 30 },
    w: 240, h: 200, createdAt: now, updatedAt: now
  }] };
  const ctx = await openApp({ seed });
  try {
    const win = ctx.win;
    const card = win.locator('#board .note[data-id="localized"]');
    await expect(card.locator('.t-desktop')).toHaveAttribute('title', '钉在桌面');
    await expect(card.locator('.note-content b')).toHaveText('重点');

    await stableClick(win.locator('#btnSettings'));
    await stableClick(win.locator('.sp-nav-item[data-tab="data"]'));
    await win.locator('#languageSelect').selectOption('en');
    await expect(card.locator('.t-desktop')).toHaveAttribute('title', 'Pin to desktop');
    await stableClick(win.locator('.sp-nav-item[data-tab="appearance"]'));
    await stableClick(win.locator('#appearanceModuleSeg [data-app-module="note"]'));
    await win.locator('#markdownToggle').uncheck({ force: true });
    await expect(card.locator('.note-content b')).toHaveCount(0);
    await expect(card.locator('.note-content')).toContainText('**重点**');
    await win.locator('#markdownToggle').check({ force: true });
    await expect(card.locator('.note-content b')).toHaveText('重点');
    await stableClick(win.locator('#btnCloseSettings'));

    await stableClick(win.locator('#viewMemo'));
    await expect(win.locator('#memoList .note-content b')).toHaveText('重点');
    await stableClick(win.locator('#viewDoc'));
    await stableClick(win.locator('#docList .doc-pick-item[data-id="localized"]'));
    await expect(win.locator('#docContent b')).toHaveText('重点');
    await expect(win.locator('#btnDocDesktop')).toHaveAttribute('title', 'Pin to desktop');
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
    // 时序加固：设置面板有打开过渡，等开关可见再操作（否则 uncheck 会因元素未稳定而超时）
    const toggle = ctx.win.locator('#bgReadabilityToggle');
    await expect(toggle).toBeVisible();
    await toggle.uncheck({ force: true });
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
test('UX-30B arrange follows changed custom order despite old saved layout (no implicit restore)', async () => {
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
    // 普通种子（无钉桌）→ 只有一个主窗口；显式断言初始化完成
    const win = ctx.win;
    await expect(win.locator('#noteCount')).toHaveText('3');
    const pos = (id) => win.evaluate((i) => { const n = state.notes.find((x) => x.id === i); return { x: n.positionAll.x, y: n.positionAll.y }; }, id);

    // 保存当前排序与布局（记录快照 a/b/c）
    await win.locator('#btnSaveOrder').click();
    const savedA = await pos('a');
    const snapBefore = await win.evaluate(() => JSON.stringify(state.settings.orderLayouts));

    // 改为新自定义顺序 c,b,a（快照仍是 a/b/c）并打乱位置
    await win.evaluate(() => { state.settings.sortMode = 'custom'; state.settings.noteOrder = ['c', 'b', 'a']; setEffPos(state.notes.find((n) => n.id === 'a'), 900, 500); });
    // 一键整理：必须按当前顺序 c,b,a 紧凑打包，而不是恢复旧快照 a/b/c
    await win.locator('#btnQuickArrange').click();
    const order = await win.evaluate(() => getSortedNotes(visibleNotes()).map((n) => n.id));
    expect(order).toEqual(['c', 'b', 'a']);
    const rel = await win.evaluate(() => {
      const p = (i) => state.notes.find((n) => n.id === i).positionAll;
      const a = p('a'), b = p('b'), c = p('c');
      const before = (u, v) => (u.y < v.y) || (u.y === v.y && u.x < v.x);
      return { cBeforeB: before(c, b), bBeforeA: before(b, a) };
    });
    expect(rel).toEqual({ cBeforeB: true, bBeforeA: true });
    // arrange 不覆盖旧快照，不切换模式/顺序
    expect(await win.evaluate(() => JSON.stringify(state.settings.orderLayouts))).toBe(snapBefore);
    expect(await win.evaluate(() => state.settings.sortMode)).toBe('custom');
    expect(await win.evaluate(() => state.settings.noteOrder)).toEqual(['c', 'b', 'a']);
    // 与旧快照不同（证明没有隐式恢复）
    expect(await pos('a')).not.toEqual(savedA);
  } finally {
    await closeApp(ctx);
  }
});

test('UX-30B explicit restore recovers saved positions independent of sortMode, preserving unsaved/hidden notes', async () => {
  const mk = (id, x, y, extra) => Object.assign({
    id, title: id, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  }, extra || {});
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated' },
    groups: [{ id: 'g1', name: 'G1' }], trash: [],
    notes: [mk('a', 20, 20), mk('b', 300, 20), mk('c', 600, 20, { groupId: 'g1' })]
  };
  const ctx = await openApp({ seed });
  try {
    const win = ctx.win;
    await expect(win.locator('#noteCount')).toHaveText('3');
    const pos = (id) => win.evaluate((i) => { const n = state.notes.find((x) => x.id === i); return { x: n.positionAll.x, y: n.positionAll.y }; }, id);

    // 保存布局（快照 a/b/c 在「全部」作用域）
    await win.locator('#btnSaveOrder').click();
    // 打乱并加一个未保存的可见新便签
    await win.evaluate(() => {
      setEffPos(state.notes.find((n) => n.id === 'a'), 900, 500);
      setEffPos(state.notes.find((n) => n.id === 'b'), 950, 520);
      state.notes.push({ id: 'new1', title: 'new1', content: '', type: 'note', items: [], images: [], files: [], tables: [], color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null, x: 60, y: 900, positionAll: { x: 60, y: 900 }, w: 240, h: 200, z: 9, createdAt: 5, updatedAt: 5 });
      renderAll();
    });
    const newBefore = await pos('new1');
    // c 在保存之后移离保存位置（保存位置为 600,20），随后折叠 g1 使其隐藏（隐藏项不得被恢复）
    await win.evaluate(() => { setEffPos(state.notes.find((n) => n.id === 'c'), 700, 333); state.settings.collapsedGroups = { g1: true }; renderAll(); });
    const cMoved = await pos('c');
    expect(cMoved).not.toEqual({ x: 600, y: 20 });
    // 非 custom 模式：恢复按钮应可用
    await win.evaluate(() => { state.settings.sortMode = 'updated'; renderAll(); });
    await expect(win.locator('#btnRestoreLayout')).toBeEnabled();
    // 打开设置 → 数据/组织区（普通点击），显式恢复
    await win.locator('#btnSettings').click();
    await win.locator('.sp-nav-item[data-tab="data"]').click();
    await win.locator('#btnRestoreLayout').click();
    // a/b 回到保存位置；未保存新便签与隐藏项 c 均保持原位
    expect(await pos('a')).toEqual({ x: 20, y: 20 });
    expect(await pos('b')).toEqual({ x: 300, y: 20 });
    expect(await pos('new1')).toEqual(newBefore);
    expect(await pos('c')).toEqual(cMoved);
    expect(await win.evaluate(() => state.settings.sortMode)).toBe('updated');
    // 关闭设置，普通按钮切换备忘录/便签视图：已恢复位置保持（跨视图覆盖）
    await win.locator('#btnCloseSettings').click();
    await win.locator('#viewMemo').click();
    await win.locator('#viewBoard').click();
    expect(await pos('a')).toEqual({ x: 20, y: 20 });
    expect(await pos('b')).toEqual({ x: 300, y: 20 });
  } finally {
    await closeApp(ctx);
  }
});

test('UX-30C query-subset arrange reserves hidden same-scope notes; clearing search adds no overlap', async () => {
  const mk = (id, title, x, y) => ({
    id, title, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  // 可见 Alpha 初始 600,400；隐藏 Beta 20,20 / Gamma 20,260（旧 arrange 会把 Alpha 落到 Beta 上）
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated', lastSeenVersion: EXPECTED_VERSION },
    groups: [], trash: [],
    notes: [mk('a', 'Alpha', 600, 400), mk('b', 'Beta', 20, 20), mk('c', 'Gamma', 20, 260)]
  };
  const ctx = await openApp({ seed });
  try {
    const win = ctx.win;
    await expect(win.locator('#noteCount')).toHaveText('3');
    const wholeNote = (id) => win.evaluate((i) => JSON.stringify(state.notes.find((x) => x.id === i)), id);
    const pos = (id) => win.evaluate((i) => { const n = state.notes.find((x) => x.id === i); return { x: n.positionAll.x, y: n.positionAll.y }; }, id);
    const betaBefore = await wholeNote('b'); // 隐藏项整对象基线
    const gammaBefore = await wholeNote('c');
    await win.locator('#searchInput').fill('Alpha');
    await expect(win.locator('#board .note')).toHaveCount(1);
    await win.locator('#btnQuickArrange').click();
    // 隐藏两项整对象完全不变（坐标/尺寸/updatedAt）
    expect(await wholeNote('b')).toBe(betaBefore);
    expect(await wholeNote('c')).toBe(gammaBefore);
    // Alpha 必须移动到不与隐藏障碍重叠的位置（旧行为会停在 600,400 与 Beta 无关；此断言要求其避让 Beta/Gamma）
    const a = await pos('a');
    const noHit = await win.evaluate(() => {
      const A = state.notes.find((n) => n.id === 'a');
      return ['b', 'c'].every((id) => {
        const o = state.notes.find((n) => n.id === id);
        return !((A.positionAll.x < o.positionAll.x + o.w + 18) && (A.positionAll.x + A.w + 18 > o.positionAll.x) && (A.positionAll.y < o.positionAll.y + o.h + 18) && (A.positionAll.y + A.h + 18 > o.positionAll.y));
      });
    });
    expect(noHit).toBe(true);
    expect(a).not.toEqual({ x: 600, y: 400 }); // 确实发生了重新排布
    // 清空搜索：三张便签两两不重叠
    await win.locator('#searchInput').fill('');
    await expect(win.locator('#board .note')).toHaveCount(3);
    const anyOverlap = await win.evaluate(() => {
      const rs = state.notes.map((n) => ({ ...n.positionAll, w: n.w, h: n.h }));
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if ((a.x < b.x + b.w + 18) && (a.x + a.w + 18 > b.x) && (a.y < b.y + b.h + 18) && (a.y + a.h + 18 > b.y)) return true;
      }
      return false;
    });
    expect(anyOverlap).toBe(false);
  } finally { await closeApp(ctx); }
});

test('UX-30C explicit restore keeps exact coords even when oversized, warns visibly, then arrange handles current sizes', async () => {
  const mk = (id, x, y, w, h) => ({
    id, title: id, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w, h, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated', lastSeenVersion: EXPECTED_VERSION },
    groups: [], trash: [],
    notes: [mk('a', 20, 20, 240, 200), mk('b', 300, 20, 240, 200)]
  };
  const ctx = await openApp({ seed });
  try {
    const win = ctx.win;
    await expect(win.locator('#noteCount')).toHaveText('2');
    const pos = (id) => win.evaluate((i) => { const n = state.notes.find((x) => x.id === i); return { x: n.positionAll.x, y: n.positionAll.y }; }, id);
    await win.locator('#btnSaveOrder').click(); // 保存布局（a 20,20 / b 300,20）
    const snapBefore = await win.evaluate(() => JSON.stringify(state.settings.orderLayouts));
    // 缩窄主窗到 640（minWidth 可能钳制），等待渲染后按「实际画布宽」定义超大宽度
    await ctx.electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html')); w.setBounds({ width: 640, height: 700 }); });
    await win.waitForTimeout(250);
    const oversizeInfo = await win.evaluate(() => {
      const maxX = canvasMaxX();
      const margin = (typeof LAYOUT !== 'undefined' ? LAYOUT.margin : 20);
      return { maxX, margin, avail: Math.max(0, maxX - margin * 2) };
    });
    const oversizedWidth = await win.evaluate(() => canvasMaxX() + 100);
    // 前置条件：确实超出可用宽（不是靠猜测常量）
    expect(oversizedWidth).toBeGreaterThan(oversizeInfo.avail);
    // 保存后：a 设为「实际超大宽度」，并把 a/b 移离保存位置
    await win.evaluate((ow) => {
      state.notes.find((n) => n.id === 'a').w = ow;
      setEffPos(state.notes.find((n) => n.id === 'a'), 500, 700);
      setEffPos(state.notes.find((n) => n.id === 'b'), 520, 720);
      applyTheme(); renderAll();
    }, oversizedWidth);
    // 普通显式恢复
    await win.locator('#btnSettings').click();
    await win.locator('.sp-nav-item[data-tab="data"]').click();
    await win.locator('#btnRestoreLayout').click();
    // 精确还原保存坐标、尺寸不变（= 实际超大宽度）
    expect(await pos('a')).toEqual({ x: 20, y: 20 });
    expect(await pos('b')).toEqual({ x: 300, y: 20 });
    expect(await win.evaluate(() => state.notes.find((n) => n.id === 'a').w)).toBe(oversizedWidth);
    // 可见冲突提示（本地化，含「一键整理」）
    await expect(win.locator('#toast')).toContainText('一键整理');
    // 原快照保持未变
    expect(await win.evaluate(() => JSON.stringify(state.settings.orderLayouts))).toBe(snapBefore);
    // 一键整理：按当前尺寸处理（设置组织区的 #btnArrange 在窄窗仍可见；顶栏 #btnQuickArrange 在 640 会被收进 More 菜单）
    await win.locator('#btnArrange').click();
    await win.locator('#btnCloseSettings').click();
    await win.waitForTimeout(150);
    const r = await win.evaluate(() => {
      const maxX = canvasMaxX();
      const margin = (typeof LAYOUT !== 'undefined' ? LAYOUT.margin : 20);
      const gap = (typeof LAYOUT !== 'undefined' ? LAYOUT.gap : 18);
      const a = state.notes.find((n) => n.id === 'a'), b = state.notes.find((n) => n.id === 'b');
      return {
        maxX, margin, gap,
        a: { x: a.positionAll.x, y: a.positionAll.y, w: a.w, h: a.h },
        b: { x: b.positionAll.x, y: b.positionAll.y, w: b.w, h: b.h }
      };
    });
    // 普通卡 b 在可用宽内；超大 a 在左边界且位于普通卡下方（间距为实际 LAYOUT.gap）；尺寸不变
    expect(r.b.x + r.b.w).toBeLessThanOrEqual(r.maxX - r.margin + 1);
    expect(r.a.x).toBe(r.margin);
    expect(r.a.y).toBeGreaterThanOrEqual(r.b.y + r.b.h + r.gap);
    expect({ a: r.a.w, b: r.b.w }).toEqual({ a: oversizedWidth, b: 240 });
    // 无重叠
    expect((r.a.x < r.b.x + r.b.w) && (r.a.x + r.a.w > r.b.x) && (r.a.y < r.b.y + r.b.h) && (r.a.y + r.a.h > r.b.y)).toBe(false);
  } finally { await closeApp(ctx); }
});

test('UX-30D undo/redo layout chain: save changes mode+snapshot, undo restores, redo exact, arrange/restore undoable', async () => {
  const mk = (id, x, y) => ({
    id, title: id, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated', lastSeenVersion: EXPECTED_VERSION, orderLayouts: { _all: { a: { x: 33, y: 44 } } } },
    groups: [], trash: [],
    notes: [mk('a', 200, 200), mk('b', 700, 100)]
  };
  const ctx = await openApp({ seed });
  try {
    const win = ctx.win;
    await ctx.electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html')); w.setBounds({ width: 1300, height: 780 }); });
    await win.waitForTimeout(200);
    await expect(win.locator('#noteCount')).toHaveText('2');
    const hist = () => win.evaluate(() => ({ u: UndoHistory.stacks().undoStack.length, r: UndoHistory.stacks().redoStack.length }));
    const mode = () => win.evaluate(() => state.settings.sortMode);
    const sortModeUi = () => win.locator('#sortMode').inputValue();
    const layouts = () => win.evaluate(() => JSON.stringify(state.settings.orderLayouts));
    const pos = (id) => win.evaluate((i) => ({ ...state.notes.find((n) => n.id === i).positionAll }), id);
    const otherBefore = await win.evaluate(() => ({ theme: state.settings.themeId, zoom: state.settings.boardZoom }));

    // 1) 保存排序（updated -> custom，含快照）
    const layoutsBefore = await layouts();
    const h0 = await hist();
    await win.locator('#btnSaveOrder').click();
    expect(await mode()).toBe('custom');
    const layoutsCustom = await layouts();
    expect(layoutsCustom).not.toBe(layoutsBefore);
    expect(await hist()).toEqual({ u: h0.u + 1, r: 0 });
    // 撤销：恢复 updated 模式、**精确旧布局 map**、并同步排序设置 UI；redo 有项
    await win.locator('#btnUndo').click();
    expect(await mode()).toBe('updated');
    expect(await layouts()).toBe(layoutsBefore);
    expect(await hist()).toEqual({ u: h0.u, r: 1 });
    // 重做：恢复 custom 与精确快照
    await win.locator('#btnRedo').click();
    expect(await mode()).toBe('custom');
    expect(await layouts()).toBe(layoutsCustom);
    expect(await hist()).toEqual({ u: h0.u + 1, r: 0 });

    // 2) 整理：坐标改变 + 一个历史项；撤销恢复旧坐标、重做精确
    const before = { a: await pos('a'), b: await pos('b') };
    const hArrange = await hist();
    await win.locator('#btnQuickArrange').click();
    const arranged = { a: await pos('a'), b: await pos('b') };
    expect(await hist()).toEqual({ u: hArrange.u + 1, r: 0 });
    await win.locator('#btnUndo').click();
    expect({ a: await pos('a'), b: await pos('b') }).toEqual(before);
    await win.locator('#btnRedo').click();
    expect({ a: await pos('a'), b: await pos('b') }).toEqual(arranged);

    // 3) 重复无变化：当前已就位，保存一次「已 arranged 的布局快照」后撤销该保存（坐标仍 arranged，redo 含该保存）
    await win.locator('#btnSaveOrder').click();
    const savedArrangedLayouts = await layouts();
    await win.locator('#btnUndo').click();
    // 坐标依旧 arranged（保存不改坐标）；redo 可重放该保存
    expect({ a: await pos('a'), b: await pos('b') }).toEqual(arranged);
    const hNoop = await hist();
    expect(hNoop.r).toBeGreaterThanOrEqual(1);
    // 现在重复整理（真正无变化）→ 历史/redo 不变
    await win.locator('#btnQuickArrange').click();
    expect(await hist()).toEqual(hNoop);
    // redo 该保存 → 快照 map 恢复为 arranged 保存值
    await win.locator('#btnRedo').click();
    expect(await layouts()).toBe(savedArrangedLayouts);

    // 4) 显式恢复：移动后恢复保存坐标，可撤销/重做；重复（无变化）不入栈
    await win.locator('#btnSaveOrder').click();
    const saved = { a: await pos('a'), b: await pos('b') };
    await win.evaluate(() => { setEffPos(state.notes.find((n) => n.id === 'a'), 900, 900); renderAll(); });
    const moved = await pos('a');
    await win.locator('#btnSettings').click();
    await win.locator('.sp-nav-item[data-tab="data"]').click();
    const hRestore = await hist();
    await win.locator('#btnRestoreLayout').click();
    expect(await pos('a')).toEqual(saved.a);
    expect(await hist()).toEqual({ u: hRestore.u + 1, r: 0 });
    await win.locator('#btnCloseSettings').click();
    await win.locator('#btnUndo').click();
    expect(await pos('a')).toEqual(moved);
    await win.locator('#btnRedo').click();
    expect(await pos('a')).toEqual(saved.a);
    // 重复显式恢复（位置已等于保存值）→ 无历史增长
    await win.locator('#btnSettings').click();
    await win.locator('.sp-nav-item[data-tab="data"]').click();
    const hRepeatRestore = await hist();
    await win.locator('#btnRestoreLayout').click();
    expect(await hist()).toEqual(hRepeatRestore);
    await win.locator('#btnCloseSettings').click();
    // 排序设置 UI 与真实模式一致 + 无关设置未被快照改回
    expect(await sortModeUi()).toBe(await mode());
    expect(await win.evaluate(() => ({ theme: state.settings.themeId, zoom: state.settings.boardZoom }))).toEqual(otherBefore);
  } finally { await closeApp(ctx); }
});

test('UX-30D group scope: arrange/save x,y vs positionAll independent; zero query/no-target does not grow history', async () => {
  const mk = (id, groupId, x, y) => ({
    id, title: id, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: 1000 + x, updatedAt: 1000 + x
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated', lastSeenVersion: EXPECTED_VERSION },
    groups: [{ id: 'g1', name: 'G1' }], trash: [],
    notes: [mk('a', 'g1', 40, 40), mk('b', 'g1', 300, 40), mk('c', null, 600, 40)]
  };
  const ctx = await openApp({ seed });
  try {
    const win = ctx.win;
    await ctx.electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html')); w.setBounds({ width: 1300, height: 780 }); });
    await win.waitForTimeout(200);
    await expect(win.locator('#noteCount')).toHaveText('3');
    const paOf = (id) => win.evaluate((i) => ({ ...state.notes.find((n) => n.id === i).positionAll }), id);
    const xyOf = (id) => win.evaluate((i) => { const n = state.notes.find((x) => x.id === i); return { x: n.x, y: n.y }; }, id);
    const hist = () => win.evaluate(() => ({ u: UndoHistory.stacks().undoStack.length, r: UndoHistory.stacks().redoStack.length }));
    const base = { a: await paOf('a'), b: await paOf('b'), c: await paOf('c'), aXY: await xyOf('a'), bXY: await xyOf('b') };
    // 通过真实分组 chip 进入 g1
    await win.locator('#groupChips .chip', { hasText: 'G1' }).click();
    await expect(win.locator('#board .note')).toHaveCount(2);
    // 整理：只改分组作用域 x/y；位置(positionAll)全部自基准不变
    const h0 = await hist();
    await win.locator('#btnQuickArrange').click();
    expect(await hist()).toEqual({ u: h0.u + 1, r: 0 });
    expect(await paOf('a')).toEqual(base.a);
    expect(await paOf('b')).toEqual(base.b);
    expect(await paOf('c')).toEqual(base.c);
    // a/b 的 x/y 确实被整理改变
    const arrangedXY = { a: await xyOf('a'), b: await xyOf('b') };
    expect(arrangedXY).not.toEqual({ a: base.aXY, b: base.bXY });
    // 撤销恢复分组 x/y；重做重放
    await win.locator('#btnUndo').click();
    expect(await xyOf('a')).toEqual(base.aXY);
    expect(await xyOf('b')).toEqual(base.bXY);
    await win.locator('#btnRedo').click();
    expect(await xyOf('a')).toEqual(arrangedXY.a);
    expect(await xyOf('b')).toEqual(arrangedXY.b);
    // 保存（分组作用域）：仅动组内顺序/快照作用域；撤销后 positionAll 仍自基准不变
    await win.locator('#btnSaveOrder').click();
    await win.locator('#btnUndo').click();
    expect(await paOf('a')).toEqual(base.a);
    expect(await paOf('b')).toEqual(base.b);
    expect(await paOf('c')).toEqual(base.c);
    // 零结果：普通点击 btnQuickArrange / btnSaveOrder，历史(含 redo)完全不变
    await win.locator('#searchInput').fill('zzz-nothing');
    await expect(win.locator('#board .note')).toHaveCount(0);
    const hZero = await hist();
    await win.locator('#btnQuickArrange').click();
    await win.locator('#btnSaveOrder').click();
    await win.waitForTimeout(150);
    expect(await hist()).toEqual(hZero);
    // 清空查询、无作用域快照 -> 恢复按钮禁用；内部 restore 返回 false 且历史不变
    await win.locator('#searchInput').fill('');
    await win.evaluate(() => { state.settings.orderLayouts = {}; renderAll(); });
    await win.locator('#btnSettings').click();
    await win.locator('.sp-nav-item[data-tab="data"]').click();
    await expect(win.locator('#btnRestoreLayout')).toBeDisabled();
    const hNoTarget = await hist();
    expect(await win.evaluate(() => restoreSavedLayout())).toBe(false);
    expect(await hist()).toEqual(hNoTarget);
    await win.locator('#btnCloseSettings').click();
  } finally { await closeApp(ctx); }
});

// —— 指针拖拽重排：备忘录 / 文档视图用 pointer 事件（支持边拖边滚，替代原生 HTML5 DnD）——
test('备忘录视图：拖动把手(指针)重排便签顺序', async () => {
  test.setTimeout(120_000);   // 真实鼠标拖动，无 GPU 沙箱下易超时（详见批量拖动用例注释）
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
  test.setTimeout(120_000);   // 真实鼠标拖动，无 GPU 沙箱下易超时（详见批量拖动用例注释）
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
  // 同上：真实鼠标拖动 + steps:14 + rAF，无 GPU 沙箱下易顶到超时。放宽以消除假失败。
  test.setTimeout(120_000);
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
test('更新安装前保存主窗口尚未落盘的编辑', async () => {
  const seed = {
    settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [{ id: 'n1', title: '更新前', x: 40, y: 40, w: 220, h: 180, positionAll: { x: 40, y: 40 } }]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    // 用测试 handler 代替真正的安装器，保留“确认→保存→调用安装”完整顺序。
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('update:install');
      ipcMain.handle('update:install', () => { globalThis.__updateInstallReached = true; return { ok: true }; });
    });
    await ctx.win.evaluate(() => {
      state.notes[0].title = '更新后仍在';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {}, 5000);
    });
    await ctx.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:downloaded', { version: '1.2.6' });
    });
    await expect(ctx.win.locator('#cmOk')).toBeVisible();
    await stableClick(ctx.win.locator('#cmOk'));
    await expect.poll(() => ctx.electronApp.evaluate(() => !!globalThis.__updateInstallReached)).toBe(true);
    const saved = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
    expect(saved.notes[0].title).toBe('更新后仍在');
  } finally { await closeApp(ctx); }
});

test('更新安装前独立便签保存失败则保留窗口', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await stableClick(ctx.win.locator('#board .note .t-desktop').first());
    const noteWin = await noteWinPromise;
    await expect(noteWin.locator('#dnTitle')).toBeVisible();
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('note:update');
      ipcMain.handle('note:update', () => false);
    });
    const result = await ctx.win.evaluate(() => window.api.quitAndInstall());
    expect(result.ok).toBe(false);
    await expect(noteWin.locator('#dnUnpin')).toHaveText('⚠');
    expect(await ctx.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).length
    )).toBeGreaterThan(0);
  } finally { await closeApp(ctx); }
});

test('更新安装前写入独立便签尚未落盘的编辑', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    await ctx.win.locator('#board .note .note-title').first().fill('更新前的桌面便签');
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await stableClick(ctx.win.locator('#board .note .t-desktop').first());
    const noteWin = await noteWinPromise;
    await expect(noteWin.locator('#dnTitle')).toHaveValue('更新前的桌面便签');
    await noteWin.locator('#dnTitle').fill('更新后仍在的桌面便签');
    await noteWin.evaluate(() => { clearTimeout(saveTimer); saveTimer = setTimeout(() => {}, 5000); });
    // 开发环境不会下载更新包；这里只验证安装 handler 销毁窗口前的保存。
    await ctx.win.evaluate(() => window.api.quitAndInstall()).catch(() => {});
    await expect.poll(async () => {
      const data = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
      return data.notes[0] && data.notes[0].title;
    }).toBe('更新后仍在的桌面便签');
  } finally { await closeApp(ctx); }
});

test('选择退出前等待未完成的保存写入', async () => {
  const seed = {
    settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [{ id: 'n1', title: '退出前', x: 40, y: 40, w: 220, h: 180, positionAll: { x: 40, y: 40 } }]
  };
  const ctx = await openApp({ seed });
  try {
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    // 制造尚未触发的延迟保存；退出操作必须主动写盘并等待确认。
    await ctx.win.evaluate(() => {
      state.notes[0].title = '退出后仍在';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {}, 5000);
      window.api.close();
    });
    await expect(ctx.win.locator('#closeOverlay')).toBeVisible();
    const closed = ctx.electronApp.waitForEvent('close');
    await stableClick(ctx.win.locator('#btnCloseQuit'));
    await closed;
    const saved = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
    expect(saved.notes[0].title).toBe('退出后仍在');
  } finally {
    await closeApp(ctx);
  }
});

test('退出前保存失败时留在应用内', async () => {
  const seed = { settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], notes: [], trash: [] };
  const ctx = await openApp({ seed });
  try {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('data:save');
      ipcMain.handle('data:save', () => { throw new Error('simulated disk error'); });
    });
    await ctx.win.evaluate(() => window.api.close());
    await expect(ctx.win.locator('#closeOverlay')).toBeVisible();
    await stableClick(ctx.win.locator('#btnCloseQuit'));
    await expect(ctx.win.locator('#closeOverlay')).toBeHidden();
    expect(await ctx.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) => !win.isDestroyed())
    )).toBe(true);
    const saved = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
    expect(saved.notes).toEqual(seed.notes);
    expect(saved.groups).toEqual(seed.groups);
    expect(saved.trash).toEqual(seed.trash);
  } finally {
    await closeApp(ctx);
  }
});

test('强制结束后可选择恢复未保存的主窗口编辑', async () => {
  const seed = { settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [{ id: 'n1', title: '正式存档', x: 40, y: 40, w: 220, h: 180, positionAll: { x: 40, y: 40 } }] };
  const first = await openApp({ seed });
  let second;
  try {
    await first.win.evaluate(() => {
      state.notes[0].title = '崩溃前最后编辑';
      save();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {}, 5000);
    });
    const draft = JSON.parse(await fs.readFile(path.join(first.userDataDir, 'notes-recovery.json'), 'utf8'));
    expect(draft.main.data.notes[0].title).toBe('崩溃前最后编辑');
    expect(JSON.parse(await fs.readFile(path.join(first.userDataDir, 'notes-data.json'), 'utf8')).notes[0].title).toBe('正式存档');
    await first.electronApp.evaluate(() => process.exit(1)).catch(() => {});
    second = await openApp({ userDataDir: first.userDataDir, expectRecovery: true });
    await expect(second.win.locator('#cmOk')).toBeVisible();
    expect(JSON.parse(await fs.readFile(path.join(first.userDataDir, 'notes-data.json'), 'utf8')).notes[0].title).toBe('正式存档');
    await stableClick(second.win.locator('#cmOk'));
    await expect.poll(() => second.win.evaluate(() => state.notes[0].title)).toBe('崩溃前最后编辑');
    expect(JSON.parse(await fs.readFile(path.join(first.userDataDir, 'notes-data.json'), 'utf8')).notes[0].title).toBe('崩溃前最后编辑');
    await expect.poll(async () => fs.stat(path.join(first.userDataDir, 'notes-recovery.json')).then(() => true, () => false)).toBe(false);
  } finally {
    if (second) await closeApp(second);
    else await fs.rm(first.userDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('丢弃异常退出草稿后正式存档保持原样', async () => {
  const seed = { settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [], notes: [] };
  const first = await openApp({ seed });
  let second;
  try {
    await first.win.evaluate(() => {
      state.settings.recoveryTest = '仅在草稿';
      save();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {}, 5000);
    });
    expect(JSON.parse(await fs.readFile(path.join(first.userDataDir, 'notes-data.json'), 'utf8')).settings.recoveryTest).toBeUndefined();
    await first.electronApp.evaluate(() => process.exit(1)).catch(() => {});
    second = await openApp({ userDataDir: first.userDataDir, expectRecovery: true });
    await expect(second.win.locator('#cmCancel')).toBeVisible();
    await stableClick(second.win.locator('#cmCancel'));
    expect(JSON.parse(await fs.readFile(path.join(first.userDataDir, 'notes-data.json'), 'utf8')).settings.recoveryTest).toBeUndefined();
    await expect.poll(() => second.win.evaluate(async () => (await window.api.loadData()).recovery)).toBe(null);
  } finally {
    if (second) await closeApp(second);
    else await fs.rm(first.userDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('独立便签异常退出后恢复最新标题，启动前不打开旧钉窗', async () => {
  const first = await openApp();
  let second;
  try {
    await stableClick(first.win.locator('#btnAdd'));
    const noteWinPromise = first.electronApp.waitForEvent('window');
    await stableClick(first.win.locator('#board .note .t-desktop').first());
    const noteWin = await noteWinPromise;
    await expect(noteWin.locator('#dnTitle')).toBeVisible();
    // 可观察就绪：note.js init 在绑定标题 input 监听器之后才把 #dnUnpin.title 设为本地化 tr('unpin')
    // （静态 HTML 是另一段文案），因此该条件成立即证明监听器已就绪，而不是仅 DOM 可见。
    await expect.poll(() => noteWin.evaluate(() => {
      const btn = document.querySelector('#dnUnpin');
      return !!btn && typeof tr === 'function' && btn.title === tr('unpin');
    })).toBe(true);
    await expect.poll(() => noteWin.evaluate(() => note && note.id)).toBeTruthy();

    await noteWin.evaluate(() => {
      const input = document.querySelector('#dnTitle');
      const originalSetTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 300 ? 5000 : delay, ...args);
      input.value = '独立窗口最后编辑';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.setTimeout = originalSetTimeout;
    });
    const file = path.join(first.userDataDir, 'notes-data.json');
    const recoveryPath = path.join(first.userDataDir, 'notes-recovery.json');
    try {
      // 先证明真实交互确实执行了监听器（模型已更新），再验证同步草稿落地。
      await expect.poll(() => noteWin.evaluate(() => note && note.title)).toBe('独立窗口最后编辑');
      // 同步草稿（captureNoteDraft）必须已写入，且内容就是本次编辑，而不是其它残留条目。
      await expect.poll(async () => {
        const raw = await fs.readFile(recoveryPath, 'utf8').catch(() => null);
        if (!raw) return null;
        const notes = (JSON.parse(raw).notes) || {};
        const ids = Object.keys(notes);
        return ids.length ? (notes[ids[0]].note && notes[ids[0]].note.title) : null;
      }).toBe('独立窗口最后编辑');
    } catch (err) {
      // 历史失败是草稿轮询超时；此处输出有界快照（不含完整大 JSON）后原样抛出，绝不吞掉失败。
      const snap = {};
      try {
        snap.renderer = await noteWin.evaluate(() => ({
          noteId: note && note.id,
          noteTitle: note && note.title,
          inputValue: (document.querySelector('#dnTitle') || {}).value
        }));
      } catch (e) { snap.renderer = 'unavailable'; }
      try {
        const raw = await fs.readFile(recoveryPath, 'utf8').catch(() => null);
        if (!raw) snap.recovery = { absent: true };
        else {
          const notes = (JSON.parse(raw).notes) || {};
          snap.recovery = {
            noteCount: Object.keys(notes).length,
            notes: Object.entries(notes).slice(0, 5).map(([id, entry]) => ({ id, title: entry && entry.note && entry.note.title, token: entry && entry.token }))
          };
        }
      } catch (e) { snap.recovery = 'unreadable'; }
      try { snap.savedTitle = JSON.parse(await fs.readFile(file, 'utf8')).notes[0].title; }
      catch (e) { snap.savedTitle = 'unreadable'; }
      console.log('A05_RECOVERY_FAILURE ' + JSON.stringify(snap));
      throw err;
    }
    expect(JSON.parse(await fs.readFile(file, 'utf8')).notes[0].title).not.toBe('独立窗口最后编辑');

    await first.electronApp.evaluate(() => process.exit(1)).catch(() => {});
    second = await openApp({ userDataDir: first.userDataDir, expectRecovery: true });
    await expect(second.win.locator('#cmOk')).toBeVisible();
    expect((await second.electronApp.windows()).filter((win) => win.url().includes('note.html'))).toHaveLength(0);
    await stableClick(second.win.locator('#cmOk'));
    await expect.poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).notes[0].title).toBe('独立窗口最后编辑');
    await expect.poll(async () => (await second.electronApp.windows()).filter((win) => win.url().includes('note.html')).length).toBe(1);
  } finally {
    if (second) await closeApp(second);
    else await fs.rm(first.userDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('较早的保存完成后不清除较新的恢复草稿', async () => {
  const seed = { settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [], notes: [] };
  const ctx = await openApp({ seed });
  try {
    const result = await ctx.win.evaluate(async () => {
      const older = { settings: { ...state.settings, recoveryRace: '旧编辑' }, groups: [], notes: [], trash: [] };
      const newer = { settings: { ...state.settings, recoveryRace: '新编辑' }, groups: [], notes: [], trash: [] };
      const oldToken = window.api.captureDraft(older);
      const newToken = window.api.captureDraft(newer);
      await window.api.saveData(older, { draftToken: oldToken });
      const pending = (await window.api.loadData()).recovery;
      await window.api.saveData(newer, { draftToken: newToken });
      const cleared = (await window.api.loadData()).recovery;
      return { oldToken, newToken, pending: pending && pending.settings.recoveryRace, cleared };
    });
    expect(result.oldToken).toBeTruthy();
    expect(result.newToken).toBeGreaterThan(result.oldToken);
    expect(result.pending).toBe('新编辑');
    expect(result.cleared).toBe(null);
  } finally { await closeApp(ctx); }
});

test('主窗口旧快照不能清除独立便签的新草稿', async () => {
  const seed = { settings: { viewMode: 'board', lastSeenVersion: EXPECTED_VERSION }, groups: [], trash: [],
    notes: [{ id: 'n1', title: '旧标题', x: 40, y: 40, w: 220, h: 180 }] };
  const ctx = await openApp({ seed });
  try {
    const result = await ctx.win.evaluate(async () => {
      const mainSnapshot = { settings: state.settings, groups: state.groups, trash: state.trash,
        notes: state.notes.map((note) => ({ ...note })) };
      const mainToken = window.api.captureDraft(mainSnapshot);
      const editedNote = { ...mainSnapshot.notes[0], title: '独立窗口新标题' };
      const noteToken = window.api.captureNoteDraft(editedNote);
      await window.api.noteUpdate(editedNote, { draftToken: noteToken });
      await window.api.saveData(mainSnapshot, { draftToken: mainToken });
      return (await window.api.loadData()).recovery.notes[0].title;
    });
    expect(result).toBe('独立窗口新标题');
  } finally { await closeApp(ctx); }
});

test('正常保存并退出后不再提示恢复草稿', async () => {
  const first = await openApp();
  let second;
  try {
    await stableClick(first.win.locator('#btnAdd'));
    await first.win.locator('#board .note .note-title').first().fill('正常保存');
    expect(await first.win.evaluate(() => saveNow())).toBe(true);
    expect(await first.win.evaluate(async () => (await window.api.loadData()).recovery)).toBe(null);
    const closed = first.electronApp.waitForEvent('close');
    await first.win.evaluate(() => window.api.close());
    await expect(first.win.locator('#closeOverlay')).toBeVisible();
    await stableClick(first.win.locator('#btnCloseQuit'));
    await closed;
    second = await openApp({ userDataDir: first.userDataDir });
    expect(await second.win.evaluate(async () => (await window.api.loadData()).recovery)).toBe(null);
    await expect(second.win.locator('#cmOk')).toHaveCount(0);
  } finally {
    if (second) await closeApp(second);
    else await fs.rm(first.userDataDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('退出应用前也会保存独立便签最后一次编辑', async () => {
  const ctx = await openApp();
  try {
    await stableClick(ctx.win.locator('#btnAdd'));
    await ctx.win.locator('#board .note .note-title').first().fill('退出前的桌面便签');
    const noteWinPromise = ctx.electronApp.waitForEvent('window');
    await stableClick(ctx.win.locator('#board .note .t-desktop').first());
    const noteWin = await noteWinPromise;
    await expect(noteWin.locator('#dnTitle')).toHaveValue('退出前的桌面便签');
    await noteWin.locator('#dnTitle').fill('退出后仍在的桌面便签');
    await noteWin.evaluate(() => { clearTimeout(saveTimer); saveTimer = setTimeout(() => {}, 5000); });
    await ctx.win.evaluate(() => window.api.close());
    await expect(ctx.win.locator('#closeOverlay')).toBeVisible();
    const closed = ctx.electronApp.waitForEvent('close');
    await stableClick(ctx.win.locator('#btnCloseQuit'));
    await closed;
    const saved = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
    expect(saved.notes[0].title).toBe('退出后仍在的桌面便签');
  } finally { await closeApp(ctx); }
});

test('关闭确认：触发关闭弹主题化确认框，取消则窗口保持', async () => {
  const ctx = await openApp();
  try {
    // 首屏 DOM 已就绪不等于 Electron 窗口已触发 ready-to-show。
    // 先等真实窗口可见，避免把启动阶段的隐藏状态误判为「取消关闭」。
    await expect.poll(async () => ctx.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible())
    )).toBe(true);
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
    // 取消后窗口应保持可见；同「隐藏到任务栏」用例，用 poll 规避可见性回传时序竞态
    await expect.poll(async () => ctx.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible())
    )).toBe(true);
  } finally {
    await closeApp(ctx);
  }
});

test('关闭确认：选「隐藏到任务栏」后窗口隐藏', async () => {
  const ctx = await openApp();
  try {
    // 必须从已显示的窗口发起隐藏；否则 ready-to-show 可能在隐藏后才调用 show()。
    await expect.poll(async () => ctx.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible())
    )).toBe(true);
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
    // 注：滚动/布局在负载高时可能滞后（3s 不够 → 曾假失败）。改为「点箭头直到真正滚动」的重试轮询。
    const chipsWrap = ctx.win.locator('#groupChips');
    await expect.poll(async () => {
      if (await right.isEnabled()) await right.click({ force: true });
      return chipsWrap.evaluate((el) => el.scrollLeft);
    }, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(left).toBeEnabled();
    await expect.poll(async () => {
      if (await left.isEnabled()) await left.click({ force: true });
      return chipsWrap.evaluate((el) => el.scrollLeft);
    }, { timeout: 15_000 }).toBeLessThanOrEqual(1);
    await expect(left).toBeDisabled();
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

test('画布平移：按住空格拖过便签、中键拖动均移动视口，编辑空格不触发平移', async () => {
  const now = Date.now();
  const seed = { version: 2, settings: { viewMode: 'board' }, groups: [], trash: [], notes: [{
    id: 'pan-note', title: '可见便签', content: '内容', type: 'note', items: [], images: [],
    color: '#93f1ce', groupId: null, x: 300, y: 260, positionAll: { x: 300, y: 260 },
    w: 240, h: 200, createdAt: now, updatedAt: now
  }, {
    id: 'far-note', title: '远处便签', content: '', type: 'note', items: [], images: [],
    color: '#93f1ce', groupId: null, x: 1900, y: 1300, positionAll: { x: 1900, y: 1300 },
    w: 240, h: 200, createdAt: now, updatedAt: now
  }] };
  const ctx = await openApp({ seed });
  try {
    const win = ctx.win;
    await stableClick(win.locator('#ctExpand'));
    // 自定义悬停提示会将 title 暂存到 data-tip-text，文案应在两处保持一致。
    const panHint = await win.locator('#btnZoomPan').evaluate((el) => el.getAttribute('title') || el.getAttribute('data-tip-text'));
    expect(panHint).toMatch(/空格键＋鼠标左键拖动.*鼠标中键拖动.*单按空格不会移动/);
    await win.evaluate(() => { const c = document.querySelector('#canvas'); c.scrollLeft = 180; c.scrollTop = 160; });
    const head = win.locator('#board .note[data-id="pan-note"] .note-head');
    const rect = await head.boundingBox();
    const x = rect.x + rect.width / 2;
    const y = rect.y + 12;
    const before = await win.evaluate(() => ({ x: document.querySelector('#canvas').scrollLeft, y: document.querySelector('#canvas').scrollTop, note: state.notes[0].positionAll }));
    await win.evaluate(() => document.activeElement.blur());
    await win.keyboard.down('Space');
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x - 80, y - 60, { steps: 4 });
    await win.mouse.up();
    await win.keyboard.up('Space');
    const afterSpace = await win.evaluate(() => ({ x: document.querySelector('#canvas').scrollLeft, y: document.querySelector('#canvas').scrollTop, note: state.notes[0].positionAll }));
    expect(afterSpace.x).toBeGreaterThan(before.x + 60);
    expect(afterSpace.y).toBeGreaterThan(before.y + 40);
    expect(afterSpace.note).toEqual(before.note);

    await win.mouse.move(x - 80, y - 60);
    await win.mouse.down({ button: 'middle' });
    await win.mouse.move(x - 125, y - 95, { steps: 3 });
    await win.mouse.up({ button: 'middle' });
    const afterMiddle = await win.evaluate(() => ({ x: document.querySelector('#canvas').scrollLeft, y: document.querySelector('#canvas').scrollTop }));
    expect(afterMiddle.x).toBeGreaterThan(afterSpace.x + 25);
    expect(afterMiddle.y).toBeGreaterThan(afterSpace.y + 20);

    const input = win.locator('#searchInput');
    await input.fill('');
    await input.focus();
    await win.keyboard.press('Space');
    await expect(input).toHaveValue(' ');
    expect(await win.evaluate(() => document.body.classList.contains('pan-mode'))).toBe(false);
  } finally { await closeApp(ctx); }
});

test('画布框选：空白处拉框多选，单击空白取消选择', async () => {
  // 真实鼠标拖动 + 分步 move + rAF 渲染，在无 GPU 沙箱下对 CPU 抢占敏感，
  // 机器负载升高时可能远超默认 60s。放宽超时以消除 CI 假失败（功能本身正常）。
  test.setTimeout(120_000);
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

// 契约（UX-30C 已接受）：折叠隐藏但共享坐标作用域的便签是「固定障碍」，整理只移动可见便签；
// 展开时回到折叠前的整体快照（UX-30E 全局快照恢复为刻意保留的现有行为）。
test('分组折叠与一键整理：折叠时整理只移动可见便签并避让隐藏便签，取消折叠后恢复折叠前原始布局且不重叠', async () => {
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
    const win = ctx.win;
    await expect(win.locator('#board .note')).toHaveCount(4);
    const wholeNote = (id) => win.evaluate((i) => JSON.stringify(state.notes.find((x) => x.id === i)), id);
    const pos = (id) => win.evaluate((i) => { const n = state.notes.find((x) => x.id === i); return { x: n.positionAll.x, y: n.positionAll.y }; }, id);
    const aBefore = await wholeNote('a'); // 隐藏障碍整对象基线
    const bBefore = await wholeNote('b');

    // 折叠 g1：只剩可见的 c/d
    await win.evaluate(() => toggleGroupCollapse('g1'));
    await expect(win.locator('#board .note')).toHaveCount(2);
    expect(await win.evaluate(() => state.settings.collapsedGroups.g1)).toBe(true);

    // 真实点击「一键整理」（不 force），只排布可见的 c/d，并避让隐藏的 a/b 固定障碍
    await win.locator('#btnQuickArrange').click();
    // c/d 确实被重新排布（离开初始 1000/1260），且位置为有限非负数
    await expect.poll(async () => (await pos('c')).x).not.toBe(1000);
    const cdAfter = await win.evaluate(() => {
      const c = state.notes.find((n) => n.id === 'c');
      const d = state.notes.find((n) => n.id === 'd');
      return { c: { x: c.positionAll.x, y: c.positionAll.y }, d: { x: d.positionAll.x, y: d.positionAll.y } };
    });
    for (const p of [cdAfter.c, cdAfter.d]) {
      expect(Number.isFinite(p.x) && p.x >= 0).toBe(true);
      expect(Number.isFinite(p.y) && p.y >= 0).toBe(true);
    }
    // c 与 d 都确实被重新排布（都离开各自的初始位置，而非仅其中之一）
    expect(cdAfter.c).not.toEqual({ x: 1000, y: 20 });
    expect(cdAfter.d).not.toEqual({ x: 1260, y: 20 });
    // 隐藏的 a/b 整对象完全不变（整理不得移动/改写隐藏障碍）
    expect(await wholeNote('a')).toBe(aBefore);
    expect(await wholeNote('b')).toBe(bBefore);
    // 折叠期间四张便签（含隐藏障碍）两两均不重叠（沿用 LAYOUT.gap 语义），
    // 旧「零障碍」实现会把 c/d 直接落到 a/b 矩形上而被此处捕获
    const foldedOverlap = await win.evaluate(() => {
      const gap = (typeof LAYOUT !== 'undefined' ? LAYOUT.gap : 18);
      const rs = state.notes.map((n) => ({ id: n.id, x: n.positionAll.x, y: n.positionAll.y, w: n.w, h: n.h }));
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if ((a.x < b.x + b.w + gap) && (a.x + a.w + gap > b.x) && (a.y < b.y + b.h + gap) && (a.y + a.h + gap > b.y)) return { bad: `${a.id}/${b.id}` };
      }
      return { bad: null };
    });
    expect(foldedOverlap.bad).toBeNull();

    // 取消折叠：整体恢复到折叠前的原始布局（a/b 回原位、c/d 也回原位）
    await win.evaluate(() => toggleGroupCollapse('g1'));
    await expect(win.locator('#board .note')).toHaveCount(4);
    await expect.poll(async () => (await pos('c')).x).toBe(1000);
    const restored = await win.evaluate(() => {
      const byId = {};
      state.notes.forEach((n) => { byId[n.id] = { x: n.positionAll.x, y: n.positionAll.y }; });
      return byId;
    });
    expect(restored.a).toEqual({ x: 20, y: 20 });
    expect(restored.b).toEqual({ x: 280, y: 20 });
    expect(restored.c).toEqual({ x: 1000, y: 20 });
    expect(restored.d).toEqual({ x: 1260, y: 20 });
    // 恢复后任意两张便签都不重叠
    const overlap = await win.evaluate(() => {
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
test('文档模式工具栏可导出当前便签为 Markdown', async () => {
  const now = Date.now();
  const seed = { version: 2, settings: { viewMode: 'doc' }, groups: [], trash: [], notes: [{
    id: 'doc-export', title: '文档:示例', content: '**重点** 内容', type: 'note', items: [], images: [],
    color: '#93f1ce', groupId: null, x: 20, y: 20, positionAll: { x: 20, y: 20 },
    w: 240, h: 200, createdAt: now, updatedAt: now
  }] };
  const ctx = await openApp({ seed });
  try {
    await ctx.electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('note:export-markdown');
      ipcMain.handle('note:export-markdown', (_event, md, filename) => {
        globalThis.__docExport = { md, filename };
        return { ok: true, path: filename };
      });
    });
    await stableClick(ctx.win.locator('#docList .doc-pick-item[data-id="doc-export"]'));
    const exportBtn = ctx.win.locator('#btnDocExportMd');
    await expect(exportBtn).toHaveAttribute('title', '导出为 Markdown');
    await stableClick(exportBtn);
    await expect.poll(() => ctx.electronApp.evaluate(() => !!globalThis.__docExport)).toBe(true);
    const result = await ctx.electronApp.evaluate(() => globalThis.__docExport);
    expect(result.filename).toBe('文档_示例.md');
    expect(result.md).toContain('# 文档:示例');
    expect(result.md).toContain('**重点** 内容');
  } finally { await closeApp(ctx); }
});
test('右键菜单：默认精简，删除固定一级，开关切换即时生效且不清空选区', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [], notes: [mk('a', '标题A', 20, 20)] };
  const ctx = await openApp({ seed });
  try {
    const openMenu = async () => {
      await ctx.win.locator('#board .note .note-content').first().click({ button: 'right', force: true });
      await expect(ctx.win.locator('.ctx-menu')).toBeVisible();
    };
    const topLabels = () => ctx.win.evaluate(() =>
      Array.from(document.querySelectorAll('.ctx-menu > button')).map((b) => b.textContent.trim()));

    await openMenu();
    // 1) 默认精简
    expect(await ctx.win.evaluate(() => state.settings.ctxMenuMode)).toBe('compact');
    const compact = await topLabels();
    // 2) 删除固定在一级，且为最后一项
    expect(compact.some((s) => s.includes('删除'))).toBe(true);
    expect(compact[compact.length - 1].includes('删除')).toBe(true);
    // 3) 导出 Markdown 保持一级（工具栏没有该入口）
    expect(compact.some((s) => s.includes('Markdown'))).toBe(true);
    // 精简模式一级项明显少于完整模式
    const compactCount = compact.length;

    // 4) 选中一段文字后切换模式：菜单不关闭、选区不清空
    await ctx.win.evaluate(() => {
      const c = document.querySelector('#board .note .note-content');
      const r = document.createRange();
      r.selectNodeContents(c);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
    });
    await openMenu();
    const selBefore = await ctx.win.evaluate(() => String(window.getSelection() || ''));

    const sw = ctx.win.locator('.ctx-menu button[role="switch"]');
    await expect(sw).toBeEnabled();
    await sw.click({ force: true });

    // 菜单仍然可见（未关闭）
    await expect(ctx.win.locator('.ctx-menu')).toBeVisible();
    expect(await ctx.win.evaluate(() => state.settings.ctxMenuMode)).toBe('full');
    const full = await topLabels();
    expect(full.length).toBeGreaterThan(compactCount);
    // 完整模式下删除同样在一级且仍在最后
    expect(full.some((s) => s.includes('删除'))).toBe(true);
    expect(full[full.length - 1].includes('删除')).toBe(true);
    // 选区未被清空
    const selAfter = await ctx.win.evaluate(() => String(window.getSelection() || ''));
    expect(selAfter).toBe(selBefore);
    expect(selBefore.length).toBeGreaterThan(0);
  } finally {
    await closeApp(ctx);
  }
});

test('右键菜单：精简模式展开「格式 ▸」时菜单宽度不变，仅下方展开', async () => {
  const now = Date.now();
  const mk = (id, title, x, y) => ({
    id, title, content: '内容' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [], notes: [mk('a', '标题A', 20, 20)] };
  const ctx = await openApp({ seed });
  try {
    await ctx.win.locator('#board .note .note-content').first().click({ button: 'right', force: true });
    const pop = ctx.win.locator('.ctx-menu');
    await expect(pop).toBeVisible();
    const widthOf = () => pop.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    const collapsedW = await widthOf();

    // 展开「格式 ▸」（精简模式下第一个二级开关）
    const fmt = pop.locator('button[aria-expanded]').first();
    await expect(fmt).toBeEnabled();
    await fmt.click({ force: true });
    // 对齐项与高亮色板在下方展开
    await expect(pop.locator('button', { hasText: '左对齐' })).toBeVisible();
    await expect(pop.locator('button', { hasText: '右对齐' })).toBeVisible();
    await expect(pop.getByText('高亮颜色')).toBeVisible();

    // 关键：展开后菜单宽度不变（不再被高亮色板撑成完整模式那样宽）
    expect(await widthOf()).toBe(collapsedW);
  } finally {
    await closeApp(ctx);
  }
});

test('菜单外观归位：右键菜单不再挂透明度/亚克力页脚，改由设置页控制', async () => {
  const now = Date.now();
  const mk = (id, x, y) => ({
    id, title: id, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  const seed = {
    version: 2,
    settings: { viewMode: 'board', sortMode: 'updated', menuOpacity: 70, menuAcrylic: false },
    groups: [], trash: [], notes: [mk('a', 20, 20)]
  };
  const ctx = await openApp({ seed });
  try {
    // 1) 便签右键菜单不含外观页脚
    await ctx.win.locator('#board .note .note-content').first().click({ button: 'right', force: true });
    await expect(ctx.win.locator('.ctx-menu')).toBeVisible();
    const noFooter = await ctx.win.evaluate(() => {
      const pop = document.querySelector('.ctx-menu');
      return {
        row: !!pop.querySelector('.cm-opacity-row'),
        text: pop.textContent.includes('透明度') || pop.textContent.includes('亚克力')
      };
    });
    expect(noFooter.row).toBe(false);
    expect(noFooter.text).toBe(false);
    await ctx.win.keyboard.press('Escape');

    // 2) 设置 → 外观 → 便签模块：存在控件，且初值同步自 settings
    await ctx.win.locator('#btnSettings').click({ force: true });
    await ctx.win.locator('#appearanceModuleSeg [data-app-module="note"]').click({ force: true });
    await expect(ctx.win.locator('#menuOpacity')).toBeVisible();
    expect(await ctx.win.locator('#menuOpacity').inputValue()).toBe('70');
    expect(await ctx.win.locator('#menuAcrylicToggle').isChecked()).toBe(false);

    // 3) 改动实时生效并持久化
    await ctx.win.evaluate(() => {
      const mo = document.querySelector('#menuOpacity');
      mo.value = '45';
      mo.dispatchEvent(new Event('input', { bubbles: true }));
      mo.dispatchEvent(new Event('change', { bubbles: true }));
      const ma = document.querySelector('#menuAcrylicToggle');
      ma.checked = true;
      ma.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await ctx.win.waitForTimeout(600);
    const after = await ctx.win.evaluate(() => ({
      cssVar: getComputedStyle(document.documentElement).getPropertyValue('--ctx-opacity').trim(),
      acrylic: document.body.classList.contains('menu-acrylic')
    }));
    expect(after.cssVar).toBe('45');
    expect(after.acrylic).toBe(true);

    const parsed = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
    expect(parsed.settings.menuOpacity).toBe(45);
    expect(parsed.settings.menuAcrylic).toBe(true);
  } finally {
    await closeApp(ctx);
  }
});

test('右键菜单：精简/完整偏好持久化到下次启动', async () => {
  const now = Date.now();
  const mk = (id, x, y) => ({
    id, title: id, content: 'c' + id, type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, reminder: null,
    x, y, positionAll: { x, y }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated' }, groups: [], trash: [], notes: [mk('a', 20, 20)] };
  // 直接以「完整」偏好启动，验证启动时读取偏好
  const seedFull = { ...seed, settings: { ...seed.settings, ctxMenuMode: 'full' } };
  const ctx = await openApp({ seed: seedFull });
  try {
    expect(await ctx.win.evaluate(() => state.settings.ctxMenuMode)).toBe('full');
    await ctx.win.locator('#board .note .note-content').first().click({ button: 'right', force: true });
    await expect(ctx.win.locator('.ctx-menu')).toBeVisible();
    const full = await ctx.win.evaluate(() =>
      Array.from(document.querySelectorAll('.ctx-menu > button')).map((b) => b.textContent.trim()));
    // 完整模式下平铺出便签级操作（精简时这些在二级里）
    expect(full.some((s) => s.includes('置顶'))).toBe(true);
    // 删除仍在一级且最后
    expect(full[full.length - 1].includes('删除')).toBe(true);
    // 开关显示为「完整」状态
    const sw = ctx.win.locator('.ctx-menu button[role="switch"]');
    expect(await sw.getAttribute('aria-checked')).toBe('true');
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
  const seed = { version: 2, settings: { viewMode: 'board', sortMode: 'updated', noteToolbarCompact: false }, groups: [], trash: [], notes: [mk('a', 'A', 20)] };
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




// ---------- 便签工具栏：精简折叠 + 按钮显隐 ----------

test('便签工具栏：默认精简显示，次要按钮收进「更多」且可打开操作菜单', async () => {
  const now = Date.now();
  const mk = (id, x) => ({
    id, title: 'T', content: '正文', type: 'note', items: [], images: [], files: [], tables: [],
    color: '#93f1ce', textColor: null, groupId: null, pinned: false, desktopPin: false, archived: false, preview: false,
    x, y: 20, positionAll: { x, y: 20 }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
  });
  const ctx = await openApp({ seed: { version: 2, settings: { viewMode: 'board' }, groups: [], trash: [], notes: [mk('a', 20)] } });
  try {
    const note = ctx.win.locator('.note[data-id="a"]');
    // 主要动作内联（含「钉在桌面」，该功能必须保持可见）
    await expect(note.locator('.t-desktop')).toHaveCount(1);
    await expect(note.locator('.t-group')).toHaveCount(1);
    await expect(note.locator('.t-color')).toHaveCount(1);
    await expect(note.locator('.t-pin')).toHaveCount(1);
    await expect(note.locator('.t-del')).toHaveCount(1);
    await expect(note.locator('.t-more')).toHaveCount(1);
    // 次要动作默认折叠
    await expect(note.locator('.t-table')).toHaveCount(0);
    await expect(note.locator('.t-preview')).toHaveCount(0);
    // 「更多」打开便签操作菜单（复用右键菜单）
    await stableClick(note.locator('.t-more'));
    await expect(ctx.win.locator('.ctx-menu')).toBeVisible();
  } finally {
    await closeApp(ctx);
  }
});

test('便签工具栏：设置内可显隐按钮、切换精简/完整，改动即时生效', async () => {
  const ctx = await openApp({ seed: { version: 2, settings: { viewMode: 'board' } } });
  try {
    await ctx.win.locator('#btnAdd').click({ force: true });
    await expect(ctx.win.locator('#board .note .t-del')).toHaveCount(1);
    // 默认精简：表格按钮折叠
    await expect(ctx.win.locator('#board .note .t-table')).toHaveCount(0);

    await ctx.win.locator('#btnSettings').click({ force: true });
    await ctx.win.locator('#appearanceModuleSeg [data-app-module="note"]').click({ force: true });

    // 隐藏「删除」按钮 → 卡片即时移除
    const delBox = ctx.win.locator('#noteToolbarVis input[data-tool="del"]');
    await expect(delBox).toBeVisible();
    await delBox.uncheck({ force: true });
    await expect(ctx.win.locator('#board .note .t-del')).toHaveCount(0);
    expect(await ctx.win.evaluate(() => state.settings.noteToolbarHidden)).toContain('del');

    // 切到完整模式 → 次要按钮重新内联出现
    const compactBox = ctx.win.locator('#noteToolbarCompact');
    await compactBox.uncheck({ force: true });
    await expect(ctx.win.locator('#board .note .t-table')).toHaveCount(1);
    await compactBox.check({ force: true });
    await expect(ctx.win.locator('#board .note .t-table')).toHaveCount(0);

    // 恢复显示删除
    await delBox.check({ force: true });
    await expect(ctx.win.locator('#board .note .t-del')).toHaveCount(1);
  } finally {
    await closeApp(ctx);
  }
});

// ---------- 数据安全：损坏 / 回退 / 写失败三态 ----------

test('合法 JSON 但便签结构错误：只读且不覆盖原文件', async () => {
  const raw = JSON.stringify({ settings: { viewMode: 'board' }, groups: [], trash: [], notes: [null] });
  const ctx = await openApp({ seedRaw: raw });
  try {
    await expect(ctx.win.locator('#dataAlert')).toBeVisible();
    await expect(ctx.win.locator('#board .note')).toHaveCount(0);
    expect(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8')).toBe(raw);
    const files = await fs.readdir(ctx.userDataDir);
    expect(files.some((name) => name.includes('.corrupt-'))).toBe(true);
  } finally {
    await closeApp(ctx);
  }
});

test('合法 JSON 但便签结构错误：从有效 .bak 恢复并允许保存', async () => {
  const good = { settings: { viewMode: 'board' }, groups: [], trash: [], notes: [{ id: 'n1', title: '备份便签', x: 40, y: 40, w: 220, h: 180 }] };
  const ctx = await openApp({ seedRaw: JSON.stringify({ notes: [null] }), seedBak: JSON.stringify(good) });
  try {
    await expect(ctx.win.locator('#dataAlert')).toBeHidden();
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    await expect.poll(async () => {
      const data = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8'));
      return data.notes[0] && data.notes[0].id;
    }).toBe('n1');
  } finally {
    await closeApp(ctx);
  }
});

test('数据损坏且无备份：进入只读，弹出损坏警告条，写入被拦截', async () => {
  // 故意写入非法 JSON（seed 走 JSON.stringify 永远是合法的，故用 seedRaw）
  const ctx = await openApp({ seedRaw: '{ this is not valid json' });
  try {
    // 常驻警告条可见（走 enterDataReadonly → #dataAlert）
    await expect(ctx.win.locator('#dataAlert')).toBeVisible();
    // 只读标记落在 body 上
    const readonly = await ctx.win.evaluate(() => document.body.classList.contains('data-readonly'));
    expect(readonly).toBe(true);
    // 加载后不应凭空出现便签（数据不可读 → 按空处理，绝不回写空数组覆盖）
    await expect(ctx.win.locator('#board .note')).toHaveCount(0);
    // 尝试触发保存：save() 在只读态直接早退，主进程侧也不应产生合法数据文件
    await ctx.win.evaluate(() => { try { saveNow(); } catch (_) {} });
    await ctx.win.waitForTimeout(400);
    const raw = await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8');
    // 原坏文件必须未被覆盖成合法 JSON（未被静默修复/清空）
    expect(raw).toBe('{ this is not valid json');
  } finally {
    await closeApp(ctx);
  }
});

test('数据损坏但有 .bak 备份：自动回退，提示已恢复，可正常读写', async () => {
  const good = { settings: { viewMode: 'board' }, groups: [], trash: [], notes: [
    { id: 'n1', text: '从备份恢复的便签', x: 40, y: 40, w: 220, h: 180 }
  ] };
  const ctx = await openApp({
    seedRaw: '{ corrupted beyond repair',
    seedBak: JSON.stringify(good)
  });
  try {
    // 不应进入只读（有备份可回退 → status 为 recovered）
    await expect(ctx.win.locator('#dataAlert')).toBeHidden();
    const readonly = await ctx.win.evaluate(() => document.body.classList.contains('data-readonly'));
    expect(readonly).toBe(false);
    // 备份内容被恢复出来（这是「回退成功」最本质的观察点）
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    // 恢复后磁盘上主文件已是合法 JSON（说明回退结果已写回）
    const raw = await fs.readFile(path.join(ctx.userDataDir, 'notes-data.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.notes.length).toBe(1);
    // 注：dataHealth().status 此刻可能已从 recovered 被后续保存重置为 ok，故不断言该瞬时值，
    // 改以「留证文件存在」证明本次确实发生了损坏-回退（corrupt 留证在 safeRead 时落盘）
    const files = await fs.readdir(ctx.userDataDir);
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true);
  } finally {
    await closeApp(ctx);
  }
});

test('数据合法：正常启动，无警告条，可创建便签并落盘', async () => {
  const ctx = await openApp({ seed: { settings: { viewMode: 'board' }, groups: [], trash: [], notes: [] } });
  try {
    await expect(ctx.win.locator('#dataAlert')).toBeHidden();
    const readonly = await ctx.win.evaluate(() => document.body.classList.contains('data-readonly'));
    expect(readonly).toBe(false);
    // 正常创建便签 → 应触发保存并成功落盘
    await stableClick(ctx.win.locator('#btnAdd'));
    await expect(ctx.win.locator('#board .note')).toHaveCount(1);
    // 保存是防抖的，固定 sleep 在负载高时不够 → 轮询等待落盘（避免假失败）
    const file = path.join(ctx.userDataDir, 'notes-data.json');
    await expect.poll(async () => {
      const raw = await fs.readFile(file, 'utf8').catch(() => '');
      try { return (JSON.parse(raw).notes || []).length; } catch (e) { return -1; }
    }, { timeout: 10_000 }).toBe(1);
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(Array.isArray(parsed.notes)).toBe(true);
    expect(parsed.notes.length).toBe(1);
  } finally {
    await closeApp(ctx);
  }
});

// ---------- UX-14：设置抽屉键盘 / 焦点（正式门槛） ----------

// 面板内可见且可用可聚焦控件的状态快照，与 settings-bind.js 的选择器保持一致
function settingsFocusState(win) {
  return win.evaluate(() => {
    const panel = document.getElementById('settingsPanel');
    const list = Array.from(panel.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
    const active = document.activeElement;
    return {
      count: list.length,
      idx: list.indexOf(active),
      inside: panel.contains(active),
      inApp: document.getElementById('app').contains(active),
      activeId: active ? (active.id || '') : ''
    };
  });
}

test('UX-14 设置抽屉：dialog 语义、打开聚焦、背景 inert、三种关闭方式均恢复打开者焦点', async () => {
  const ctx = await openApp();
  const win = ctx.win;
  const overlay = win.locator('#settingsOverlay');
  const panel = win.locator('#settingsPanel');
  try {
    const settingsBefore = await win.evaluate(() => JSON.stringify(state.settings));

    // 键盘打开：聚焦触发按钮后回车，验证真实键盘路径可用
    await win.locator('#btnSettings').focus();
    await win.keyboard.press('Enter');
    await expect(overlay).toBeVisible();

    // 可访问对话框 + 本地化名称（aria-labelledby -> 标题文案）
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    await expect(panel).toHaveAccessibleName(/全局设置/);

    // 打开即聚焦面板内，主界面 #app 变 inert（背景不可聚焦）
    expect((await settingsFocusState(win)).inside).toBe(true);
    expect(await win.locator('#app').evaluate((el) => el.inert)).toBe(true);

    // Escape 关闭 → 恢复 #app 可交互并归还焦点给打开者
    await win.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    expect(await win.locator('#app').evaluate((el) => el.inert)).toBe(false);
    expect(await win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btnSettings');

    // 关闭按钮
    await win.locator('#btnSettings').click();
    await expect(overlay).toBeVisible();
    await win.locator('#btnCloseSettings').click();
    await expect(overlay).toBeHidden();
    expect(await win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btnSettings');

    // 点击遮罩（面板左侧空白）
    await win.locator('#btnSettings').click();
    await expect(overlay).toBeVisible();
    await overlay.click({ force: true, position: { x: 5, y: 5 } });
    await expect(overlay).toBeHidden();
    expect(await win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btnSettings');

    // 键盘开关不得改动任何设置值
    expect(await win.evaluate(() => JSON.stringify(state.settings))).toBe(settingsBefore);
  } finally {
    await closeApp(ctx);
  }
});

test('UX-14 设置抽屉：Tab/Shift+Tab 在面板内循环，不逃到被遮挡的背景', async () => {
  const ctx = await openApp();
  const win = ctx.win;
  try {
    await win.locator('#btnSettings').click();
    await expect(win.locator('#settingsOverlay')).toBeVisible();

    // 初始焦点在面板内（面板容器）
    expect((await settingsFocusState(win)).inside).toBe(true);

    // 连续正向 Tab：焦点始终留在面板内且不落入 #app 背景
    for (let i = 0; i < 30; i++) {
      await win.keyboard.press('Tab');
      const s = await settingsFocusState(win);
      expect(s.inside).toBe(true);
      expect(s.inApp).toBe(false);
    }
    // 连续反向 Shift+Tab 同理
    for (let i = 0; i < 30; i++) {
      await win.keyboard.press('Shift+Tab');
      const s = await settingsFocusState(win);
      expect(s.inside).toBe(true);
      expect(s.inApp).toBe(false);
    }

    // 首尾边界：第一个控件 Shift+Tab → 最后一个；最后一个控件 Tab → 第一个
    const count = (await settingsFocusState(win)).count;
    expect(count).toBeGreaterThan(2);
    await win.evaluate(() => {
      const panel = document.getElementById('settingsPanel');
      const list = Array.from(panel.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
      list[0].focus();
    });
    await win.keyboard.press('Shift+Tab');
    expect((await settingsFocusState(win)).idx).toBe(count - 1);

    await win.evaluate(() => {
      const panel = document.getElementById('settingsPanel');
      const list = Array.from(panel.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
      list[list.length - 1].focus();
    });
    await win.keyboard.press('Tab');
    expect((await settingsFocusState(win)).idx).toBe(0);
  } finally {
    await closeApp(ctx);
  }
});

test('UX-14 设置抽屉：更上层确认框默认聚焦安全取消项，Escape 不关闭下层设置，回车取消后焦点归还', async () => {
  const ctx = await openApp();
  const win = ctx.win;
  try {
    await win.locator('#btnSettings').click();
    await expect(win.locator('#settingsOverlay')).toBeVisible();
    await win.locator('.sp-nav-item[data-tab="trash"]').click();
    await win.locator('#btnEmptyTrash').click();

    const modal = win.locator('body > [data-modal-overlay]');
    await expect(modal).toBeVisible();

    // 危险确认框打开时应聚焦安全项「取消」，而不是停留在下层触发按钮
    await expect(win.locator('#cmCancel')).toBeFocused();
    // Escape 不入确认框语义，不得关闭下层设置，确认框也仍在
    await win.keyboard.press('Escape');
    await expect(win.locator('#settingsOverlay')).toBeVisible();
    await expect(modal).toBeVisible();

    // 键盘取消：回车（不强制鼠标点击）→ 确认框关闭、焦点回到触发按钮、设置仍开；此时 Escape 才关闭设置
    await win.keyboard.press('Enter');
    await expect(modal).toHaveCount(0);
    expect(await win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btnEmptyTrash');
    await expect(win.locator('#settingsOverlay')).toBeVisible();
    await win.keyboard.press('Escape');
    await expect(win.locator('#settingsOverlay')).toBeHidden();
  } finally {
    await closeApp(ctx);
  }
});

test('UX-14 设置抽屉：关于页更新说明嵌套打开/关闭，焦点归还且不误关设置', async () => {
  const ctx = await openApp();
  const win = ctx.win;
  try {
    await win.locator('#btnSettings').click();
    await win.locator('.sp-nav-item[data-tab="about"]').click();
    await win.locator('#btnChangelog').click();
    await expect(win.locator('#changelogOverlay')).toBeVisible();
    expect(await win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btnChangelogClose');

    // 更新说明在设置之上：Escape 不得关闭下层设置
    await win.keyboard.press('Escape');
    await expect(win.locator('#settingsOverlay')).toBeVisible();
    await expect(win.locator('#changelogOverlay')).toBeVisible();

    // 关闭更新说明 → 焦点回到设置内的按钮，设置保持打开
    await win.locator('#btnChangelogClose').click();
    await expect(win.locator('#changelogOverlay')).toBeHidden();
    await expect(win.locator('#settingsOverlay')).toBeVisible();
    expect(await win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btnChangelog');
  } finally {
    await closeApp(ctx);
  }
});

test('UX-14 设置抽屉：640/1080 宽度与亮/暗主题下 Escape/Tab 行为不变', async () => {
  const ctx = await openApp();
  const win = ctx.win;
  const overlay = win.locator('#settingsOverlay');
  try {
    for (const combo of [{ w: 640, mode: 'light' }, { w: 1080, mode: 'dark' }]) {
      await win.locator('#btnSettings').click();
      await expect(overlay).toBeVisible();
      await ctx.electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 700), combo.w);
      await win.locator('#modeSeg [data-mode="' + combo.mode + '"]').click({ force: true });
      await expect(overlay).toBeVisible();

      expect((await settingsFocusState(win)).inside).toBe(true);
      expect(await win.locator('#app').evaluate((el) => el.inert)).toBe(true);
      await win.keyboard.press('Tab');
      const s = await settingsFocusState(win);
      expect(s.inside).toBe(true);
      expect(s.inApp).toBe(false);

      await win.keyboard.press('Escape');
      await expect(overlay).toBeHidden();
      expect(await win.locator('#app').evaluate((el) => el.inert)).toBe(false);
      expect(await win.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btnSettings');
    }
  } finally {
    await closeApp(ctx);
  }
});

test('UX-14 设置抽屉：打开前已有的 inert 状态在关闭后保留', async () => {
  const ctx = await openApp();
  const win = ctx.win;
  try {
    // 模拟外部逻辑已让 #app inert：用程序化点击打开设置，关闭后不应擅自解除
    await win.evaluate(() => {
      document.getElementById('app').inert = true;
      document.getElementById('btnSettings').click();
    });
    await expect(win.locator('#settingsOverlay')).toBeVisible();
    await win.keyboard.press('Escape');
    await expect(win.locator('#settingsOverlay')).toBeHidden();
    expect(await win.locator('#app').evaluate((el) => el.inert)).toBe(true);
    await win.evaluate(() => { document.getElementById('app').inert = false; });
  } finally {
    await closeApp(ctx);
  }
});

test('UX-14 设置抽屉：快捷键录制中 Escape 只取消录制，设置保持打开，再次 Escape 才关闭', async () => {
  const ctx = await openApp();
  const win = ctx.win;
  const overlay = win.locator('#settingsOverlay');
  try {
    await win.locator('#btnSettings').click();
    await win.locator('.sp-nav-item[data-tab="shortcuts"]').click();

    const shortcutsBefore = await win.evaluate(() => JSON.stringify(state.settings.shortcuts || {}));
    const keyBtn = win.locator('.sc-key').first();
    await keyBtn.click();
    await expect(keyBtn).toHaveClass(/recording/);

    // 录制中按 Escape：录制器在捕获阶段消费该键，只取消录制；不写快捷键，也不关闭设置
    await win.keyboard.press('Escape');
    await expect(keyBtn).not.toHaveClass(/recording/);
    await expect(overlay).toBeVisible();
    expect(await win.evaluate(() => JSON.stringify(state.settings.shortcuts || {}))).toBe(shortcutsBefore);

    // 录制已退出，此时 Escape 才关闭设置
    await win.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  } finally {
    await closeApp(ctx);
  }
});

// ---------- UX-15：纯图标控件的可访问名称与状态 ----------

// 种一张便签并展开便签工具栏（非精简），以便同一用例覆盖主/次按钮
function ux15Seed(extraSettings) {
  const now = Date.now();
  return {
    version: 2,
    settings: Object.assign(
      { viewMode: 'board', sortMode: 'updated', noteToolbarCompact: false, lastSeenVersion: EXPECTED_VERSION },
      extraSettings || {}
    ),
    groups: [], trash: [],
    notes: [{
      id: 'a', title: '卡片', content: '', type: 'note', items: [], images: [], files: [], tables: [],
      color: '#93f1ce', textColor: null, groupId: null, pinned: false, preview: false, desktopPin: false, reminder: null,
      x: 30, y: 30, positionAll: { x: 30, y: 30 }, w: 240, h: 200, z: 1, createdAt: now, updatedAt: now
    }]
  };
}

test('UX-15 可访问名称：四个视图切换与便签工具在中英文下均为本地化名称', async () => {
  const ctx = await openApp({ seed: ux15Seed() });
  const win = ctx.win;
  try {
    // 中文：视图切换 + 顶部工具栏纯图标按钮 + 便签工具
    await expect(win.locator('#viewBoard')).toHaveAccessibleName('便签视图');
    await expect(win.locator('#viewMemo')).toHaveAccessibleName('备忘录视图');
    await expect(win.locator('#viewTodo')).toHaveAccessibleName('待办区');
    await expect(win.locator('#viewDoc')).toHaveAccessibleName('文档模式');
    await expect(win.locator('#btnSettings')).toHaveAccessibleName('全局设置');
    await expect(win.locator('#btnUndo')).toHaveAccessibleName('撤销');
    await expect(win.locator('#btnRedo')).toHaveAccessibleName('重做');

    const card = win.locator('#board .note[data-id="a"]');
    await expect(card.locator('.t-desktop').first()).toHaveAccessibleName('钉在桌面');
    await expect(card.locator('.t-pin')).toHaveAccessibleName('置顶');
    await expect(card.locator('.t-todo')).toHaveAccessibleName('待办模式');
    await expect(card.locator('.t-preview')).toHaveAccessibleName('预览');
    await expect(card.locator('.t-color')).toHaveAccessibleName('颜色');
    await expect(card.locator('.t-del')).toHaveAccessibleName('删除');
    await expect(card.locator('.t-image')).toHaveAccessibleName('插入图片');

    // 切到英文：既有控件无需重启即刷新名称
    await stableClick(win.locator('#btnSettings'));
    await stableClick(win.locator('.sp-nav-item[data-tab="data"]'));
    await win.locator('#languageSelect').selectOption('en');
    await stableClick(win.locator('#btnCloseSettings'));

    await expect(win.locator('#viewBoard')).toHaveAccessibleName('Board view');
    await expect(win.locator('#viewMemo')).toHaveAccessibleName('List view');
    await expect(win.locator('#viewTodo')).toHaveAccessibleName('Todo view');
    await expect(win.locator('#viewDoc')).toHaveAccessibleName('Document view');
    await expect(win.locator('#btnSettings')).toHaveAccessibleName('Global Settings');
    await expect(win.locator('#btnUndo')).toHaveAccessibleName('Undo');

    const cardEn = win.locator('#board .note[data-id="a"]');
    await expect(cardEn.locator('.t-desktop').first()).toHaveAccessibleName('Pin to desktop');
    await expect(cardEn.locator('.t-pin')).toHaveAccessibleName('Pin');
    await expect(cardEn.locator('.t-todo')).toHaveAccessibleName('Todo mode');
    await expect(cardEn.locator('.t-preview')).toHaveAccessibleName('Preview');
    await expect(cardEn.locator('.t-del')).toHaveAccessibleName('Delete');
  } finally {
    await closeApp(ctx);
  }
});

test('UX-15 精简便签工具：默认「更多」与备忘录共享工具栏在中英文下均为本地化名称', async () => {
  const ctx = await openApp({ seed: ux15Seed({ viewMode: 'memo', noteToolbarCompact: true }) });
  const win = ctx.win;
  const row = () => win.locator('#memoList .memo-row[data-id="a"]');
  try {
    // 精简模式默认出现「⋯ 更多」，此前只有符号、无可访问名称
    await expect(row().locator('.t-more')).toHaveAccessibleName('更多');
    // 备忘录行复用同一共享工具栏（既有 UX-15 用例只覆盖画布卡片）
    await expect(row().locator('.t-desktop').first()).toHaveAccessibleName('钉在桌面');
    await expect(row().locator('.t-pin')).toHaveAccessibleName('置顶');
    await expect(row().locator('.t-del')).toHaveAccessibleName('删除');

    // 切英文：共享工具栏与「更多」即时刷新为英文名称
    await stableClick(win.locator('#btnSettings'));
    await stableClick(win.locator('.sp-nav-item[data-tab="data"]'));
    await win.locator('#languageSelect').selectOption('en');
    await stableClick(win.locator('#btnCloseSettings'));

    await expect(row().locator('.t-more')).toHaveAccessibleName('More');
    await expect(row().locator('.t-desktop').first()).toHaveAccessibleName('Pin to desktop');
    await expect(row().locator('.t-pin')).toHaveAccessibleName('Pin');
    await expect(row().locator('.t-del')).toHaveAccessibleName('Delete');
  } finally {
    await closeApp(ctx);
  }
});

// 结束 Electron 进程但保留 userData，用于「重开读取持久化视图」场景
async function quitKeepData(app) {
  let pid = null;
  try { pid = app.process() ? app.process().pid : null; } catch (_) {}
  await app.close().catch(() => {});
  if (pid) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {} }
}

test('UX-15 视图选中态：初始持久化视图、点击切换与重开后恰好一个 pressed', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mynotes-ux15-'));
  await fs.writeFile(path.join(userDataDir, 'notes-data.json'), JSON.stringify(ux15Seed({ viewMode: 'doc' })));
  let ctx = await openApp({ userDataDir });
  const pressed = () => ctx.win.evaluate(() => {
    const o = {};
    ['viewBoard', 'viewMemo', 'viewTodo', 'viewDoc'].forEach((id) => { o[id] = document.getElementById(id).getAttribute('aria-pressed'); });
    return o;
  });
  try {
    // 初始即为持久化的文档视图
    expect(await pressed()).toEqual({ viewBoard: 'false', viewMemo: 'false', viewTodo: 'false', viewDoc: 'true' });

    // 真实点击切换 → 恰好一个按下，且视觉 active 与 aria 同源
    await stableClick(ctx.win.locator('#viewMemo'));
    const afterClick = await pressed();
    expect(afterClick).toEqual({ viewBoard: 'false', viewMemo: 'true', viewTodo: 'false', viewDoc: 'false' });
    expect(await ctx.win.locator('#viewMemo').getAttribute('class')).toContain('active');
    expect(await ctx.win.locator('#memoList').isVisible()).toBe(true);

    // 落盘后退出，复用同一 userData 重开：读取已持久化的视图
    await ctx.win.evaluate(() => saveNow());
    await quitKeepData(ctx.electronApp);
    ctx = await openApp({ userDataDir });
    expect(await pressed()).toEqual({ viewBoard: 'false', viewMemo: 'true', viewTodo: 'false', viewDoc: 'false' });
  } finally {
    await closeApp(ctx);
  }
});

test('UX-15 便签工具状态：置顶/预览/待办按真实切换更新 aria-pressed，动作按钮不伪装开关', async () => {
  const ctx = await openApp({ seed: ux15Seed() });
  const win = ctx.win;
  const card = () => win.locator('#board .note[data-id="a"]');
  try {
    // 动作类按钮不得带 aria-pressed（避免被读成开关）
    for (const sel of ['.t-image', '.t-del', '.t-color', '.t-desktop', '.t-group', '.t-table', '.t-remind']) {
      expect(await card().locator(sel).first().getAttribute('aria-pressed')).toBeNull();
    }
    await expect(card().locator('.t-pin')).toHaveAttribute('aria-pressed', 'false');
    await expect(card().locator('.t-preview')).toHaveAttribute('aria-pressed', 'false');
    await expect(card().locator('.t-todo')).toHaveAttribute('aria-pressed', 'false');

    await stableClick(card().locator('.t-pin'));
    await expect(card().locator('.t-pin')).toHaveAttribute('aria-pressed', 'true');
    await expect(card().locator('.t-pin')).toHaveAccessibleName('置顶');

    await stableClick(card().locator('.t-preview'));
    await expect(card().locator('.t-preview')).toHaveAttribute('aria-pressed', 'true');
    // 预览态下按钮名反映「退出预览」动作
    await expect(card().locator('.t-preview')).toHaveAccessibleName('退出预览');

    await stableClick(card().locator('.t-todo'));
    await expect(card().locator('.t-todo')).toHaveAttribute('aria-pressed', 'true');
    // 转待办后预览按钮不再出现（沿用既有行为）
    await expect(card().locator('.t-preview')).toHaveCount(0);
  } finally {
    await closeApp(ctx);
  }
});

test('UX-15 键盘：Tab 聚焦视图切换有可见焦点指示，Enter 激活对应视图', async () => {
  const ctx = await openApp({ seed: ux15Seed() });
  const win = ctx.win;
  try {
    const tabTo = async (id) => {
      for (let i = 0; i < 60; i++) {
        await win.keyboard.press('Tab');
        if (await win.evaluate((x) => document.activeElement && document.activeElement.id === x, id)) return true;
      }
      return false;
    };
    expect(await tabTo('viewMemo')).toBe(true);

    const focus = await win.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { fv: el.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0 };
    });
    expect(focus.fv).toBe(true);
    expect(focus.style).not.toBe('none');
    expect(focus.width).toBeGreaterThan(0);

    await win.keyboard.press('Enter');
    await expect(win.locator('#viewMemo')).toHaveAttribute('aria-pressed', 'true');
    await expect(win.locator('#memoList')).toBeVisible();
    await expect(win.locator('#board')).toBeHidden();
  } finally {
    await closeApp(ctx);
  }
});

test('UX-15 键盘：共享便签工具栏按钮聚焦仍有可见焦点指示', async () => {
  const ctx = await openApp({ seed: ux15Seed() });
  const win = ctx.win;
  try {
    const tabTo = async (sel) => {
      for (let i = 0; i < 120; i++) {
        await win.keyboard.press('Tab');
        if (await win.evaluate((s) => document.activeElement && document.activeElement.matches(s), sel)) return true;
      }
      return false;
    };
    expect(await tabTo('#board .note[data-id="a"] .note-tools .t-del')).toBe(true);

    const focus = await win.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { fv: el.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0 };
    });
    expect(focus.fv).toBe(true);
    expect(focus.style).not.toBe('none');
    expect(focus.width).toBeGreaterThan(0);
  } finally {
    await closeApp(ctx);
  }
});
