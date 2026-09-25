/* system/dialogs.js
   承接：通用弹窗 / 关闭确认弹窗 / 备份 / 提示气泡 四个强 DOM 相关的应用级子系统。
   沿用项目 UMD 惯例：Node 走 module.exports；浏览器挂 root.systemDialogs + 顶层全局。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.systemDialogs = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

/* ============ 通用弹窗 ============ */
function promptModal(title, placeholder, def) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;border-radius:14px;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:280px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
    modal.innerHTML = `
      <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${escapeHtml(title)}</header>
      <div style="padding:16px"><input id="pmInput" style="width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;font-family:inherit;font-size:14px" value="${escapeHtml(def || '')}" /></div>
      <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
        <button id="pmCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
        <button id="pmOk" class="sp-btn primary" style="width:auto;padding:8px 18px">${t('ok')}</button>
      </footer>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const input = $('#pmInput', modal);
    const done = (val) => { overlay.remove(); resolve(val); };
    $('#pmOk', modal).onclick = () => done(input.value);
    $('#pmCancel', modal).onclick = () => done(null);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    input.focus();
    input.select();
  });
}

function confirmModal(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;border-radius:14px;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:300px;background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;';
    modal.innerHTML = `
      <header style="padding:14px 16px;font-weight:700;border-bottom:1px solid var(--border)">${escapeHtml(title)}</header>
      <div style="padding:16px;font-size:13.5px;color:var(--fg-dim);line-height:1.6">${escapeHtml(message)}</div>
      <footer style="padding:12px 16px;display:flex;gap:10px;justify-content:flex-end">
        <button id="cmCancel" class="sp-btn ghost" style="width:auto;padding:8px 18px">${t('cancel')}</button>
        <button id="cmOk" class="sp-btn" style="width:auto;padding:8px 18px;background:#e5484d">${t('ok')}</button>
      </footer>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    $('#cmOk', modal).onclick = () => { overlay.remove(); resolve(true); };
    $('#cmCancel', modal).onclick = () => { overlay.remove(); resolve(false); };
  });
}

/* ============ 关闭确认弹窗（主题化三个选择） ============ */
// （closeDecisionResolve 见 core/app-state.js）
function showCloseDecisionModal() {
  return new Promise((resolve) => {
    // 若已有弹窗在等待，先关闭上一个
    if (closeDecisionResolve) { const r = closeDecisionResolve; closeDecisionResolve = null; r('cancel'); }
    closeDecisionResolve = resolve;
    const overlay = $('#closeOverlay');
    if (!overlay) { resolve('cancel'); return; }
    overlay.classList.remove('hidden');
  });
}

function hideCloseDecisionModal() {
  const overlay = $('#closeOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function closeDecision(choice) {
  const r = closeDecisionResolve;
  closeDecisionResolve = null;
  hideCloseDecisionModal();
  if (r) r(choice);
}

/* ============ 备份 ============ */
async function chooseBackupDir() {
  const r = await window.api.chooseDirectory();
  if (r.ok) {
    state.settings.backupDir = r.path;
    const el = $('#backupDir');
    if (el) el.value = r.path;
    save();
  }
}

async function backupNow() {
  const r = await window.api.backupExport(
    { settings: state.settings, groups: state.groups, notes: state.notes, trash: state.trash },
    state.settings.backupDir || null
  );
  if (r.ok) toast(t('toast_backup_ok') + r.path);
  else toast(t('toast_backup_fail') + r.error);
}

async function openBackupDir() {
  await window.api.openPath(state.settings.backupDir || null);
}

/* ============ 提示气泡 ============ */
let activeTipEl = null;
let tipTimer = null;
let tipEl = null;

function initTooltips() {
  tipEl = document.createElement('div');
  tipEl.id = 'tooltip';
  document.body.appendChild(tipEl);

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title]');
    if (el && el !== activeTipEl) {
      restoreTipEl();
      const text = el.getAttribute('title');
      if (text && text.trim()) {
        activeTipEl = el;
        el.setAttribute('data-tip-text', text);
        el.removeAttribute('title');
        showTooltip(el, text);
      }
    }
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[title], [data-tip-text]');
    if (el && el === activeTipEl) {
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      restoreTipEl();
      hideTooltip();
    }
  });

  document.addEventListener('mousedown', hideTooltip);
  $('#canvas').addEventListener('scroll', hideTooltip);
  window.addEventListener('blur', hideTooltip);
}

function showTooltip(el, text) {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    if (!activeTipEl) return;
    tipEl.textContent = text;
    tipEl.classList.add('visible');
    positionTooltip(el);
  }, 350);
}

function positionTooltip(el) {
  const r = el.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  let left = r.left + r.width / 2;
  let top = r.bottom + 8;
  if (top + th > window.innerHeight - 4) top = r.top - th - 8;
  if (left - tw / 2 < 4) left = tw / 2 + 4;
  if (left + tw / 2 > window.innerWidth - 4) left = window.innerWidth - tw / 2 - 4;
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}

function hideTooltip() {
  clearTimeout(tipTimer);
  if (tipEl) tipEl.classList.remove('visible');
}

function restoreTipEl() {
  if (activeTipEl) {
    if (activeTipEl.hasAttribute('data-tip-text')) {
      activeTipEl.setAttribute('title', activeTipEl.getAttribute('data-tip-text'));
      activeTipEl.removeAttribute('data-tip-text');
    }
    activeTipEl = null;
  }
}

  return {
    promptModal, confirmModal,
    showCloseDecisionModal, hideCloseDecisionModal, closeDecision,
    chooseBackupDir, backupNow, openBackupDir,
    initTooltips, showTooltip, positionTooltip, hideTooltip, restoreTipEl
  };
}));
