// 由主进程调用工作区当前状态。速记窗不持有整份存档，也不改变当前筛选或视图。
function enableQuickCapture() {
  window.quickCaptureWorkspace = {
    config() {
      const preset = getTheme();
      return {
        language: state.settings.language,
        light: isLightTheme(),
        accent: state.settings.accent || preset.accent,
        groups: state.groups.map(({ id, name }) => ({ id, name }))
      };
    },

    async save({ id, title, content, groupId, pin }) {
      if (dataReadonly) return 'readonly';

      const group = state.groups.find((item) => item.id === groupId);
      const normalizedGroupId = group?.id || null;
      let note = state.notes.find((item) => item.id === id);
      if (!note || note.groupId !== normalizedGroupId) {
        const maxX = Math.round(($('#canvas').clientWidth || LAYOUT.defaultW * 6) / boardZoom());
        const occupied = state.notes.filter((item) => item !== note && !item.archived && !item.desktopPin &&
          (item.groupId || null) === normalizedGroupId);
        const pos = BoardLayout.nextGridPosition(occupied, maxX, {}, LAYOUT.defaultW, LAYOUT.newH);
        if (!note) {
          pushUndo();
          note = makeWorkspaceNote(pos, nextAllPosition(), normalizedGroupId);
          note.id = id;
          state.notes.push(note);
        } else {
          Object.assign(note, pos, { groupId: normalizedGroupId });
        }
      }
      Object.assign(note, { title, content, updatedAt: Date.now() });
      ensureOrder();
      const saved = await saveNow();
      renderAll();
      if (!saved) return 'failed';

      if (pin) {
        try {
          if (await window.api.pinToDesktop(id)) {
            note.desktopPin = true;
            renderAll();
          } else {
            return 'unpinned';
          }
        } catch (err) {
          console.error('[quick-capture] 钉桌失败：', err);
          return 'unpinned';
        }
      }
      return 'saved';
    }
  };
}
