// Runs at document_start: applies theme classes before first paint to avoid a flash of the old design.
(() => {
  const DEFAULTS = {
    enabled: true,
    mode: "auto", // auto | light | dark
    accent: "#ff5a36",
    density: "comfy", // comfy | compact
    rail: false, // sidebar collapsed
    today: true, // today panel on the start page
    aurora: true, // animated background glow
    accentMode: "fixed", // fixed | time | course
    notify: true, // class reminders
    notifyLead: "10", // minutes before a class
    motion: true // animations and micro interactions
  };
  const CACHE_KEY = "orbit:settings";
  const root = document.documentElement;
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const calmQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  function readCache() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  // Accent that follows the time of day: warm mornings, bright days, calm nights
  const TIME_ACCENTS = [
    [5, "#f59e0b"],
    [9, "#0ea5e9"],
    [15, "#ff5a36"],
    [19, "#a855f7"],
    [22, "#5b6cff"]
  ];
  function timeAccent() {
    const h = new Date().getHours();
    let color = TIME_ACCENTS[TIME_ACCENTS.length - 1][1];
    for (const [from, c] of TIME_ACCENTS) if (h >= from) color = c;
    return color;
  }

  // Accent taken from the Stud.IP color group of the course being viewed (cached by data.js)
  function courseAccent() {
    const cid = new URLSearchParams(location.search).get("cid") || (location.pathname.match(/\/course\/[^?]*?([0-9a-f]{32})/) || [])[1];
    if (!cid) return null;
    try {
      const g = JSON.parse(localStorage.getItem("orbit:groups") || "{}")[cid];
      return g == null ? null : `var(--group-color-${g})`;
    } catch (e) {
      return null;
    }
  }

  function resolveAccent(s) {
    if (s.accentMode === "time") return timeAccent();
    if (s.accentMode === "course") return courseAccent() || s.accent;
    return s.accent;
  }

  // The rail setting only applies to the start page. Every other page starts with the sidebar
  // open, and toggling there only affects the current page.
  const START_PAGE = /^\/(index\.php)?$|^\/dispatch\.php\/start(\/|$)/;
  window.__orbitPageRail = START_PAGE.test(location.pathname) ? null : false;

  function apply(s) {
    const dark = s.mode === "dark" || (s.mode === "auto" && darkQuery.matches);
    root.classList.toggle("sx", !!s.enabled);
    root.classList.toggle("sx-dark", !!s.enabled && dark);
    root.classList.toggle("sx-compact", s.density === "compact");
    root.classList.toggle("sx-rail", window.__orbitPageRail ?? !!s.rail);
    root.classList.toggle("sx-noaurora", !s.aurora);
    root.classList.toggle("sx-motion", !!s.enabled && s.motion !== false && !calmQuery.matches);
    root.style.setProperty("--sx-accent", resolveAccent(s));
    window.__orbitSettings = s;
    window.dispatchEvent(new CustomEvent("orbit:settings", { detail: s }));
  }

  apply(readCache());

  // Thin load bar that motion.js completes once the page has loaded
  if (root.classList.contains("sx-motion")) {
    const bar = document.createElement("div");
    bar.className = "sx-topbar";
    root.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add("is-loading"));
  }

  chrome.storage.sync.get(DEFAULTS, (s) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)); } catch (e) {}
    apply(s);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const next = { ...window.__orbitSettings };
    for (const [k, v] of Object.entries(changes)) next[k] = v.newValue;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch (e) {}
    apply(next);
  });

  darkQuery.addEventListener("change", () => apply(window.__orbitSettings));
  calmQuery.addEventListener("change", () => apply(window.__orbitSettings));
  setInterval(() => {
    if (window.__orbitSettings?.accentMode === "time") apply(window.__orbitSettings);
  }, 5 * 60 * 1000);

  // Stud.IP serializes a day end of "24:00" as maxTime "00:00", which makes FullCalendar
  // render an empty time grid. Patch the config before the calendar is initialized.
  function fixCalendarConfig(el) {
    const raw = el.getAttribute("data-config");
    if (!raw) return;
    try {
      const cfg = JSON.parse(raw);
      const toMin = (t) => {
        const [h, m] = String(t).split(":").map(Number);
        return h * 60 + (m || 0);
      };
      if (cfg.maxTime != null && toMin(cfg.maxTime) <= toMin(cfg.minTime || "00:00")) {
        cfg.maxTime = "24:00";
        el.setAttribute("data-config", JSON.stringify(cfg));
      }
    } catch (e) {}
  }

  const calObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches("[data-fullcalendar][data-config]")) fixCalendarConfig(n);
        n.querySelectorAll?.("[data-fullcalendar][data-config]").forEach(fixCalendarConfig);
      }
    }
  });
  calObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-fullcalendar][data-config]").forEach(fixCalendarConfig);
    calObserver.disconnect();
  });

  window.__orbitDefaults = DEFAULTS;
})();
