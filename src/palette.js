// Command palette: jump to any course, page or action with the keyboard.
(() => {
  const Orbit = window.Orbit;
  const { esc, hue, urls } = Orbit.util;
  const t = Orbit.t;
  const RECENT_KEY = "orbit:recent";

  const ICONS = {
    search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>'
  };

  let overlay, input, list;
  let items = [];
  let results = [];
  let active = 0;
  let courseCache = [];

  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (e) { return []; }
  }
  function pushRecent(key) {
    const r = [key, ...recent().filter((k) => k !== key)].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (e) {}
  }

  function cleanText(el) {
    return (el.textContent || el.getAttribute("title") || el.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pageItems() {
    const seen = new Set();
    const out = [];
    const add = (a, group) => {
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      if (a.id === "uol-logout-link" || /logout/i.test(href)) return;
      const abs = new URL(href, location.href).href;
      if (seen.has(abs)) return;
      let title = a.querySelector(".navtitle") ? cleanText(a.querySelector(".navtitle")) : cleanText(a);
      title = title.replace(/^(To the|Zur)\s+/i, "");
      if (!title || title.length > 90) return;
      seen.add(abs);
      out.push({ key: "p:" + abs, kind: "page", group, title, sub: new URL(abs).pathname.replace("/dispatch.php/", ""), href: abs });
    };
    document.querySelectorAll("#navigation-level-1-items > li > a").forEach((a) => add(a, t("pages")));
    document.querySelectorAll("#tabs a, #sidebar .widget-links a, #header-links .uol-nav-link a").forEach((a) => add(a, t("pages")));
    return out;
  }

  function actionItems() {
    const s = Orbit.settings();
    return [
      { key: "a:dark", kind: "action", group: t("actions"), title: t("toggleDark"), hint: "⇧D",
        run: () => {
          const dark = document.documentElement.classList.contains("sx-dark");
          Orbit.saveSetting({ mode: dark ? "light" : "dark" });
        } },
      { key: "a:rail", kind: "action", group: t("actions"), title: t("toggleSide"), hint: "[",
        run: () => (Orbit.toggleRail ? Orbit.toggleRail() : Orbit.saveSetting({ rail: !s.rail })) },
      { key: "a:aurora", kind: "action", group: t("actions"), title: t("toggleAurora"),
        run: () => Orbit.saveSetting({ aurora: !s.aurora }) },
      { key: "a:schedule", kind: "page", group: t("actions"), title: t("openSchedule"), href: urls.schedule() },
      { key: "a:refresh", kind: "action", group: t("actions"), title: t("refresh"),
        run: async () => { await Orbit.clearCache(); Orbit.toast(t("refreshed")); setTimeout(() => location.reload(), 500); } }
    ];
  }

  function courseItems() {
    return courseCache.map((c) => ({
      key: "c:" + c.id,
      kind: "course",
      group: t("courses"),
      title: c.title,
      sub: [c.number, c.semester, c.subtitle].filter(Boolean).join("  ·  "),
      haystack: `${c.title} ${c.number} ${c.subtitle} ${c.semester}`,
      current: c.current,
      id: c.id,
      href: urls.overview(c.id)
    }));
  }

  function rebuild() {
    items = [...courseItems(), ...pageItems(), ...actionItems()];
  }

  // Lightweight fuzzy scoring: contiguous match > all tokens > subsequence
  function score(q, item) {
    const hay = (item.haystack || `${item.title} ${item.sub || ""}`).toLowerCase();
    const title = item.title.toLowerCase();
    let s = -1;
    const idx = title.indexOf(q);
    if (idx >= 0) {
      s = 100 - Math.min(idx, 40) + (idx === 0 || title[idx - 1] === " " ? 25 : 0);
    } else if (hay.includes(q)) {
      s = 60;
    } else {
      const tokens = q.split(/\s+/).filter(Boolean);
      if (tokens.length > 1 && tokens.every((tk) => hay.includes(tk))) s = 50;
      else {
        let i = 0;
        for (const ch of title) if (ch === q[i]) i++;
        if (i === q.length && q.length > 1) s = 20 - Math.min(10, title.length / 10);
      }
    }
    if (s < 0) return s;
    if (item.current) s += 15;
    if (recent().includes(item.key)) s += 10;
    return s;
  }

  function highlight(title, q) {
    if (!q) return esc(title);
    const i = title.toLowerCase().indexOf(q);
    if (i < 0) return esc(title);
    return esc(title.slice(0, i)) + "<mark>" + esc(title.slice(i, i + q.length)) + "</mark>" + esc(title.slice(i + q.length));
  }

  function search(raw) {
    const q = raw.trim().toLowerCase();
    if (!q) {
      const rec = recent().map((k) => items.find((i) => i.key === k)).filter(Boolean).map((i) => ({ ...i, group: t("recent") }));
      const recKeys = new Set(rec.map((r) => r.key));
      const cur = items.filter((i) => i.kind === "course" && i.current && !recKeys.has(i.key)).map((i) => ({ ...i, group: t("thisSem") }));
      return [...rec, ...cur, ...actionItems()];
    }
    return items
      .map((i) => ({ i, s: score(q, i) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.i)
      // keep groups together in their first-appearance order
      .sort((a, b) => groupOrder(a.group) - groupOrder(b.group));
  }

  function groupOrder(g) {
    return [t("recent"), t("thisSem"), t("courses"), t("pages"), t("actions")].indexOf(g);
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    results = search(input.value);
    if (active >= results.length) active = Math.max(0, results.length - 1);
    if (!results.length) {
      list.innerHTML = `<div class="sx-pal-empty">${esc(t("noRes"))}</div>`;
      return;
    }
    let html = "";
    let lastGroup = null;
    results.forEach((r, n) => {
      if (r.group !== lastGroup) {
        html += `<div class="sx-pal-group">${esc(r.group)}</div>`;
        lastGroup = r.group;
      }
      let ico;
      if (r.kind === "course") {
        const initials = r.title.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
        ico = `<span class="sx-pal-ico" style="--h:${hue(r.id)}">${esc(initials)}</span>`;
      } else {
        ico = `<span class="sx-pal-ico is-plain">${r.kind === "action" ? ICONS.bolt : ICONS.link}</span>`;
      }
      const hint = r.kind === "course" ? `↵ ${t("open")} · ⇧↵ ${t("files")}` : r.hint || "↵";
      html += `<div class="sx-pal-item" role="option" id="sx-opt-${n}" data-n="${n}" aria-selected="${n === active}">
        ${ico}
        <div class="sx-pal-text"><div class="sx-pal-title">${highlight(r.title, q)}</div>${r.sub ? `<div class="sx-pal-sub">${esc(r.sub)}</div>` : ""}</div>
        <span class="sx-pal-hint">${esc(hint)}</span>
      </div>`;
    });
    list.innerHTML = html;
    input.setAttribute("aria-activedescendant", `sx-opt-${active}`);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  function setActive(n) {
    if (!results.length) return;
    active = (n + results.length) % results.length;
    list.querySelectorAll(".sx-pal-item").forEach((el) => el.setAttribute("aria-selected", String(+el.dataset.n === active)));
    input.setAttribute("aria-activedescendant", `sx-opt-${active}`);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  function execute(r, { shift = false, newTab = false } = {}) {
    if (!r) return;
    pushRecent(r.key);
    close();
    if (r.run) return r.run();
    let href = r.href;
    if (r.kind === "course" && shift) href = urls.files(r.id);
    if (newTab) window.open(href, "_blank", "noopener");
    else location.href = href;
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "sx-overlay";
    overlay.innerHTML = `
      <div class="sx-pal" role="dialog" aria-modal="true" aria-label="${esc(t("search"))}">
        <div class="sx-pal-input">
          ${ICONS.search}
          <input type="text" role="combobox" aria-expanded="true" aria-controls="sx-pal-list" autocomplete="off" spellcheck="false" placeholder="${esc(t("searchPh"))}">
          <span class="sx-kbd">esc</span>
        </div>
        <div class="sx-pal-list" id="sx-pal-list" role="listbox"></div>
        <div class="sx-pal-foot">
          <span><span class="sx-kbd">↑</span><span class="sx-kbd">↓</span> ${esc(t("nav"))}</span>
          <span><span class="sx-kbd">↵</span> ${esc(t("open"))}</span>
          <span><span class="sx-kbd">⌘↵</span> ${esc(t("newTab"))}</span>
          <span><span class="sx-kbd">esc</span> ${esc(t("close"))}</span>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    input = overlay.querySelector("input");
    list = overlay.querySelector(".sx-pal-list");

    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    input.addEventListener("input", () => { active = 0; render(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        execute(results[active], { shift: e.shiftKey, newTab: e.metaKey || e.ctrlKey });
      } else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    list.addEventListener("mousemove", (e) => {
      const el = e.target.closest(".sx-pal-item");
      if (el && +el.dataset.n !== active) setActive(+el.dataset.n);
    });
    list.addEventListener("click", (e) => {
      const el = e.target.closest(".sx-pal-item");
      if (el) execute(results[+el.dataset.n], { shift: e.shiftKey, newTab: e.metaKey || e.ctrlKey });
    });
  }

  function open(prefill = "") {
    if (!document.documentElement.classList.contains("sx")) return;
    if (!overlay) build();
    rebuild();
    input.value = prefill;
    active = 0;
    render();
    overlay.classList.add("is-open");
    requestAnimationFrame(() => input.focus());
  }

  function close() {
    overlay?.classList.remove("is-open");
  }

  function isOpen() {
    return !!overlay?.classList.contains("is-open");
  }

  // Load courses in the background so the palette is instant when opened
  Orbit.data
    .courses((fresh) => { courseCache = fresh; if (isOpen()) { rebuild(); render(); } })
    .then((c) => { courseCache = c; if (isOpen()) { rebuild(); render(); } })
    .catch(() => {});

  Orbit.palette = { open, close, isOpen };
})();
