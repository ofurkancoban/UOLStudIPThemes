const DEFAULTS = {
  enabled: true,
  mode: "auto",
  accent: "#ff5a36",
  density: "comfy",
  rail: false,
  today: true,
  aurora: true,
  accentMode: "fixed",
  notify: true,
  notifyLead: "10",
  motion: true
};

const PRESETS = ["#ff5a36", "#f43f7a", "#a855f7", "#5b6cff", "#0ea5e9", "#10b981", "#eab308", "#64748b"];

const $ = (s) => document.querySelector(s);
let state = { ...DEFAULTS };

function save(patch) {
  state = { ...state, ...patch };
  chrome.storage.sync.set(patch);
  paint();
}

function paint() {
  document.documentElement.style.setProperty("--accent", state.accent);
  $("#enabled").checked = state.enabled;
  $("#panel").classList.toggle("off", !state.enabled);
  document.querySelectorAll(".seg").forEach((seg) => {
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.val === state[seg.dataset.key]));
  });
  document.querySelectorAll(".swatches button").forEach((b) => b.classList.toggle("on", b.dataset.val.toLowerCase() === state.accent.toLowerCase()));
  document.querySelectorAll("input[data-key]").forEach((i) => (i.checked = !!state[i.dataset.key]));
  $("#swatches").classList.toggle("muted", state.accentMode === "time");
  $("#lead").classList.toggle("off", !state.notify);
}

function build() {
  const sw = $("#swatches");
  for (const c of PRESETS) {
    const b = document.createElement("button");
    b.style.background = c;
    b.style.color = c;
    b.dataset.val = c;
    b.title = c;
    b.addEventListener("click", () => save({ accent: c }));
    sw.appendChild(b);
  }
  const custom = document.createElement("label");
  custom.title = "Custom color";
  custom.innerHTML = '<input type="color">';
  custom.querySelector("input").addEventListener("input", (e) => save({ accent: e.target.value }));
  sw.appendChild(custom);

  document.querySelectorAll(".seg").forEach((seg) =>
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) save({ [seg.dataset.key]: b.dataset.val });
    })
  );
  document.querySelectorAll("input[data-key]").forEach((i) =>
    i.addEventListener("change", () => save({ [i.dataset.key]: i.checked }))
  );
  $("#enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
}

build();
chrome.storage.sync.get(DEFAULTS, (s) => {
  state = s;
  paint();
});
