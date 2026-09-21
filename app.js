// 界面模块：DOM 渲染与事件接线，业务规则与状态分别落在 rules.js / state.js / storage.js
(function () {
  const { rules, store } = window.FilmDesk;

  const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

  let draggedId = null;
  let markingId = null;
  let freezeErrors = [];

  const els = {
    reelTitle: document.querySelector("#reelTitle"),
    colorFilter: document.querySelector("#colorFilter"),
    damageFilter: document.querySelector("#damageFilter"),
    searchInput: document.querySelector("#searchInput"),
    segmentForm: document.querySelector("#segmentForm"),
    codeInput: document.querySelector("#codeInput"),
    durationInput: document.querySelector("#durationInput"),
    shiftInput: document.querySelector("#shiftInput"),
    damageInput: document.querySelector("#damageInput"),
    handlingInput: document.querySelector("#handlingInput"),
    thumbInput: document.querySelector("#thumbInput"),
    noteInput: document.querySelector("#noteInput"),
    segmentList: document.querySelector("#segmentList"),
    warningList: document.querySelector("#warningList"),
    totalDuration: document.querySelector("#totalDuration"),
    damageCount: document.querySelector("#damageCount"),
    segmentCount: document.querySelector("#segmentCount"),
    frozenVersionCount: document.querySelector("#frozenVersionCount"),
    exportBtn: document.querySelector("#exportBtn"),
    freezeForm: document.querySelector("#freezeForm"),
    freezeStart: document.querySelector("#freezeStart"),
    freezeEnd: document.querySelector("#freezeEnd"),
    roomInput: document.querySelector("#roomInput"),
    versionNoteInput: document.querySelector("#versionNoteInput"),
    freezeErrorBox: document.querySelector("#freezeErrors"),
    versionList: document.querySelector("#versionList")
  };

  function formatDuration(seconds) {
    const value = Number(seconds) || 0;
    const minutes = Math.floor(value / 60);
    const rest = String(value % 60).padStart(2, "0");
    return `${minutes}:${rest}`;
  }

  function formatTime(iso) {
    if (!iso) return "-";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { hour12: false });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderStats(state) {
    const stats = rules.computeStats(state.segments, state.versions);
    els.totalDuration.textContent = formatDuration(stats.totalDuration);
    els.damageCount.textContent = stats.damageCount;
    els.segmentCount.textContent = stats.segmentCount;
    els.frozenVersionCount.textContent = `${stats.frozenVersions}/${stats.versionCount}`;
  }

  function actionButtons(item, locked) {
    if (item.excluded) {
      return `
        <button type="button" title="恢复到清单" data-restore="${item.id}">恢</button>
        <button type="button" title="删除" data-delete="${item.id}">×</button>
      `;
    }
    if (locked) {
      return `<button type="button" title="标记新破损（将解除冻结）" data-mark="${item.id}">⚠</button>`;
    }
    return `
      <button type="button" title="上移" data-move-up="${item.id}">↑</button>
      <button type="button" title="下移" data-move-down="${item.id}">↓</button>
      <button type="button" title="标记新破损" data-mark="${item.id}">⚠</button>
      <button type="button" title="排除出清单" data-exclude="${item.id}">排</button>
      <button type="button" title="删除" data-delete="${item.id}">×</button>
    `;
  }

  function markFormHtml(item) {
    const options = rules.DAMAGE_MARK_OPTIONS.map(
      (option) => `<option value="${option}" ${option === item.damage ? "selected" : ""}>${option}</option>`
    ).join("");
    return `
      <div class="mark-form">
        <select data-mark-damage>${options}</select>
        <input data-mark-handling type="text" placeholder="处置备注（接片松动时必填）" value="${escapeHtml(item.handling)}" />
        <div class="mark-form-actions">
          <button type="button" class="primary" data-mark-confirm="${item.id}">确认标记</button>
          <button type="button" data-mark-cancel>取消</button>
        </div>
      </div>
    `;
  }

  function renderList(state) {
    const segments = rules.filterSegments(state.segments, {
      color: els.colorFilter.value,
      damage: els.damageFilter.value,
      keyword: els.searchInput.value
    });
    const active = rules.activeSegments(state.segments);
    els.segmentList.innerHTML =
      segments
        .map((item) => {
          const realIndex = state.segments.findIndex((segment) => segment.id === item.id);
          const activeIndex = active.findIndex((segment) => segment.id === item.id);
          const locked = rules.isLocked(state.versions, item.id);
          const hasDamage = item.damage !== rules.INTACT;
          const draggable = !locked && !item.excluded;
          return `
            <article class="segment-card ${locked ? "locked" : ""} ${item.excluded ? "excluded" : ""}" draggable="${draggable}" data-id="${item.id}">
              <div class="thumb">
                ${
                  item.thumb
                    ? `<img src="${item.thumb}" alt="${escapeHtml(item.code)}缩略图" />`
                    : `<div class="film-placeholder" style="background:${fallbackThumbs[realIndex % fallbackThumbs.length]}">${escapeHtml(item.code)}</div>`
                }
              </div>
              <div class="segment-main">
                <div class="segment-title">
                  <strong>${item.excluded ? "—" : activeIndex + 1}. ${escapeHtml(item.code)}</strong>
                  <span>${formatDuration(item.duration)}</span>
                </div>
                <div class="tag-row">
                  <span class="tag">${escapeHtml(item.shift)}</span>
                  <span class="tag ${hasDamage ? "damage" : "ok"}">${escapeHtml(item.damage)}</span>
                  ${locked ? `<span class="tag lock">🔒 冻结只读</span>` : ""}
                  ${item.excluded ? `<span class="tag excluded-tag">已排除</span>` : ""}
                </div>
                ${item.handling ? `<p class="segment-handling">处置：${escapeHtml(item.handling)}</p>` : ""}
                <p class="segment-note">${escapeHtml(item.note || "没有备注。")}</p>
                ${markingId === item.id ? markFormHtml(item) : ""}
              </div>
              <div class="segment-actions">${actionButtons(item, locked)}</div>
            </article>
          `;
        })
        .join("") || `<p class="empty">没有符合筛选的片段。</p>`;
  }

  function renderWarnings(state) {
    const warnings = rules.buildWarnings(state.segments, state.versions);
    els.warningList.innerHTML =
      warnings
        .map((warning) => {
          if (warning.type === "version") {
            return `<div class="warning-item version-notice"><strong>版本提醒</strong><span>${escapeHtml(warning.text)}</span></div>`;
          }
          if (warning.type === "dup") {
            return `<div class="warning-item"><strong>编号重复</strong><span>${escapeHtml(warning.text)}</span></div>`;
          }
          return `
            <div class="warning-item">
              <strong>${warning.index}. ${escapeHtml(warning.code)}</strong>
              <span>${escapeHtml(warning.text)}${warning.note ? `：${escapeHtml(warning.note)}` : ""}</span>
            </div>
          `;
        })
        .join("") || `<p class="empty">当前清单没有颜色偏移或破损提醒。</p>`;
  }

  function renderVersions(state) {
    els.versionList.innerHTML =
      [...state.versions]
        .reverse()
        .map((version) => {
          const frozen = version.status === "frozen";
          return `
            <article class="version-card ${version.status}">
              <div class="version-head">
                <strong>${escapeHtml(version.name)}</strong>
                <span class="badge ${version.status}">${frozen ? "冻结中" : "已解除"}</span>
              </div>
              <p>放映室：${escapeHtml(version.room || "未登记")}｜冻结时间：${formatTime(version.createdAt)}</p>
              <p>区间：第${version.rangeFrom}–${version.rangeTo}段 · ${version.snapshot.length}个片段</p>
              <p class="version-codes">${version.snapshot.map((item) => escapeHtml(item.code)).join(" → ")}</p>
              ${version.note ? `<p>版本备注：${escapeHtml(version.note)}</p>` : ""}
              ${frozen ? "" : `<p class="lifted-reason">解除原因：${escapeHtml(version.liftedReason || "片段标记新破损")}，版本快照已保留。</p>`}
            </article>
          `;
        })
        .join("") || `<p class="empty">还没有冻结的试映版本。</p>`;
  }

  function renderFreezeForm(state) {
    const active = rules.activeSegments(state.segments);
    const prevStart = els.freezeStart.value;
    const prevEnd = els.freezeEnd.value;
    const options = active
      .map((item, index) => `<option value="${item.id}">${index + 1}. ${escapeHtml(item.code)}</option>`)
      .join("");
    els.freezeStart.innerHTML = options;
    els.freezeEnd.innerHTML = options;
    if (active.some((item) => item.id === prevStart)) els.freezeStart.value = prevStart;
    if (active.some((item) => item.id === prevEnd)) {
      els.freezeEnd.value = prevEnd;
    } else if (active.length) {
      els.freezeEnd.value = active[active.length - 1].id;
    }
  }

  function renderFreezeErrors() {
    els.freezeErrorBox.innerHTML = freezeErrors.length
      ? `<p class="freeze-error-title">本次冻结已整次拒绝，原清单和版本不变：</p>` +
        freezeErrors.map((error) => `<div class="freeze-error">${escapeHtml(error)}</div>`).join("")
      : "";
  }

  function renderAll() {
    const state = store.getState();
    if (document.activeElement !== els.reelTitle) els.reelTitle.value = state.reelTitle;
    renderStats(state);
    renderList(state);
    renderWarnings(state);
    renderVersions(state);
    renderFreezeForm(state);
    renderFreezeErrors();
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

  async function addSegment(event) {
    event.preventDefault();
    const thumb = await readFileAsDataUrl(els.thumbInput.files[0]);
    store.addSegment({
      code: els.codeInput.value.trim(),
      duration: Number(els.durationInput.value),
      shift: els.shiftInput.value,
      damage: els.damageInput.value,
      handling: els.handlingInput.value.trim(),
      note: els.noteInput.value.trim(),
      thumb
    });
    els.segmentForm.reset();
    els.durationInput.value = 12;
  }

  function submitFreeze(event) {
    event.preventDefault();
    const state = store.getState();
    const active = rules.activeSegments(state.segments);
    const start = active.findIndex((item) => item.id === els.freezeStart.value);
    const end = active.findIndex((item) => item.id === els.freezeEnd.value);
    const result = store.freezeVersion({
      start,
      end,
      room: els.roomInput.value.trim(),
      note: els.versionNoteInput.value.trim()
    });
    freezeErrors = result.ok ? [] : result.errors;
    if (result.ok) {
      els.roomInput.value = "";
      els.versionNoteInput.value = "";
    }
    renderAll();
  }

  function exportList() {
    const state = store.getState();
    const stats = rules.computeStats(state.segments, state.versions);
    const active = rules.activeSegments(state.segments);
    const excluded = state.segments.filter((item) => item.excluded);
    const lines = [
      `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
      `总时长：${formatDuration(stats.totalDuration)}｜片段数：${stats.segmentCount}｜破损片段：${stats.damageCount}｜冻结版本：${stats.frozenVersions}/${stats.versionCount}`,
      "",
      "【放映清单】",
      ...active.map(
        (item, index) =>
          `${index + 1}. ${item.code}｜${formatDuration(item.duration)}｜${item.shift}｜${item.damage}` +
          `${item.handling ? `｜处置：${item.handling}` : ""}｜${item.note || "无备注"}`
      ),
      ...(excluded.length
        ? [
            "",
            "【已排除片段】",
            ...excluded.map(
              (item) => `- ${item.code}｜${formatDuration(item.duration)}｜${item.shift}｜${item.damage}｜${item.note || "无备注"}`
            )
          ]
        : []),
      "",
      "【试映版本】",
      ...(state.versions.length
        ? state.versions.flatMap((version) =>
            [
              `${version.name}｜${version.status === "frozen" ? "冻结中" : "已解除"}｜放映室：${version.room || "未登记"}｜${formatTime(version.createdAt)}`,
              `　区间：第${version.rangeFrom}–${version.rangeTo}段｜片段：${version.snapshot.map((item) => item.code).join(" → ")}`,
              version.note ? `　版本备注：${version.note}` : "",
              version.status === "lifted" ? `　解除原因：${version.liftedReason}（版本快照已保留）` : ""
            ].filter(Boolean)
          )
        : ["（无）"])
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.reelTitle || "film-reel"}-checklist.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  els.reelTitle.addEventListener("input", () => store.setReelTitle(els.reelTitle.value));
  els.colorFilter.addEventListener("change", () => renderList(store.getState()));
  els.damageFilter.addEventListener("change", () => renderList(store.getState()));
  els.searchInput.addEventListener("input", () => renderList(store.getState()));
  els.segmentForm.addEventListener("submit", addSegment);
  els.freezeForm.addEventListener("submit", submitFreeze);
  els.exportBtn.addEventListener("click", exportList);

  els.segmentList.addEventListener("click", (event) => {
    const up = event.target.closest("[data-move-up]");
    const down = event.target.closest("[data-move-down]");
    const remove = event.target.closest("[data-delete]");
    const exclude = event.target.closest("[data-exclude]");
    const restore = event.target.closest("[data-restore]");
    const mark = event.target.closest("[data-mark]");
    const markCancel = event.target.closest("[data-mark-cancel]");
    const markConfirm = event.target.closest("[data-mark-confirm]");
    if (up) store.moveSegment(up.dataset.moveUp, -1);
    if (down) store.moveSegment(down.dataset.moveDown, 1);
    if (remove) store.deleteSegment(remove.dataset.delete);
    if (exclude) store.setExcluded(exclude.dataset.exclude, true);
    if (restore) store.setExcluded(restore.dataset.restore, false);
    if (mark) {
      markingId = mark.dataset.mark;
      renderAll();
    }
    if (markCancel) {
      markingId = null;
      renderAll();
    }
    if (markConfirm) {
      const card = markConfirm.closest("[data-id]");
      const damage = card.querySelector("[data-mark-damage]").value;
      const handling = card.querySelector("[data-mark-handling]").value.trim();
      markingId = null;
      store.markDamage(markConfirm.dataset.markConfirm, damage, handling);
    }
  });

  els.segmentList.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-id]");
    if (!card || card.getAttribute("draggable") === "false") return;
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
    if (!card || !draggedId || card.dataset.id === draggedId) return;
    event.preventDefault();
    store.dragReorder(draggedId, card.dataset.id);
  });

  store.subscribe(renderAll);
  renderAll();
})();
