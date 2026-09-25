/* 主窗共享状态容器（L2）：主窗唯一的可变状态来源。
   设计要点：
   - 所有「原始值状态」以 getter/setter 暴露到顶层全局，使 notes-view.js 等经典脚本里的
     裸读写（multiSelect = true / if (docNoteId) …）继续工作，无需改任何调用点。
   - 「对象/集合状态」（state / filter / selectedNotes / richCache / boardEls）本身是引用，
     顶层只暴露同一个引用即可。
   - app.js 仍保留字面量初始化（let state = {...}），但由本模块统一接管其读写语义：
     app.js 改为 `var state = AppState.initState(DEFAULT_SETTINGS)` 之类亦可；
     为最小侵入，这里直接持有并在 window 上 defineProperty 转发到内部变量。
   沿用项目 UMD 惯例。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root['AppState'] = factory();
    const fns = root['AppState'];
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 原始值状态（需访问器，才能跨模块共享同一份） ----
  const primitives = {
    multiSelect: false,
    isBatchDragging: false,
    spaceDown: false,
    zCounter: 10,
    saveTimer: null,
    dragSortId: null,
    docNoteId: null,
    savedRange: null,
    savedSelText: '',
    savedNoteId: null,
    savedImageSrc: null,
    copiedImage: null,
    lastRenderView: null,
    sortPanelGroupId: 'all',
    shortcutRecordingId: null,
    alarmNoteId: null,
    reminderNoteId: null,
    closeDecisionResolve: null,
    saveErrorShown: false,
    dataReadonly: false,
    skipSave: false,           // 导入备份等场景的保存抑制标记
    // 表格块选中态（主窗专用；note.js 有自己独立的一套，见 note.js）
    activeTableEl: null,
    activeTableNote: null,
    activeTableToolbar: null,
    activeTableSelCell: null,
    activeTableSelBox: null,
    lastTableBoxTime: 0
  };

  // ---- 引用型状态（对象/集合，同一引用共享即可） ----
  const refs = {
    state: null,               // 由 app.js 在启动时用真实数据填充（initState）
    filter: { group: 'all', query: '', archive: false },
    selectedNotes: new Set(),
    richCache: new Map(),
    boardEls: new Map(),
    // 弹窗句柄：跨模块（canvas-zoom / popovers）共享
    activeColorPop: null,
    activeGroupPop: null
  };

  // 在浏览器端把状态名挂到顶层全局；原始值用访问器，引用值用同一引用
  function install(target) {
    Object.keys(primitives).forEach((k) => {
      Object.defineProperty(target, k, {
        get() { return primitives[k]; },
        set(v) { primitives[k] = v; },
        configurable: true
      });
    });
    Object.keys(refs).forEach((k) => {
      // 引用型整体替换也要生效（如 state = migrated）：同样用访问器
      Object.defineProperty(target, k, {
        get() { return refs[k]; },
        set(v) { refs[k] = v; },
        configurable: true
      });
    });
  }

  // app.js 启动时用它建立 state 的初始值
  function initState(initial) {
    refs.state = initial || { settings: {}, groups: [], notes: [], trash: [] };
    return refs.state;
  }

  function getPrimitive(k) { return primitives[k]; }
  function setPrimitive(k, v) { primitives[k] = v; }
  function getRef(k) { return refs[k]; }
  function setRef(k, v) { refs[k] = v; }

  return {
    primitives, refs, install, initState,
    getPrimitive, setPrimitive, getRef, setRef
  };
}));
