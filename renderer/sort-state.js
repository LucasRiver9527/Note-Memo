/* 排序 / 布局作用域纯逻辑模块：单一来源，可被单元测试，也可挂到页面全局。
   - Node: module.exports
   - 浏览器: 挂 root.SortState + 顶层全局，app.js 可直接按名字调用
   收拢「视图位置作用域」「排序作用域」「读序」等此前散落 app.js、易改一处崩一处的逻辑。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const fns = factory();
    root.SortState = fns;
    Object.keys(fns).forEach((k) => { root[k] = fns[k]; });
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALL = 'all';
  const UNGROUPED = 'ungrouped';
  const KEY_ALL = '_all';
  const KEY_UNGROUPED = '_ungrouped';

  // 解析某个「分组筛选值」对应的两个作用域：
  //   - orderGid：排序数组作用域（null = 全局 noteOrder，具体分组 id = 该分组的 groupOrders[id]）
  //   - layoutKey：布局快照作用域（'all' → '_all'、'ungrouped' → '_ungrouped'、分组 → 分组 id）
  function resolveScope(filterGroup) {
    const isGroup = !!(filterGroup && filterGroup !== ALL && filterGroup !== UNGROUPED);
    const orderGid = isGroup ? filterGroup : null;
    let layoutKey = KEY_ALL;
    if (filterGroup === UNGROUPED) layoutKey = KEY_UNGROUPED;
    else if (isGroup) layoutKey = filterGroup;
    return { orderGid, layoutKey };
  }

  // 取便签在当前视图作用域下的位置：「全部」用 positionAll，其余用便签自身 x,y。
  function posOf(n, filterGroup) {
    if (filterGroup === ALL && n && n.positionAll && typeof n.positionAll.x === 'number') return n.positionAll;
    return n;
  }

  // 写便签在当前视图作用域下的位置：「全部」写 positionAll，其余写 x,y。
  function writePos(n, x, y, filterGroup) {
    if (filterGroup === ALL) n.positionAll = { x, y };
    else { n.x = x; n.y = y; }
    return n;
  }

  // 由画布布局读序：先按「行」（~rowBand 带宽量化 y）再按「列」（x），返回按阅读顺序的 id 列表。
  // 位置通过 posOf 取（「全部」取 positionAll，否则取 x,y），保证保存的顺序与画面一致。
  // 行分组用 floor + 极小容差：round 半带宽边界会因浮点误差把同排便签拆到不同行，导致“保存排序后位置偏移”。
  function readOrderFromLayout(notes, filterGroup, rowBand) {
    const band = rowBand || 100;
    const eps = 0.001;
    return (notes || []).slice()
      .sort((a, b) => {
        const pa = posOf(a, filterGroup);
        const pb = posOf(b, filterGroup);
        const rowA = Math.floor(((pa.y || 0) / band) + eps);
        const rowB = Math.floor(((pb.y || 0) / band) + eps);
        return (rowA - rowB) || ((pa.x || 0) - (pb.x || 0));
      })
      .map((n) => n.id);
  }

  // 只重排当前视图内的便签（ids，按新顺序），保留视图外便签原有相对顺序（不清空其它分组顺序）。
  function reorderScoped(order, ids) {
    const inView = new Set(ids || []);
    const rest = (order || []).filter((id) => !inView.has(id));
    const out = [];
    (ids || []).forEach((id) => { if (!out.includes(id)) out.push(id); });
    rest.forEach((id) => { if (!out.includes(id)) out.push(id); });
    return out;
  }

  // 规整排序数组：剔除已删除便签、补入缺失便签；每个分组各自维护顺序。就地更新 groupOrders（保持原对象引用），
  // 返回 { noteOrder, groupOrders }。
  function ensureOrderRefs(notes, groups, noteOrder, groupOrders) {
    const order = (noteOrder || []).filter((id) => notes.some((n) => n.id === id));
    notes.forEach((n) => { if (!order.includes(n.id)) order.push(n.id); });
    const go = groupOrders || {};
    (groups || []).forEach((gr) => {
      let arr = (go[gr.id] || []).filter((id) => notes.some((n) => n.id === id && n.groupId === gr.id));
      notes.forEach((n) => { if (n.groupId === gr.id && !arr.includes(n.id)) arr.push(n.id); });
      go[gr.id] = arr;
    });
    return { noteOrder: order, groupOrders: go };
  }

  // 把 fromId 移到 toId **之前**（就地修改 order，返回 order）。
  // 关键：先移除 fromId 再重新定位 toId，避免 fromId 在 toId 之前时被插到 toId 之后（历史 off-by-one）。
  function moveBefore(order, fromId, toId) {
    const fi = order.indexOf(fromId);
    const ti = order.indexOf(toId);
    if (fi < 0 || ti < 0 || fi === ti) return order;
    order.splice(fi, 1);
    order.splice(order.indexOf(toId), 0, fromId);
    return order;
  }

  // 把 fromId 移到 afterId **之后**（就地修改 order，返回 order）。
  function moveAfter(order, fromId, afterId) {
    const fi = order.indexOf(fromId);
    if (fi < 0 || !afterId) return order;
    const ai = order.indexOf(afterId);
    if (ai < 0 || fi === ai) return order;
    order.splice(fi, 1);
    order.splice(order.indexOf(afterId) + 1, 0, fromId);
    return order;
  }

  // 排序策略（显示层）：根据当前排序方式返回便签 id 的「展示顺序」，**绝不修改 noteOrder/groupOrders**。
  // 存储基准（noteOrder/groupOrders）永远只代表「自定义顺序」；按时间/标题/颜色等都是临时展示滤镜。
  // 返回 id 列表（非便签对象），便于渲染层映射。缺省/未知策略回退 'updated'。
  //   - custom：基准顺序优先，缺失（新建）便签追加到末尾 → 新便签一定参与排序。
  //   - 非 custom：按策略排序（置顶 pinned 便签排最前，其余按策略），不改动存储。
  function applySortStrategy(notes, strategy, filterGroup, storedNoteOrder, storedGroupOrders) {
    const { orderGid } = resolveScope(filterGroup);
    const baseOrder = orderGid ? ((storedGroupOrders || {})[orderGid] || []) : (storedNoteOrder || []);
    const arr = (notes || []).slice();
    if (!arr.length) return [];
    const mode = strategy || 'updated';
    const byId = new Map(arr.map((n) => [n.id, n]));
    if (mode === 'custom') {
      const out = [];
      baseOrder.forEach((id) => { if (byId.has(id) && !out.includes(id)) out.push(id); });
      // 未保存（新建）便签：按默认方案（创建时间降序）排序追加到末尾，不干扰已保存便签的顺序
      const missing = arr.filter((n) => { const base = baseOrder.indexOf(n.id); return base < 0; });
      missing.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      missing.forEach((n) => { if (!out.includes(n.id)) out.push(n.id); });
      return out;
    }
    const cmp = (a, b) => {
      if (mode === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
      if (mode === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'zh');
      if (mode === 'color') {
        const ca = String(a.color || ''), cb = String(b.color || '');
        const la = /^#[0-9a-f]{6}$/i.test(ca), lb = /^#[0-9a-f]{6}$/i.test(cb);
        if (la && lb) return parseInt(ca.slice(1), 16) - parseInt(cb.slice(1), 16);
        return ca.localeCompare(cb);
      }
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    };
    arr.sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : cmp(a, b)));
    return arr.map((n) => n.id);
  }

  return { ALL, UNGROUPED, KEY_ALL, KEY_UNGROUPED, resolveScope, posOf, writePos, readOrderFromLayout, reorderScoped, ensureOrderRefs, moveBefore, moveAfter, applySortStrategy };
}));
