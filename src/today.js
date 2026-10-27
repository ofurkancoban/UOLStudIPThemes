// Today panel on the start page: greeting, live clock, next class, weekly agenda, semester progress, course tiles.
(() => {
  const Orbit = window.Orbit;
  const { esc, hue, urls, groupColor } = Orbit.util;
  const t = Orbit.t;
  const DAY = 24 * 3600 * 1000;
  const locale = Orbit.lang === "de" ? "de-DE" : "en-GB";

  const isStart = document.body?.id === "start-index" || /\/dispatch\.php\/start\b/.test(location.pathname);
  if (!isStart) return;

  const state = {
    me: null,
    schedule: [],
    courses: [],
    semester: null,
    dayOffset: 0,
    scheduleReady: false
  };
  let root = null;

  const hhmm = (d) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dayAt = (offset) => new Date(startOfDay(new Date()).getTime() + offset * DAY + 12 * 3600 * 1000);

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return t("night");
    if (h < 11) return t("morning");
    if (h < 18) return t("day");
    return t("evening");
  }

  function duration(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  function courseFor(ev) {
    return state.courses.find((c) => c.id === ev.courseId);
  }

  // Stud.IP color group when the course has one, otherwise a stable generated hue
  function colorFor(courseId, fallback) {
    const g = state.courses.find((c) => c.id === courseId)?.group;
    return groupColor(g) || `hsl(${hue(courseId || fallback)} 75% 55%)`;
  }

  function evTitle(ev) {
    const c = courseFor(ev);
    if (c) return c.title;
    return ev.title.replace(/^[\d.]+\s+/, "");
  }

  function upcoming() {
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const evs = Orbit.data.eventsOn(state.schedule, dayAt(i));
      const hit = evs.find((e) => e.endAt > now && !e.cancelled);
      if (hit) return hit;
    }
    return null;
  }

  function renderNext() {
    if (!state.scheduleReady) return '<div class="sx-next is-loading"><div class="sx-skel sx-skel-badge"></div><div class="sx-skel sx-skel-line"></div></div>';
    const ev = upcoming();
    if (!ev) {
      return `<div class="sx-next"><div class="sx-next-badge">✓</div><div><div class="sx-next-title">${esc(t("noClass"))}</div></div></div>`;
    }
    const now = new Date();
    const live = ev.startAt <= now;
    let badge;
    if (live) badge = duration(ev.endAt - now);
    else if (ev.startAt - now < 12 * 3600 * 1000) badge = duration(ev.startAt - now);
    else badge = ev.startAt.toLocaleDateString(locale, { weekday: "short" });
    const meta = live
      ? `${t("live")} · ${t("left")}: ${duration(ev.endAt - now)}`
      : `${t("next")} · ${ev.startAt.toLocaleDateString(locale, { weekday: "long" })} ${hhmm(ev.startAt)}–${hhmm(ev.endAt)}`;
    const href = ev.courseId ? urls.overview(ev.courseId) : urls.schedule();
    return `<a class="sx-next" href="${esc(href)}">
      <div class="sx-next-badge ${live ? "is-live" : ""}">${live ? "● " : ""}${esc(live ? t("live") : badge)}</div>
      <div>
        <div class="sx-next-title">${esc(evTitle(ev))}</div>
        <div class="sx-next-meta">${ev.roomChanged ? `<span class="sx-tag is-warn">${esc(t("roomChanged"))}</span>` : ""}${esc(meta)}${ev.location ? " · " + esc(ev.location) : ""}</div>
      </div>
    </a>`;
  }

  function renderSemester() {
    const s = state.semester;
    if (!s) return "";
    const now = Date.now();
    const ls = new Date(s.lecStart || s.start).getTime();
    const le = new Date(s.lecEnd || s.end).getTime();
    const weeks = Math.max(1, Math.ceil((le - ls) / (7 * DAY)));
    const inLectures = now >= ls && now <= le;
    const cur = inLectures ? Math.floor((now - ls) / (7 * DAY)) + 1 : now > le ? weeks + 1 : 0;
    let bars = "";
    for (let i = 1; i <= weeks; i++) bars += `<i class="${i < cur ? "done" : i === cur ? "now" : ""}"></i>`;
    const label = inLectures ? `${t("week")} <b>${cur}</b> ${t("of")} ${weeks}` : esc(t("break"));
    return `<div class="sx-sem">
      <div class="sx-sem-row"><span>${esc(s.title)}</span><span>${label}</span></div>
      <div class="sx-sem-bar" aria-hidden="true">${bars}</div>
    </div>`;
  }

  function renderSummary() {
    if (!state.scheduleReady) return "";
    const now = new Date();
    const evs = Orbit.data.eventsOn(state.schedule, dayAt(0));
    if (!evs.length) return "";
    const left = evs.filter((e) => e.endAt > now);
    const minutes = evs.reduce((m, e) => m + (e.endAt - e.startAt) / 60000, 0);
    const changes = evs.filter((e) => e.cancelled || e.roomChanged).length;
    const chips = [
      `<b>${evs.length}</b> ${esc(t("classesToday"))}`,
      `<b>${esc(duration(minutes * 60000))}</b> ${esc(t("inClass"))}`,
      left.length
        ? `${esc(t("doneAt"))} <b>${esc(hhmm(evs[evs.length - 1].endAt))}</b>`
        : `<b>✓</b> ${esc(t("allDone"))}`
    ];
    let html = chips.map((c) => `<span>${c}</span>`).join("");
    if (changes) html += `<span class="is-warn"><b>${changes}</b> ${esc(t("changesToday"))}</span>`;
    return `<div class="sx-chips">${html}</div>`;
  }

  const digits = (str) => [...str].map((ch) => `<span class="sx-digit">${esc(ch)}</span>`).join("");

  function renderHero() {
    const now = new Date();
    const name = state.me?.given || "";
    return `<section class="sx-card sx-hero">
      <div class="sx-sky" aria-hidden="true"></div>
      <div class="sx-hero-top">
        <div>
          <div class="sx-eyebrow">${esc(now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }))}</div>
          <h2 class="sx-greet">${esc(greeting())}${name ? `, <em>${esc(name)}</em>` : ""}.</h2>
        </div>
        <div class="sx-clock" data-clock><span class="sx-clock-digits">${digits(hhmm(now))}</span><small>${esc(state.semester?.token || "")}</small></div>
      </div>
      <div data-next>${renderNext()}</div>
      <div data-summary>${renderSummary()}</div>
      ${renderSemester()}
    </section>`;
  }

  function renderDays() {
    let html = "";
    for (let i = 0; i < 6; i++) {
      const d = dayAt(i);
      const label = i === 0 ? t("today") : i === 1 ? t("tomorrow") : d.toLocaleDateString(locale, { weekday: "short", day: "numeric" });
      const has = Orbit.data.eventsOn(state.schedule, d).length > 0;
      html += `<button type="button" data-day="${i}" aria-pressed="${i === state.dayOffset}" class="${has ? "has-events" : ""}">${esc(label)}</button>`;
    }
    return html;
  }

  function renderEvents() {
    if (!state.scheduleReady) return Array.from({ length: 3 }, () => '<div class="sx-skel sx-skel-ev"></div>').join("");
    const day = dayAt(state.dayOffset);
    const evs = Orbit.data.eventsOn(state.schedule, day);
    if (!evs.length) {
      return `<div class="sx-empty"><b>${esc(t("nothing"))}</b>${esc(t("free"))}</div>`;
    }
    const now = new Date();
    return evs
      .map((ev) => {
        const past = ev.endAt <= now;
        const live = ev.startAt <= now && now < ev.endAt;
        const p = live ? Math.round(((now - ev.startAt) / (ev.endAt - ev.startAt)) * 100) : 0;
        const c = courseFor(ev);
        const color = colorFor(ev.courseId, ev.title);
        const href = ev.courseId ? urls.overview(ev.courseId) : urls.schedule();
        const num = c?.number || (ev.title.match(/^[\d.]+/) || [""])[0];
        let room = esc(ev.location || "");
        if (ev.roomChanged) {
          room = `<span class="sx-room-new" title="${esc(t("usually"))}: ${esc(ev.usualRoom)}">${esc(ev.location)}</span> <s>${esc(ev.usualRoom)}</s>`;
        }
        const meta = [esc(num), room].filter(Boolean).join(" · ");
        let tag = "";
        if (ev.cancelled) tag = `<span class="sx-tag is-bad">${esc(t("cancelled"))}</span>`;
        else if (ev.roomChanged) tag = `<span class="sx-tag is-warn">${esc(t("roomChanged"))}</span>`;
        else if (live) tag = `<span class="sx-live-tag">● ${esc(t("live"))}</span>`;
        return `<a class="sx-ev ${past ? "is-past" : ""} ${live && !ev.cancelled ? "is-live" : ""} ${ev.cancelled ? "is-cancelled" : ""}" href="${esc(href)}" style="--c:${color};--p:${ev.cancelled ? 0 : p}%${live ? `;--dur:${Math.round((ev.endAt - ev.startAt) / 1000)}s;--delay:-${Math.round((now - ev.startAt) / 1000)}s` : ""}">
          <div class="sx-ev-time">${esc(hhmm(ev.startAt))}<span>${esc(hhmm(ev.endAt))}</span></div>
          <div class="sx-ev-bar"></div>
          <div>
            <div class="sx-ev-title">${esc(evTitle(ev))}</div>
            <div class="sx-ev-meta">${tag}${meta}</div>
          </div>
        </a>`;
      })
      .join("");
  }

  function renderTimeline() {
    return `<section class="sx-card sx-tl">
      <div class="sx-tl-head">
        <h2>${esc(t("schedule"))}</h2>
        <div class="sx-days" role="group">${renderDays()}</div>
      </div>
      <div class="sx-list" data-events>${renderEvents()}</div>
    </section>`;
  }

  function renderCourses() {
    const current = state.courses.filter((c) => c.current).sort((a, b) => a.title.localeCompare(b.title));
    let body;
    if (!state.courses.length) {
      body = Array.from({ length: 6 }, () => '<div class="sx-skel"></div>').join("");
    } else {
      body = current
        .map(
          (c) => `<a class="sx-tile ${c.group != null ? "has-group" : ""}" href="${esc(urls.overview(c.id))}" style="--h:${hue(c.id)}${c.group != null ? `;--tc:${groupColor(c.group)}` : ""}">
            <span class="sx-tile-num">${esc(c.number)}</span>
            <span class="sx-tile-title">${esc(c.title)}</span>
            <span class="sx-tile-actions">
              <span data-go="${esc(urls.files(c.id))}">${esc(t("files"))}</span>
              <span data-go="${esc(urls.members(c.id))}">${esc(t("members"))}</span>
            </span>
          </a>`
        )
        .join("");
    }
    return `<section class="sx-card sx-courses">
      <div class="sx-courses-head">
        <h2>${esc(t("thisSem"))} <span class="sx-kbd" title="${esc(t("search"))}">⌘K</span></h2>
        <a href="${esc(urls.myCourses())}">${esc(t("all"))} →</a>
      </div>
      <div class="sx-grid">${body}</div>
    </section>`;
  }

  // The panel is split into fixed slots so re-rendering never touches the to-do card (todo.js owns that slot)
  function render() {
    if (!root) return;
    root.querySelector('[data-slot="main"]').innerHTML = renderHero() + renderTimeline();
    root.querySelector('[data-slot="courses"]').innerHTML = renderCourses();
  }

  function tick() {
    if (!root) return;
    const spans = root.querySelectorAll("[data-clock] .sx-digit");
    const next = [...hhmm(new Date())];
    if (spans.length !== next.length) return;
    spans.forEach((span, i) => {
      if (span.textContent === next[i]) return;
      span.textContent = next[i];
      span.classList.remove("is-flipping");
      void span.offsetWidth;
      span.classList.add("is-flipping");
    });
  }

  function refreshLive() {
    if (!root) return;
    const next = root.querySelector("[data-next]");
    if (next) next.innerHTML = renderNext();
    const evs = root.querySelector("[data-events]");
    if (evs) evs.innerHTML = renderEvents();
    const sum = root.querySelector("[data-summary]");
    if (sum) sum.innerHTML = renderSummary();
  }

  function mount() {
    const s = Orbit.settings();
    const content = document.querySelector("#content");
    if (!content) return;
    if (!s.enabled || !s.today) {
      root?.remove();
      root = null;
      return;
    }
    if (root && root.isConnected) return;
    root = document.createElement("div");
    root.className = "sx-today";
    root.innerHTML =
      '<div class="sx-slot" data-slot="main"></div>' +
      '<div class="sx-slot" data-slot="todo"></div>' +
      '<div class="sx-slot" data-slot="courses"></div>';
    const anchor = content.querySelector(".start-widgetcontainer") || content.firstElementChild;
    content.insertBefore(root, anchor);

    root.addEventListener("click", (e) => {
      const day = e.target.closest("[data-day]");
      if (day) {
        state.dayOffset = +day.dataset.day;
        root.querySelectorAll("[data-day]").forEach((b) => b.setAttribute("aria-pressed", String(b === day)));
        root.querySelector("[data-events]").innerHTML = renderEvents();
        return;
      }
      const go = e.target.closest("[data-go]");
      if (go) {
        e.preventDefault();
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey) window.open(go.dataset.go, "_blank", "noopener");
        else location.href = go.dataset.go;
      }
    });
    render();
  }

  async function load() {
    mount();
    try {
      const [me, sem] = await Promise.all([Orbit.data.me(), Orbit.data.currentSemester()]);
      state.me = me;
      state.semester = sem;
      render();
      // Schedule and courses render independently so a slow request never blocks the other
      const sched = Orbit.data
        .schedule((fresh) => { state.schedule = fresh; render(); })
        .catch((e) => { console.warn("[Orbit] schedule", e); return []; })
        .then((v) => { state.schedule = v; state.scheduleReady = true; render(); return v; })
        .then((v) => Orbit.data.dates(v.map((e) => e.courseId), render))
        .then(render)
        .catch((e) => console.warn("[Orbit] rooms", e));
      const courses = Orbit.data
        .courses((fresh) => { state.courses = fresh; render(); })
        .catch((e) => { console.warn("[Orbit] courses", e); return []; })
        .then((v) => { state.courses = v; render(); });
      await Promise.all([sched, courses]);
    } catch (e) {
      // Not logged in or API unavailable: keep the original start page untouched
      console.warn("[Orbit] today panel disabled", e);
      root?.remove();
      root = null;
    }
  }

  window.addEventListener("orbit:settings", () => { mount(); });
  window.addEventListener("orbit:user-changed", async () => {
    await Orbit.clearCache();
    state.scheduleReady = false;
    load();
  });
  setInterval(tick, 1000 * 15);
  setInterval(refreshLive, 1000 * 60);
  load();
})();
