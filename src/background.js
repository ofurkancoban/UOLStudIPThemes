// Background worker: sends a reminder shortly before each class published by notify.js.
const ALARM = "orbit-reminders";
const DEFAULTS = { enabled: true, notify: true, notifyLead: "10" };

function ensureAlarm() {
  chrome.alarms.get(ALARM, (a) => {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 0.1 });
  });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();

async function check() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  if (!settings.enabled || !settings.notify) return;
  const lead = Number(settings.notifyLead) || 10;
  const store = await chrome.storage.local.get(["orbit:upcoming", "orbit:notified"]);
  const data = store["orbit:upcoming"];
  if (!data?.items?.length) return;
  const notified = store["orbit:notified"] || {};
  const now = Date.now();

  for (const item of data.items) {
    const msLeft = item.start - now;
    if (msLeft <= 0 || msLeft > lead * 60000 || notified[item.key]) continue;
    const mins = Math.max(1, Math.round(msLeft / 60000));
    const labels = data.labels || {};
    notified[item.key] = item.start;
    await chrome.notifications.create(`orbit|${item.key}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: `${item.name}`,
      message: `${labels.startsIn || "starts in"} ${mins} ${labels.minutes || "min"} · ${item.line}`,
      priority: 1
    });
    await chrome.storage.local.set({ [`orbit:notify-url:${item.key}`]: item.url });
  }

  // Forget reminders for classes that ended a day ago
  for (const [key, start] of Object.entries(notified)) {
    if (start < now - 24 * 3600 * 1000) {
      delete notified[key];
      chrome.storage.local.remove(`orbit:notify-url:${key}`);
    }
  }
  await chrome.storage.local.set({ "orbit:notified": notified });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) check().catch(() => {});
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith("orbit|")) return;
  const key = id.slice("orbit|".length);
  const urlKey = `orbit:notify-url:${key}`;
  const store = await chrome.storage.local.get(urlKey);
  if (store[urlKey]) chrome.tabs.create({ url: store[urlKey] });
  chrome.notifications.clear(id);
});
