/* system/alarm.js
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.systemAlarm + 顶层全局。
   —— 本模块的函数通过顶层全局访问其他模块（与 board-layout.js / sort-panel.js 等同构）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.systemAlarm = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ 待办提醒 ============ */
// （reminderNoteId 见 core/app-state.js）

let reminderEveningTimer;

function openReminder(n) {
  reminderNoteId = n.id;
  $('#reminderTitle').textContent = n.title || t('set_todo_time');
  const input = $('#reminderInput');
  const preview = $('#reminderTimePreview');
  const updatePreview = () => {
    const date = new Date(input.value);
    const valid = Number.isFinite(date.getTime());
    $('#btnReminderSave').disabled = !valid;
    preview.textContent = valid ? new Intl.DateTimeFormat(
      state.settings.language === 'en' ? 'en' : 'zh-CN',
      { dateStyle: 'full', timeStyle: 'short', hourCycle: 'h23' }
    ).format(date) : '';
  };
  const setTime = (date) => {
    const pad = (value) => String(value).padStart(2, '0');
    input.value = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    updatePreview();
  };
  const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000);
  const current = new Date(n.reminder?.time || NaN);
  setTime(Number.isFinite(current.getTime()) ? current : inMinutes(60));
  input.oninput = updatePreview;
  $('#reminderInFifteen').onclick = () => setTime(inMinutes(15));
  $('#reminderInHour').onclick = () => setTime(inMinutes(60));
  const todayEvening = $('#reminderTodayEvening');
  const cutoff = new Date();
  cutoff.setHours(18, 0, 0, 0);
  clearTimeout(reminderEveningTimer);
  const remaining = cutoff.getTime() - Date.now();
  todayEvening.hidden = remaining <= 0;
  if (remaining > 0) {
    reminderEveningTimer = setTimeout(() => { todayEvening.hidden = true; }, remaining);
  }
  todayEvening.onclick = () => {
    if (Date.now() < cutoff.getTime()) setTime(cutoff);
    else todayEvening.hidden = true;
  };
  $('#reminderTomorrow').onclick = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    setTime(tomorrow);
  };
  $('#reminderOverlay').classList.remove('hidden');
}

function closeReminder() {
  clearTimeout(reminderEveningTimer);
  $('#reminderOverlay').classList.add('hidden');
  reminderNoteId = null;
}

/* ============ 闹铃声音 ============ */
let alarmAudio = null;    // 自定义声音 Audio（循环播放）
let alarmCtx = null;      // 默认提示音 WebAudio 上下文
let alarmTimer = null;    // 默认提示音循环定时器

function defaultAlarmVolume() {
  return (state.settings.reminderVolume != null ? state.settings.reminderVolume : 70) / 100;
}

function stopAlarm() {
  if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
  if (alarmAudio) { try { alarmAudio.pause(); alarmAudio.currentTime = 0; } catch (e) { /* ignore */ } alarmAudio = null; }
  if (alarmCtx) { try { alarmCtx.close(); } catch (e) { /* ignore */ } alarmCtx = null; }
}

function playDefaultBeep(ctx, volume) {
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.01, volume), now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  gain.connect(ctx.destination);
  const freqs = [880, 988, 880, 988];
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.16);
  });
}

function startDefaultAlarm(volume, loop) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  alarmCtx = ctx;
  if (ctx.state === 'suspended') ctx.resume();
  playDefaultBeep(ctx, volume);
  if (loop) {
    alarmTimer = setInterval(() => {
      if (!alarmCtx) return;
      playDefaultBeep(alarmCtx, volume);
    }, 1500);
  }
}

function playReminderSound(info) {
  stopAlarm();
  // 若明确禁用则静音
  if (info && info.enabled === false) return;
  let url = null;
  let volume = defaultAlarmVolume();
  if (info) {
    url = info.url || info.path || null;
    volume = (info.volume != null ? info.volume : defaultAlarmVolume());
  } else {
    url = state.settings.reminderSoundPath || null;
  }

  if (url) {
    try {
      const a = new Audio(url);
      a.loop = true;
      a.volume = Math.max(0, Math.min(1, volume));
      a.play().catch(() => {});
      alarmAudio = a;
    } catch (e) { /* ignore */ }
    return;
  }
  startDefaultAlarm(volume, true);
}

function previewReminderSound() {
  stopAlarm();
  const url = state.settings.reminderSoundPath || null;
  const volume = defaultAlarmVolume();
  if (url) {
    try {
      const a = new Audio(url);
      a.loop = false;
      a.volume = Math.max(0, Math.min(1, volume));
      a.play().catch(() => {});
      alarmAudio = a;
    } catch (e) { /* ignore */ }
    return;
  }
  startDefaultAlarm(volume, false);
}

/* ============ 闹铃提醒弹窗 ============ */
// （alarmNoteId 见 core/app-state.js）

function showAlarmModal(n) {
  alarmNoteId = n && n.id;
  const title = n.title || t('untitled');
  const body = n.type === 'todo'
    ? (n.items || []).filter((i) => !i.done).map((i) => i.text).join('\n')
    : (n.content || '').replace(/\[\[(?:img|file):[a-zA-Z0-9_-]+\]\]/g, '');
  $('#alarmTitle').textContent = '⏰ ' + title;
  $('#alarmBody').textContent = (body || '').slice(0, 400);
  $('#alarmOverlay').classList.remove('hidden');
}

function dismissAlarm() {
  alarmNoteId = null;
  stopAlarm();
  $('#alarmOverlay').classList.add('hidden');
}

// 稍后再响：把当前闹铃的提醒重新武装为「minutes 分钟后」，关闭弹窗并让主进程重新调度。
function snoozeAlarm(minutes) {
  const n = state.notes.find((x) => x.id === alarmNoteId);
  if (n && n.reminder) {
    n.reminder = { enabled: true, time: new Date(Date.now() + minutes * 60000).toISOString(), fired: false };
    n.updatedAt = Date.now();
    save();
    renderAll();
    toast(t('alarm_snoozed').replace('{n}', minutes));
  }
  dismissAlarm();
}

  return {
    openReminder, closeReminder,
    defaultAlarmVolume, stopAlarm, playDefaultBeep, startDefaultAlarm,
    playReminderSound, previewReminderSound,
    showAlarmModal, dismissAlarm, snoozeAlarm
  };
}));
