// To-do card on the start page. Tasks live in chrome.storage.sync so they follow the user across devices.
(() => {
  const Orbit = window.Orbit;
  if (!Orbit?.data) return;
  const isStart = document.body?.id === "start-index" || /\/dispatch\.php\/start\b/.test(location.pathname);
  if (!isStart) return;

  const { esc, groupColor, hue, localDate, urls } = Orbit.util;
  const t = Orbit.t;
  const KEY = "orbit:todos";
  const locale = Orbit.lang === "de" ? "de-DE" : "en-GB";

  let todos = [];
  let courses = [];
  let card = null;
  let showDone = false;

  const save = () => chrome.storage.sync.set({ [KEY]: todos });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function dueInfo(due) {
    if (!due) return null;
    const today = localDate(new Date());
    const tomorrow = localDate(new Date(Date.now() + 24 * 3600 * 1000));
    if (due < today) return { label: t("overdue"), cls: "is-overdue" };
    if (due === today) return { label: t("today"), cls: "is-today" };
    if (due === tomorrow) return { label: t("tomorrow"), cls: "" };
    const d = new Date(`${due}T12:00:00`);
    return { label: d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }), cls: "" };
  }

  function sorted() {
    const open = todos.filter((x) => !x.done).sort((a, b) => {
      if (a.due && b.due) return a.due.localeCompare(b.due) || a.created - b.created;
      if (a.due) return -1;
      if (b.due) return 1;
      return a.created - b.created;
    });
    const done = todos.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    return { open, done };
  }

  function itemHtml(x) {
    const course = courses.find((c) => c.id === x.course);
    const color = course ? groupColor(course.group) || `hsl(${hue(course.id)} 75% 55%)` : null;
    const due = dueInfo(x.due);
    const meta = [];
    if (course) {
      meta.push(`<a class="sx-todo-course" href="${esc(urls.overview(course.id))}" style="--c:${color}">${esc(course.title)}</a>`);
    }
    if (due && !x.done) meta.push(`<span class="sx-todo-due ${due.cls}">${esc(due.label)}</span>`);
    return `<li class="sx-todo-item ${x.done ? "is-done" : ""}" data-id="${esc(x.id)}">
      <button type="button" class="sx-todo-check" data-act="toggle" aria-pressed="${x.done}" title="${esc(t("markDone"))}"></button>
      <div class="sx-todo-body">
        <span class="sx-todo-text">${esc(x.text)}</span>
        ${meta.length ? `<span class="sx-todo-meta">${meta.join("")}</span>` : ""}
      </div>
      <button type="button" class="sx-todo-del" data-act="delete" title="${esc(t("delete"))}" aria-label="${esc(t("delete"))}">×</button>
    </li>`;
  }

  function confetti(anchor) {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const colors = ["var(--sx-accent)", "#ffd166", "#06d6a0", "#5b6cff", "#f43f7a"];
    for (let i = 0; i < 14; i++) {
      const p = document.createElement("span");
      p.className = "sx-confetti";
      const angle = Math.random() * Math.PI * 2;
      const dist = 26 + Math.random() * 34;
      p.style.left = `${r.left + r.width / 2}px`;
      p.style.top = `${r.top + r.height / 2}px`;
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * dist - 12}px`);
      p.style.setProperty("--rot", `${Math.round(Math.random() * 540 - 270)}deg`);
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  let freshId = null;

  function renderList() {
    if (!card) return;
    const { open, done } = sorted();
    const list = card.querySelector("[data-list]");
    let html = open.map(itemHtml).join("");
    if (freshId) html = html.replace(`data-id="${freshId}"`, `data-id="${freshId}" data-fresh`);
    if (!open.length) html = `<li class="sx-todo-empty">${esc(t("nothingTodo"))}</li>`;
    if (done.length) {
      html += `<li class="sx-todo-sep"><button type="button" data-act="show-done">${esc(showDone ? t("hideDone") : t("showDone"))} (${done.length})</button>
        <button type="button" data-act="clear-done">${esc(t("clearDone"))}</button></li>`;
      if (showDone) html += done.map(itemHtml).join("");
    }
    list.innerHTML = html;
    list.querySelector("[data-fresh]")?.classList.add("is-new");
    freshId = null;
    card.querySelector("[data-count]").textContent = open.length ? `${open.length} ${t("open")}` : "";
    // Share of finished tasks, shown as a thin bar under the title
    const progress = card.querySelector("[data-progress]");
    const total = open.length + done.length;
    progress.hidden = !total;
    progress.style.setProperty("--done", total ? `${Math.round((done.length / total) * 100)}%` : "0%");
    progress.title = `${done.length} / ${total}`;
  }

  function renderCourseOptions() {
    if (!card) return;
    const select = card.querySelector("[data-course]");
    const current = select.value;
    const list = courses.filter((c) => c.current).sort((a, b) => a.title.localeCompare(b.title));
    select.innerHTML =
      `<option value="">${esc(t("noCourse"))}</option>` +
      list.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("");
    select.value = current;
  }

  function mount() {
    const s = Orbit.settings();
    const slot = document.querySelector('.sx-today [data-slot="todo"]');
    if (!s.enabled || !s.today || !slot) {
      card?.remove();
      card = null;
      return;
    }
    if (card && card.isConnected) return;
    card = document.createElement("section");
    card.className = "sx-card sx-todo";
    card.innerHTML = `
      <div class="sx-todo-head">
        <h2>${esc(t("todo"))} <span class="sx-todo-count" data-count></span></h2>
        <div class="sx-todo-progress" data-progress hidden><span></span></div>
      </div>
      <form class="sx-todo-form" data-form autocomplete="off">
        <input type="text" data-text maxlength="200" placeholder="${esc(t("addTask"))}" aria-label="${esc(t("addTask"))}">
        <select data-course aria-label="${esc(t("course"))}"></select>
        <input type="date" data-due aria-label="${esc(t("due"))}">
        <button type="submit">${esc(t("add"))}</button>
      </form>
      <ul class="sx-todo-list" data-list></ul>`;
    slot.appendChild(card);

    card.querySelector("[data-form]").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = card.querySelector("[data-text]");
      const text = input.value.trim();
      if (!text) return;
      freshId = uid();
      todos.push({
        id: freshId,
        text,
        course: card.querySelector("[data-course]").value || null,
        due: card.querySelector("[data-due]").value || null,
        done: false,
        created: Date.now()
      });
      input.value = "";
      card.querySelector("[data-due]").value = "";
      save();
      renderList();
      input.focus();
    });

    card.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "show-done") { showDone = !showDone; renderList(); return; }
      if (act === "clear-done") { todos = todos.filter((x) => !x.done); save(); renderList(); return; }
      const id = btn.closest("[data-id]")?.dataset.id;
      const item = todos.find((x) => x.id === id);
      if (!item) return;
      const row = btn.closest("[data-id]");
      const animate = document.documentElement.classList.contains("sx-motion");
      if (act === "toggle") {
        item.done = !item.done;
        item.doneAt = item.done ? Date.now() : null;
        if (item.done && animate) {
          // Let the tick and strike play before the task moves to the done section
          row.querySelector(".sx-todo-check").setAttribute("aria-pressed", "true");
          row.classList.add("is-completing");
          confetti(row.querySelector(".sx-todo-check"));
          setTimeout(() => row.classList.add("is-leaving"), 420);
          setTimeout(() => { save(); renderList(); }, 700);
          return;
        }
      }
      if (act === "delete" && animate) {
        todos = todos.filter((x) => x.id !== id);
        row.classList.add("is-leaving");
        setTimeout(() => { save(); renderList(); }, 280);
        return;
      }
      if (act === "delete") todos = todos.filter((x) => x.id !== id);
      save();
      renderList();
    });

    renderCourseOptions();
    renderList();
  }

  chrome.storage.sync.get({ [KEY]: [] }, (v) => {
    todos = Array.isArray(v[KEY]) ? v[KEY] : [];
    renderList();
  });

  // Keep several open tabs in sync
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[KEY]) return;
    todos = changes[KEY].newValue || [];
    renderList();
  });

  // The Today panel is created by today.js; wait for it before mounting
  let tries = 0;
  const waitForToday = () => {
    if (document.querySelector('.sx-today [data-slot="todo"]')) mount();
    else if (++tries < 40) setTimeout(waitForToday, 150);
  };
  waitForToday();
  window.addEventListener("orbit:settings", () => setTimeout(mount, 0));

  Orbit.data
    .courses((fresh) => { courses = fresh; renderCourseOptions(); renderList(); })
    .then((v) => { courses = v; renderCourseOptions(); renderList(); })
    .catch(() => {});
})();
