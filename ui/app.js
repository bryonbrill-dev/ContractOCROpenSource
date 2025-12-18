const $ = (id) => document.getElementById(id);
const state = { events: [], termDefinitions: [], tags: [], agreementTypes: [], planner: [], currentContractId: null };
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

function parseCsv(str = "") {
  return (str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseOffsets(str = "") {
  return (str || "")
    .split(",")
    .map((n) => parseInt(n.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
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

async function loadLookups() {
  const [typesRes, termsRes, tagsRes] = await Promise.all([
    apiFetch("/api/agreement-types"),
    apiFetch("/api/term-definitions"),
    apiFetch("/api/tags"),
  ]);
  state.agreementTypes = await typesRes.json();
  state.termDefinitions = await termsRes.json();
  state.tags = await tagsRes.json();
}

async function refreshTags() {
  const res = await apiFetch("/api/tags");
  state.tags = await res.json();
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
  if (!state.agreementTypes.length || !state.termDefinitions.length || !state.tags.length) {
    await loadLookups();
  }
  state.currentContractId = id;
  $("detail").innerHTML = "Loading…";
  try {
    const res = await apiFetch(`/api/contracts/${id}`);
    const data = await res.json();

    const c = data.contract || {};
    const terms = data.terms || [];
    const events = data.events || [];

    const termOptions = state.termDefinitions
      .map((t) => `<option value="${t.key}">${t.name} (${t.value_type})</option>`)
      .join("");

    const tagChips = (data.tags || [])
      .map((t) => `<span class="pill" style="background:${t.color}; color:#fff;">${t.name}${t.auto_generated ? " (auto)" : ""} <button data-tag="${t.id}" class="removeTag" style="margin-left:6px;">✕</button></span>`)
      .join(" ") || `<span class="muted small">No tags yet.</span>`;

    const eventRows = events.length
      ? events
          .map((e) => {
            const reminder = data.reminders?.[e.id];
            return `
              <div class="event-row">
                <div class="event-date">${formatDate(e.event_date)}</div>
                <div style="flex:1">
                  <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    ${eventTypePill(e.event_type)}
                    ${e.derived_from_term_key ? `<span class="pill">From ${e.derived_from_term_key}</span>` : ""}
                  </div>
                  <div class="small muted" style="margin-top:4px;">${reminderText(reminder)}</div>
                  <button class="small editReminder" data-event="${e.id}">Configure reminders</button>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="muted small">No events.</div>`;

    $("detail").innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">
        <div>
          <div><b>${c.title || id}</b></div>
          <div class="small muted">ID: ${c.id || id}</div>
        </div>
        <div>${badge(c.status)}</div>
      </div>

      <div class="card" style="margin-top:10px; background:#f8f9ff;">
        <div class="row wrap" style="gap:10px;">
          <label class="small" style="flex:1; min-width:180px;">Title
            <input id="metaTitle" value="${c.title || ""}" style="width:100%;" />
          </label>
          <label class="small" style="flex:1; min-width:180px;">Vendor
            <input id="metaVendor" value="${c.vendor || ""}" style="width:100%;" />
          </label>
          <label class="small" style="flex:1; min-width:180px;">Agreement Type
            <select id="metaAgreement" style="width:100%;">
              ${state.agreementTypes.map((t) => `<option value="${t}" ${t === (c.agreement_type || "Uncategorized") ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </label>
        </div>
        <button id="saveMeta" style="margin-top:10px;">Save contract info</button>
      </div>

      <div style="margin-top:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <b>Tags</b>
        </div>
        <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">${tagChips}</div>
        <div class="row wrap" style="gap:6px; margin-top:8px; align-items:center;">
          <select id="tagSelect" style="min-width:160px;">
            <option value="">Add existing tag…</option>
            ${state.tags.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}
          </select>
          <input id="newTagName" placeholder="or create new tag" style="flex:1; min-width:160px;" />
          <input id="newTagColor" type="color" value="#3b82f6" />
          <button id="addTagBtn">Add tag</button>
        </div>
      </div>

      <div style="margin-top:12px;">
        <div><b>Terms</b></div>
        ${terms.length ? `
          <ul>
            ${terms.map(t => `<li><b>${t.name}</b>: ${t.value_normalized || t.value_raw || ""} <span class="muted small">(${t.status || ""}, ${t.confidence ?? ""})</span></li>`).join("")}
          </ul>
        ` : `<div class="muted small">No extracted terms. Add one manually below.</div>`}
        <div class="row wrap" style="gap:8px; margin-top:8px; align-items:flex-end;">
          <label class="small" style="min-width:200px;">Term
            <select id="termKey" style="width:100%">${termOptions}</select>
          </label>
          <label class="small" style="flex:1; min-width:200px;">Value
            <input id="termValue" placeholder="Enter value (date, text, etc.)" style="width:100%;" />
          </label>
          <button id="saveTermBtn">Save term</button>
        </div>
        <div class="muted small" style="margin-top:4px;">Date terms will also create matching events automatically.</div>
      </div>

      <div style="margin-top:12px;">
        <div><b>Events</b></div>
        ${eventRows}
        <div class="row wrap" style="gap:8px; margin-top:10px; align-items:flex-end;">
          <label class="small" style="min-width:160px;">Event type
            <input id="eventTypeInput" list="eventTypeList" placeholder="renewal, termination, custom…" style="width:100%;" />
          </label>
          <label class="small" style="min-width:160px;">Event date
            <input id="eventDateInput" type="date" style="width:100%;" />
          </label>
          <label class="small" style="flex:1; min-width:200px;">Reminder recipients (comma separated)
            <input id="eventReminderRecipients" placeholder="email1@example.com, email2@example.com" style="width:100%;" />
          </label>
          <label class="small" style="min-width:160px;">Reminder offsets (days)
            <input id="eventReminderOffsets" placeholder="90,60,30" style="width:100%;" />
          </label>
          <label class="small" style="display:flex; align-items:center; gap:4px; min-width:120px;">
            <input type="checkbox" id="eventReminderEnabled" checked />
            Enable reminders
          </label>
          <button id="addEventBtn">Add / update event</button>
        </div>
      </div>

      <datalist id="eventTypeList">
        <option value="effective"></option>
        <option value="renewal"></option>
        <option value="termination"></option>
        <option value="auto_opt_out"></option>
        <option value="review"></option>
      </datalist>
    `;

    $("saveMeta")?.addEventListener("click", async () => {
      const payload = {
        title: $("metaTitle").value,
        vendor: $("metaVendor").value,
        agreement_type: $("metaAgreement").value,
      };
      await apiFetch(`/api/contracts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadRecent();
      await loadDetail(id);
    });

    document.querySelectorAll(".removeTag").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await apiFetch(`/api/contracts/${id}/tags/${btn.dataset.tag}`, { method: "DELETE" });
        await loadDetail(id);
      });
    });

    $("addTagBtn")?.addEventListener("click", async () => {
      const existingId = $("tagSelect").value;
      const newName = $("newTagName").value.trim();
      try {
        if (newName) {
          await apiFetch(`/api/contracts/${id}/tags/custom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName, color: $("newTagColor").value }),
          });
          await refreshTags();
        } else if (existingId) {
          await apiFetch(`/api/contracts/${id}/tags/${existingId}`, { method: "POST" });
        } else {
          alert("Choose an existing tag or enter a new tag name.");
          return;
        }
      } catch (e) {
        alert(e.message);
      }
      await loadDetail(id);
    });

    $("saveTermBtn")?.addEventListener("click", async () => {
      const termKey = $("termKey").value;
      const value = $("termValue").value.trim();
      if (!value) {
        alert("Please enter a value for the term.");
        return;
      }
      await apiFetch(`/api/contracts/${id}/terms/upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term_key: termKey, value }),
      });
      await loadDetail(id);
      await loadEvents();
    });

    $("addEventBtn")?.addEventListener("click", async () => {
      const event_type = $("eventTypeInput").value.trim() || "custom";
      const event_date = $("eventDateInput").value;
      if (!event_date) {
        alert("Please select an event date.");
        return;
      }
      const recipients = parseCsv($("eventReminderRecipients").value);
      const offsets = parseOffsets($("eventReminderOffsets").value || "90,60,30");
      const reminderPayload = recipients.length
        ? { recipients, offsets, enabled: $("eventReminderEnabled").checked }
        : null;

      await apiFetch(`/api/contracts/${id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type, event_date, reminder: reminderPayload }),
      });
      await loadDetail(id);
      await loadEvents();
    });

    document.querySelectorAll(".editReminder").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const reminder = data.reminders?.[btn.dataset.event];
        const rec = prompt("Recipients (comma separated)", reminder?.recipients?.join(", ") || "");
        if (rec === null) return;
        const off = prompt("Offsets in days (comma separated)", (reminder?.offsets || [90, 60, 30]).join(", "));
        if (off === null) return;
        const payload = {
          recipients: parseCsv(rec),
          offsets: parseOffsets(off),
          enabled: true,
        };
        try {
          await apiFetch(`/api/events/${btn.dataset.event}/reminders`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          await loadDetail(id);
        } catch (e) {
          alert(e.message);
        }
      });
    });
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

async function loadPlanner() {
  const list = $("plannerList");
  if (!list) return;
  list.innerHTML = `<div class="muted">Loading planner…</div>`;
  try {
    const res = await apiFetch("/api/contracts-with-events?limit=200");
    state.planner = await res.json();
    renderPlanner();
  } catch (e) {
    list.innerHTML = `<div class="badge red">error</div><pre>${e.message}</pre>`;
  }
}

async function savePlannerEvent(contractId, container) {
  const typeInput = container.querySelector(".plannerEventType");
  const dateInput = container.querySelector(".plannerEventDate");
  const recipientsInput = container.querySelector(".plannerRecipients");
  const offsetsInput = container.querySelector(".plannerOffsets");
  const enabledInput = container.querySelector(".plannerEnable");

  const event_type = (typeInput?.value || "").trim() || "review";
  const event_date = dateInput?.value;
  if (!event_date) {
    alert("Please choose an event date.");
    return;
  }
  const recipients = parseCsv(recipientsInput?.value);
  const offsets = parseOffsets(offsetsInput?.value || "90,60,30");
  const reminder = recipients.length
    ? { recipients, offsets, enabled: enabledInput?.checked ?? true }
    : null;

  await apiFetch(`/api/contracts/${contractId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type, event_date, reminder }),
  });
  await loadPlanner();
  await loadEvents();
}

function renderPlanner() {
  const list = $("plannerList");
  if (!list) return;
  if (!state.planner.length) {
    list.innerHTML = `<div class="muted">No contracts available yet.</div>`;
    return;
  }

  list.innerHTML = state.planner
    .map((c) => {
      const eventsHtml = (c.events || [])
        .map(
          (ev) => `
            <div class="event-row">
              <div class="event-date">${formatDate(ev.event_date)}</div>
              <div style="flex:1">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                  ${eventTypePill(ev.event_type)}
                  ${ev.derived_from_term_key ? `<span class="pill">From ${ev.derived_from_term_key}</span>` : ""}
                </div>
                <div class="small muted" style="margin-top:4px;">${reminderText(ev.reminder)}</div>
              </div>
            </div>
          `
        )
        .join("");

      return `
        <div class="folder-card">
          <div class="folder-header">
            <div>
              <div class="folder-title">${c.title}</div>
              <div class="muted small">${c.vendor || "Unknown vendor"} • ${c.agreement_type || "Uncategorized"}</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <span class="pill">${c.events.length} event${c.events.length === 1 ? "" : "s"}</span>
              <button class="open" data-id="${c.id}">Open</button>
            </div>
          </div>
          <div class="folder-body">
            ${eventsHtml || `<div class="muted small">No events yet.</div>`}
            <div class="row wrap" style="gap:8px; margin-top:8px; align-items:flex-end;" data-contract="${c.id}">
              <label class="small" style="min-width:160px;">Event type
                <input class="plannerEventType" list="eventTypeList" placeholder="renewal, termination, etc." style="width:100%;" />
              </label>
              <label class="small" style="min-width:160px;">Event date
                <input class="plannerEventDate" type="date" style="width:100%;" />
              </label>
              <label class="small" style="flex:1; min-width:200px;">Reminder recipients
                <input class="plannerRecipients" placeholder="email1@example.com, email2@example.com" style="width:100%;" />
              </label>
              <label class="small" style="min-width:150px;">Offsets (days)
                <input class="plannerOffsets" placeholder="90,60,30" style="width:100%;" />
              </label>
              <label class="small" style="display:flex; align-items:center; gap:4px; min-width:120px;">
                <input type="checkbox" class="plannerEnable" checked /> Enable reminders
              </label>
              <button class="plannerSave" data-id="${c.id}">Save event</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("#plannerList button.open").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await loadDetail(btn.dataset.id);
      showPage("contracts");
    });
  });

  document.querySelectorAll(".plannerSave").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("[data-contract]");
      await savePlannerEvent(btn.dataset.id, row);
    });
  });
}

function showPage(page) {
  const pages = {
    contracts: $("contractsPage"),
    events: $("eventsPage"),
    planner: $("plannerPage"),
  };

  Object.entries(pages).forEach(([key, el]) => {
    el?.classList.toggle("hidden", key !== page);
  });

  $("navContracts")?.classList.toggle("active", page === "contracts");
  $("navEvents")?.classList.toggle("active", page === "events");
  $("navPlanner")?.classList.toggle("active", page === "planner");

  if (page === "events" && !state.events.length) {
    loadEvents();
  }
  if (page === "planner") {
    loadPlanner();
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
$("navPlanner")?.addEventListener("click", () => showPage("planner"));

$("saveApi").addEventListener("click", async () => {
  setApiBase($("apiBase").value.trim());
  setApiUi();
  await testApi();
  await loadRecent();
});

$("refresh").addEventListener("click", loadRecent);
$("plannerRefresh")?.addEventListener("click", loadPlanner);

setApiUi();
initDropzone();
initEventsUi();
showPage("contracts");
testApi()
  .then(loadLookups)
  .then(() => {
    loadRecent();
    loadEvents();
  })
  .catch((e) => {
    console.error(e);
  });
