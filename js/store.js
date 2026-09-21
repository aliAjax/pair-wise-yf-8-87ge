/*
 * 状态模块 FilmStore
 * 持有整份业务状态并定义全部动作；动作成功后持久化并通知界面。
 * 规则判断调用 FilmRules，落盘调用 FilmStorage。
 */
(function () {
  "use strict";

  const {
    rangeBetween,
    validateFreeze,
    getFrozenVersion,
    nextVersionNumber,
    makeSnapshot
  } = window.FilmRules;

  let state = window.FilmStorage.load();
  const listeners = new Set();

  function emit() {
    listeners.forEach((listener) => listener(state));
  }

  function commit() {
    window.FilmStorage.save(state);
    emit();
  }

  function getState() {
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function isFrozen() {
    return Boolean(getFrozenVersion(state.versions));
  }

  function setReelTitle(value) {
    state.reelTitle = value;
    window.FilmStorage.save(state);
  }

  function addSegment(data) {
    if (isFrozen()) {
      return { ok: false, errors: ["版本冻结中，片段只读，不能新增。"] };
    }
    state.segments.push({
      id: crypto.randomUUID(),
      code: data.code,
      duration: Number(data.duration),
      shift: data.shift,
      damage: data.damage,
      note: data.note,
      thumb: data.thumb || ""
    });
    commit();
    return { ok: true };
  }

  function moveSegment(id, direction) {
    if (isFrozen()) return { ok: false, errors: ["版本冻结中，顺序已锁定。"] };
    const index = state.segments.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.segments.length) {
      return { ok: false, errors: ["无法移动该片段。"] };
    }
    const [item] = state.segments.splice(index, 1);
    state.segments.splice(target, 0, item);
    commit();
    return { ok: true };
  }

  function reorderSegment(draggedId, targetId) {
    if (isFrozen()) return { ok: false, errors: ["版本冻结中，顺序已锁定。"] };
    const from = state.segments.findIndex((item) => item.id === draggedId);
    const to = state.segments.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0 || from === to) return { ok: true };
    const [item] = state.segments.splice(from, 1);
    state.segments.splice(to, 0, item);
    commit();
    return { ok: true };
  }

  function removeSegment(id) {
    if (isFrozen()) {
      return { ok: false, errors: ["版本冻结中，片段只读，不能删除。"] };
    }
    state.segments = state.segments.filter((item) => item.id !== id);
    if (state.pendingExcludeId === id) state.pendingExcludeId = null;
    commit();
    return { ok: true };
  }

  // 解除冻结后“排除该片段”：从工作清单移除，旧版本快照保留
  function excludeSegment(id) {
    if (isFrozen()) {
      return { ok: false, errors: ["版本仍冻结中，请先在试映中标记新破损。"] };
    }
    state.segments = state.segments.filter((item) => item.id !== id);
    if (state.pendingExcludeId === id) state.pendingExcludeId = null;
    commit();
    return { ok: true };
  }

  /*
   * 按连续片段建立试映版本。
   * 校验不过：整次拒绝，原清单和已有版本一律不变（不写状态、不落盘）。
   */
  function freezeVersion({ fromId, toId, room, note }) {
    if (isFrozen()) {
      return { ok: false, errors: ["已有冻结版本，请先解除当前版本。"] };
    }
    if (state.pendingExcludeId) {
      const pending = state.segments.find((item) => item.id === state.pendingExcludeId);
      if (pending) {
        return {
          ok: false,
          errors: [`试映中标记新破损的片段 ${pending.code} 尚未排除，请先排除后再冻结新版本。`]
        };
      }
      state.pendingExcludeId = null;
    }
    const range = rangeBetween(state.segments, fromId, toId);
    if (!range.length) {
      return { ok: false, errors: ["请选择连续片段区间。"] };
    }
    const trimmedRoom = (room || "").trim();
    if (!trimmedRoom) {
      return { ok: false, errors: ["请登记放映室。"] };
    }
    const errors = validateFreeze(range);
    if (errors.length) {
      return { ok: false, errors };
    }

    const now = new Date().toISOString();
    const segmentIds = range.map((item) => item.id);
    const version = {
      id: crypto.randomUUID(),
      number: nextVersionNumber(state.versions),
      room: trimmedRoom,
      note: (note || "").trim(),
      frozenAt: now,
      unfrozenAt: "",
      status: "frozen",
      duration: range.reduce((sum, item) => sum + Number(item.duration || 0), 0),
      segmentIds,
      snapshot: makeSnapshot(range, segmentIds),
      damage: "",
      damageNote: "",
      damagedSegmentId: ""
    };
    state.versions.push(version);
    state.pendingExcludeId = null;
    commit();
    return { ok: true, version };
  }

  /*
   * 试映中对冻结片段标记新破损：
   * 片段记下新破损；当前版本解除冻结并完整保留快照；该片段进入待排除状态。
   */
  function markDamage(segmentId, damageType, damageNote) {
    const frozen = getFrozenVersion(state.versions);
    if (!frozen) {
      return { ok: false, errors: ["当前没有冻结版本。"] };
    }
    const segment = state.segments.find((item) => item.id === segmentId);
    if (!segment) {
      return { ok: false, errors: ["找不到该片段。"] };
    }
    if (!frozen.segmentIds.includes(segmentId)) {
      return { ok: false, errors: ["只能对冻结区间内的片段标记新破损。"] };
    }
    const note = (damageNote || "").trim();
    if (damageType === "接片松动" && !note) {
      return { ok: false, errors: ["接片松动必须填写处置备注。"] };
    }

    segment.newDamage = damageType;
    segment.newDamageNote = note;

    frozen.status = "unfrozen";
    frozen.unfrozenAt = new Date().toISOString();
    frozen.damage = damageType;
    frozen.damageNote = note;
    frozen.damagedSegmentId = segmentId;
    state.pendingExcludeId = segmentId;

    commit();
    return { ok: true };
  }

  window.FilmStore = {
    getState,
    subscribe,
    isFrozen,
    setReelTitle,
    addSegment,
    moveSegment,
    reorderSegment,
    removeSegment,
    excludeSegment,
    freezeVersion,
    markDamage
  };
})();
