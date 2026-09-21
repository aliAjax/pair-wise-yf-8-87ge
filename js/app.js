/*
 * 界面模块
 * 只负责渲染与事件；规则找 FilmRules，状态动作找 FilmStore，
 * 持久化由 FilmStorage 在 store 内部完成。刷新后状态从本地存储恢复。
 */
(function () {
  "use strict";

  const { formatDuration, applyFilters, computeStats, collectWarnings, getFrozenVersion, effectiveDamage } =
    window.FilmRules;

  const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

  const els = {
    reelTitle: document.querySelector("#reelTitle"),
    colorFilter: document.querySelector("#colorFilter"),
    damageFilter: document.querySelector("#damageFilter"),
    searchInput: document.querySelector("#searchInput"),
    exportBtn: document.querySelector("#exportBtn"),

    segmentForm: document.querySelector("#segmentForm"),
    codeInput: document.querySelector("#codeInput"),
    durationInput: document.querySelector("#durationInput"),
    shiftInput: document.querySelector("#shiftInput"),
    damageInput: document.querySelector("#damageInput"),
    thumbInput: document.querySelector("#thumbInput"),
    noteInput: document.querySelector("#noteInput"),
    formLockedHint: document.querySelector("#formLockedHint"),

    freezeBar: document.querySelector("#freezeBar"),
    segmentList: document.querySelector("#segmentList"),
    listHeadHint: document.querySelector("#listHeadHint"),
    versionList: document.querySelector("#versionList"),
    warningList: document.querySelector("#warningList"),
    totalDuration: document.querySelector("#totalDuration"),
    damageCount: document.querySelector("#damageCount"),
    segmentCount: document.querySelector("#segmentCount"),
    versionStat: document.querySelector("#versionStat"),

    damageModal: document.querySelector("#damageModal"),
    damageModalCode: document.querySelector("#damageModalCode"),
    damageForm: document.querySelector("#damageForm"),
    damageTypeInput: document.querySelector("#damageTypeInput"),
    damageNoteInput: document.querySelector("#damageNoteInput"),
    modalError: document.querySelector("#modalError"),
    damageCancel: document.querySelector("#damageCancel")
  };

  // 仅界面态：区间选择、被拒绝原因、弹窗目标、快照展开项（业务状态都在 FilmStore）
  let rangeFromId = null;
  let rangeToId = null;
  let lastRejection = [];
  let modalTargetId = null;
  let draggedId = null;
  const expandedSnapshots = new Set();

  function state() {
    return FilmStore.getState();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  /* ---------------- 统计 ---------------- */

  function renderStats() {
    const s = state();
    const stats = computeStats(s.segments);
    els.totalDuration.textContent = formatDuration(stats.totalDuration);
    els.damageCount.textContent = stats.damagedCount;
    els.segmentCount.textContent = stats.count;

    const frozen = getFrozenVersion(s.versions);
    if (frozen) {
      els.versionStat.textContent = `v${frozen.number} 冻结中`;
      els.versionStat.title = `${frozen.room}｜${formatDuration(frozen.duration)}`;
      els.versionStat.classList.add("frozen-badge");
    } else {
      els.versionStat.textContent = "未冻结";
      els.versionStat.title = "";
      els.versionStat.classList.remove("frozen-badge");
    }
  }

  /* ---------------- 冻结条（建立版本 / 当前冻结版本） ---------------- */

  function ensureRangeSelection(segments) {
    const ids = segments.map((item) => item.id);
    if (!ids.includes(rangeFromId)) rangeFromId = ids[0] || null;
    if (!ids.includes(rangeToId)) rangeToId = ids[ids.length - 1] || null;
  }

  function renderFreezeBar() {
    const s = state();
    const frozen = getFrozenVersion(s.versions);
    if (frozen) {
      els.freezeBar.innerHTML = `
        <div class="freeze-status">
          <div class="freeze-status-head">
            <span class="version-pill frozen">试映版本 v${frozen.number} · 已冻结</span>
            <span class="freeze-meta">${formatDateTime(frozen.frozenAt)} 冻结</span>
          </div>
          <div class="freeze-grid">
            <div><span>放映室</span><strong>${escapeHtml(frozen.room)}</strong></div>
            <div><span>连续片段</span><strong>${frozen.snapshot.length} 个</strong></div>
            <div><span>版本总时长</span><strong>${formatDuration(frozen.duration)}</strong></div>
            <div class="freeze-note"><span>版本备注</span><strong>${escapeHtml(frozen.note || "无")}</strong></div>
          </div>
          <p class="freeze-readonly">片段只读。试映中如发现新破损，在下方片段卡片上“标记新破损”，将解除冻结并保留本版本快照。</p>
        </div>
      `;
      return;
    }

    ensureRangeSelection(s.segments);
    const pending = s.pendingExcludeId
      ? s.segments.find((item) => item.id === s.pendingExcludeId)
      : null;

    const options = s.segments
      .map(
        (item, index) =>
          `<option value="${item.id}" ${
            item.id === rangeFromId ? "selected" : ""
          }>${index + 1}. ${escapeHtml(item.code)}</option>`
      )
      .join("");
    const optionsTo = s.segments
      .map(
        (item, index) =>
          `<option value="${item.id}" ${
            item.id === rangeToId ? "selected" : ""
          }>${index + 1}. ${escapeHtml(item.code)}</option>`
      )
      .join("");

    els.freezeBar.innerHTML = `
      <div class="freeze-form-wrap">
        <div class="freeze-title-row">
          <h2>建立试映版本</h2>
          <span>按放映顺序选取连续片段，登记后整段冻结</span>
        </div>
        ${
          pending
            ? `<div class="pending-banner">待排除片段 <strong>${escapeHtml(
                pending.code
              )}</strong>（试映新损：${escapeHtml(
                pending.newDamage
              )}）。请先排除它，再冻结新的版本区间。</div>`
            : ""
        }
        <form id="freezeForm" class="freeze-form">
          <label class="range-label">
            区间起
            <select id="freezeFrom">${options}</select>
          </label>
          <span class="range-arrow">→</span>
          <label class="range-label">
            区间止
            <select id="freezeTo">${optionsTo}</select>
          </label>
          <label>
            放映室
            <input id="freezeRoom" type="text" required placeholder="例：三号放映室" />
          </label>
          <label class="freeze-note-input">
            版本备注
            <input id="freezeNote" type="text" placeholder="例：春日试映媒体场" />
          </label>
          <button class="primary" type="submit" ${s.segments.length ? "" : "disabled"}>冻结为试映版本</button>
        </form>
        <p id="rangePreview" class="range-preview"></p>
        <div id="rejectBox" class="reject-box" ${lastRejection.length ? "" : "hidden"}></div>
      </div>
    `;
    updateRangePreview();
  }

  function currentRange() {
    const s = state();
    const from = s.segments.findIndex((item) => item.id === rangeFromId);
    const to = s.segments.findIndex((item) => item.id === rangeToId);
    if (from < 0 || to < 0) return [];
    return s.segments.slice(Math.min(from, to), Math.max(from, to) + 1);
  }

  function updateRangePreview() {
    const preview = els.freezeBar.querySelector("#rangePreview");
    if (!preview) return;
    const range = currentRange();
    if (!range.length) {
      preview.textContent = "清单为空，先在左侧录入片段。";
      return;
    }
    const duration = range.reduce((sum, item) => sum + Number(item.duration || 0), 0);
    preview.textContent = `区间预览：${range.length} 个连续片段，合计 ${formatDuration(
      duration
    )}（${range[0].code} → ${range[range.length - 1].code}）。含“需跳过”、接片松动无处置备注或编号重复时将被拒绝。`;
  }

  function renderRejectBox(errors) {
    let box = els.freezeBar.querySelector("#rejectBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "rejectBox";
      box.className = "reject-box";
      els.freezeBar.querySelector(".freeze-form-wrap").appendChild(box);
    }
    lastRejection = errors;
    if (!errors.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = `
      <strong>本次冻结被整次拒绝，原清单与版本均未改动：</strong>
      <ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
    `;
  }

  /* ---------------- 片段列表 ---------------- */

  function renderList() {
    const s = state();
    const frozen = Boolean(getFrozenVersion(s.versions));
    const filtered = applyFilters(s.segments, {
      color: els.colorFilter.value,
      damage: els.damageFilter.value,
      keyword: els.searchInput.value
    });
    els.listHeadHint.textContent = frozen
      ? "版本冻结中，片段只读"
      : "拖拽片段调整顺序";

    els.segmentList.innerHTML = filtered
      .map((item) => {
        const realIndex = s.segments.findIndex((segment) => segment.id === item.id);
        const shownDamage = effectiveDamage(item);
        const hasDamage = shownDamage !== "完好";
        const isPending = s.pendingExcludeId === item.id;
        return `
          <article class="segment-card${frozen ? " locked" : ""}${
          isPending ? " pending" : ""
        }" ${frozen ? "" : `draggable="true"`} data-id="${item.id}">
            <div class="thumb">
              ${
                item.thumb
                  ? `<img src="${item.thumb}" alt="${escapeHtml(item.code)}缩略图" />`
                  : `<div class="film-placeholder" style="background:${fallbackThumbs[realIndex % fallbackThumbs.length]}">${escapeHtml(item.code)}</div>`
              }
            </div>
            <div class="segment-main">
              <div class="segment-title">
                <strong>${realIndex + 1}. ${escapeHtml(item.code)}</strong>
                <span>${formatDuration(item.duration)}</span>
                ${frozen ? '<span class="lock-tag">🔒 冻结</span>' : ""}
                ${
                  isPending
                    ? `<span class="new-damage-tag">试映新损：${escapeHtml(item.newDamage)}</span>`
                    : ""
                }
              </div>
              <div class="tag-row">
                <span class="tag">${escapeHtml(item.shift)}</span>
                <span class="tag ${hasDamage ? "damage" : "ok"}">${escapeHtml(shownDamage)}</span>
                ${
                  item.newDamage && item.damage !== "完好"
                    ? `<span class="tag ok">原：${escapeHtml(item.damage)}</span>`
                    : ""
                }
              </div>
              <p class="segment-note">${escapeHtml(item.note || "没有备注。")}</p>
              ${
                item.newDamage
                  ? `<p class="new-damage-note">试映标记：${escapeHtml(item.newDamage)}${
                      item.newDamageNote ? `｜${escapeHtml(item.newDamageNote)}` : ""
                    }</p>`
                  : ""
              }
              ${
                frozen
                  ? `<button type="button" class="mark-damage-btn" data-mark-damage="${item.id}">标记试映新破损</button>`
                  : ""
              }
              ${
                isPending
                  ? `<button type="button" class="primary exclude-btn" data-exclude="${item.id}">排除该片段</button>`
                  : ""
              }
            </div>
            ${
              frozen
                ? ""
                : `<div class="segment-actions">
                    <button type="button" title="上移" data-move-up="${item.id}">↑</button>
                    <button type="button" title="下移" data-move-down="${item.id}">↓</button>
                    <button type="button" title="删除" data-delete="${item.id}">×</button>
                  </div>`
            }
          </article>
        `;
      })
      .join("") || `<p class="empty">没有符合筛选的片段。</p>`;
  }

  /* ---------------- 版本档案 ---------------- */

  function renderVersions() {
    const s = state();
    const ordered = [...s.versions].sort((a, b) => b.number - a.number);
    if (!ordered.length) {
      els.versionList.innerHTML = `<p class="empty">还没有冻结过版本。在上方选择连续片段建立首个试映版本。</p>`;
      return;
    }

    els.versionList.innerHTML = ordered
      .map((version) => {
        const frozen = version.status === "frozen";
        const damagedCode =
          version.damagedSegmentId
            ? s.segments.find((item) => item.id === version.damagedSegmentId)?.code ||
              version.snapshot.find((item) => item.id === version.damagedSegmentId)?.code ||
              "已排除片段"
            : "";
        const expanded = expandedSnapshots.has(version.id);
        return `
          <article class="version-card ${frozen ? "version-frozen" : "version-unfrozen"}">
            <div class="version-card-head">
              <span class="version-pill ${frozen ? "frozen" : "unfrozen"}">v${version.number} · ${
          frozen ? "冻结中" : "已解除"
        }</span>
              <span class="freeze-meta">${formatDateTime(version.frozenAt)}</span>
            </div>
            <p class="version-line"><span>放映室</span>${escapeHtml(version.room)}</p>
            <p class="version-line"><span>片段</span>${version.snapshot.length} 个 · ${formatDuration(
          version.duration
        )}</p>
            <p class="version-line"><span>备注</span>${escapeHtml(version.note || "无")}</p>
            ${
              frozen
                ? ""
                : `<p class="version-unfreeze-reason">解除于 ${formatDateTime(
                    version.unfrozenAt
                  )}：片段 <strong>${escapeHtml(damagedCode)}</strong> 新破损“${escapeHtml(
                    version.damage
                  )}”${version.damageNote ? `｜${escapeHtml(version.damageNote)}` : ""}。快照已保留。</p>`
            }
            <button type="button" class="snapshot-toggle" data-version-toggle="${version.id}">
              ${expanded ? "收起版本快照" : "查看版本快照"}
            </button>
            <ol class="snapshot-list" ${expanded ? "" : "hidden"}>
              ${version.snapshot
                .map(
                  (item) => `
                <li class="${item.id === version.damagedSegmentId ? "snapshot-damaged" : ""}">
                  ${item.orderIndex}. ${escapeHtml(item.code)}｜${formatDuration(
                    item.duration
                  )}｜${escapeHtml(item.shift)}｜${escapeHtml(item.damage)}｜${escapeHtml(
                    item.note || "无备注"
                  )}
                </li>`
                )
                .join("")}
            </ol>
          </article>
        `;
      })
      .join("");
  }

  /* ---------------- 试映提醒 ---------------- */

  function renderWarnings() {
    const warnings = collectWarnings(state());
    els.warningList.innerHTML = warnings
      .map(
        (warning) => `
        <div class="warning-item warning-${warning.level}">
          <strong>${escapeHtml(warning.title)}</strong>
          <span>${escapeHtml(warning.text)}</span>
        </div>
      `
      )
      .join("") || `<p class="empty">当前清单没有颜色偏移、破损或版本提醒。</p>`;
  }

  /* ---------------- 录入表单锁定态 ---------------- */

  function syncSegmentForm() {
    const frozen = FilmStore.isFrozen();
    [
      els.codeInput,
      els.durationInput,
      els.shiftInput,
      els.damageInput,
      els.thumbInput,
      els.noteInput
    ].forEach((input) => {
      input.disabled = frozen;
    });
    els.segmentForm.querySelector("button[type=submit]").disabled = frozen;
    els.formLockedHint.hidden = !frozen;
  }

  /* ---------------- 总渲染 ---------------- */

  function renderAll() {
    const s = state();
    lastRejection = [];
    els.reelTitle.value = s.reelTitle;
    renderStats();
    renderFreezeBar();
    renderList();
    renderVersions();
    renderWarnings();
    syncSegmentForm();
  }

  FilmStore.subscribe(renderAll);

  /* ---------------- 导出（跟随颜色 / 破损 / 搜索筛选） ---------------- */

  function exportList() {
    const s = state();
    const frozen = getFrozenVersion(s.versions);
    const filtered = applyFilters(s.segments, {
      color: els.colorFilter.value,
      damage: els.damageFilter.value,
      keyword: els.searchInput.value
    });

    const filterSummary = [
      els.colorFilter.value === "all" ? null : `颜色=${els.colorFilter.value}`,
      els.damageFilter.value === "all" ? null : `破损=${els.damageFilter.value}`,
      els.searchInput.value.trim() ? `搜索=${els.searchInput.value.trim()}` : null
    ]
      .filter(Boolean)
      .join("，");

    const lines = [
      `胶片卷：${s.reelTitle || "未命名胶片卷"}`,
      `导出时间：${formatDateTime(new Date().toISOString())}`,
      `筛选条件：${filterSummary || "全部"}`,
      "",
      frozen
        ? `当前试映版本：v${frozen.number}（${frozen.room}｜${frozen.snapshot.length} 个片段｜${formatDuration(
            frozen.duration
          )}｜${frozen.note || "无版本备注"}）`
        : "当前试映版本：未冻结",
      `清单片段：${filtered.length} 个`,
      ""
    ];

    if (frozen) {
      lines.push("【冻结版本快照】");
      frozen.snapshot.forEach((item) => {
        lines.push(
          `${item.orderIndex}. ${item.code}｜${formatDuration(item.duration)}｜${item.shift}｜${
            item.damage
          }｜${item.note || "无备注"}`
        );
      });
      lines.push("");
    }

    lines.push("【当前放映顺序】");
    filtered.forEach((item, index) => {
      const extra = item.newDamage ? `｜试映新损=${item.newDamage}` : "";
      lines.push(
        `${index + 1}. ${item.code}｜${formatDuration(item.duration)}｜${item.shift}｜${
          item.damage
        }｜${item.note || "无备注"}${extra}`
      );
    });

    const historical = s.versions.filter((version) => version.status !== "frozen");
    if (historical.length) {
      lines.push("");
      lines.push("【历史版本快照】");
      [...historical]
        .sort((a, b) => b.number - a.number)
        .forEach((version) => {
          lines.push(
            `v${version.number}｜${version.room}｜冻结 ${formatDateTime(
              version.frozenAt
            )}｜解除 ${formatDateTime(version.unfrozenAt)}｜${version.snapshot.length} 个片段｜${
              formatDuration(version.duration)
            }｜版本备注 ${version.note || "无"}｜新破损 ${version.damage}${
              version.damageNote ? `｜处置 ${version.damageNote}` : ""
            }`
          );
          version.snapshot.forEach((item) => {
            const mark = item.id === version.damagedSegmentId ? "（解除时标记的新破损片段）" : "";
            lines.push(
              `  ${item.orderIndex}. ${item.code}｜${formatDuration(item.duration)}｜${
                item.shift
              }｜${item.damage}｜${item.note || "无备注"}${mark}`
            );
          });
          lines.push("");
        });
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    const safeName = (s.reelTitle || "film-reel").replace(/[\\/:*?"<>|]/g, "_");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName}-${frozen ? `v${frozen.number}` : "未冻结"}-清单.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /* ---------------- 标记新破损弹窗 ---------------- */

  function openDamageModal(id) {
    const s = state();
    const segment = s.segments.find((item) => item.id === id);
    if (!segment) return;
    modalTargetId = id;
    els.damageModalCode.textContent = segment.code;
    els.damageForm.reset();
    els.modalError.hidden = true;
    els.modalError.textContent = "";
    els.damageModal.hidden = false;
  }

  function closeDamageModal() {
    els.damageModal.hidden = true;
    modalTargetId = null;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
      if (!file) {
        resolve("");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }

  /* ---------------- 事件 ---------------- */

  els.reelTitle.addEventListener("input", () => {
    FilmStore.setReelTitle(els.reelTitle.value);
  });
  els.colorFilter.addEventListener("change", renderList);
  els.damageFilter.addEventListener("change", renderList);
  els.searchInput.addEventListener("input", renderList);
  els.exportBtn.addEventListener("click", exportList);

  els.segmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (FilmStore.isFrozen()) return;
    const thumb = await readFileAsDataUrl(els.thumbInput.files[0]);
    const result = FilmStore.addSegment({
      code: els.codeInput.value.trim(),
      duration: Number(els.durationInput.value),
      shift: els.shiftInput.value,
      damage: els.damageInput.value,
      note: els.noteInput.value.trim(),
      thumb
    });
    if (result.ok) {
      els.segmentForm.reset();
      els.durationInput.value = 12;
      rangeFromId = null;
      rangeToId = null;
    }
  });

  // 冻结条整体重渲染，用容器委托绑定
  els.freezeBar.addEventListener("submit", (event) => {
    if (event.target.id !== "freezeForm") return;
    event.preventDefault();
    const room = els.freezeBar.querySelector("#freezeRoom").value;
    const note = els.freezeBar.querySelector("#freezeNote").value;
    const result = FilmStore.freezeVersion({
      fromId: rangeFromId,
      toId: rangeToId,
      room,
      note
    });
    if (!result.ok) {
      renderRejectBox(result.errors);
    }
  });

  els.freezeBar.addEventListener("change", (event) => {
    if (event.target.id === "freezeFrom") {
      rangeFromId = event.target.value;
      updateRangePreview();
    } else if (event.target.id === "freezeTo") {
      rangeToId = event.target.value;
      updateRangePreview();
    }
  });

  els.segmentList.addEventListener("click", (event) => {
    const mark = event.target.closest("[data-mark-damage]");
    const exclude = event.target.closest("[data-exclude]");
    const up = event.target.closest("[data-move-up]");
    const down = event.target.closest("[data-move-down]");
    const remove = event.target.closest("[data-delete]");

    if (mark) openDamageModal(mark.dataset.markDamage);
    if (exclude) FilmStore.excludeSegment(exclude.dataset.exclude);
    if (up) FilmStore.moveSegment(up.dataset.moveUp, -1);
    if (down) FilmStore.moveSegment(down.dataset.moveDown, 1);
    if (remove) FilmStore.removeSegment(remove.dataset.delete);
  });

  els.versionList.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-version-toggle]");
    if (!toggle) return;
    const id = toggle.dataset.versionToggle;
    if (expandedSnapshots.has(id)) expandedSnapshots.delete(id);
    else expandedSnapshots.add(id);
    renderVersions();
  });

  els.segmentList.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-id]");
    if (!card || FilmStore.isFrozen()) return;
    draggedId = card.dataset.id;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });

  els.segmentList.addEventListener("dragend", (event) => {
    event.target.closest("[data-id]")?.classList.remove("dragging");
    draggedId = null;
  });

  els.segmentList.addEventListener("dragover", (event) => {
    const card = event.target.closest("[data-id]");
    if (!card || !draggedId || card.dataset.id === draggedId || FilmStore.isFrozen()) return;
    event.preventDefault();
    FilmStore.reorderSegment(draggedId, card.dataset.id);
  });

  els.damageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = FilmStore.markDamage(
      modalTargetId,
      els.damageTypeInput.value,
      els.damageNoteInput.value
    );
    if (!result.ok) {
      els.modalError.hidden = false;
      els.modalError.textContent = result.errors.join("；");
      return;
    }
    closeDamageModal();
  });
  els.damageCancel.addEventListener("click", closeDamageModal);
  els.damageModal.addEventListener("click", (event) => {
    if (event.target === els.damageModal) closeDamageModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.damageModal.hidden) closeDamageModal();
  });

  renderAll();
})();
