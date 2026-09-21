/*
 * 本地存储模块 FilmStorage
 * 只负责 localStorage 读写、默认清单与旧数据兼容整理，
 * 不含任何业务规则（校验、统计都在 rules.js / store.js）。
 */
(function () {
  "use strict";

  const STORAGE_KEY = "zfl17-film-preview-freeze-desk-v2";

  const defaultSegments = [
    {
      id: "seed-a-001",
      code: "A-001",
      duration: 18,
      shift: "正常",
      damage: "完好",
      note: "开场街景，节奏平稳，适合保留原顺序。",
      thumb: ""
    },
    {
      id: "seed-a-006",
      code: "A-006",
      duration: 9,
      shift: "偏红",
      damage: "轻微划痕",
      note: "人物近景左侧有划痕，试映时留意是否明显。",
      thumb: ""
    },
    {
      id: "seed-a-012",
      code: "A-012",
      duration: 14,
      shift: "褪色",
      damage: "接片松动",
      note: "接片位置靠近段尾，已重新压平并试跑一遍。",
      thumb: ""
    }
  ];

  function defaultState() {
    return {
      reelTitle: "春日试映A卷",
      segments: defaultSegments.map((item) => ({ ...item })),
      versions: [],
      pendingExcludeId: null
    };
  }

  function normalizeSegment(raw, fallbackIndex) {
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : `seg-${fallbackIndex}-${Date.now()}`,
      code: String(raw.code ?? ""),
      duration: Math.max(0, Number(raw.duration) || 0),
      shift: String(raw.shift ?? "正常"),
      damage: String(raw.damage ?? "完好"),
      note: String(raw.note ?? ""),
      thumb: typeof raw.thumb === "string" ? raw.thumb : "",
      newDamage: raw.newDamage ? String(raw.newDamage) : "",
      newDamageNote: raw.newDamageNote ? String(raw.newDamageNote) : ""
    };
  }

  function normalizeSnapshot(raw) {
    return {
      orderIndex: Number(raw.orderIndex) || 0,
      id: String(raw.id ?? ""),
      code: String(raw.code ?? ""),
      duration: Number(raw.duration) || 0,
      shift: String(raw.shift ?? "正常"),
      damage: String(raw.damage ?? "完好"),
      note: String(raw.note ?? "")
    };
  }

  function normalizeVersion(raw, index) {
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : `ver-${index}`,
      number: Number(raw.number) || index + 1,
      room: String(raw.room ?? ""),
      note: String(raw.note ?? ""),
      frozenAt: String(raw.frozenAt ?? ""),
      unfrozenAt: raw.unfrozenAt ? String(raw.unfrozenAt) : "",
      status: raw.status === "frozen" ? "frozen" : "unfrozen",
      duration: Number(raw.duration) || 0,
      segmentIds: Array.isArray(raw.segmentIds) ? raw.segmentIds.map(String) : [],
      snapshot: Array.isArray(raw.snapshot) ? raw.snapshot.map(normalizeSnapshot) : [],
      damage: raw.damage ? String(raw.damage) : "",
      damageNote: raw.damageNote ? String(raw.damageNote) : "",
      damagedSegmentId: raw.damagedSegmentId ? String(raw.damagedSegmentId) : ""
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    return {
      reelTitle: typeof raw.reelTitle === "string" ? raw.reelTitle : base.reelTitle,
      segments: Array.isArray(raw.segments)
        ? raw.segments.map((item, index) => normalizeSegment(item, index))
        : base.segments,
      versions: Array.isArray(raw.versions)
        ? raw.versions.map((item, index) => normalizeVersion(item, index))
        : [],
      pendingExcludeId:
        typeof raw.pendingExcludeId === "string" ? raw.pendingExcludeId : null
    };
  }

  function load() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultState();
    try {
      return normalizeState(JSON.parse(saved));
    } catch {
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      // 缩略图可能撑爆配额：保留内存状态，提醒由界面层处理
      return false;
    }
  }

  window.FilmStorage = { STORAGE_KEY, defaultState, load, save };
})();
