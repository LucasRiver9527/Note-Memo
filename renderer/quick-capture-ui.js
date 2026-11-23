const $ = (id) => document.getElementById(id);
const form = $('capture');
const title = $('title');
const content = $('content');
const group = $('group');
const pin = $('pin');
const save = $('save');
const status = $('status');
const api = window.quickCaptureApi;
const copy = {
  zh: {
    heading: '快速记录', title: '标题', optional: '标题（可选）', body: '正文',
    placeholder: '写下刚想到的事…', group: '分组', ungrouped: '未分组', pin: '钉到桌面',
    save: '保存', saving: '保存中…', done: '完成', empty: '写下标题或正文即可保存。',
    failed: '保存失败，内容已保留，可以重试。', readonly: '存档处于只读状态，请先在工作区恢复。',
    unpinned: '便签已保存，钉到桌面失败。'
  },
  en: {
    heading: 'Quick Capture', title: 'Title', optional: 'Title (optional)', body: 'Note',
    placeholder: 'Write down a thought…', group: 'Group', ungrouped: 'Ungrouped', pin: 'Pin to desktop',
    save: 'Save', saving: 'Saving…', done: 'Done', empty: 'Enter a title or a note to save.',
    failed: 'Save failed. Your text is still here. Try again.', readonly: 'Storage is read-only. Recover it in the workspace first.',
    unpinned: 'Note saved. Could not pin it to the desktop.'
  }
};
let text = copy.zh;
let pending = false;
let savedWithoutPin = false;

async function refresh() {
  const config = await api.config().catch(() => null);
  if (!config) return;
  text = config.language === 'en' ? copy.en : copy.zh;
  document.documentElement.lang = config.language === 'en' ? 'en' : 'zh-CN';
  document.documentElement.toggleAttribute('data-dark', !config.light);
  if (/^#[0-9a-f]{6}$/i.test(config.accent)) document.documentElement.style.setProperty('--accent', config.accent);
  $('heading').textContent = text.heading;
  title.placeholder = text.optional;
  title.setAttribute('aria-label', text.title);
  content.placeholder = text.placeholder;
  content.setAttribute('aria-label', text.body);
  group.setAttribute('aria-label', text.group);
  $('pinLabel').textContent = text.pin;
  const current = group.value;
  group.replaceChildren(new Option(text.ungrouped, ''), ...config.groups.map(({ name, id }) => new Option(name, id)));
  group.value = config.groups.some(({ id }) => id === current) ? current : '';
  save.textContent = pending ? text.saving : savedWithoutPin ? text.done : text.save;
}

function reset() {
  form.reset();
  pin.setAttribute('aria-pressed', 'false');
  status.textContent = '';
  savedWithoutPin = false;
}

pin.addEventListener('click', () => pin.setAttribute('aria-pressed', String(pin.getAttribute('aria-pressed') !== 'true')));
document.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape' && !pending) {
    if (savedWithoutPin) reset();
    api.hide();
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending) return;
  if (savedWithoutPin) {
    reset();
    api.hide();
    return;
  }
  if (!title.value.trim() && !content.value.trim()) {
    status.textContent = text.empty;
    content.focus();
    return;
  }
  pending = true;
  status.textContent = '';
  const fields = [title, content, group, pin, save];
  fields.forEach((field) => { field.disabled = true; });
  save.textContent = text.saving;
  const result = await api.save({
    title: title.value, content: content.value, groupId: group.value,
    pin: pin.getAttribute('aria-pressed') === 'true'
  }).catch(() => 'failed');
  pending = false;
  fields.forEach((field) => { field.disabled = false; });
  if (result === 'saved' || result === 'unpinned') {
    reset();
    savedWithoutPin = result === 'unpinned';
  }
  status.textContent = result === 'saved' ? '' : text[result] || text.failed;
  save.textContent = savedWithoutPin ? text.done : text.save;
  if (result !== 'saved') (savedWithoutPin ? save : content).focus();
});

window.addEventListener('focus', () => {
  if (!pending) (savedWithoutPin ? save : content).focus();
  refresh();
});
refresh();
