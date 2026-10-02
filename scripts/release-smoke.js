#!/usr/bin/env node
'use strict';
/**
 * 安装包冒烟验证（独立脚本，不进测试套件）。
 *
 *   node scripts/release-smoke.js <解包后的 exe 绝对路径> <期望版本>
 *
 * 用仓库已安装的 @playwright/test Electron launcher 启动「解包版」应用，
 * 在全新的系统临时 userData 上验证：版本一致、首启更新说明、创建便签并落盘、
 * 强杀后重启仍能看到数据且无数据告警。
 *
 * 只动脚本自己创建的临时 userData；成功时删除，失败时保留并打印路径。
 * 不触碰已安装的 MyNotes 或真实用户数据。
 */
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// 硬超时：整个流程（含两次启动）都不得超过该值。ponytail: 固定 120s；若打包机明显更慢再上调。
const TIMEOUT_MS = 120_000;

const EXE = process.argv[2];
const VERSION = process.argv[3];

/** 已启动的 Electron 句柄，供 finally / 超时兜底清理进程树。 */
const apps = [];

function validateArgs() {
  const usage = '用法: node scripts/release-smoke.js <解包后的 exe 绝对路径> <期望版本>';
  if (!EXE || !VERSION) return `${usage}（两个参数都必填）`;
  if (process.platform !== 'win32') return 'release-smoke 仅支持在 Windows 上运行';
  if (!path.isAbsolute(EXE)) return `exe 路径必须是绝对路径：${EXE}`;
  let stat;
  try {
    stat = fs.statSync(EXE);
  } catch (_) {
    return `exe 不存在：${EXE}`;
  }
  if (!stat.isFile()) return `exe 不是文件：${EXE}`;
  if (!/^\d+\.\d+(\.\d+)?/.test(VERSION)) return `期望版本格式不正确：${VERSION}`;
  return null;
}

/** 启动应用：全新临时 userData、禁用自动更新、无沙箱无 GPU。 */
async function launchApp(userDataDir) {
  const electronApp = await electron.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--disable-gpu'],
    env: { ...process.env, MYNOTES_USER_DATA: userDataDir, MYNOTES_DISABLE_AUTOUPDATE: '1' },
  });
  apps.push(electronApp);
  const win = await electronApp.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // 关闭动画/过渡，避免冷启动时的稳定性竞态（与 tests/e2e 保持一致）
  await win.addStyleTag({ content: '*{animation:none !important;transition:none !important;}' }).catch(() => {});
  return { electronApp, win };
}

/** 强制结束该句柄对应的整个测试进程树（不走普通关闭/退出对话框）。 */
async function forceStop(electronApp) {
  if (!electronApp || electronApp.__smokeStopped) return;
  electronApp.__smokeStopped = true;
  let pid = null;
  try {
    const proc = electronApp.process();
    pid = proc && proc.pid;
  } catch (_) {}
  if (pid) {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch (_) {}
  }
  // 进程已强杀，close() 只用于释放 Playwright 内部连接；限时避免挂起。
  await Promise.race([
    electronApp.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]).catch(() => {});
}

function readNoteTitles(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'notes-data.json'), 'utf8'));
    return (data.notes || []).map((n) => n && n.title);
  } catch (_) {
    return [];
  }
}

/** 恢复草稿是否已清空（文件不存在，或 main 为空且无便签草稿）。 */
function recoveryCleared(dir) {
  const file = path.join(dir, 'notes-recovery.json');
  if (!fs.existsSync(file)) return true;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return !parsed.main && Object.keys(parsed.notes || {}).length === 0;
  } catch (_) {
    return false;
  }
}

async function smoke(userDataDir) {
  const title = `SMOKE-${Date.now()}`;

  // ---- 第一次启动：首启界面 + 建便签落盘 ----
  const first = await launchApp(userDataDir);
  const win = first.win;

  const appVersion = await win.evaluate(() => window.api && window.api.appVersion);
  if (appVersion !== VERSION) {
    throw new Error(`window.api.appVersion 不符：期望 ${VERSION}，实际 ${appVersion}`);
  }

  // 首启应弹出「更新说明」，标题版本 = v<期望版本>
  await expect(win.locator('#changelogOverlay')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await win.locator('#clVersion').textContent()) || '',
    { timeout: 10_000, message: '更新说明标题版本' }).toBe(`v${VERSION}`);
  const clItems = await win.locator('#changelogList li').allTextContents();
  if (VERSION === '1.2.6' && !clItems.some((t) => t.includes('测试版说明') || /Test build/i.test(t))) {
    throw new Error('更新说明缺少 1.2.6 测试版说明文案');
  }
  await win.locator('#btnChangelogClose').click();
  // 明确等待更新说明关闭后再新建，避免与关闭动画/遮罩竞态（封装版回归：force 点击会跳过早于关闭的等待）
  await expect(win.locator('#changelogOverlay')).toBeHidden({ timeout: 10_000 });

  // 新建便签并写入唯一标题
  await win.locator('#btnAdd').click();
  const titleInput = win.locator('#board .note .note-title').first();
  await expect(titleInput).toBeVisible({ timeout: 20_000 });
  await titleInput.fill(title);

  // 确认标题已写入 notes-data.json，且恢复草稿已清空
  await expect.poll(() => readNoteTitles(userDataDir).includes(title),
    { timeout: 30_000, message: '标题落盘' }).toBe(true);
  await expect.poll(() => recoveryCleared(userDataDir),
    { timeout: 30_000, message: '恢复草稿清空' }).toBe(true);

  // ---- 强杀 + 重启：数据仍在，无数据告警 ----
  await forceStop(first.electronApp);

  const second = await launchApp(userDataDir);
  const win2 = second.win;
  await expect(win2.locator('#board .note .note-title').first()).toHaveValue(title, { timeout: 20_000 });
  await expect(win2.locator('#noteCount')).toHaveText('1');
  await expect(win2.locator('#dataAlert')).toBeHidden();
  await expect(win2.locator('body')).not.toHaveClass(/data-readonly/);
  await expect(win2.locator('#cmOk')).toBeHidden(); // 没有恢复草稿确认弹窗

  const about = (await win2.locator('#aboutVersion').textContent()) || '';
  if (about.trim() !== VERSION) {
    throw new Error(`关于页版本不符：期望 ${VERSION}，实际 ${about.trim()}`);
  }
  return title;
}

async function main() {
  const argError = validateArgs();
  if (argError) {
    console.error(`[release-smoke] FAIL: ${argError}`);
    process.exit(2);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mynotes-smoke-'));
  let passed = false;
  let persisted = '';

  const watchdog = setTimeout(() => {
    console.error(`[release-smoke] FAIL: 超时（${TIMEOUT_MS}ms）`);
    console.error(`  exe: ${EXE}`);
    console.error(`  version: ${VERSION}`);
    console.error(`  temp userData: ${userDataDir} （已保留以便诊断）`);
    for (const a of apps) forceStop(a);
    process.exit(1);
  }, TIMEOUT_MS);
  // 不阻止进程自然退出：成功路径会显式 clearTimeout。
  if (watchdog.unref) watchdog.unref();

  try {
    persisted = await smoke(userDataDir);
    passed = true;
  } catch (err) {
    console.error(`[release-smoke] FAIL: ${(err && err.message) || err}`);
  } finally {
    clearTimeout(watchdog);
    for (const a of apps) await forceStop(a).catch(() => {});
  }

  if (passed) {
    // 成功路径清理：Windows 上强杀后的句柄可能短时占用临时目录，用有界原生重试吸收（只删脚本自己创建的 userData）。
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (err) {
      // 清理失败绝不误报 PASS：如实报 FAIL 并保留路径（不动其它目录）。
      console.error(`[release-smoke] FAIL: 功能检查通过，但临时 userData 清理失败：${(err && err.message) || err}`);
      console.error(`  exe: ${EXE}`);
      console.error(`  version: ${VERSION}`);
      console.error(`  temp userData: ${userDataDir} （已保留以便诊断）`);
      process.exit(1);
    }
    console.log('[release-smoke] PASS');
    console.log(`  exe: ${EXE}`);
    console.log(`  version: ${VERSION}`);
    console.log(`  temp userData: ${userDataDir} （已删除）`);
    console.log(`  persisted title: ${persisted}`);
    process.exit(0);
  }

  console.error(`  exe: ${EXE}`);
  console.error(`  version: ${VERSION}`);
  console.error(`  temp userData: ${userDataDir} （已保留以便诊断）`);
  process.exit(1);
}

main();
