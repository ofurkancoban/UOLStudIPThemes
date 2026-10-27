// Data layer: talks to the Stud.IP JSON:API with the user's existing session and caches results.
(() => {
  const Orbit = (window.Orbit = window.Orbit || {});
  const API = `${location.origin}/jsonapi.php/v1/`;
  const HOUR = 3600 * 1000;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function hue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function localDate(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  const urls = {
    overview: (cid) => `${location.origin}/dispatch.php/course/overview?cid=${encodeURIComponent(cid)}`,
    files: (cid) => `${location.origin}/dispatch.php/course/files?cid=${encodeURIComponent(cid)}`,
    members: (cid) => `${location.origin}/dispatch.php/course/members?cid=${encodeURIComponent(cid)}`,
    myCourses: () => `${location.origin}/dispatch.php/my_courses`,
    schedule: () => `${location.origin}/dispatch.php/calendar/schedule`
  };

  // Signed-out requests get "401 Basic" from the JSON:API, which makes Chrome show its own
  // username/password prompt. Only call the API when the page shows a signed-in user.
  const signedIn = () => !!document.querySelector("#avatar-wrapper, #avatar-menu");
  let apiBlocked = false;

  async function api(path) {
    if (apiBlocked || !signedIn()) throw new Error("Stud.IP API: not signed in");
    const res = await fetch(API + path, {
      credentials: "same-origin",
      headers: { Accept: "application/vnd.api+json" }
    });
    // The session expired while the page was open: stop before the next call prompts again
    if (res.status === 401) apiBlocked = true;
    if (!res.ok) throw new Error(`Stud.IP API ${res.status}`);
    return res.json();
  }

  async function paged(path, limit = 100) {
    const out = { data: [], included: [] };
    for (let offset = 0; offset < 5000; offset += limit) {
      const sep = path.includes("?") ? "&" : "?";
      const j = await api(`${path}${sep}page[offset]=${offset}&page[limit]=${limit}`);
      out.data.push(...(j.data || []));
      out.included.push(...(j.included || []));
      const total = j.meta?.page?.total ?? 0;
      if (offset + limit >= total) break;
    }
    return out;
  }

  // chrome.storage.local cache with stale-while-revalidate semantics
  function cacheGet(key) {
    return new Promise((r) => chrome.storage.local.get(key, (v) => r(v[key] || null)));
  }
  function cacheSet(key, value) {
    return new Promise((r) => chrome.storage.local.set({ [key]: { ts: Date.now(), value } }, r));
  }

  // With revalidate the cached value is still served instantly, but the server is asked every time,
  // so changes such as a dropped course show up on the next page load instead of after the TTL.
  async function cached(key, ttl, loader, onFresh, revalidate = false) {
    const hit = await cacheGet(key);
    const fresh = hit && Date.now() - hit.ts < ttl;
    if (hit && (!fresh || revalidate)) {
      loader()
        .then((v) => {
          const changed = JSON.stringify(v) !== JSON.stringify(hit.value);
          return cacheSet(key, v).then(() => changed && onFresh && onFresh(v));
        })
        .catch(() => {});
    }
    if (hit) return hit.value;
    const v = await loader();
    await cacheSet(key, v);
    return v;
  }

  // The cached identity is served instantly and always revalidated, so a different login is picked up on the next load
  let mePromise = null;
  function me() {
    if (!mePromise) {
      const load = () =>
        api("users/me").then((j) => ({
          id: j.data.id,
          username: j.data.attributes.username,
          given: j.data.attributes["given-name"],
          name: j.data.attributes["formatted-name"]
        }));
      mePromise = cached("orbit:me", 0, load, (fresh) => {
        mePromise.then((old) => {
          if (old.id !== fresh.id) {
            mePromise = Promise.resolve(fresh);
            window.dispatchEvent(new CustomEvent("orbit:user-changed"));
          }
        });
      });
    }
    return mePromise;
  }

  async function semesters() {
    return cached("orbit:semesters", 24 * 7 * HOUR, async () => {
      const j = await paged("semesters", 100);
      return j.data.map((s) => ({
        id: s.id,
        title: s.attributes.title,
        token: s.attributes.token,
        start: s.attributes.start,
        end: s.attributes.end,
        lecStart: s.attributes["start-of-lectures"],
        lecEnd: s.attributes["end-of-lectures"]
      }));
    });
  }

  async function currentSemester() {
    const list = await semesters();
    const now = Date.now();
    return list.find((s) => new Date(s.start) <= now && now <= new Date(s.end)) || null;
  }

  // boot.js reads this synchronously to tint course pages in "course" accent mode
  function rememberGroups(list) {
    const map = {};
    list.forEach((c) => { if (c.group != null) map[c.id] = c.group; });
    try { localStorage.setItem("orbit:groups", JSON.stringify(map)); } catch (e) {}
  }

  async function courses(onFresh) {
    const u = await me();
    const [sems, cur] = await Promise.all([semesters(), currentSemester()]);
    const semById = Object.fromEntries(sems.map((s) => [s.id, s]));
    const enrich = (list) =>
      list.map((c) => {
        const start = semById[c.startSem];
        const end = c.endSem ? semById[c.endSem] : null;
        const current =
          !!cur &&
          (!start || new Date(start.start) <= new Date(cur.start)) &&
          (!c.endSem || (end && new Date(end.end) >= new Date(cur.start)));
        return { ...c, current, semester: start ? start.token || start.title : "" };
      });

    const raw = await cached(
      `orbit:courses2:${u.id}`,
      6 * HOUR,
      async () => {
        const j = await paged(`users/${u.id}/course-memberships?include=course`, 100);
        // The membership carries the user's color group (0-8) from "My courses"
        const groups = {};
        j.data.forEach((m) => {
          const cid = m.relationships?.course?.data?.id;
          if (cid && m.attributes?.group != null) groups[cid] = Number(m.attributes.group);
        });
        return j.included
          .filter((x) => x.type === "courses")
          .map((c) => ({
            id: c.id,
            title: c.attributes.title,
            number: c.attributes["course-number"] || "",
            subtitle: c.attributes.subtitle || "",
            group: groups[c.id] ?? null,
            startSem: c.relationships?.["start-semester"]?.data?.id || null,
            endSem: c.relationships?.["end-semester"]?.data?.id || null
          }));
      },
      onFresh ? (v) => { rememberGroups(v); onFresh(enrich(v)); } : null,
      true
    );
    rememberGroups(raw);
    return enrich(raw);
  }

  function locText(loc) {
    if (!loc) return "";
    if (typeof loc === "string") return loc;
    if (Array.isArray(loc)) return loc.map(locText).filter(Boolean).join(", ");
    if (typeof loc === "object") return loc.name || loc.title || loc.room || loc.description || Object.values(loc).find((v) => typeof v === "string") || "";
    return "";
  }

  async function schedule(onFresh) {
    const u = await me();
    return cached(
      `orbit:schedule:${u.id}`,
      2 * HOUR,
      async () => {
        const j = await api(`users/${u.id}/schedule`);
        return (j.data || [])
          .filter((d) => d.attributes && d.attributes.start && d.attributes.weekday != null)
          .map((d) => {
            const a = d.attributes;
            const r = a.recurrence || {};
            return {
              id: d.id,
              title: a.title || "",
              description: a.description || "",
              start: a.start,
              end: a.end,
              weekday: Number(a.weekday),
              location: locText(a.locations),
              courseId: d.relationships?.owner?.data?.type === "courses" ? d.relationships.owner.data.id : null,
              from: r.DTSTART ? String(r.DTSTART).slice(0, 10) : null,
              until: r.UNTIL ? String(r.UNTIL).slice(0, 10) : null,
              interval: Number(r.INTERVAL || 1),
              exdates: (r.EXDATES || []).map((x) => String(x).slice(0, 10))
            };
          });
      },
      onFresh,
      true
    );
  }

  // Many courses keep their room as free text on single dates, which the JSON:API does not expose.
  // Read it from each course's dates page instead: { courseId: { "YYYY-MM-DD HH:MM": room } }
  const roomIndex = {};
  const pad2 = (n) => String(n).padStart(2, "0");

  function parseRooms(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = {};
    doc.querySelectorAll("#content table").forEach((table) => {
      const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim().toLowerCase());
      const timeCol = heads.findIndex((h) => /^(time|zeit)/.test(h));
      const roomCol = heads.findIndex((h) => /^(room|raum)/.test(h));
      if (timeCol < 0 || roomCol < 0) return;
      table.querySelectorAll("tbody tr").forEach((tr) => {
        const cells = tr.querySelectorAll("td");
        if (cells.length <= Math.max(timeCol, roomCol)) return;
        const m = cells[timeCol].textContent.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\D*?(\d{1,2}):(\d{2})/);
        const room = cells[roomCol].textContent.replace(/\s+/g, " ").trim();
        if (!m || !room || /keine|no room|ohne raum|not specified/i.test(room)) return;
        const year = m[3].length === 2 ? "20" + m[3] : m[3];
        out[`${year}-${pad2(m[2])}-${pad2(m[1])} ${pad2(m[4])}:${m[5]}`] = room;
      });
    });
    return out;
  }

  const cancelIndex = {};

  async function loadCourseDates(cid) {
    const [page, events] = await Promise.all([
      fetch(`${location.origin}/dispatch.php/course/dates?cid=${encodeURIComponent(cid)}`, { credentials: "same-origin" }).then((res) => {
        if (!res.ok) throw new Error(`Stud.IP dates ${res.status}`);
        return res.text();
      }),
      paged(`courses/${cid}/events`, 100).catch(() => ({ data: [] }))
    ]);
    const rooms = parseRooms(page);
    const cancelled = [];
    events.data.forEach((ev) => {
      const a = ev.attributes || {};
      const start = a.start ? new Date(a.start) : null;
      if (!start || isNaN(start)) return;
      const key = `${localDate(start)} ${pad2(start.getHours())}:${pad2(start.getMinutes())}`;
      if (a["is-cancelled"]) cancelled.push(key);
      else if (a.location && !rooms[key]) rooms[key] = a.location;
    });
    return { rooms, cancelled };
  }

  // Rooms and cancellations per course: { courseId: { rooms: { "YYYY-MM-DD HH:MM": room }, cancelled: [...] } }
  async function dates(courseIds, onFresh) {
    const ids = [...new Set(courseIds.filter(Boolean))];
    const store = (cid, v) => {
      roomIndex[cid] = v?.rooms || {};
      cancelIndex[cid] = new Set(v?.cancelled || []);
    };
    await Promise.all(
      ids.map((cid) =>
        cached(`orbit:dates:${cid}`, 6 * HOUR, () => loadCourseDates(cid), (fresh) => {
          store(cid, fresh);
          onFresh && onFresh();
        })
          .then((v) => store(cid, v))
          .catch(() => {})
      )
    );
    return roomIndex;
  }

  // The room a course usually uses on this weekday and time, so one-off moves stand out
  function usualRoom(courseId, weekday, time) {
    const map = roomIndex[courseId];
    if (!map) return "";
    const counts = {};
    for (const [key, room] of Object.entries(map)) {
      const [day, hm] = key.split(" ");
      if (hm !== time) continue;
      const wd = new Date(`${day}T12:00:00`).getDay();
      if (wd !== weekday % 7) continue;
      counts[room] = (counts[room] || 0) + 1;
    }
    let best = "", n = 0;
    for (const [room, c] of Object.entries(counts)) if (c > n) { best = room; n = c; }
    return n >= 2 ? best : "";
  }

  // Expand recurring cycle dates into concrete events for a given day
  function eventsOn(entries, day) {
    const iso = localDate(day);
    const wd = day.getDay();
    return entries
      .filter((e) => {
        if (!(e.weekday === wd || (wd === 0 && e.weekday === 7))) return false;
        if (e.from && iso < e.from) return false;
        if (e.until && iso > e.until) return false;
        if (e.exdates.includes(iso)) return false;
        if (e.interval > 1 && e.from) {
          const weeks = Math.round((new Date(iso) - new Date(e.from)) / (7 * 24 * HOUR));
          if (weeks % e.interval !== 0) return false;
        }
        return true;
      })
      .map((e) => {
        const [sh, sm] = e.start.split(":").map(Number);
        const [eh, em] = e.end.split(":").map(Number);
        const s = new Date(day); s.setHours(sh, sm, 0, 0);
        const t = new Date(day); t.setHours(eh, em, 0, 0);
        const time = `${pad2(sh)}:${pad2(sm)}`;
        const dated = roomIndex[e.courseId]?.[`${iso} ${time}`] || "";
        const room = dated || e.location || "";
        const usual = usualRoom(e.courseId, wd, time) || e.location || "";
        const cancelled = !!cancelIndex[e.courseId]?.has(`${iso} ${time}`);
        const roomChanged = !!(dated && usual && dated !== usual);
        return { ...e, location: room, usualRoom: usual, roomChanged, cancelled, startAt: s, endAt: t };
      })
      .sort((a, b) => a.startAt - b.startAt);
  }

  Orbit.data = { api, me, semesters, currentSemester, courses, schedule, dates, eventsOn, signedIn };
  const groupColor = (g) => (g == null ? null : `var(--group-color-${g})`);
  Orbit.util = { esc, hue, localDate, urls, groupColor };

  Orbit.settings = () => window.__orbitSettings || window.__orbitDefaults || {};
  Orbit.saveSetting = (patch) => chrome.storage.sync.set(patch);

  Orbit.lang = (document.documentElement.lang || navigator.language || "en").slice(0, 2);
  const T = {
    en: {
      morning: "Good morning", day: "Hello", evening: "Good evening", night: "Burning the midnight oil",
      today: "Today", tomorrow: "Tomorrow", schedule: "Schedule", nothing: "Nothing scheduled",
      free: "A free day. Use it well.", next: "Next up", live: "Live", left: "left", in: "in",
      week: "Week", of: "of", lectures: "Lecture period", break: "Lecture-free period",
      thisSem: "This semester", all: "All courses", files: "Files", members: "People",
      search: "Search", searchPh: "Jump to a course, page or action...", courses: "Courses",
      pages: "On this site", actions: "Actions", recent: "Recent", noRes: "No results",
      toggleDark: "Toggle dark mode", toggleSide: "Toggle sidebar", toggleAurora: "Toggle background glow",
      openSchedule: "Open weekly schedule", refresh: "Refresh theme data", refreshed: "Data refreshed",
      open: "open", newTab: "new tab", nav: "navigate", close: "close", noClass: "No more classes this week",
      classesToday: "classes today", inClass: "in class", doneAt: "done at", allDone: "all done for today",
      cancelled: "Cancelled", roomChanged: "Room changed", usually: "usually", changesToday: "changes today",
      startsIn: "starts in", minutes: "min",
      todo: "To-do", addTask: "Add a task, e.g. read chapter 4", noCourse: "No course", course: "Course",
      due: "Due date", add: "Add", open: "open", overdue: "Overdue", nothingTodo: "Nothing to do. Enjoy it.",
      showDone: "Show done", hideDone: "Hide done", clearDone: "Clear done", markDone: "Mark as done", delete: "Delete"
    },
    de: {
      morning: "Guten Morgen", day: "Hallo", evening: "Guten Abend", night: "Noch wach",
      today: "Heute", tomorrow: "Morgen", schedule: "Stundenplan", nothing: "Nichts geplant",
      free: "Ein freier Tag. Nutze ihn gut.", next: "Als Nächstes", live: "Läuft", left: "übrig", in: "in",
      week: "Woche", of: "von", lectures: "Vorlesungszeit", break: "Vorlesungsfreie Zeit",
      thisSem: "Dieses Semester", all: "Alle Veranstaltungen", files: "Dateien", members: "Teilnehmende",
      search: "Suche", searchPh: "Zu Veranstaltung, Seite oder Aktion springen...", courses: "Veranstaltungen",
      pages: "Auf dieser Seite", actions: "Aktionen", recent: "Zuletzt", noRes: "Keine Treffer",
      toggleDark: "Dunkelmodus umschalten", toggleSide: "Seitenleiste umschalten", toggleAurora: "Hintergrundleuchten umschalten",
      openSchedule: "Stundenplan öffnen", refresh: "Theme-Daten aktualisieren", refreshed: "Daten aktualisiert",
      open: "öffnen", newTab: "neuer Tab", nav: "navigieren", close: "schließen", noClass: "Diese Woche keine Termine mehr",
      classesToday: "Termine heute", inClass: "Präsenz", doneAt: "fertig um", allDone: "heute alles erledigt",
      cancelled: "Fällt aus", roomChanged: "Raum geändert", usually: "sonst", changesToday: "Änderungen heute",
      startsIn: "beginnt in", minutes: "Min.",
      todo: "Aufgaben", addTask: "Aufgabe hinzufügen, z. B. Kapitel 4 lesen", noCourse: "Keine Veranstaltung", course: "Veranstaltung",
      due: "Fällig am", add: "Hinzufügen", open: "offen", overdue: "Überfällig", nothingTodo: "Nichts zu tun. Genieß es.",
      showDone: "Erledigte zeigen", hideDone: "Erledigte ausblenden", clearDone: "Erledigte löschen", markDone: "Als erledigt markieren", delete: "Löschen"
    }
  };
  Orbit.t = (k) => (T[Orbit.lang] || T.en)[k] || T.en[k] || k;

  Orbit.toast = (msg) => {
    let el = document.querySelector(".sx-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "sx-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("is-on"), 1800);
  };

  Orbit.clearCache = () =>
    new Promise((r) =>
      chrome.storage.local.get(null, (all) => {
        const keys = Object.keys(all).filter((k) => k.startsWith("orbit:"));
        chrome.storage.local.remove(keys, r);
      })
    );
})();
