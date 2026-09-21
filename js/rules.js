/*
 * 规则模块 FilmRules
 * 纯业务规则，不碰 DOM、localStorage：
 * 区间冻结校验、筛选、统计、版本快照、试映提醒。
 */
(function () {
  "use strict";

  const COLORS = ["正常", "偏红", "偏青", "偏黄", "褪色"];
  const DAMAGES = ["完好", "轻微划痕", "齿孔破损", "接片松动", "需跳过"];

  function isDamaged(segment) {
    return Boolean(segment) && (segment.damage !== "完好" || Boolean(segment.newDamage));
  }

  // 有效破损：试映中新标记的破损优先（仅用于筛选/统计，不改原始记录）
  function effectiveDamage(segment) {
    return segment.newDamage || segment.damage || "完好";
  }

  function formatDuration(seconds) {
    const value = Number(seconds) || 0;
    const minutes = Math.floor(value / 60);
    const rest = String(value % 60).padStart(2, "0");
    return `${minutes}:${rest}`;
  }

  // 按当前放映顺序取出两个片段（含端点）之间的连续片段
  function rangeBetween(segments, fromId, toId) {
    const from = segments.findIndex((item) => item.id === fromId);
    const to = segments.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0) return [];
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    return segments.slice(start, end + 1);
  }

  /*
   * 冻结前校验。任一条不通过即整次拒绝：
   * 1. 区间内有片段标记“需跳过”；
   * 2. 区间内有“接片松动”却没有处置备注；
   * 3. 区间内片段编号重复。
   */
  function validateFreeze(range) {
    const errors = [];
    if (!range.length) {
      errors.push("区间为空，无法冻结。");
      return errors;
    }

    range.forEach((item, index) => {
      const label = `${index + 1}. ${item.code}`;
      if (item.damage === "需跳过") {
        errors.push(`片段 ${label} 已标记需跳过，不能进入试映版本。`);
      }
      if (item.damage === "接片松动" && !(item.note && item.note.trim())) {
        errors.push(`片段 ${label} 接片松动却没有处置备注。`);
      }
    });

    const seen = new Map();
    range.forEach((item) => {
      seen.set(item.code, (seen.get(item.code) || 0) + 1);
    });
    seen.forEach((count, code) => {
      if (count > 1) {
        errors.push(`片段编号 ${code} 在区间内重复出现 ${count} 次。`);
      }
    });

    return errors;
  }

  function applyFilters(segments, filters) {
    const { color = "all", damage = "all", keyword = "" } = filters || {};
    const word = keyword.trim();
    return segments.filter((item) => {
      const matchesColor = color === "all" || item.shift === color;
      const matchesDamage = damage === "all" || effectiveDamage(item) === damage;
      const matchesKeyword =
        !word || `${item.code}${item.note}${item.damage}${item.shift}${item.newDamage || ""}`.includes(word);
      return matchesColor && matchesDamage && matchesKeyword;
    });
  }

  function computeStats(segments) {
    return {
      totalDuration: segments.reduce((sum, item) => sum + Number(item.duration || 0), 0),
      damagedCount: segments.filter(isDamaged).length,
      count: segments.length
    };
  }

  function getFrozenVersion(versions) {
    return versions.find((version) => version.status === "frozen") || null;
  }

  function nextVersionNumber(versions) {
    return versions.reduce((max, version) => Math.max(max, version.number || 0), 0) + 1;
  }

  // 快照只保留核对需要的文本字段，不复制缩略图（避免本地存储膨胀）
  function makeSnapshotItem(item, orderIndex) {
    return {
      orderIndex,
      id: item.id,
      code: item.code,
      duration: Number(item.duration) || 0,
      shift: item.shift,
      damage: item.damage,
      note: item.note || ""
    };
  }

  function makeSnapshot(range, sourceSegmentIds) {
    const byId = new Map(range.map((item) => [item.id, item]));
    return sourceSegmentIds
      .map((id, index) => {
        const item = byId.get(id);
        return item ? makeSnapshotItem(item, index + 1) : null;
      })
      .filter(Boolean);
  }

  // 试映提醒：颜色偏移、已有破损、待排除、编号重复
  function collectWarnings(state) {
    const warnings = [];
    const { segments, versions, pendingExcludeId } = state;
    const frozen = getFrozenVersion(versions);

    const pending = pendingExcludeId
      ? segments.find((item) => item.id === pendingExcludeId)
      : null;
    if (pending) {
      const index = segments.findIndex((item) => item.id === pending.id) + 1;
      warnings.push({
        level: "exclude",
        title: `待排除：${index}. ${pending.code}`,
        text: `试映中标记为“${pending.newDamage}”，当前版本已解除冻结。排除该片段后可再次冻结。${
          pending.newDamageNote ? `处置备注：${pending.newDamageNote}` : ""
        }`
      });
    }

    if (frozen) {
      warnings.push({
        level: "frozen",
        title: `版本 v${frozen.number} 已冻结`,
        text: `${frozen.room}｜${frozen.segmentIds.length} 个连续片段｜${formatDuration(
          frozen.duration
        )}。片段只读，登记新破损将解除冻结并保留此版本快照。`
      });
    }

    const codeCount = new Map();
    segments.forEach((item) => codeCount.set(item.code, (codeCount.get(item.code) || 0) + 1));

    segments.forEach((item, i) => {
      if (codeCount.get(item.code) > 1) {
        warnings.push({
          level: "error",
          title: `编号重复：${i + 1}. ${item.code}`,
          text: "同一编号在清单中出现多次，冻结含该编号的区间会被拒绝。"
        });
      }
      if (item.damage === "需跳过") {
        warnings.push({
          level: "error",
          title: `需跳过：${i + 1}. ${item.code}`,
          text: item.note ? `处置备注：${item.note}` : "需跳过片段不能进入试映版本。"
        });
      } else if (isDamaged(item)) {
        warnings.push({
          level: "damage",
          title: `${i + 1}. ${item.code}｜${effectiveDamage(item)}`,
          text:
            item.damage === "接片松动" && !(item.note && item.note.trim())
              ? "接片松动缺少处置备注，含此片段的冻结会被拒绝。"
              : item.note || "放映前留意。"
        });
      }
      if (item.shift !== "正常") {
        warnings.push({
          level: "color",
          title: `${i + 1}. ${item.code}｜${item.shift}`,
          text: item.note || "放映前留意颜色偏移。"
        });
      }
    });

    return warnings;
  }

  window.FilmRules = {
    COLORS,
    DAMAGES,
    isDamaged,
    effectiveDamage,
    formatDuration,
    rangeBetween,
    validateFreeze,
    applyFilters,
    computeStats,
    getFrozenVersion,
    nextVersionNumber,
    makeSnapshotItem,
    makeSnapshot,
    collectWarnings
  };
})();
