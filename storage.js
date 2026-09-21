window.FilmDesk = window.FilmDesk || {};

// 本地存储模块：只负责 localStorage 的读写，不关心业务字段
window.FilmDesk.storage = (() => {
  const KEY = "zfl17-film-strip-desk";

  function loadRaw() {
    const saved = localStorage.getItem(KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  }

  function persist(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  return { KEY, loadRaw, persist };
})();
