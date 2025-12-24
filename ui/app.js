const $ = (id) => document.getElementById(id);
const state = {
  events: [],
  plannerEvents: [],
  definitions: [],
  tags: [],
  agreementTypes: [],
  contracts: [],
  allContracts: [],
  allContractsQuery: "",
  allContractsOffset: 0,
  allContractsLimit: 200,
  currentPage: "contracts",
};
const EXPIRING_TYPES = ["renewal", "termination", "auto_opt_out"];
const TERM_EVENT_MAP = {
  effective_date: "effective",
  renewal_date: "renewal",
  termination_date: "termination",
  auto_renew_opt_out_date: "auto_opt_out",
};
const STANDARD_EVENT_TYPES = ["renewal", "termination", "effective", "auto_opt_out"];
const modalState = { resolver: null, showCancel: false };

function getModalElements() {
  return {
    overlay: $("modalOverlay"),
    title: $("modalTitle"),
    message: $("modalMessage"),
    confirm: $("modalConfirm"),
    cancel: $("modalCancel"),
    close: $("modalClose"),
  };
}

function closeModal(result) {
  const { overlay } = getModalElements();
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
  if (modalState.resolver) {
    modalState.resolver(result);
    modalState.resolver = null;
    modalState.showCancel = false;
  }
}

function openModal({ title, message, confirmText = "OK", cancelText = "Cancel", showCancel = false }) {
  const { overlay, title: titleEl, message: messageEl, confirm, cancel } = getModalElements();
  if (!overlay || !titleEl || !messageEl || !confirm || !cancel) {
    return Promise.resolve(showCancel ? window.confirm(message) : (alert(message), true));
  }

  titleEl.textContent = title || (showCancel ? "Confirm action" : "Notice");
  messageEl.textContent = message || "";
  confirm.textContent = confirmText;
  cancel.textContent = cancelText;
  cancel.classList.toggle("hidden", !showCancel);
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  modalState.showCancel = showCancel;

  return new Promise((resolve) => {
    modalState.resolver = resolve;
    confirm.focus();
  });
}

function showConfirm(message, options = {}) {
  return openModal({
    title: options.title || "Confirm action",
    message,
    confirmText: options.confirmText || "Confirm",
    cancelText: options.cancelText || "Cancel",
    showCancel: true,
  });
}

function showAlert(message, options = {}) {
  return openModal({
    title: options.title || "Notice",
    message,
    confirmText: options.confirmText || "OK",
    showCancel: false,
  });
}

function initModal() {
  const { overlay, confirm, cancel, close } = getModalElements();
  if (!overlay || !confirm || !cancel || !close) return;

  confirm.addEventListener("click", () => closeModal(true));
  cancel.addEventListener("click", () => closeModal(false));
  close.addEventListener("click", () => closeModal(false));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeModal(!modalState.showCancel);
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.classList.contains("hidden")) {
      closeModal(!modalState.showCancel);
    }
  });
}

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

async function loadReferenceData() {
  const [defsRes, tagsRes, agRes] = await Promise.all([
    apiFetch("/api/terms/definitions"),
    apiFetch("/api/tags"),
    apiFetch("/api/agreement-types"),
  ]);
  state.definitions = await defsRes.json();
  state.tags = await tagsRes.json();
  state.agreementTypes = await agRes.json();
}

async function loadContractsList() {
  const res = await apiFetch(`/api/contracts?limit=500&include_tags=false`);
  state.contracts = await res.json();
}

function termEventLabel(key) {
  return TERM_EVENT_MAP[key] || null;
}

function statusPill(status) {
  const label = (status || "manual").toLowerCase();
  const cls = `status-${label}`;
  return `<span class="pill ${cls}">${label}</span>`;
}

function optionList(values, selectedValue) {
  return values
    .map((v) => `<option value="${v}" ${v === selectedValue ? "selected" : ""}>${v}</option>`)
    .join("");
}

async function loadRecent() {
  const tbody = $("contracts");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" class="muted">Loading…</td></tr>`;

  const res = await apiFetch(`/api/search?mode=quick&q=&limit=100`);
  const rows = await res.json();
  state.contracts = rows;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">No contracts yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
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
    })
    .join("");

  document.querySelectorAll("a.open").forEach((a) => {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await loadDetail(a.dataset.id);
    });
  });
}

function renderAllContractsTable(rows, append = false) {
  const tbody = $("allContractsTable");
  if (!tbody) return;
  if (!rows.length && !append) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No contracts found.</td></tr>`;
    return;
  }

  const html = rows
    .map((r) => {
      const id = r.id;
      const title = r.title || r.original_filename || id;
      const uploaded = r.uploaded_at || "";
      return `
        <tr>
          <td>${badge(r.status)}</td>
          <td><a href="#" data-id="${id}" class="open-contract">${title}</a></td>
          <td class="small">${r.vendor || ""}</td>
          <td class="small">${uploaded}</td>
          <td class="small">
            <a href="${getApiBase()}/api/contracts/${id}/original" target="_blank">View</a>
            &nbsp;|&nbsp;
            <a href="${getApiBase()}/api/contracts/${id}/download" target="_blank">Download</a>
            &nbsp;|&nbsp;
            <button class="reprocess-btn" data-id="${id}">Reprocess</button>
          </td>
        </tr>
      `;
    })
    .join("");

  if (append) {
    tbody.insertAdjacentHTML("beforeend", html);
  } else {
    tbody.innerHTML = html;
  }

  document.querySelectorAll("a.open-contract").forEach((a) => {
    a.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await loadDetail(a.dataset.id);
      showPage("contracts");
    });
  });

  document.querySelectorAll(".reprocess-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await reprocessContract(btn.dataset.id);
    });
  });
}

async function loadAllContracts(reset = true) {
  const status = $("allContractsStatus");
  const loadMoreBtn = $("allContractsLoadMore");
  if (reset) {
    state.allContractsOffset = 0;
    state.allContracts = [];
    if (status) status.textContent = "Loading contracts…";
  }

  const params = new URLSearchParams({
    limit: String(state.allContractsLimit),
    offset: String(state.allContractsOffset),
    include_tags: "false",
  });
  if (state.allContractsQuery) {
    params.set("q", state.allContractsQuery);
    params.set("mode", "quick");
  }

  try {
    const res = await apiFetch(`/api/contracts?${params.toString()}`);
    const rows = await res.json();
    state.allContracts = reset ? rows : state.allContracts.concat(rows);
    renderAllContractsTable(rows, !reset);
    state.allContractsOffset += rows.length;

    if (status) {
      status.textContent = `Showing ${state.allContracts.length} contract${state.allContracts.length === 1 ? "" : "s"}.`;
    }

    if (loadMoreBtn) {
      loadMoreBtn.disabled = rows.length < state.allContractsLimit;
    }
  } catch (e) {
    if (status) status.textContent = e.message;
  }
}

let allContractsSearchTimer = null;

function initAllContractsUi() {
  const search = $("allContractsSearch");
  search?.addEventListener("input", () => {
    if (allContractsSearchTimer) window.clearTimeout(allContractsSearchTimer);
    allContractsSearchTimer = window.setTimeout(() => {
      state.allContractsQuery = search.value.trim();
      loadAllContracts(true);
    }, 300);
  });

  $("allRefresh")?.addEventListener("click", () => loadAllContracts(true));
  $("allContractsLoadMore")?.addEventListener("click", () => loadAllContracts(false));
  $("reprocessAll")?.addEventListener("click", async () => {
    const ok = await showConfirm(
      "Reprocess all contracts? This may take a long time on large databases.",
      { confirmText: "Reprocess all" }
    );
    if (!ok) return;
    const status = $("allContractsStatus");
    if (status) status.textContent = "Reprocessing all contracts…";
    try {
      const res = await apiFetch(`/api/contracts/reprocess?all=true`, { method: "POST" });
      const data = await res.json();
      const errorCount = data.errors?.length || 0;
      if (status) {
        status.textContent = `Reprocessed ${data.processed?.length || 0} contract${data.processed?.length === 1 ? "" : "s"}.` +
          (errorCount ? ` ${errorCount} error${errorCount === 1 ? "" : "s"} reported.` : "");
      }
      await loadRecent();
      await loadAllContracts(true);
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  });
}

function renderTagPill(tag) {
  const auto = tag.auto_generated ? " (auto)" : "";
  return `<span class="pill tag" style="background:${tag.color || "#eef2ff"}; color:#0f172a;">${tag.name}${auto}</span>`;
}

function contractOptionLabel(contract) {
  return `${contract.title || contract.id || "Contract"} — ${contract.vendor || "Unknown vendor"}`;
}

function renderContractDetail(data) {
  const c = data.contract || {};
  const terms = data.terms || [];
  const events = data.events || [];
  const tags = data.tags || [];
  const reminders = data.reminders || {};
  const agreementType = c.agreement_type || "Uncategorized";
  const termLookup = new Map(terms.map((t) => [t.term_key, t]));
  const eventLookup = new Map(events.filter((e) => e.derived_from_term_key).map((e) => [e.derived_from_term_key, e]));
  const vendorTerm = termLookup.get("vendor");
  const vendorFromTerms = vendorTerm ? vendorTerm.value_normalized || vendorTerm.value_raw || "" : "";
  const vendorAutoValue = c.vendor || vendorFromTerms;

  const termOptions = state.definitions
    .map((d) => `<option value="${d.key}" data-type="${d.value_type}">${d.name}</option>`)
    .join("");

  const tagOptions = state.tags
    .map((t) => `<option value="${t.id}">${t.name}</option>`)
    .join("");

  const tagHtml = tags.length
    ? tags
        .map(
          (t) => `
      <div class="inline" style="gap:4px; margin-bottom:4px;">
        ${renderTagPill(t)}
        <button class="chip-btn remove-tag" data-tag="${t.id}">×</button>
      </div>`
        )
        .join("")
    : `<div class="muted small">No tags yet.</div>`;

  const termSummaryItems = terms.map((t) => {
    const value = t.value_normalized || t.value_raw || "";
    return `<span class="pill ${`status-${(t.status || "manual").toLowerCase()}`}" title="${t.term_key}">${t.name || t.term_key}: ${value}</span>`;
  });
  const hasVendorTerm = terms.some((t) => t.term_key === "vendor");
  if (!hasVendorTerm && vendorAutoValue) {
    termSummaryItems.push(`<span class="pill status-smart" title="vendor">Vendor: ${vendorAutoValue}</span>`);
  }
  const termSummaryHtml = termSummaryItems.length
    ? termSummaryItems.join(" ")
    : `<div class="muted small">No extracted terms yet.</div>`;

  const termsHtml = terms.length
    ? terms
        .map(
          (t) => `
        <details class="section term-row" data-term="${t.term_key}">
          <summary>
            <span class="summary-title">
              ${t.name || t.term_key}
              <span class="muted small">${t.term_key}</span>
              ${termEventLabel(t.term_key) ? `<span class="pill">${termEventLabel(t.term_key)} event</span>` : ""}
            </span>
            <span class="summary-meta">
              ${statusPill(t.status)}
              <span>${(t.confidence ?? 0).toFixed(2)}</span>
            </span>
          </summary>
          <div class="row wrap" style="gap:8px; margin-top:6px;">
            <input class="muted-input term-value" type="text" value="${t.value_normalized || t.value_raw || ""}" />
            <select class="term-status">
              ${optionList(["manual", "smart", "inconclusive"], t.status || "manual")}
            </select>
            <button class="save-term" data-term="${t.term_key}">Save</button>
            <button class="delete-term" data-term="${t.term_key}">Delete</button>
          </div>
        </details>`
        )
        .join("")
    : `<div class="muted small">No extracted terms. Use the form below to add one manually.</div>`;

  const eventsHtml = events.length
    ? events
        .map((e) => {
          const reminder = reminders[e.id];
          const offsets = reminder?.offsets?.join(", ") || "";
          const recipients = reminder?.recipients?.join(", ") || "";
          return `
          <details class="section" data-event="${e.id}">
            <summary>
              <span class="summary-title">
                ${eventTypePill(e.event_type)}
                ${e.derived_from_term_key ? `<span class="pill">From ${e.derived_from_term_key}</span>` : ""}
              </span>
              <span class="summary-meta">${formatDate(e.event_date)}</span>
            </summary>
            <div class="row wrap" style="gap:8px; margin-top:6px;">
              <input type="date" class="event-date" value="${(e.event_date || "").slice(0, 10)}" />
              <select class="event-type">
                ${optionList(STANDARD_EVENT_TYPES, e.event_type)}
              </select>
              <button class="save-event" data-event="${e.id}">Save</button>
              <button class="delete-event" data-event="${e.id}">Delete</button>
            </div>
            <div class="row wrap" style="gap:8px; margin-top:6px;">
              <input type="text" class="reminder-recipients" placeholder="Emails, comma separated" value="${recipients}" />
              <input type="text" class="reminder-offsets" placeholder="Offsets e.g., 90,60,30" value="${offsets}" />
              <button class="save-reminder" data-event="${e.id}">Save reminders</button>
              <span class="muted small">${reminder ? "Configured" : "Not configured"}</span>
            </div>
          </details>`;
        })
        .join("")
    : `<div class="muted small">No events. Add one manually below.</div>`;

  $("detail").innerHTML = `
    <div><b>${c.title || c.original_filename || c.id}</b></div>
    <div class="small muted">ID: ${c.id}</div>
    <div style="margin-top:8px">Status: ${badge(c.status)}</div>
    <div class="inline" style="gap:8px; margin-top:8px;">
      <button id="reprocessContract">Reprocess</button>
    </div>
    <div class="small muted" style="margin-top:4px;">Agreement Type: <span class="pill">${agreementType}</span></div>
    <div class="section" style="margin-top:10px;">
      <h4>Extracted Terms</h4>
      <div class="row wrap" style="gap:6px;">${termSummaryHtml}</div>
    </div>

    <div class="section">
      <h4>Contract Info</h4>
      <div class="row wrap" style="gap:8px;">
        <input id="contractTitle" class="muted-input" type="text" placeholder="Title" value="${c.title || ""}" />
        <input id="contractVendor" class="muted-input" type="text" placeholder="Vendor" value="${vendorAutoValue || ""}" />
        <select id="contractAgreement">
          ${optionList(state.agreementTypes.length ? state.agreementTypes : [agreementType], agreementType)}
        </select>
        <button id="saveContractMeta">Save</button>
      </div>
    </div>

    <details class="section">
      <summary class="summary-title">Tags</summary>
      <div id="contractTags">${tagHtml}</div>
      <div class="row wrap" style="gap:8px; margin-top:6px;">
        <select id="tagPicker">${tagOptions}</select>
        <button id="addTag">Add tag</button>
      </div>
      <div class="row wrap" style="gap:8px; margin-top:6px;">
        <input type="text" id="newTagName" placeholder="Create new tag" />
        <input type="color" id="newTagColor" value="#3b82f6" />
        <button id="createTag">Create & attach</button>
      </div>
    </details>

    <details class="section">
      <summary class="summary-title">Terms</summary>
      ${termsHtml}
      <div class="section" style="margin-top:8px;">
        <div class="muted small">Add or override a term</div>
        <div class="row wrap" style="gap:8px; margin-top:6px;">
          <select id="newTermKey">${termOptions}</select>
          <input id="newTermValue" class="muted-input" type="text" placeholder="Value" />
          <select id="newTermStatus">
            ${optionList(["manual", "smart", "inconclusive"], "manual")}
          </select>
          <select id="newTermEventType">
            <option value="">No event</option>
            ${optionList(STANDARD_EVENT_TYPES, "")}
          </select>
          <input type="date" id="newTermEventDate" />
          <button id="addTerm">Add/Update Term</button>
        </div>
      </div>
    </details>

    <details class="section">
      <summary class="summary-title">Events</summary>
      ${eventsHtml}
      <div class="section" style="margin-top:8px;">
        <div class="muted small">Add an event manually</div>
        <div class="row wrap" style="gap:8px; margin-top:6px;">
          <select id="newEventType">
            ${optionList(STANDARD_EVENT_TYPES, "renewal")}
          </select>
          <input type="date" id="newEventDate" />
          <button id="addEvent">Add Event</button>
        </div>
      </div>
    </details>
  `;

  $("saveContractMeta")?.addEventListener("click", async () => {
    try {
      await apiFetch(`/api/contracts/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: $("contractTitle").value,
          vendor: $("contractVendor").value,
          agreement_type: $("contractAgreement").value,
        }),
      });
      await loadRecent();
      await loadDetail(c.id);
    } catch (e) {
      await showAlert(e.message, { title: "Update failed" });
    }
  });

  $("reprocessContract")?.addEventListener("click", () => reprocessContract(c.id));

  document.querySelectorAll(".remove-tag").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/contracts/${c.id}/tags/${btn.dataset.tag}`, { method: "DELETE" });
        await loadDetail(c.id);
      } catch (e) {
        await showAlert(e.message, { title: "Update failed" });
      }
    });
  });

  $("addTag")?.addEventListener("click", async () => {
    const tagId = parseInt($("tagPicker").value, 10);
    if (!tagId) return;
    try {
      await apiFetch(`/api/contracts/${c.id}/tags/${tagId}`, { method: "POST" });
      await loadDetail(c.id);
    } catch (e) {
      await showAlert(e.message, { title: "Update failed" });
    }
  });

  $("createTag")?.addEventListener("click", async () => {
    const name = $("newTagName").value.trim();
    const color = $("newTagColor").value || "#3b82f6";
    if (!name) {
      await showAlert("Tag name required", { title: "Missing info" });
      return;
    }
    try {
      const res = await apiFetch(`/api/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
      await res.json();
      await loadReferenceData();
      const newTag = state.tags.find((t) => t.name === name);
      if (newTag?.id) {
        await apiFetch(`/api/contracts/${c.id}/tags/${newTag.id}`, { method: "POST" });
      }
      await loadDetail(c.id);
    } catch (e) {
      await showAlert(e.message, { title: "Update failed" });
    }
  });

  document.querySelectorAll(".save-term").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const termKey = btn.dataset.term;
      const row = btn.closest(".term-row");
      const value = row.querySelector(".term-value")?.value || "";
      const status = row.querySelector(".term-status")?.value || "manual";
      const def = state.definitions.find((d) => d.key === termKey);
      try {
        await apiFetch(`/api/contracts/${c.id}/terms/${termKey}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            term_key: termKey,
            value_raw: value,
            value_normalized: value,
            status,
            value_type: def?.value_type || "text",
            event_type: termEventLabel(termKey),
          }),
        });
        await loadDetail(c.id);
      } catch (e) {
        await showAlert(e.message, { title: "Update failed" });
      }
    });
  });

  document.querySelectorAll(".delete-term").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const termKey = btn.dataset.term;
      try {
        await apiFetch(`/api/contracts/${c.id}/terms/${termKey}`, { method: "DELETE" });
        await loadDetail(c.id);
      } catch (e) {
        await showAlert(e.message, { title: "Update failed" });
      }
    });
  });

  function prefillTermForm() {
    const termKey = $("newTermKey")?.value;
    if (!termKey) return;
    const term = termLookup.get(termKey);
    const event = eventLookup.get(termKey);
    $("newTermValue").value = term?.value_normalized || term?.value_raw || "";
    $("newTermStatus").value = term?.status || "manual";
    const eventType = event?.event_type || termEventLabel(termKey) || "";
    $("newTermEventType").value = STANDARD_EVENT_TYPES.includes(eventType) ? eventType : "";
    const termDate = term?.value_type === "date" ? term?.value_normalized : "";
    $("newTermEventDate").value = event?.event_date?.slice(0, 10) || termDate || "";
  }

  $("newTermKey")?.addEventListener("change", prefillTermForm);
  prefillTermForm();

  $("addTerm")?.addEventListener("click", async () => {
    const termKey = $("newTermKey").value;
    const value = $("newTermValue").value;
    const status = $("newTermStatus").value;
    const eventType = $("newTermEventType").value || undefined;
    const eventDate = $("newTermEventDate").value || undefined;
    const def = state.definitions.find((d) => d.key === termKey);
    try {
      await apiFetch(`/api/contracts/${c.id}/terms/${termKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          term_key: termKey,
          value_raw: value,
          value_normalized: value,
          status,
          value_type: def?.value_type || "text",
          event_type: eventType || termEventLabel(termKey),
          event_date: eventDate || undefined,
        }),
      });
      await loadDetail(c.id);
    } catch (e) {
      await showAlert(e.message, { title: "Update failed" });
    }
  });

  document.querySelectorAll(".save-event").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("[data-event]");
      const eventId = btn.dataset.event;
      const eventDate = row.querySelector(".event-date")?.value;
      const eventType = row.querySelector(".event-type")?.value;
      try {
        await apiFetch(`/api/events/${eventId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_date: eventDate, event_type: eventType }),
        });
        await loadEvents();
        await loadDetail(c.id);
      } catch (e) {
        await showAlert(e.message, { title: "Update failed" });
      }
    });
  });

  document.querySelectorAll(".delete-event").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const eventId = btn.dataset.event;
      try {
        await apiFetch(`/api/events/${eventId}`, { method: "DELETE" });
        await loadEvents();
        await loadDetail(c.id);
      } catch (e) {
        await showAlert(e.message, { title: "Update failed" });
      }
    });
  });

  document.querySelectorAll(".save-reminder").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("[data-event]");
      const eventId = btn.dataset.event;
      const recipients = (row.querySelector(".reminder-recipients")?.value || "")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      const offsetsInput = row.querySelector(".reminder-offsets")?.value || "";
      const offsets = offsetsInput
        .split(/[\s,]+/)
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => Number.parseInt(o, 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (!offsets.length) {
        await showAlert("Offsets must include at least one positive integer.", {
          title: "Invalid reminder offsets",
        });
        return;
      }
      try {
        await apiFetch(`/api/events/${eventId}/reminders`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients, offsets, enabled: true }),
        });
        await loadDetail(c.id);
      } catch (e) {
        await showAlert(e.message, { title: "Update failed" });
      }
    });
  });

  $("addEvent")?.addEventListener("click", async () => {
    const type = $("newEventType").value;
    const date = $("newEventDate").value;
    if (!date) {
      await showAlert("Date is required", { title: "Missing info" });
      return;
    }
    try {
      await apiFetch(`/api/contracts/${c.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: type, event_date: date }),
      });
      await loadEvents();
      await loadDetail(c.id);
    } catch (e) {
      await showAlert(e.message, { title: "Update failed" });
    }
  });
}

async function reprocessContract(contractId) {
  const ok = await showConfirm("Reprocess this contract? This will re-run OCR and extraction.", {
    confirmText: "Reprocess",
  });
  if (!ok) return;
  try {
    await apiFetch(`/api/contracts/${contractId}/reprocess`, { method: "POST" });
    await loadRecent();
    await loadDetail(contractId);
    if (state.currentPage === "allContracts") {
      await loadAllContracts(true);
    }
  } catch (e) {
    await showAlert(e.message, { title: "Update failed" });
  }
}

async function loadDetail(id) {
  const detail = $("detail");
  detail.innerHTML = "Loading…";
  try {
    if (!state.definitions.length || !state.tags.length || !state.agreementTypes.length) {
      await loadReferenceData();
    }
    const res = await apiFetch(`/api/contracts/${id}`);
    const data = await res.json();
    renderContractDetail(data);
  } catch (e) {
    detail.innerHTML = `<div class="badge red">error</div><pre>${e.message}</pre>`;
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
        body: fd,
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

  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });
}

function eventTypePill(type) {
  const label = type || "event";
  const cls = type ? `event-${type}` : "";
  return `<span class="pill event-type ${cls}">${label}</span>`;
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

  list.innerHTML = folders
    .map((f) => {
      const eventsHtml = f.events
        .map((ev) => {
          const days = daysUntil(ev.event_date);
          const relative =
            days === null
              ? ""
              : days === 0
              ? "Today"
              : days > 0
              ? `In ${days} day${days === 1 ? "" : "s"}`
              : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
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
        })
        .join("");

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
    })
    .join("");

  if (status) {
    status.textContent = `Showing ${filtered.length} event${filtered.length === 1 ? "" : "s"} across ${folders.length} contract${folders.length === 1 ? "" : "s"}.`;
  }
}

async function loadEvents() {
  const list = $("eventsList");
  if (!list) return;
  const month = $("eventAllMonths")?.checked ? "all" : $("eventMonth")?.value || defaultMonthValue();
  const eventType = $("eventTypeFilter")?.value || "all";
  const sort = $("eventSort")?.value || "date_asc";

  if ($("eventMonth")) $("eventMonth").value = month === "all" ? defaultMonthValue() : month;

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
  const pages = ["contracts", "allContracts", "events", "planner"];
  state.currentPage = page;
  pages.forEach((p) => {
    $(p + "Page")?.classList.toggle("hidden", p !== page);
    $("nav" + p.charAt(0).toUpperCase() + p.slice(1))?.classList.toggle("active", p === page);
  });

  if (page === "allContracts") {
    loadAllContracts(true);
  }
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
  $("eventAllMonths")?.addEventListener("change", loadEvents);
  $("eventTypeFilter")?.addEventListener("change", loadEvents);
  $("eventSort")?.addEventListener("change", loadEvents);
  $("eventSearch")?.addEventListener("input", renderEvents);
  $("expiringOnly")?.addEventListener("change", renderEvents);
  $("eventsRefresh")?.addEventListener("click", loadEvents);
}

function renderPlannerTable() {
  const tbody = $("plannerTable");
  if (!tbody) return;
  if (!state.plannerEvents.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">No events for the selected window.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.plannerEvents
    .map((e) => {
      const contract = state.contracts.find((c) => c.id === e.contract_id);
      return `
        <tr data-event="${e.id}">
          <td><div class="small">${contract ? contractOptionLabel(contract) : e.contract_id}</div></td>
          <td>
            <select class="planner-type">${optionList(STANDARD_EVENT_TYPES, e.event_type)}</select>
          </td>
          <td><input type="date" class="planner-date" value="${(e.event_date || "").slice(0, 10)}" /></td>
          <td>
            <button class="planner-save" data-event="${e.id}">Save</button>
            <button class="planner-delete" data-event="${e.id}">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".planner-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const date = row.querySelector(".planner-date")?.value;
      const type = row.querySelector(".planner-type")?.value;
      try {
        await apiFetch(`/api/events/${btn.dataset.event}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_date: date, event_type: type }),
        });
        await loadEvents();
        await loadPlannerEvents();
      } catch (e) {
        await showAlert(e.message, { title: "Update failed" });
      }
    });
  });

  document.querySelectorAll(".planner-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/events/${btn.dataset.event}`, { method: "DELETE" });
        await loadEvents();
        await loadPlannerEvents();
      } catch (e) {
        await showAlert(e.message, { title: "Update failed" });
      }
    });
  });
}

async function loadPlannerEvents() {
  const month = $("plannerAllMonths")?.checked ? "all" : $("plannerMonth")?.value || defaultMonthValue();
  if ($("plannerMonth")) $("plannerMonth").value = month === "all" ? defaultMonthValue() : month;
  const status = $("plannerStatus");
  try {
    const res = await apiFetch(`/api/events?month=${encodeURIComponent(month)}&event_type=all&sort=date_asc`);
    state.plannerEvents = await res.json();
    if (status) status.textContent = `Loaded ${state.plannerEvents.length} events`;
    renderPlannerTable();
  } catch (e) {
    if (status) status.textContent = e.message;
  }
}

async function loadPlanner() {
  if (!state.contracts.length) {
    await loadContractsList();
  }
  const select = $("plannerContract");
  if (select) {
    select.innerHTML = state.contracts.map((c) => `<option value="${c.id}">${contractOptionLabel(c)}</option>`).join("");
  }
  await loadPlannerEvents();
}

function initPlannerUi() {
  $("plannerAdd")?.addEventListener("click", async () => {
    const contractId = $("plannerContract")?.value;
    let eventType = $("plannerEventType")?.value;
    const date = $("plannerEventDate")?.value;
    if (!contractId || !date) {
      await showAlert("Contract and date are required", { title: "Missing info" });
      return;
    }
    if (eventType === "custom") {
      eventType = $("plannerCustomType")?.value?.trim();
      if (!eventType) {
        await showAlert("Provide a custom event type", { title: "Missing info" });
        return;
      }
    }
    try {
      await apiFetch(`/api/contracts/${contractId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: eventType, event_date: date }),
      });
      $("plannerEventDate").value = "";
      await loadEvents();
      await loadPlannerEvents();
    } catch (e) {
      await showAlert(e.message, { title: "Update failed" });
    }
  });

  $("plannerMonth")?.addEventListener("change", loadPlannerEvents);
  $("plannerAllMonths")?.addEventListener("change", loadPlannerEvents);
  $("plannerRefresh")?.addEventListener("click", loadPlannerEvents);
}

$("navContracts")?.addEventListener("click", () => showPage("contracts"));
$("navAllContracts")?.addEventListener("click", () => showPage("allContracts"));
$("navEvents")?.addEventListener("click", () => showPage("events"));
$("navPlanner")?.addEventListener("click", () => showPage("planner"));

$("saveApi").addEventListener("click", async () => {
  setApiBase($("apiBase").value.trim());
  setApiUi();
  await testApi();
  await loadReferenceData();
  await loadRecent();
});

$("refresh").addEventListener("click", loadRecent);

setApiUi();
initModal();
initDropzone();
initEventsUi();
initPlannerUi();
initAllContractsUi();
showPage("contracts");

testApi()
  .then(loadReferenceData)
  .then(loadRecent)
  .then(loadEvents)
  .catch((e) => console.error(e));
