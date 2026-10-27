// Publishes the classes of the next days to chrome.storage so the background worker can send reminders.
(() => {
  const Orbit = window.Orbit;
  if (!Orbit?.data) return;
  const { urls } = Orbit.util;
  const DAY = 24 * 3600 * 1000;
  const locale = Orbit.lang === "de" ? "de-DE" : "en-GB";
  const hhmm = (d) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  async function publish() {
    if (!document.documentElement.classList.contains("sx") || !Orbit.data.signedIn()) return;
    // A changed schedule (for example a dropped course) republishes right away
    const schedule = await Orbit.data.schedule(() => publish().catch(() => {}));
    const [courses] = await Promise.all([
      Orbit.data.courses().catch(() => []),
      Orbit.data.dates(schedule.map((e) => e.courseId)).catch(() => null)
    ]);
    const titleOf = (ev) => courses.find((c) => c.id === ev.courseId)?.title || ev.title.replace(/^[\d.]+\s+/, "");
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const now = Date.now();
    const upcoming = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(start.getTime() + i * DAY);
      for (const ev of Orbit.data.eventsOn(schedule, day)) {
        if (ev.cancelled || ev.startAt.getTime() < now) continue;
        const room = ev.roomChanged
          ? `${Orbit.t("roomChanged")}: ${ev.location} (${Orbit.t("usually")} ${ev.usualRoom})`
          : ev.location;
        upcoming.push({
          key: `${ev.courseId || ev.title}|${ev.startAt.toISOString()}`,
          name: titleOf(ev),
          line: [`${hhmm(ev.startAt)}–${hhmm(ev.endAt)}`, room].filter(Boolean).join(" · "),
          start: ev.startAt.getTime(),
          url: ev.courseId ? urls.overview(ev.courseId) : urls.schedule()
        });
      }
    }
    chrome.storage.local.set({
      "orbit:upcoming": {
        ts: now,
        items: upcoming,
        labels: { startsIn: Orbit.t("startsIn"), minutes: Orbit.t("minutes"), now: Orbit.t("live") }
      }
    });
  }

  publish().catch((e) => console.warn("[Orbit] reminders", e));
})();
