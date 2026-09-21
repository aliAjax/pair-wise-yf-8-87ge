window.FilmDesk = window.FilmDesk || {};

// 规则模块：纯业务规则，不碰 DOM 和存储
window.FilmDesk.rules = (() => {
  const SHIFT_OPTIONS = ["正常", "偏红", "偏青", "偏黄", "褪色"];
  const DAMAGE_OPTIONS = ["完好", "轻微划痕", "齿孔破损", "接片松动", "需跳过"];
  const DAMAGE_MARK_OPTIONS = DAMAGE_OPTIONS.filter((item) => item !== "完好");
  const INTACT = "完好";
  const SKIP_DAMAGE = "需跳过";
  const LOOSE_DAMAGE = "接片松动";

  // 放映清单中的在册片段（已排除的不参与统计、冻结与提醒）
  const activeSegments = (segments) => segments.filter((item) => !item.excluded);

  function lockedSegmentIds(versions) {
    const locked = new Set();
    versions
      .filter((version) => version.status === "frozen")
      .forEach((version) => version.segmentIds.forEach((id) => locked.add(id)));
    return locked;
  }

  // 片段被任一冻结中的版本覆盖即为只读
  function isLocked(versions, segmentId) {
    return lockedSegmentIds(versions).has(segmentId);
  }

  // 冻结校验：任一规则不满足则整次拒绝，调用方不得改动清单和版本
  function validateFreeze(segments, start, end) {
    const active = activeSegments(segments);
    const errors = [];

    if (!active.length) errors.push("当前没有可冻结的在册片段。");
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= active.length) {
      errors.push("请选择有效的连续片段区间。");
    } else if (end < start) {
      errors.push("起始片段不能晚于结束片段。");
    }
    if (errors.length) return { ok: false, errors, range: [], from: 0, to: 0 };

    const range = active.slice(start, end + 1);
    range.forEach((segment, offset) => {
      const label = `第${start + offset + 1}段 ${segment.code}`;
      if (segment.damage === SKIP_DAMAGE) errors.push(`${label} 标记为需跳过。`);
      if (segment.damage === LOOSE_DAMAGE && !segment.handling.trim()) {
        errors.push(`${label} 接片松动却没有处置备注。`);
      }
    });

    const counts = new Map();
    range.forEach((segment) => {
      const key = segment.code.trim().toUpperCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([code]) => code);
    if (duplicates.length) errors.push(`片段编号重复：${duplicates.join("、")}。`);

    return { ok: errors.length === 0, errors, range, from: start + 1, to: end + 1 };
  }

  function computeStats(segments, versions) {
    const active = activeSegments(segments);
    return {
      totalDuration: active.reduce((sum, item) => sum + (Number(item.duration) || 0), 0),
      damageCount: active.filter((item) => item.damage !== INTACT).length,
      segmentCount: active.length,
      excludedCount: segments.length - active.length,
      frozenVersions: versions.filter((version) => version.status === "frozen").length,
      versionCount: versions.length
    };
  }

  function filterSegments(segments, { color = "all", damage = "all", keyword = "" } = {}) {
    const kw = keyword.trim();
    return segments.filter((item) => {
      const matchesColor = color === "all" || item.shift === color;
      const matchesDamage = damage === "all" || item.damage === damage;
      const matchesKeyword = !kw || `${item.code}${item.note}${item.handling}${item.damage}`.includes(kw);
      return matchesColor && matchesDamage && matchesKeyword;
    });
  }

  function buildWarnings(segments, versions) {
    const active = activeSegments(segments);
    const warnings = [];

    versions
      .filter((version) => version.status === "lifted")
      .forEach((version) => {
        warnings.push({
          type: "version",
          text: `版本 ${version.name} 已解除冻结：${version.liftedReason || "片段标记新破损"}，版本快照已保留。`
        });
      });

    const counts = new Map();
    active.forEach((segment) => {
      const key = segment.code.trim().toUpperCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([code]) => code);
    if (duplicates.length) {
      warnings.push({ type: "dup", text: `放映清单中片段编号重复：${duplicates.join("、")}，冻结前需先调整。` });
    }

    active.forEach((segment, index) => {
      const reasons = [];
      if (segment.shift !== "正常") reasons.push(segment.shift);
      if (segment.damage !== INTACT) {
        reasons.push(segment.damage);
        if (segment.damage === LOOSE_DAMAGE && !segment.handling.trim()) reasons.push("缺少处置备注");
      }
      if (reasons.length) {
        warnings.push({ type: "segment", index: index + 1, code: segment.code, text: reasons.join(" · "), note: segment.note });
      }
    });

    return warnings;
  }

  return {
    SHIFT_OPTIONS,
    DAMAGE_OPTIONS,
    DAMAGE_MARK_OPTIONS,
    INTACT,
    SKIP_DAMAGE,
    LOOSE_DAMAGE,
    activeSegments,
    lockedSegmentIds,
    isLocked,
    validateFreeze,
    computeStats,
    filterSegments,
    buildWarnings
  };
})();
