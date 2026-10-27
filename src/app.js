// Global wiring: floating control bar and keyboard shortcuts.
(() => {
  const Orbit = window.Orbit;
  const { esc } = Orbit.util;
  const t = Orbit.t;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  const ICONS = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    side: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
  };

  function isTyping(e) {
    const el = e.target;
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest?.(".ck-editor"));
  }

  function toggleDark() {
    const dark = document.documentElement.classList.contains("sx-dark");
    Orbit.saveSetting({ mode: dark ? "light" : "dark" });
  }

  function toggleRail() {
    // Pages that open the sidebar by default (see boot.js) toggle it locally
    if (window.__orbitPageRail != null) {
      window.__orbitPageRail = !window.__orbitPageRail;
      document.documentElement.classList.toggle("sx-rail", window.__orbitPageRail);
      return;
    }
    Orbit.saveSetting({ rail: !Orbit.settings().rail });
  }
  Orbit.toggleRail = toggleRail;

  function buildFab() {
    if (document.querySelector(".sx-fab")) return;
    const fab = document.createElement("div");
    fab.className = "sx-fab";
    fab.innerHTML = `
      <button type="button" data-act="rail" title="${esc(t("toggleSide"))} ( [ )" aria-label="${esc(t("toggleSide"))}">${ICONS.side}</button>
      <button type="button" data-act="dark" title="${esc(t("toggleDark"))} (⇧D)" aria-label="${esc(t("toggleDark"))}"><span data-theme-ico></span></button>
      <button type="button" data-act="search" class="is-primary" aria-label="${esc(t("search"))}">
        ${ICONS.search}<span class="sx-fab-label">${esc(t("search"))}</span><span class="sx-kbd">${isMac ? "⌘" : "Ctrl"} K</span>
      </button>`;
    document.body.appendChild(fab);
    fab.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "search") Orbit.palette.open();
      if (b.dataset.act === "rail") toggleRail();
      if (b.dataset.act === "dark") toggleDark();
    });
    syncFab();
  }

  function syncFab() {
    const ico = document.querySelector(".sx-fab [data-theme-ico]");
    if (ico) ico.innerHTML = document.documentElement.classList.contains("sx-dark") ? ICONS.sun : ICONS.moon;
    const hasSidebar = !!document.querySelector("#sidebar .sidebar-widget");
    const rail = document.querySelector('.sx-fab [data-act="rail"]');
    if (rail) rail.hidden = !hasSidebar;
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (!document.documentElement.classList.contains("sx")) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        Orbit.palette.isOpen() ? Orbit.palette.close() : Orbit.palette.open();
        return;
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); Orbit.palette.open(); }
      else if (e.key === "[") { e.preventDefault(); toggleRail(); }
      else if (e.key === "D" && e.shiftKey) { e.preventDefault(); toggleDark(); }
    },
    true
  );

  // Some plugin tiles set their icon as an inline background image, which CSS cannot recolor.
  // Expose the image as a variable so the theme can paint it as an accent colored mask.
  function exposeTileIcons() {
    document.querySelectorAll("ul.askone-boxed-grid-group > li > a").forEach((a) => {
      const bg = getComputedStyle(a).backgroundImage;
      if (!bg || bg === "none" || a.classList.contains("sx-masked-icon")) return;
      a.style.setProperty("--sx-icon", bg);
      a.classList.add("sx-masked-icon");
    });
  }

  // Stud.IP key visuals (OER, empty forum) are two-color SVGs: a light fill plus Stud.IP blue.
  // Swap both colors for theme tokens.
  const svgCache = {};
  function resolveColor(value) {
    const probe = document.createElement("span");
    probe.style.color = value;
    probe.style.display = "none";
    // Outside <body> so the illustration observer below does not see the probe
    document.documentElement.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }

  async function recolorIllustrations() {
    const imgs = document.querySelectorAll(".oer_search .browser img.illustration, .empty-forum .forum-illustration img");
    if (!imgs.length) return;
    const on = document.documentElement.classList.contains("sx");
    const light = resolveColor("color-mix(in srgb, var(--sx-accent) 30%, var(--sx-surface-3))");
    const dark = resolveColor("var(--sx-accent-text)");
    const tone = on ? `${light}|${dark}` : "";
    for (const img of imgs) {
      const current = img.getAttribute("src") || "";
      const painted = current.startsWith("data:");
      // Already painted with the current colors
      if (img.dataset.sxTone === tone && (painted || !on)) continue;
      // Vue may reuse the element and point it at a new original file
      const src = painted ? img.dataset.sxSrc : current;
      img.dataset.sxSrc = src;
      img.dataset.sxTone = tone;
      if (!on) {
        img.src = src;
        continue;
      }
      try {
        svgCache[src] = svgCache[src] || (await fetch(src, { credentials: "same-origin" }).then((r) => r.text()));
        const svg = svgCache[src].replace(/#ffffff|#e7ebf0/gi, light).replace(/#28497c/gi, dark);
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      } catch (e) {
        console.warn("[Orbit] illustration recolor failed", e);
      }
    }
  }

  // Profile pages keep the picture, name and score in the sidebar. Mirror them into a header card
  // that the theme shows while the sidebar is collapsed.
  function buildProfileHero() {
    if (document.body?.id !== "profile-index" || document.querySelector(".sx-profile-hero")) return;
    const widget = document.querySelector("#sidebar .avatar-widget")?.closest(".sidebar-widget");
    const img = widget?.querySelector("img[class*='avatar']");
    const content = document.querySelector("#content");
    if (!widget || !img || !content) return;
    const name = widget.querySelector(".sidebar-widget-header")?.textContent.trim() || "";
    const link = widget.querySelector("a.profile-avatar");
    const hero = document.createElement("section");
    hero.className = "sx-profile-hero";
    const pic = document.createElement(link ? "a" : "div");
    pic.className = "sx-profile-pic";
    if (link) {
      pic.href = link.href;
      pic.title = link.querySelector(".text")?.textContent.trim() || "";
    }
    const photo = document.createElement("img");
    photo.src = img.currentSrc || img.src;
    photo.alt = "";
    pic.appendChild(photo);
    const info = document.createElement("div");
    info.className = "sx-profile-info";
    const h = document.createElement("h1");
    h.textContent = name;
    info.appendChild(h);
    const meta = document.createElement("div");
    meta.className = "sx-profile-meta";
    widget.querySelectorAll(".profile-sidebar-details .minor").forEach((m) => {
      const chip = m.cloneNode(true);
      chip.className = "sx-profile-chip";
      chip.querySelectorAll("br").forEach((br) => br.replaceWith(" · "));
      meta.appendChild(chip);
    });
    info.appendChild(meta);
    hero.append(pic, info);
    content.prepend(hero);
  }

  // Replace the plain "Campusmanagementsystem Stud.IP" title with a logo and wordmark
  function buildBrand() {
    const title = document.querySelector("#site-title");
    if (!title || title.querySelector(".sx-brand")) return;
    title.title = title.textContent.trim();
    title.innerHTML =
      `<a class="sx-brand" href="${location.origin}/dispatch.php/start">` +
      '<span class="sx-brand-mark" aria-hidden="true"></span>' +
      '<span class="sx-brand-text"><b>Stud.IP</b><small>Universität Oldenburg</small></span></a>';
  }

  // Some uploaded pictures carry a transparent margin, which hides the rounded corners.
  // Measure the opaque area once and crop the image to it.
  function trimAvatar(img) {
    if (img.dataset.sxTrimmed) return;
    if (!img.complete || !img.naturalWidth) {
      img.addEventListener("load", () => trimAvatar(img), { once: true });
      return;
    }
    img.dataset.sxTrimmed = "1";
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      let top = h, left = w, bottom = -1, right = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] <= 16) continue;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
      if (bottom < 0 || (top === 0 && left === 0 && bottom === h - 1 && right === w - 1)) return;
      const pct = (n, total) => `${((n / total) * 100).toFixed(2)}%`;
      img.style.objectViewBox = `inset(${pct(top, h)} ${pct(w - 1 - right, w)} ${pct(h - 1 - bottom, h)} ${pct(left, w)})`;
    } catch (e) {
      // Cross-origin or decoding issues: keep the picture as it is
    }
  }

  function trimAvatars() {
    document.querySelectorAll("img.avatar-normal, .sx-profile-pic img").forEach(trimAvatar);
  }

  // Stud.IP can mark two dock items active (AskOne lives under "My work place").
  // Keep the highlight on the item whose link matches the current address best.
  function singleActiveDock() {
    const items = [...document.querySelectorAll("#navigation-level-1-items > li.active")];
    if (items.length < 2) return;
    const here = location.pathname;
    const score = (li) => {
      const path = li.querySelector("a")?.pathname || "";
      const dir = path.replace(/\/[^/]*$/, "/");
      if (path === here) return 3;
      if (dir.length > 1 && here.startsWith(dir)) return 2 + dir.length / 1000;
      return 0;
    };
    const best = items.reduce((a, b) => (score(b) > score(a) ? b : a));
    items.forEach((li) => li.classList.toggle("sx-not-active", li !== best));
  }

  // Stud.IP only offers "Change colour grouping" in the sidebar, which is hidden in rail mode.
  // Turn each course's colour bar into a shortcut that opens the same dialog.
  function colorGroupShortcuts() {
    const link = [...document.querySelectorAll("#sidebar a[href*='/my_courses/groups']")][0];
    if (!link) return;
    const label = link.textContent.trim();
    document.querySelectorAll("table.mycourses > tbody > tr > td[class^='gruppe']").forEach((td) => {
      if (td.classList.contains("sx-group-pick")) return;
      td.classList.add("sx-group-pick");
      td.title = label;
      td.tabIndex = 0;
      td.setAttribute("role", "button");
      td.addEventListener("click", () => link.click());
      td.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); link.click(); }
      });
    });
  }

  window.addEventListener("orbit:settings", () => {
    syncFab();
    recolorIllustrations();
  });
  buildFab();
  exposeTileIcons();
  recolorIllustrations();
  buildBrand();
  buildProfileHero();
  trimAvatars();
  colorGroupShortcuts();
  singleActiveDock();

  // Stud.IP and plugins still ship blue icon files as <img>. Keep the file as a mask and let the
  // theme paint it in the accent (see img.sx-icon-img in theme.css).
  function recolorIconImages() {
    // Plugin tiles and the Opencast search button already recolor their icon with a drop-shadow
    const skip = ".content-item-img-wrapper, .oc--searchbar--search-icon";
    document.querySelectorAll('img[src*="/icons/blue/"]').forEach((img) => {
      if (img.closest(skip)) return;
      const src = `url("${img.src}")`;
      if (img.style.getPropertyValue("--sx-icon-src") !== src) img.style.setProperty("--sx-icon-src", src);
      img.classList.add("sx-icon-img");
    });
  }
  recolorIconImages();

  // Some illustrations (the empty forum) and icons are rendered later by Vue; paint them when they appear
  let recolorQueued = false;
  new MutationObserver(() => {
    if (recolorQueued) return;
    recolorQueued = true;
    requestAnimationFrame(() => {
      recolorQueued = false;
      recolorIllustrations();
      recolorIconImages();
    });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });

  // Signature for the curious ones who open DevTools
  console.info(
    "%cUOL StudIP Theme%c by Furkan Çoban · https://github.com/ofurkancoban",
    "font-weight:700;color:#ff5a36",
    "color:inherit"
  );
})();
