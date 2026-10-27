// Motion layer: tilt cards, button rings, count-ups, badge bounce, cursor glow,
// sky phases and the page load bar. Every effect checks html.sx-motion so the setting turns it off live.
(() => {
  const root = document.documentElement;
  const on = () => root.classList.contains("sx") && root.classList.contains("sx-motion");

  const dock = document.querySelector("#navigation-level-1-items");

  /* ---------- 3D tilt with a light sheen ---------- */
  const TILT = ".sx-tile, ul.askone-boxed-grid > li > a, ul.askone-boxed-grid-group > li > a, a.content-item-link, .studip-grid-element, .cw-tile";
  let tilted = null;
  document.addEventListener("pointermove", (e) => {
    if (!on() || e.pointerType === "touch") return;
    const el = e.target.closest?.(TILT);
    if (tilted && tilted !== el) resetTilt(tilted);
    if (!el) return;
    if (!el.classList.contains("sx-tilt")) {
      el.classList.add("sx-tilt");
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      const sheen = document.createElement("span");
      sheen.className = "sx-sheen";
      el.appendChild(sheen);
    }
    tilted = el;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.classList.add("is-tilting");
    el.style.setProperty("--ry", `${((px - 0.5) * 9).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${((0.5 - py) * 9).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  }, { passive: true });
  function resetTilt(el) {
    el.classList.remove("is-tilting");
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
    if (tilted === el) tilted = null;
  }
  document.addEventListener("pointerleave", () => tilted && resetTilt(tilted));

  /* ---------- Ring burst on buttons ---------- */
  const BUTTONS = ".button, button, input[type='submit'], .fc-button, .sx-fab button";
  document.addEventListener("pointerdown", (e) => {
    if (!on()) return;
    const b = e.target.closest?.(BUTTONS);
    if (!b || b.closest("#navigation-level-1-items")) return;
    b.classList.remove("sx-ring");
    void b.offsetWidth;
    b.classList.add("sx-ring");
    setTimeout(() => b.classList.remove("sx-ring"), 600);
  }, { passive: true });

  /* ---------- Count-up numbers on the start page ---------- */
  const counted = new WeakSet();
  function countUp(el) {
    if (counted.has(el)) return;
    counted.add(el);
    const m = el.textContent.trim().match(/^(\d+)(\D*)$/);
    if (!m || /:/.test(el.textContent)) return;
    const target = Number(m[1]);
    const suffix = m[2];
    if (target < 2) return;
    const start = performance.now();
    const dur = 700;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = `${Math.round(target * eased)}${suffix}`;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const countStart = Date.now();
  const countObserver = new MutationObserver(() => {
    if (!on()) return;
    if (Date.now() - countStart > 6000) return countObserver.disconnect();
    document.querySelectorAll(".sx-chips b, .sx-sem-row b").forEach(countUp);
  });
  if (document.body) countObserver.observe(document.body, { childList: true, subtree: true });

  /* ---------- Badge bounce when the count goes up ---------- */
  if (dock) {
    const badgeObserver = new MutationObserver((list) => {
      if (!on()) return;
      for (const m of list) {
        const a = m.target;
        const before = Number(m.oldValue || 0);
        const now = Number(a.getAttribute("data-badge") || 0);
        if (now > before) {
          a.classList.remove("sx-bump");
          void a.offsetWidth;
          a.classList.add("sx-bump");
          setTimeout(() => a.classList.remove("sx-bump"), 800);
        }
      }
    });
    badgeObserver.observe(dock, { attributes: true, attributeFilter: ["data-badge"], attributeOldValue: true, subtree: true });
    // A gentle hello for badges that are already there
    setTimeout(() => {
      if (!on()) return;
      dock.querySelectorAll("a[data-badge]:not([data-badge='0'])").forEach((a) => {
        a.classList.add("sx-bump");
        setTimeout(() => a.classList.remove("sx-bump"), 800);
      });
    }, 500);
  }

  /* ---------- Cursor glow on card borders ---------- */
  const GLOW = ".sx-card, .studip-widget, section.contentbox, #sidebar .sidebar-widget";
  document.addEventListener("pointermove", (e) => {
    if (!on() || e.pointerType === "touch") return;
    const host = e.target.closest?.(GLOW);
    if (!host) return;
    if (!host.classList.contains("sx-glow-host")) {
      host.classList.add("sx-glow-host");
      const g = document.createElement("span");
      g.className = "sx-glow";
      host.appendChild(g);
    }
    const r = host.getBoundingClientRect();
    host.style.setProperty("--gx", `${e.clientX - r.left}px`);
    host.style.setProperty("--gy", `${e.clientY - r.top}px`);
  }, { passive: true });

  /* ---------- Sky phase for the greeting card ---------- */
  function skyPhase() {
    const h = new Date().getHours();
    if (h >= 5 && h < 9) return "dawn";
    if (h >= 9 && h < 17) return "day";
    if (h >= 17 && h < 21) return "dusk";
    return "night";
  }
  const setSky = () => { root.dataset.sky = skyPhase(); };
  setSky();
  setInterval(setSky, 5 * 60 * 1000);

  /* ---------- Page load bar ---------- */
  function bar() {
    let el = document.querySelector(".sx-topbar");
    if (!el) {
      el = document.createElement("div");
      el.className = "sx-topbar";
      root.appendChild(el);
    }
    return el;
  }
  const finish = () => {
    const el = document.querySelector(".sx-topbar");
    if (!el) return;
    el.classList.remove("is-loading");
    el.classList.add("is-done");
    setTimeout(() => el.remove(), 800);
  };
  if (document.readyState === "complete") finish();
  else window.addEventListener("load", finish, { once: true });

  // Start a new bar as soon as the user leaves the page
  document.addEventListener("click", (e) => {
    if (!on() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("download") || a.hasAttribute("data-dialog")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
    const el = bar();
    el.classList.remove("is-done");
    void el.offsetWidth;
    el.classList.add("is-loading");
    // Links handled by Stud.IP's own scripts (dialogs, toggles) never unload the page
    setTimeout(() => { if (document.visibilityState === "visible") finish(); }, 8000);
  });
  window.addEventListener("pageshow", (e) => { if (e.persisted) finish(); });
})();
