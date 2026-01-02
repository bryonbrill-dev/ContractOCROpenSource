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
  allContractsStatusFilter: "all",
  allContractsTypeFilter: "all",
  currentPage: "contracts",
  selectedContractId: null,
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

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename, headers, rows) {
  const headerRow = headers.map((h) => csvValue(h.label)).join(",");
  const lines = rows.map((row) => headers.map((h) => csvValue(row[h.key])).join(","));
  const csv = [headerRow, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function timestampForFilename() {
  return new Date().toISOString().slice(0, 10);
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

function titleCase(text) {
  return (text || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function abbreviateText(text, max = 26) {
  const safe = text || "Contract";
  if (safe.length <= max) return safe;
  return `${safe.slice(0, Math.max(0, max - 1))}…`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function defaultMonthValue() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${month}`;
}

function shiftMonthValue(value, delta) {
  const [yearStr, monthStr] = (value || defaultMonthValue()).split("-");
  const year = Number.parseInt(yearStr, 10);
  const monthIndex = Number.parseInt(monthStr, 10) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return defaultMonthValue();
  }
  const date = new Date(year, monthIndex + delta, 1);
  const newMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${newMonth}`;
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
  renderAllContractsFilters();
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

function updateSelectedRows() {
  document.querySelectorAll("[data-contract-id]").forEach((row) => {
    row.classList.toggle("active-row", row.dataset.contractId === state.selectedContractId);
  });
}

function renderAllContractsFilters() {
  const statusSelect = $("allContractsStatus");
  const typeSelect = $("allContractsType");
  if (statusSelect) {
    const options = ["all", "processed", "processing", "error"];
    statusSelect.innerHTML = options
      .map((opt) => `<option value="${opt}">${titleCase(opt)}</option>`)
      .join("");
    statusSelect.value = state.allContractsStatusFilter;
  }
  if (typeSelect) {
    const options = ["all", ...(state.agreementTypes.length ? state.agreementTypes : ["Uncategorized"])];
    typeSelect.innerHTML = options
      .map((opt) => `<option value="${opt}">${opt === "all" ? "All types" : opt}</option>`)
      .join("");
    typeSelect.value = state.allContractsTypeFilter;
  }
}

async function loadRecent() {
  const tbody = $("contracts");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" class="muted">Loading…</td></tr>`;

  const res = await apiFetch(`/api/search?mode=quick&q=&limit=100`);
  const rows = await res.json();
  const processedRows = rows.filter((row) => (row.status || "").toLowerCase() === "processed").slice(0, 5);
  state.contracts = processedRows;

  if (!processedRows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">No processed contracts yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = processedRows
    .map((r) => {
      const id = r.id;
      const title = r.title || r.original_filename || id;
      const shortTitle = abbreviateText(title, 32);
      const uploaded = r.uploaded_at || "";
      const activeClass = id === state.selectedContractId ? "active-row" : "";
      return `
        <tr data-contract-id="${id}" class="${activeClass}">
          <td>${badge(r.status)}</td>
          <td><a href="#" data-id="${id}" class="open" title="${escapeHtml(title)}">${shortTitle}</a></td>
          <td class="small">${uploaded}</td>
          <td class="small">
            <a href="${getApiBase()}/api/contracts/${id}/original" target="_blank">View</a>
            &nbsp;|&nbsp;
            <a href="${getApiBase()}/api/contracts/${id}/download" target="_blank">Download</a>
            &nbsp;|&nbsp;
            <button class="delete-contract danger" data-id="${id}" data-title="${escapeHtml(title)}">Delete</button>
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

  document.querySelectorAll(".delete-contract").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteContract(btn.dataset.id, btn.dataset.title);
    });
  });
  updateSelectedRows();
}

function renderAllContractsTable(rows, append = false) {
  const tbody = $("allContractsTable");
  if (!tbody) return;
  if (!rows.length && !append) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No contracts found.</td></tr>`;
    return;
  }

  const html = rows
    .map((r) => {
      const id = r.id;
      const title = r.title || r.original_filename || id;
      const uploaded = r.uploaded_at || "";
      const activeClass = id === state.selectedContractId ? "active-row" : "";
      return `
        <tr data-contract-id="${id}" class="${activeClass}">
          <td>${badge(r.status)}</td>
          <td><a href="#" data-id="${id}" class="open-contract">${title}</a></td>
          <td class="small">${r.vendor || ""}</td>
          <td class="small">${r.agreement_type || "Uncategorized"}</td>
          <td class="small">${uploaded}</td>
          <td class="small">
            <a href="${getApiBase()}/api/contracts/${id}/original" target="_blank">View</a>
            &nbsp;|&nbsp;
            <a href="${getApiBase()}/api/contracts/${id}/download" target="_blank">Download</a>
            &nbsp;|&nbsp;
            <button class="reprocess-btn" data-id="${id}">Reprocess</button>
            &nbsp;|&nbsp;
            <button class="delete-contract danger" data-id="${id}" data-title="${escapeHtml(title)}">Delete</button>
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

  document.querySelectorAll(".delete-contract").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteContract(btn.dataset.id, btn.dataset.title);
    });
  });

  updateSelectedRows();
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
  if (state.allContractsStatusFilter && state.allContractsStatusFilter !== "all") {
    params.set("status", state.allContractsStatusFilter);
  }
  if (state.allContractsTypeFilter && state.allContractsTypeFilter !== "all") {
    params.set("agreement_type", state.allContractsTypeFilter);
  }
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

  $("allContractsStatus")?.addEventListener("change", (event) => {
    state.allContractsStatusFilter = event.target.value;
    loadAllContracts(true);
  });

  $("allContractsType")?.addEventListener("change", (event) => {
    state.allContractsTypeFilter = event.target.value;
    loadAllContracts(true);
  });

  $("allRefresh")?.addEventListener("click", () => loadAllContracts(true));
  $("allContractsExport")?.addEventListener("click", exportAllContractsCsv);
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
  const mimeType = (c.mime_type || "").toLowerCase();
  const hasPreview = mimeType === "application/pdf" || mimeType.startsWith("image/");
  const previewSrc = `${getApiBase()}/api/contracts/${c.id}/original`;
  const previewHtml = hasPreview
    ? `<iframe class="preview-frame" src="${previewSrc}" title="Contract file preview"></iframe>`
    : `<div class="muted small">Preview unavailable for ${mimeType || "unknown"} files. Use download to view.</div>`;

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
        <details class="section term-row ${t.status === "manual" ? "manual-term" : ""}" data-term="${t.term_key}">
          <summary>
            <span class="summary-chevron" aria-hidden="true">▸</span>
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
              <span class="summary-chevron" aria-hidden="true">▸</span>
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

  const actionButtons =
    c.status === "processed"
      ? `<button id="deleteContract" class="danger">Delete</button>`
      : `
        <button id="reprocessContract">Reprocess</button>
        <button id="deleteContract" class="danger">Delete</button>
      `;

  $("detail").innerHTML = `
    <div><b>${c.title || c.original_filename || c.id}</b></div>
    <div class="small muted">ID: ${c.id}</div>
    <div class="small muted" style="margin-top:4px;">Agreement Type: <span class="pill">${agreementType}</span></div>
    <div class="section" style="margin-top:10px;">
      <div class="row wrap" style="gap:8px;">
        <input id="contractTitle" class="muted-input" type="text" placeholder="Title" value="${c.title || ""}" />
        <input id="contractVendor" class="muted-input" type="text" placeholder="Vendor" value="${vendorAutoValue || ""}" />
        <select id="contractAgreement">
          ${optionList(state.agreementTypes.length ? state.agreementTypes : [agreementType], agreementType)}
        </select>
        <button id="saveContractMeta">Save</button>
      </div>
    </div>
    <div class="section">
      <h4>Extracted Terms</h4>
      <div class="row wrap" style="gap:6px;">${termSummaryHtml}</div>
    </div>

    <details class="section" id="contractContent" open>
      <summary>
        <span class="summary-chevron" aria-hidden="true">▸</span>
        <span class="summary-title">Content Preview</span>
        <span class="summary-meta">PDF or OCR text</span>
      </summary>
      <div class="preview-grid">
        <div>
          <div class="small muted" style="margin-bottom:6px;">Document preview</div>
          ${previewHtml}
        </div>
        <div>
          <div class="small muted" style="margin-bottom:6px;">OCR text</div>
          <pre id="contractText" class="contract-text">Open to load text…</pre>
        </div>
      </div>
    </details>

    <details class="section">
      <summary>
        <span class="summary-chevron" aria-hidden="true">▸</span>
        <span class="summary-title">Tags</span>
      </summary>
      <div class="muted small">Create company-specific tags (e.g., BCBS, Deer Run) to group related contracts.</div>
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
      <summary>
        <span class="summary-chevron" aria-hidden="true">▸</span>
        <span class="summary-title">Terms</span>
      </summary>
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
      <summary>
        <span class="summary-chevron" aria-hidden="true">▸</span>
        <span class="summary-title">Events</span>
      </summary>
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

    <details class="section">
      <summary>
        <span class="summary-chevron" aria-hidden="true">▸</span>
        <span class="summary-title">Advanced Details</span>
      </summary>
      <div style="margin-top:8px">Status: ${badge(c.status)}</div>
      <div style="margin-top:8px;">
        Actions:
        <span class="inline" style="gap:8px; margin-left:6px;">${actionButtons}</span>
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
  $("deleteContract")?.addEventListener("click", () => deleteContract(c.id, c.title || c.original_filename || c.id));

  const contentDetails = $("contractContent");
  if (contentDetails) {
    const loadPreview = () => {
      if (contentDetails.dataset.loaded) return;
      contentDetails.dataset.loaded = "true";
      loadContractText(c.id);
    };
    if (contentDetails.open) {
      loadPreview();
    }
    contentDetails.addEventListener("toggle", () => {
      if (!contentDetails.open) return;
      loadPreview();
    });
  }

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
      const row = btn.closest("details[data-event]");
      const eventId = btn.dataset.event;
      const eventDate = row?.querySelector(".event-date")?.value;
      const eventType = row?.querySelector(".event-type")?.value;
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
      const row = btn.closest("details[data-event]");
      const eventId = btn.dataset.event;
      const recipients = (row?.querySelector(".reminder-recipients")?.value || "")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      const offsetsInput = row?.querySelector(".reminder-offsets")?.value || "";
      const offsets = offsetsInput
        .split(/[\s,]+/)
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => Number.parseInt(o, 10))
        .filter((n) => Number.isFinite(n) && n >= 0);
      const enabled = true;
      if (!recipients.length) {
        await showAlert("Recipients must include at least one email address.", {
          title: "Invalid reminder recipients",
        });
        return;
      }
      if (!offsets.length) {
        await showAlert("Offsets must include at least one non-negative integer.", {
          title: "Invalid reminder offsets",
        });
        return;
      }
      try {
        await apiFetch(`/api/events/${eventId}/reminders`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients, offsets, enabled }),
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

async function loadContractText(contractId) {
  const textEl = $("contractText");
  if (!textEl) return;
  textEl.textContent = "Loading OCR text…";
  try {
    const res = await apiFetch(`/api/contracts/${contractId}/ocr-text`);
    const data = await res.json();
    if (data.text) {
      textEl.textContent = data.text;
      return;
    }
    textEl.textContent = "OCR text not available yet. Reprocess the contract to generate text.";
  } catch (e) {
    textEl.textContent = `Unable to load OCR text: ${e.message}`;
  }
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

async function deleteContract(contractId, title = "this contract") {
  const ok = await showConfirm(`Delete "${title}"? This removes the file and all extracted data.`, {
    confirmText: "Delete",
    cancelText: "Cancel",
  });
  if (!ok) return;
  try {
    await apiFetch(`/api/contracts/${contractId}`, { method: "DELETE" });
    if (state.selectedContractId === contractId) {
      state.selectedContractId = null;
      const detail = $("detail");
      if (detail) {
        detail.innerHTML = `<div class="muted">Select a contract to view details.</div>`;
      }
    }
    await loadRecent();
    if (state.currentPage === "allContracts") {
      await loadAllContracts(true);
    }
    updateSelectedRows();
  } catch (e) {
    await showAlert(e.message, { title: "Delete failed" });
  }
}

async function loadDetail(id) {
  const detail = $("detail");
  detail.innerHTML = "Loading…";
  state.selectedContractId = id;
  updateSelectedRows();
  try {
    if (!state.definitions.length || !state.tags.length || !state.agreementTypes.length) {
      await loadReferenceData();
    }
    const res = await apiFetch(`/api/contracts/${id}`);
    const data = await res.json();
    renderContractDetail(data);
    $("detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const filtered = getFilteredEvents();
  const sort = $("eventSort")?.value || "date_asc";

  const status = $("eventsStatus");
  if (!filtered.length) {
    list.innerHTML = `<div class="muted">No events match your filters for this month.</div>`;
    if (status) status.textContent = `Showing 0 of ${state.events.length} events.`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => {
    const dir = sort.endsWith("desc") ? -1 : 1;
    if (sort.startsWith("title")) {
      return (a.title || "").localeCompare(b.title || "") * dir;
    }
    return (a.event_date || "").localeCompare(b.event_date || "") * dir;
  });

  const dateGroups = new Map();
  sorted.forEach((ev) => {
    const dateKey = ev.event_date || "unknown";
    if (!dateGroups.has(dateKey)) {
      dateGroups.set(dateKey, {
        date: ev.event_date,
        contracts: new Map(),
      });
    }
    const dateGroup = dateGroups.get(dateKey);
    if (!dateGroup.contracts.has(ev.contract_id)) {
      dateGroup.contracts.set(ev.contract_id, {
        contractId: ev.contract_id,
        title: ev.title || ev.contract_id,
        vendor: ev.vendor || "Unknown vendor",
        agreement_type: ev.agreement_type || "",
        events: [],
      });
    }
    dateGroup.contracts.get(ev.contract_id).events.push(ev);
  });

  const dateGroupList = Array.from(dateGroups.values());

  list.innerHTML = dateGroupList
    .map((group, groupIndex) => {
      const contractsHtml = Array.from(group.contracts.values())
        .map((contract) => {
          const eventsHtml = contract.events
            .map((ev) => {
              const days = daysUntil(ev.event_date);
              const isExpired =
                days !== null && days < 0 && EXPIRING_TYPES.includes((ev.event_type || "").toLowerCase());
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
                  <div class="event-date">
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                      ${isExpired ? `<span class="expired-bell" title="Expired">🔔 Expired</span>` : ""}
                      <span>${relative || "Upcoming"}</span>
                    </div>
                  </div>
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
            <details class="section event-contract" data-contract="${contract.contractId}">
              <summary>
                <span class="summary-chevron" aria-hidden="true">▸</span>
                <span class="summary-title">
                  <button type="button" class="link-button open-contract" data-id="${contract.contractId}">
                    ${contract.title}
                  </button>
                </span>
                <span class="summary-meta">
                  <span class="muted small">${contract.vendor}</span>
                  ${contract.agreement_type ? `<span class="pill">${contract.agreement_type}</span>` : ""}
                  <span class="pill">${contract.events.length} event${contract.events.length === 1 ? "" : "s"}</span>
                </span>
              </summary>
              <div class="event-contract-body">
                ${eventsHtml}
              </div>
            </details>
          `;
        })
        .join("");

      return `
        <details class="section event-date-group"${groupIndex === 0 ? " open" : ""}>
          <summary>
            <span class="summary-chevron" aria-hidden="true">▸</span>
            <span class="summary-title">${formatDate(group.date)}</span>
            <span class="summary-meta">${group.contracts.size} contract${group.contracts.size === 1 ? "" : "s"}</span>
          </summary>
          <div class="event-date-body">
            ${contractsHtml}
          </div>
        </details>
      `;
    })
    .join("");

  if (status) {
    status.textContent = `Showing ${filtered.length} event${filtered.length === 1 ? "" : "s"} across ${dateGroupList.length} date${dateGroupList.length === 1 ? "" : "s"}.`;
  }

  document.querySelectorAll(".open-contract").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await loadDetail(btn.dataset.id);
      showPage("contracts");
    });
  });
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

function getFilteredEvents() {
  const search = ($("eventSearch")?.value || "").toLowerCase();
  const expiringOnly = $("expiringOnly")?.checked;
  return state.events.filter((ev) => {
    const term = `${ev.title || ""} ${ev.vendor || ""} ${ev.event_type || ""} ${ev.derived_from_term_key || ""}`.toLowerCase();
    const matchesSearch = !search || term.includes(search);
    const matchesExpiring = !expiringOnly || EXPIRING_TYPES.includes((ev.event_type || "").toLowerCase());
    return matchesSearch && matchesExpiring;
  });
}

async function exportEventsCsv() {
  const filtered = getFilteredEvents();
  if (!filtered.length) {
    await showAlert("There are no events in the current view to export.", { title: "Nothing to export" });
    return;
  }
  const headers = [
    { key: "contract_id", label: "Contract ID" },
    { key: "contract_title", label: "Contract Title" },
    { key: "vendor", label: "Vendor" },
    { key: "agreement_type", label: "Agreement Type" },
    { key: "event_id", label: "Event ID" },
    { key: "event_type", label: "Event Type" },
    { key: "event_date", label: "Event Date" },
    { key: "derived_from_term_key", label: "Derived Term" },
    { key: "days_until", label: "Days Until" },
    { key: "reminder_status", label: "Reminder Status" },
    { key: "reminder_offsets", label: "Reminder Offsets" },
    { key: "reminder_recipients", label: "Reminder Recipients" },
  ];
  const rows = filtered.map((ev) => {
    const reminder = ev.reminder;
    return {
      contract_id: ev.contract_id || "",
      contract_title: ev.title || "",
      vendor: ev.vendor || "",
      agreement_type: ev.agreement_type || "",
      event_id: ev.id || "",
      event_type: ev.event_type || "",
      event_date: ev.event_date || "",
      derived_from_term_key: ev.derived_from_term_key || "",
      days_until: daysUntil(ev.event_date) ?? "",
      reminder_status: reminder ? (reminder.enabled ? "Enabled" : "Disabled") : "Not configured",
      reminder_offsets: reminder?.offsets?.join("; ") || "",
      reminder_recipients: reminder?.recipients?.join("; ") || "",
    };
  });
  downloadCsv(`events-${timestampForFilename()}.csv`, headers, rows);
}

async function exportPlannerCsv() {
  if (!state.plannerEvents.length) {
    await showAlert("There are no planner events in the current view to export.", { title: "Nothing to export" });
    return;
  }
  const contractLookup = new Map(state.contracts.map((c) => [c.id, c]));
  const headers = [
    { key: "contract_id", label: "Contract ID" },
    { key: "contract_title", label: "Contract Title" },
    { key: "vendor", label: "Vendor" },
    { key: "event_id", label: "Event ID" },
    { key: "event_type", label: "Event Type" },
    { key: "event_date", label: "Event Date" },
  ];
  const rows = state.plannerEvents.map((ev) => {
    const contract = contractLookup.get(ev.contract_id);
    return {
      contract_id: ev.contract_id || "",
      contract_title: contract?.title || "",
      vendor: contract?.vendor || "",
      event_id: ev.id || "",
      event_type: ev.event_type || "",
      event_date: ev.event_date || "",
    };
  });
  downloadCsv(`planner-events-${timestampForFilename()}.csv`, headers, rows);
}

async function exportAllContractsCsv() {
  if (!state.allContracts.length) {
    await showAlert("There are no contracts in the current view to export.", { title: "Nothing to export" });
    return;
  }
  const headers = [
    { key: "id", label: "Contract ID" },
    { key: "title", label: "Title" },
    { key: "vendor", label: "Vendor" },
    { key: "agreement_type", label: "Agreement Type" },
    { key: "status", label: "Status" },
    { key: "uploaded_at", label: "Uploaded At" },
  ];
  const rows = state.allContracts.map((c) => ({
    id: c.id || "",
    title: c.title || c.original_filename || "",
    vendor: c.vendor || "",
    agreement_type: c.agreement_type || "",
    status: c.status || "",
    uploaded_at: c.uploaded_at || "",
  }));
  downloadCsv(`contracts-${timestampForFilename()}.csv`, headers, rows);
}

function showPage(page) {
  const pages = ["contracts", "allContracts", "events", "planner", "outputs"];
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
  $("eventPrevMonth")?.addEventListener("click", () => {
    const input = $("eventMonth");
    if (!input) return;
    if ($("eventAllMonths")) $("eventAllMonths").checked = false;
    input.value = shiftMonthValue(input.value, -1);
    loadEvents();
  });
  $("eventNextMonth")?.addEventListener("click", () => {
    const input = $("eventMonth");
    if (!input) return;
    if ($("eventAllMonths")) $("eventAllMonths").checked = false;
    input.value = shiftMonthValue(input.value, 1);
    loadEvents();
  });
  $("eventsRefresh")?.addEventListener("click", loadEvents);
  $("eventsExport")?.addEventListener("click", exportEventsCsv);
}

function renderPlannerCalendar() {
  const calendar = $("plannerCalendar");
  if (!calendar) return;

  const monthValue = $("plannerAllMonths")?.checked ? "all" : $("plannerMonth")?.value || defaultMonthValue();
  if (monthValue === "all") {
    calendar.innerHTML = `<div class="planner-cell" style="grid-column:1 / -1;">Select a single month to see the grid view.</div>`;
    return;
  }

  const [yearStr, monthStr] = monthValue.split("-");
  const year = Number.parseInt(yearStr, 10);
  const monthIndex = Number.parseInt(monthStr, 10) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    calendar.innerHTML = `<div class="planner-cell" style="grid-column:1 / -1;">Invalid month selection.</div>`;
    return;
  }

  const headers = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const firstDay = new Date(year, monthIndex, 1);
  const startDay = firstDay.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const prevMonthDays = new Date(year, monthIndex, 0).getDate();
  const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;

  const entriesByDay = new Map();
  state.plannerEvents.forEach((ev) => {
    if (!ev.event_date) return;
    const eventDate = new Date(ev.event_date);
    if (Number.isNaN(eventDate.getTime())) return;
    if (eventDate.getFullYear() !== year || eventDate.getMonth() !== monthIndex) return;
    const day = eventDate.getDate();
    if (!entriesByDay.has(day)) entriesByDay.set(day, []);
    entriesByDay.get(day).push(ev);
  });

  let html = headers.map((label) => `<div class="planner-cell planner-header">${label}</div>`).join("");

  for (let i = 0; i < totalCells; i += 1) {
    const dayNumber = i - startDay + 1;
    let displayDay = dayNumber;
    let muted = false;
    if (dayNumber <= 0) {
      displayDay = prevMonthDays + dayNumber;
      muted = true;
    } else if (dayNumber > daysInMonth) {
      displayDay = dayNumber - daysInMonth;
      muted = true;
    }

    const entries = dayNumber >= 1 && dayNumber <= daysInMonth ? entriesByDay.get(dayNumber) || [] : [];
    const visibleEntries = entries.slice(0, 3);
    const moreCount = entries.length - visibleEntries.length;

    const entriesHtml = visibleEntries
      .map((ev) => {
        const contract = state.contracts.find((c) => c.id === ev.contract_id);
        const label = contract?.title || contract?.vendor || ev.title || ev.contract_id || "Contract";
        const typeLabel = titleCase(ev.event_type || "event");
        const typeClass = ev.event_type ? `event-${ev.event_type}` : "";
        const expired =
          daysUntil(ev.event_date) < 0 &&
          EXPIRING_TYPES.includes((ev.event_type || "").toLowerCase());
        const tooltipLines = [
          `Contract: ${label}`,
          contract?.vendor ? `Vendor: ${contract.vendor}` : null,
          contract?.agreement_type ? `Type: ${contract.agreement_type}` : null,
          `Event: ${typeLabel}`,
          `Date: ${formatDate(ev.event_date)}`,
        ].filter(Boolean);
        const tooltip = escapeHtml(tooltipLines.join("\n")).replace(/\n/g, "&#10;");
        return `
          <div class="planner-entry ${typeClass}" data-contract="${ev.contract_id || ""}" data-tooltip="${tooltip}" role="button" tabindex="0">
            <div class="entry-title">${abbreviateText(label)}</div>
            <div class="entry-meta">${typeLabel}</div>
            ${expired ? `<div class="expired-bell" title="Expired">🔔 Expired</div>` : ""}
          </div>
        `;
      })
      .join("");

    html += `
      <div class="planner-cell">
        <div class="planner-day ${muted ? "muted" : ""}">
          <span>${displayDay}</span>
        </div>
        ${entriesHtml || `<div class="planner-empty"></div>`}
        ${moreCount > 0 ? `<div class="planner-more">+${moreCount} more</div>` : ""}
      </div>
    `;
  }

  calendar.innerHTML = html;
  calendar.querySelectorAll(".planner-entry[data-contract]").forEach((entry) => {
    entry.addEventListener("click", async () => {
      const contractId = entry.dataset.contract;
      if (!contractId) return;
      showPage("contracts");
      await loadDetail(contractId);
    });
    entry.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      entry.click();
    });
  });
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
    renderPlannerCalendar();
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
  $("plannerPrevMonth")?.addEventListener("click", () => {
    const input = $("plannerMonth");
    if (!input) return;
    if ($("plannerAllMonths")) $("plannerAllMonths").checked = false;
    input.value = shiftMonthValue(input.value, -1);
    loadPlannerEvents();
  });
  $("plannerNextMonth")?.addEventListener("click", () => {
    const input = $("plannerMonth");
    if (!input) return;
    if ($("plannerAllMonths")) $("plannerAllMonths").checked = false;
    input.value = shiftMonthValue(input.value, 1);
    loadPlannerEvents();
  });
  $("plannerRefresh")?.addEventListener("click", loadPlannerEvents);
  $("plannerExport")?.addEventListener("click", exportPlannerCsv);
}

$("navContracts")?.addEventListener("click", () => showPage("contracts"));
$("navAllContracts")?.addEventListener("click", () => showPage("allContracts"));
$("navEvents")?.addEventListener("click", () => showPage("events"));
$("navPlanner")?.addEventListener("click", () => showPage("planner"));
$("navOutputs")?.addEventListener("click", () => showPage("outputs"));

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
