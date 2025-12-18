const $ = (id) => document.getElementById(id);
const state = { events: [] };
const EXPIRING_TYPES = ["renewal", "termination", "auto_opt_out"];

function getApiBase() {
  return localStorage.getItem("apiBase") || "http://localhost:8080";
}
function setApiBase(v) {
  localStorage.setItem("apiBase", v);
}

function badge(status) {
  const s = (status || "").toLowerCase();
  if (s === "processed") return `<span class="badge green">processed</span>`;
  if (s === "error") return `<span class="badge red">error</span>`;
  return `<span class="badge yellow">${status || "unknown"}</span>`;
}

async function apiFetch(path, opts = {}) {
  const base = getApiBase();
  const url = `${base}${path}`;
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.detail) msg += ` — ${j.detail}`;
    } catch {}
    throw new Error(msg);
  }
  return res;
}

function formatDate(dateStr) {
  if (!dateStr) return "Unknown date";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function daysUntil(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = d.getTime() - today.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function defaultMonthValue() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${month}`;
}

function setApiUi() {
  $("apiBase").value = getApiBase();
  $("apiStatus").textContent = "";
}

async function testApi() {
  $("apiStatus").textContent = "Testing...";
  try {
    await apiFetch("/openapi.json");
    $("apiStatus").textContent = "OK";
  } catch (e) {
    $("apiStatus").textContent = `FAIL: ${e.message}`;
  }
}

async function loadRecent() {
  const tbody = $("contracts");
  tbody.innerHTML = `<tr><td colspan="4" class="muted">Loading…</td></tr>`;

  const res = await apiFetch(`/api/search?mode=quick&q=&limit=100`);
  const rows = await res.json();

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">No contracts yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const id = r.id;
    const title = r.title || r.original_filename || id;
    const uploaded = r.uploaded_at || "";
    return `
      <tr>
        <td>${badge(r.status)}</td>
        <td><a href="#" data-id="${id}" class="open">${title}</a></td>
        <td class="small">${uploaded}</td>
        <td class="small">
          <a href="${getApiBase()}/api/contracts/${id}/original" target="_blank">View</a>
          &nbsp;|&nbsp;
          <a href="${getApiBase()}/api/contracts/${id}/download" target="_blank">Download</a>
        </td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll("a.open").forEach(a => {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await loadDetail(a.dataset.id);
    });
  });
}

async function loadDetail(id) {
  $("detail").innerHTML = "Loading…";
  try {
    const res = await apiFetch(`/api/contracts/${id}`);
    const data = await res.json();

    const c = data.contract || {};
    const terms = data.terms || [];
    const events = data.events || [];

    $("detail").innerHTML = `
      <div><b>${c.title || id}</b></div>
      <div class="small muted">ID: ${c.id || id}</div>
      <div style="margin-top:8px">Status: ${badge(c.status)}</div>

      <hr />

      <div><b>Terms</b></div>
      ${terms.length ? `
        <ul>
          ${terms.map(t => `<li><b>${t.name}</b>: ${t.value_normalized || t.value_raw || ""} <span class="muted small">(${t.status || ""}, ${t.confidence ?? ""})</span></li>`).join("")}
        </ul>
      ` : `<div class="muted small">No extracted terms.</div>`}

      <div style="margin-top:10px"><b>Events</b></div>
      ${events.length ? `
        <ul>
          ${events.map(e => `<li><b>${e.event_type}</b>: ${e.event_date}</li>`).join("")}
        </ul>
      ` : `<div class="muted small">No events.</div>`}
    `;
  } catch (e) {
    $("detail").innerHTML = `<div class="badge red">error</div><pre>${e.message}</pre>`;
  }
}

async function uploadFiles(files) {
  const log = $("uploadLog");
  for (const file of files) {
    log.innerHTML = `Uploading: <b>${file.name}</b>…`;
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await apiFetch(`/api/contracts/upload`, {
        method: "POST",
        body: fd
      });

      const j = await res.json();
      log.innerHTML = `Uploaded: <b>${file.name}</b> → ${badge(j.status)} <span class="muted small">${j.contract_id}</span>`;
      await loadRecent();
    } catch (e) {
      log.innerHTML = `<span class="badge red">error</span> ${file.name}: ${e.message}`;
    }
  }
}

function initDropzone() {
  const drop = $("drop");
  const picker = $("filePicker");

  drop.addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => uploadFiles(picker.files));

  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });
}

function eventTypePill(type) {
  const label = type || "event";
  return `<span class="pill event-type">${label}</span>`;
}

function reminderText(reminder) {
  if (!reminder) return "Reminders not configured.";
  if (!reminder.enabled) return "Reminders disabled.";
  const offsets = reminder.offsets?.length ? `Offsets: ${reminder.offsets.join(", ")} days.` : "";
  const recipients = reminder.recipients?.length ? `Recipients: ${reminder.recipients.join(", ")}` : "";
  return `${offsets} ${recipients}`.trim() || "Reminders enabled.";
}

function renderEvents() {
  const list = $("eventsList");
  if (!list) return;

  const search = ($("eventSearch")?.value || "").toLowerCase();
  const expiringOnly = $("expiringOnly")?.checked;

  const filtered = state.events.filter((ev) => {
    const term = `${ev.title || ""} ${ev.vendor || ""} ${ev.event_type || ""} ${ev.derived_from_term_key || ""}`.toLowerCase();
    const matchesSearch = !search || term.includes(search);
    const matchesExpiring = !expiringOnly || EXPIRING_TYPES.includes((ev.event_type || "").toLowerCase());
    return matchesSearch && matchesExpiring;
  });

  const status = $("eventsStatus");
  if (!filtered.length) {
    list.innerHTML = `<div class="muted">No events match your filters for this month.</div>`;
    if (status) status.textContent = `Showing 0 of ${state.events.length} events.`;
    return;
  }

  const grouped = new Map();
  filtered.forEach((ev) => {
    if (!grouped.has(ev.contract_id)) {
      grouped.set(ev.contract_id, {
        contractId: ev.contract_id,
        title: ev.title || ev.contract_id,
        vendor: ev.vendor || "Unknown vendor",
        agreement_type: ev.agreement_type || "",
        events: [],
      });
    }
    grouped.get(ev.contract_id).events.push(ev);
  });

  const folders = Array.from(grouped.values());
  folders.forEach((f) => f.events.sort((a, b) => (a.event_date || "").localeCompare(b.event_date || "")));

  list.innerHTML = folders.map((f) => {
    const eventsHtml = f.events.map((ev) => {
      const days = daysUntil(ev.event_date);
      const relative = days === null ? "" : days === 0 ? "Today" : days > 0 ? `In ${days} day${days === 1 ? "" : "s"}` : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
      return `
        <div class="event-row">
          <div class="event-date">${formatDate(ev.event_date)}<div class="small muted">${relative}</div></div>
          <div style="flex:1">
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              ${eventTypePill(ev.event_type)}
              ${ev.derived_from_term_key ? `<span class="pill">From ${ev.derived_from_term_key}</span>` : ""}
            </div>
            <div class="small muted" style="margin-top:4px;">${reminderText(ev.reminder)}</div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="folder-card">
        <div class="folder-header">
          <div>
            <div class="folder-title">${f.title}</div>
            <div class="muted small">${f.vendor}</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            ${f.agreement_type ? `<span class="pill">${f.agreement_type}</span>` : ""}
            <span class="pill">${f.events.length} event${f.events.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div class="folder-body">
          ${eventsHtml}
        </div>
      </div>
    `;
  }).join("");

  if (status) {
    status.textContent = `Showing ${filtered.length} event${filtered.length === 1 ? "" : "s"} across ${folders.length} contract${folders.length === 1 ? "" : "s"}.`;
  }
}

async function loadEvents() {
  const list = $("eventsList");
  if (!list) return;
  const month = $("eventMonth")?.value || defaultMonthValue();
  const eventType = $("eventTypeFilter")?.value || "all";
  const sort = $("eventSort")?.value || "date_asc";

  if ($("eventMonth")) $("eventMonth").value = month;

  list.innerHTML = `<div class="muted">Loading events…</div>`;
  const status = $("eventsStatus");
  if (status) status.textContent = "";

  try {
    const res = await apiFetch(`/api/events?month=${encodeURIComponent(month)}&event_type=${encodeURIComponent(eventType)}&sort=${encodeURIComponent(sort)}`);
    state.events = await res.json();
    renderEvents();
  } catch (e) {
    list.innerHTML = `<div class="badge red">error</div><pre>${e.message}</pre>`;
  }
}

function showPage(page) {
  const contractsPage = $("contractsPage");
  const eventsPage = $("eventsPage");
  const isContracts = page === "contracts";

  contractsPage?.classList.toggle("hidden", !isContracts);
  eventsPage?.classList.toggle("hidden", isContracts);

  $("navContracts")?.classList.toggle("active", isContracts);
  $("navEvents")?.classList.toggle("active", !isContracts);

  if (!isContracts && !state.events.length) {
    loadEvents();
  }
}

function initEventsUi() {
  if ($("eventMonth")) $("eventMonth").value = defaultMonthValue();
  $("eventMonth")?.addEventListener("change", loadEvents);
  $("eventTypeFilter")?.addEventListener("change", loadEvents);
  $("eventSort")?.addEventListener("change", loadEvents);
  $("eventSearch")?.addEventListener("input", renderEvents);
  $("expiringOnly")?.addEventListener("change", renderEvents);
  $("eventsRefresh")?.addEventListener("click", loadEvents);
}

$("navContracts")?.addEventListener("click", () => showPage("contracts"));
$("navEvents")?.addEventListener("click", () => showPage("events"));

$("saveApi").addEventListener("click", async () => {
  setApiBase($("apiBase").value.trim());
  setApiUi();
  await testApi();
  await loadRecent();
});

$("refresh").addEventListener("click", loadRecent);

setApiUi();
initDropzone();
initEventsUi();
showPage("contracts");
testApi().then(loadRecent);
