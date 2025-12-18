const $ = (id) => document.getElementById(id);

function getApiBase() {
  return localStorage.getItem("apiBase") || "http://192.168.149.8:8080";
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

  // Uses your existing endpoint:
  // /api/search?mode=quick&q=&limit=...
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

  // attach click handlers
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

$("saveApi").addEventListener("click", async () => {
  setApiBase($("apiBase").value.trim());
  setApiUi();
  await testApi();
  await loadRecent();
});

$("refresh").addEventListener("click", loadRecent);

setApiUi();
initDropzone();
testApi().then(loadRecent);
