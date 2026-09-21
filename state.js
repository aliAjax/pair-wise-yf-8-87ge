window.FilmDesk = window.FilmDesk || {};

// 状态模块：持有状态、执行变更、变更后持久化并通知订阅者
window.FilmDesk.store = (() => {
  const { storage, rules } = window.FilmDesk;

  const defaultState = {
    reelTitle: "春日试映A卷",
    segments: [
      {
        id: crypto.randomUUID(),
        code: "A-001",
        duration: 18,
        shift: "正常",
        damage: "完好",
        handling: "",
        note: "开场街景，节奏平稳，适合保留原顺序。",
        thumb: "",
        excluded: false
      },
      {
        id: crypto.randomUUID(),
        code: "A-006",
        duration: 9,
        shift: "偏红",
        damage: "轻微划痕",
        handling: "",
        note: "人物近景左侧有划痕，试映时留意是否明显。",
        thumb: "",
        excluded: false
      },
      {
        id: crypto.randomUUID(),
        code: "A-012",
        duration: 14,
        shift: "褪色",
        damage: "接片松动",
        handling: "已重新压平接片，试映前复查一遍。",
        note: "接片位置靠近段尾，放映前建议重新压平。",
        thumb: "",
        excluded: false
      }
    ],
    versions: []
  };

  function normalizeSegment(raw) {
    return {
      id: raw.id || crypto.randomUUID(),
      code: String(raw.code ?? ""),
      duration: Number(raw.duration) || 0,
      shift: raw.shift || "正常",
      damage: raw.damage || "完好",
      handling: raw.handling || "",
      note: raw.note || "",
      thumb: raw.thumb || "",
      excluded: Boolean(raw.excluded)
    };
  }

  function normalizeVersion(raw) {
    return {
      id: raw.id || crypto.randomUUID(),
      name: raw.name || "V?",
      room: raw.room || "",
      note: raw.note || "",
      createdAt: raw.createdAt || "",
      status: raw.status === "lifted" ? "lifted" : "frozen",
      liftedAt: raw.liftedAt || "",
      liftedReason: raw.liftedReason || "",
      rangeFrom: Number(raw.rangeFrom) || 0,
      rangeTo: Number(raw.rangeTo) || 0,
      segmentIds: Array.isArray(raw.segmentIds) ? raw.segmentIds : [],
      snapshot: Array.isArray(raw.snapshot) ? raw.snapshot : []
    };
  }

  function normalizeState(raw) {
    const base = structuredClone(defaultState);
    if (!raw || typeof raw !== "object") return base;
    return {
      reelTitle: typeof raw.reelTitle === "string" ? raw.reelTitle : base.reelTitle,
      segments: Array.isArray(raw.segments) ? raw.segments.map(normalizeSegment) : base.segments,
      versions: Array.isArray(raw.versions) ? raw.versions.map(normalizeVersion) : []
    };
  }

  let state = normalizeState(storage.loadRaw());
  const listeners = new Set();

  function commit() {
    storage.persist(state);
    listeners.forEach((listener) => listener(state));
  }

  const isLocked = (id) => rules.isLocked(state.versions, id);

  function subscribe(listener) {
    listeners.add(listener);
  }

  function setReelTitle(title) {
    state.reelTitle = title;
    commit();
  }

  function addSegment(data) {
    state.segments.push({
      id: crypto.randomUUID(),
      code: data.code,
      duration: data.duration,
      shift: data.shift,
      damage: data.damage,
      handling: data.handling || "",
      note: data.note || "",
      thumb: data.thumb || "",
      excluded: false
    });
    commit();
  }

  function moveSegment(id, direction) {
    if (isLocked(id)) return;
    const index = state.segments.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.segments.length) return;
    const [item] = state.segments.splice(index, 1);
    state.segments.splice(target, 0, item);
    commit();
  }

  function dragReorder(fromId, toId) {
    if (isLocked(fromId)) return;
    const fromIndex = state.segments.findIndex((item) => item.id === fromId);
    const toIndex = state.segments.findIndex((item) => item.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [item] = state.segments.splice(fromIndex, 1);
    state.segments.splice(toIndex, 0, item);
    commit();
  }

  function deleteSegment(id) {
    if (isLocked(id)) return;
    state.segments = state.segments.filter((item) => item.id !== id);
    commit();
  }

  function setExcluded(id, excluded) {
    if (excluded && isLocked(id)) return; // 冻结中的片段只读，不能排除
    const segment = state.segments.find((item) => item.id === id);
    if (!segment) return;
    segment.excluded = excluded;
    commit();
  }

  // 标记新破损：覆盖破损与处置备注；若片段处于冻结版本中，解除该版本冻结并保留快照
  function markDamage(id, damage, handling) {
    const segment = state.segments.find((item) => item.id === id);
    if (!segment || segment.excluded) return;
    segment.damage = damage;
    segment.handling = handling;
    state.versions.forEach((version) => {
      if (version.status === "frozen" && version.segmentIds.includes(id)) {
        version.status = "lifted";
        version.liftedAt = new Date().toISOString();
        version.liftedReason = `片段 ${segment.code} 标记新破损（${damage}）`;
      }
    });
    commit();
  }

  // 冻结版本：规则不通过则整次拒绝，原清单和版本不变
  function freezeVersion({ start, end, room, note }) {
    if (!room) return { ok: false, errors: ["请登记放映室。"] };
    const result = rules.validateFreeze(state.segments, start, end);
    if (!result.ok) return { ok: false, errors: result.errors };
    const version = {
      id: crypto.randomUUID(),
      name: `V${state.versions.length + 1}`,
      room,
      note,
      createdAt: new Date().toISOString(),
      status: "frozen",
      liftedAt: "",
      liftedReason: "",
      rangeFrom: result.from,
      rangeTo: result.to,
      segmentIds: result.range.map((item) => item.id),
      snapshot: result.range.map((item) => ({
        code: item.code,
        duration: item.duration,
        shift: item.shift,
        damage: item.damage,
        handling: item.handling,
        note: item.note
      }))
    };
    state.versions.push(version);
    commit();
    return { ok: true, errors: [], version };
  }

  return {
    getState: () => state,
    subscribe,
    setReelTitle,
    addSegment,
    moveSegment,
    dragReorder,
    deleteSegment,
    setExcluded,
    markDamage,
    freezeVersion
  };
})();
