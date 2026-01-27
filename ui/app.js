const $ = (id) => document.getElementById(id);
const state = {
  events: [],
  plannerEvents: [],
  definitions: [],
  tags: [],
  roles: [],
  agreementTypes: [],
  agreementTypeCatalog: [],
  contracts: [],
  allContracts: [],
  allContractsQuery: "",
  allContractsOffset: 0,
  allContractsLimit: 200,
  allContractsStatusFilter: "all",
  allContractsTypeFilter: "all",
  currentPage: "contracts",
  selectedContractId: null,
  previewFullscreen: false,
  previewMode: "split",
  notificationUsers: [],
  pendingAgreementReminders: [],
  pendingAgreements: [],
  pendingAgreementsQuery: "",
  pendingAgreementsOffset: 0,
  pendingAgreementsLimit: 20,
  pendingAgreementsTotal: 0,
  pendingAgreementsHasMore: false,
  pendingAgreementsExpanded: false,
  pendingAgreementRecipients: [],
  pendingAgreementNotes: [],
  pendingAgreementFiles: [],
  tasks: [],
  tasksQuery: "",
  tasksOffset: 0,
  tasksLimit: 20,
  tasksTotal: 0,
  tasksHasMore: false,
  tasksExpanded: false,
  notificationLogs: [],
  notificationLogQuery: "",
  notificationLogStatus: "all",
  notificationLogKind: "all",
  notificationLogOffset: 0,
  notificationLogLimit: 40,
  notificationLogTotal: 0,
  notificationLogHasMore: false,
  notificationEventReminders: [],
  notificationPendingReminders: [],
  notificationTaskReminders: [],
  adminUsers: [],
  tagPermissions: {},
  permissionDefinitions: [],
  permissionAssignments: {},
  userPermissions: [],
  adminUserEditId: null,
  adminUserModalTrigger: null,
  adminRoleEditId: null,
  adminProfitCenterEditId: null,
  adminProfitCenterModalTrigger: null,
  newUserNotificationEmail: "",
  profitCenters: [],
  currentUser: null,
  authReady: false,
  authRequired: false,
  oidcEnabled: false,
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
const pendingReminderModalState = { reminderId: null };
const pendingAgreementModalState = { agreementId: null };
const tourState = { steps: [], index: 0, active: false, currentTarget: null };

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

function closeConfirmModal(result) {
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

function showToast(message, { variant = "success", timeout = 30000 } = {}) {
  const container = $("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${variant}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss notification">×</button>
  `;
  container.appendChild(toast);

  const removeToast = () => {
    toast.classList.add("toast-hide");
    window.setTimeout(() => toast.remove(), 220);
  };

  const timer = window.setTimeout(removeToast, timeout);
  toast.querySelector(".toast-close")?.addEventListener("click", () => {
    window.clearTimeout(timer);
    removeToast();
  });
}

function initCollapsibleHeaders(root = document) {
  root.querySelectorAll("details").forEach((detailsEl) => {
    const summary = detailsEl.querySelector(":scope > summary.sgh-collapsible-header");
    if (!summary) return;
    const updateAria = () => {
      summary.setAttribute("aria-expanded", detailsEl.open ? "true" : "false");
    };
    updateAria();
    if (!detailsEl.dataset.sghCollapsibleBound) {
      detailsEl.addEventListener("toggle", updateAria);
      detailsEl.dataset.sghCollapsibleBound = "true";
    }
  });
}

function initModal() {
  const { overlay, confirm, cancel, close } = getModalElements();
  if (!overlay || !confirm || !cancel || !close) return;

  confirm.addEventListener("click", () => closeConfirmModal(true));
  cancel.addEventListener("click", () => closeConfirmModal(false));
  close.addEventListener("click", () => closeConfirmModal(false));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeConfirmModal(!modalState.showCancel);
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.classList.contains("hidden")) {
      closeConfirmModal(!modalState.showCancel);
    }
  });
}

function getAuthElements() {
  return {
    overlay: $("authOverlay"),
    form: $("authForm"),
    email: $("authEmail"),
    password: $("authPassword"),
    error: $("authError"),
    status: $("authStatus"),
    loginButton: $("authLoginButton"),
    logoutButton: $("authLogoutButton"),
    microsoftButton: $("authMicrosoftButton"),
  };
}

function showAuthOverlay(message = "") {
  const { overlay, error, email } = getAuthElements();
  if (!overlay) return;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  if (error) error.textContent = message;
  if (email) email.focus();
}

function hideAuthOverlay() {
  const { overlay, error, password } = getAuthElements();
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  if (error) error.textContent = "";
  if (password) password.value = "";
}

function renderAuthStatus() {
  const { status, loginButton, logoutButton, microsoftButton } = getAuthElements();
  if (!status || !loginButton || !logoutButton) return;
  const currentUser = state.currentUser?.user || state.currentUser;
  if (currentUser) {
    status.textContent = `Signed in as ${currentUser.name || currentUser.email}`;
    loginButton.classList.add("hidden");
    logoutButton.classList.remove("hidden");
  } else {
    status.textContent = "Not signed in";
    loginButton.classList.remove("hidden");
    logoutButton.classList.add("hidden");
  }
  const adminButton = $("navAdmin");
  if (adminButton) {
    const isAdmin = !state.authRequired || (currentUser && currentUser.roles?.includes("admin"));
    adminButton.classList.toggle("hidden", !isAdmin);
  }
  if (microsoftButton) {
    microsoftButton.classList.toggle("hidden", !state.oidcEnabled);
  }
}

function getCurrentUser() {
  return state.currentUser?.user || state.currentUser;
}

function isAdminUser() {
  const currentUser = getCurrentUser();
  return !state.authRequired || (currentUser && currentUser.roles?.includes("admin"));
}

function hasPermission(permissionKey) {
  if (!state.authRequired) return true;
  if (isAdminUser()) return true;
  return state.userPermissions.includes(permissionKey);
}

function applyPermissionVisibility() {
  const pendingNav = $("navPendingAgreements");
  const tasksNav = $("navTasks");
  if (pendingNav) {
    pendingNav.classList.toggle("hidden", !hasPermission("pending_agreements_view"));
  }
  if (tasksNav) {
    tasksNav.classList.toggle("hidden", !hasPermission("tasks_view"));
  }

  $("pendingRemindersCard")?.classList.toggle(
    "hidden",
    !hasPermission("pending_agreement_reminders_manage"),
  );
  $("pendingUserDirectorySection")?.classList.toggle("hidden", !hasPermission("user_directory_view"));
  $("pendingAgreementRecipientsSection")?.classList.toggle(
    "hidden",
    !hasPermission("pending_agreements_manage"),
  );
  $("pendingAgreementsAdd")?.classList.toggle("hidden", !hasPermission("pending_agreements_view"));

  $("taskCreateCard")?.classList.toggle("hidden", !hasPermission("tasks_manage"));
  $("taskUserDirectorySection")?.classList.toggle("hidden", !hasPermission("user_directory_view"));

  renderPendingAgreementsQueue();
  renderPendingReminderTable();
  renderTaskTable();
  renderUserDirectories();
}

async function loginUser(email, password) {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  state.currentUser = await res.json();
  renderAuthStatus();
  hideAuthOverlay();
  return state.currentUser;
}

async function logoutUser() {
  await apiFetch("/api/auth/logout", { method: "POST" });
  state.currentUser = null;
  state.userPermissions = [];
  renderAuthStatus();
  applyPermissionVisibility();
  showAuthOverlay();
}

async function ensureAuth() {
  if (state.authReady) return !!state.currentUser;
  try {
    const res = await apiFetch("/api/auth/me");
    const data = await res.json();
    state.currentUser = data.user;
    state.authRequired = Boolean(data.auth_required);
    state.oidcEnabled = Boolean(data.oidc_enabled);
    state.authReady = true;
    renderAuthStatus();
    if (!data.user && data.auth_required) {
      showAuthOverlay();
    }
    return Boolean(data.user) || !data.auth_required;
  } catch (err) {
    state.authReady = true;
    state.currentUser = null;
    state.authRequired = true;
    state.oidcEnabled = false;
    renderAuthStatus();
    showAuthOverlay();
    return false;
  }
}

function initAuthUi() {
  const { form, loginButton, logoutButton, error, microsoftButton } = getAuthElements();
  if (loginButton) loginButton.addEventListener("click", () => showAuthOverlay());
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        await logoutUser();
      } catch (err) {
        if (error) error.textContent = err.message || "Unable to sign out.";
      }
    });
  }
  if (microsoftButton) {
    microsoftButton.addEventListener("click", () => {
      const returnTo = encodeURIComponent(window.location.href);
      window.location.href = `${getApiBase()}/api/auth/oidc/login?return_to=${returnTo}`;
    });
  }
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = $("authEmail")?.value?.trim();
      const password = $("authPassword")?.value || "";
      if (!email || !password) {
        if (error) error.textContent = "Email and password are required.";
        return;
      }
      try {
        if (error) error.textContent = "";
        await loginUser(email, password);
        await loadAppData();
      } catch (err) {
        if (error) error.textContent = err.message || "Unable to sign in.";
      }
    });
  }
}

function getPendingReminderModalElements() {
  return {
    overlay: $("pendingReminderModal"),
    title: $("pendingReminderModalTitle"),
    frequency: $("pendingReminderEditFrequency"),
    roleContainer: $("pendingReminderEditRoles"),
    recipientContainer: $("pendingReminderEditRecipients"),
    message: $("pendingReminderEditMessage"),
    cancel: $("pendingReminderEditCancel"),
    close: $("pendingReminderEditClose"),
    save: $("pendingReminderEditSave"),
  };
}

function openPendingReminderModal(reminder) {
  const { overlay, title, frequency, message } = getPendingReminderModalElements();
  if (!overlay || !frequency || !title || !message) return;
  pendingReminderModalState.reminderId = reminder.id;
  title.textContent = "Edit reminder rule";
  frequency.value = reminder.frequency || "weekly";
  message.value = reminder.message || "";
  renderCheckboxList("pendingReminderEditRoles", state.roles, reminder.roles || []);
  renderCheckboxList(
    "pendingReminderEditRecipients",
    state.notificationUsers,
    reminder.recipients || [],
  );
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  frequency.focus();
}

function closePendingReminderModal() {
  const { overlay } = getPendingReminderModalElements();
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  pendingReminderModalState.reminderId = null;
}

function getPendingAgreementModalElements() {
  return {
    overlay: $("pendingAgreementModal"),
    title: $("pendingAgreementModalTitle"),
    description: $("pendingAgreementModalDescription"),
    internalCompany: $("pendingAgreementEditInternalCompany"),
    teamMember: $("pendingAgreementEditTeamMember"),
    requesterEmail: $("pendingAgreementEditRequesterEmail"),
    attorneyAssigned: $("pendingAgreementEditAttorneyAssigned"),
    matter: $("pendingAgreementEditMatter"),
    status: $("pendingAgreementEditStatus"),
    statusNotes: $("pendingAgreementEditStatusNotes"),
    internalCompletionDate: $("pendingAgreementEditInternalCompletionDate"),
    fullyExecutedDate: $("pendingAgreementEditFullyExecutedDate"),
    ownerEmailList: $("pendingAgreementOwnerEmails"),
    filesList: $("pendingAgreementFilesList"),
    fileType: $("pendingAgreementFileType"),
    fileUpload: $("pendingAgreementFileUpload"),
    fileUploadButton: $("pendingAgreementFileUploadButton"),
    fileStatus: $("pendingAgreementFileStatus"),
    notesList: $("pendingAgreementNotesList"),
    noteInput: $("pendingAgreementNoteInput"),
    noteAdd: $("pendingAgreementNoteAdd"),
    noteStatus: $("pendingAgreementNoteStatus"),
    cancel: $("pendingAgreementEditCancel"),
    close: $("pendingAgreementEditClose"),
    save: $("pendingAgreementEditSave"),
  };
}

function toInputDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function renderPendingAgreementOwnerEmails() {
  const { ownerEmailList } = getPendingAgreementModalElements();
  if (!ownerEmailList) return;
  ownerEmailList.innerHTML = state.notificationUsers
    .map((user) => `<option value="${escapeHtml(user.email)}"></option>`)
    .join("");
}

function renderAttorneyOptions(selectEl, selectedValue) {
  if (!selectEl) return;
  const options = [
    { label: "Unassigned", value: "" },
    ...state.notificationUsers.map((user) => ({
      label: `${user.name} (${user.email})`,
      value: user.email,
    })),
  ];
  selectEl.innerHTML = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${option.value === selectedValue ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
}

function renderPendingAgreementFiles() {
  const { filesList } = getPendingAgreementModalElements();
  if (!filesList) return;
  if (!state.pendingAgreementFiles.length) {
    filesList.textContent = "No files uploaded yet.";
    return;
  }
  filesList.innerHTML = state.pendingAgreementFiles
    .map((file) => {
      const link = `${getApiBase()}/api/pending-agreement-files/${file.id}`;
      const label = `${file.file_name} (${file.file_type})`;
      const uploaded = formatDateTime(file.uploaded_at);
      return `<div><a href="${link}" target="_blank" rel="noopener">${escapeHtml(label)}</a> · <span class="muted">${escapeHtml(uploaded)}</span></div>`;
    })
    .join("");
}

function renderPendingAgreementNotes() {
  const { notesList } = getPendingAgreementModalElements();
  if (!notesList) return;
  if (!state.pendingAgreementNotes.length) {
    notesList.textContent = "No notes yet.";
    return;
  }
  notesList.innerHTML = state.pendingAgreementNotes
    .map((note) => {
      const author = note.user_name || note.user_email || "Unknown";
      return `<div style="margin-bottom:6px;"><div>${escapeHtml(note.note)}</div><div class="muted small">${escapeHtml(author)} · ${escapeHtml(formatDateTime(note.created_at))}</div></div>`;
    })
    .join("");
}

function setPendingAgreementModalReadOnly(isReadOnly) {
  const {
    internalCompany,
    teamMember,
    requesterEmail,
    attorneyAssigned,
    matter,
    status,
    statusNotes,
    internalCompletionDate,
    fullyExecutedDate,
    save,
    noteInput,
    noteAdd,
  } = getPendingAgreementModalElements();
  [internalCompany, teamMember, requesterEmail, attorneyAssigned, matter, status, statusNotes, internalCompletionDate, fullyExecutedDate]
    .filter(Boolean)
    .forEach((input) => {
      input.disabled = isReadOnly;
    });
  if (save) save.classList.toggle("hidden", isReadOnly);
  if (noteInput) noteInput.disabled = isReadOnly;
  if (noteAdd) noteAdd.disabled = isReadOnly;
}

function openPendingAgreementModal(agreement) {
  const {
    overlay,
    title,
    description,
    internalCompany,
    teamMember,
    requesterEmail,
    attorneyAssigned,
    matter,
    status,
    statusNotes,
    internalCompletionDate,
    fullyExecutedDate,
    fileType,
    fileUpload,
    fileUploadButton,
    save,
  } =
    getPendingAgreementModalElements();
  if (
    !overlay ||
    !title ||
    !internalCompany ||
    !teamMember ||
    !requesterEmail ||
    !attorneyAssigned ||
    !matter ||
    !status ||
    !statusNotes ||
    !internalCompletionDate ||
    !fullyExecutedDate ||
    !save
  ) {
    return;
  }
  renderPendingAgreementOwnerEmails();
  pendingAgreementModalState.agreementId = agreement.id;
  title.textContent = hasPermission("pending_agreements_manage")
    ? "Edit pending agreement"
    : "Pending agreement details";
  if (description) {
    description.textContent = hasPermission("pending_agreements_manage")
      ? "Update the details for this approval item."
      : "Review the submission details.";
  }
  save.textContent = "Save changes";
  internalCompany.value = agreement.internal_company || "";
  teamMember.value = agreement.team_member || "";
  requesterEmail.value = agreement.requester_email || "";
  renderAttorneyOptions(attorneyAssigned, agreement.attorney_assigned || "");
  matter.value = agreement.matter || agreement.title || "";
  status.value = agreement.status || "";
  statusNotes.value = agreement.status_notes || agreement.latest_note || "";
  internalCompletionDate.value = toInputDate(agreement.internal_completion_date);
  fullyExecutedDate.value = toInputDate(agreement.fully_executed_date);
  const canManage = hasPermission("pending_agreements_manage");
  setPendingAgreementModalReadOnly(!canManage);
  const isOwner =
    agreement.requester_email &&
    state.currentUser?.email &&
    agreement.requester_email.toLowerCase() === state.currentUser.email.toLowerCase();
  const canUpload = canManage || isOwner;
  if (fileType) {
    fileType.disabled = !canManage;
    if (!canManage) fileType.value = "draft";
  }
  if (fileUpload) fileUpload.disabled = !canUpload;
  if (fileUploadButton) fileUploadButton.disabled = !canUpload;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  internalCompany.focus();
  loadPendingAgreementDetails(agreement.id);
}

function closePendingAgreementModal() {
  const { overlay } = getPendingAgreementModalElements();
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  pendingAgreementModalState.agreementId = null;
}

function getPendingAgreementIntakeElements() {
  return {
    overlay: $("pendingAgreementIntakeModal"),
    internalCompany: $("pendingAgreementIntakeInternalCompany"),
    teamMember: $("pendingAgreementIntakeTeamMember"),
    requesterEmail: $("pendingAgreementIntakeRequesterEmail"),
    attorneyAssigned: $("pendingAgreementIntakeAttorneyAssigned"),
    matter: $("pendingAgreementIntakeMatter"),
    statusNotes: $("pendingAgreementIntakeStatusNotes"),
    file: $("pendingAgreementIntakeFile"),
    cancel: $("pendingAgreementIntakeCancel"),
    close: $("pendingAgreementIntakeClose"),
    save: $("pendingAgreementIntakeSave"),
  };
}

function openPendingAgreementIntakeModal() {
  const {
    overlay,
    internalCompany,
    teamMember,
    requesterEmail,
    attorneyAssigned,
    matter,
    statusNotes,
  } = getPendingAgreementIntakeElements();
  if (!overlay || !internalCompany || !teamMember || !requesterEmail || !attorneyAssigned || !matter || !statusNotes) {
    return;
  }
  renderAttorneyOptions(attorneyAssigned, "");
  internalCompany.value = "";
  teamMember.value = state.currentUser?.name || "";
  requesterEmail.value = state.currentUser?.email || "";
  matter.value = "";
  statusNotes.value = "";
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  internalCompany.focus();
}

function closePendingAgreementIntakeModal() {
  const { overlay } = getPendingAgreementIntakeElements();
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

async function loadPendingAgreementDetails(agreementId) {
  try {
    const [notes, files] = await Promise.all([
      fetchPendingAgreementNotes(agreementId),
      fetchPendingAgreementFiles(agreementId),
    ]);
    state.pendingAgreementNotes = notes || [];
    state.pendingAgreementFiles = files || [];
  } catch (err) {
    state.pendingAgreementNotes = [];
    state.pendingAgreementFiles = [];
  }
  renderPendingAgreementNotes();
  renderPendingAgreementFiles();
}

function getApiBase() {
  if (window.API_BASE) {
    return window.API_BASE;
  }
  if (window.location && window.location.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return "https://127.0.0.1:8080";
}

const THEME_STORAGE_KEY = "uiTheme";

function getPreferredTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY) || "light";
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("theme-dark", isDark);
  const label = $("themeLabel");
  const toggle = $("themeToggle");
  if (label) label.textContent = `Theme: ${isDark ? "Dark" : "Light"}`;
  if (toggle) toggle.textContent = `Switch to ${isDark ? "Light" : "Dark"} Theme`;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function initThemeToggle() {
  const toggle = $("themeToggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    const nextTheme = document.body.classList.contains("theme-dark") ? "light" : "dark";
    applyTheme(nextTheme);
  });
  applyTheme(getPreferredTheme());
}

function setPreviewFullscreen(isActive) {
  state.previewFullscreen = isActive;
  document.body.classList.toggle("preview-fullscreen", isActive);
  const toggle = $("togglePreviewFullscreen");
  if (toggle) {
    toggle.textContent = isActive ? "Exit full screen" : "Expand";
    toggle.setAttribute("aria-pressed", String(isActive));
  }
}

function setPreviewMode(mode) {
  const allowed = ["split", "pdf", "ocr"];
  const next = allowed.includes(mode) ? mode : "split";
  state.previewMode = next;
  document.body.classList.remove("preview-mode-split", "preview-mode-pdf", "preview-mode-ocr");
  document.body.classList.add(`preview-mode-${next}`);
  document.querySelectorAll("[data-preview-mode]").forEach((btn) => {
    const isActive = btn.dataset.previewMode === next;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
}

function setQueueExpanded(queueKey, isExpanded) {
  const isPending = queueKey === "pendingAgreements";
  const card = $(isPending ? "pendingAgreementsQueueCard" : "taskQueueCard");
  const toggle = $(isPending ? "pendingAgreementsQueueExpand" : "taskQueueExpand");
  if (!card) return;
  card.classList.toggle("queue-expanded", isExpanded);
  document.body.classList.toggle("queue-fullscreen", isExpanded);
  if (toggle) {
    toggle.textContent = isExpanded ? "Exit full screen" : "Expand";
    toggle.setAttribute("aria-pressed", String(isExpanded));
  }
  if (isPending) {
    state.pendingAgreementsExpanded = isExpanded;
  } else {
    state.tasksExpanded = isExpanded;
  }
}

function toggleQueueExpanded(queueKey) {
  const isPending = queueKey === "pendingAgreements";
  const current = isPending ? state.pendingAgreementsExpanded : state.tasksExpanded;
  if (!current) {
    if (isPending && state.tasksExpanded) {
      setQueueExpanded("tasks", false);
    }
    if (!isPending && state.pendingAgreementsExpanded) {
      setQueueExpanded("pendingAgreements", false);
    }
  }
  setQueueExpanded(queueKey, !current);
}

function initPreviewFullscreen() {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.previewFullscreen) {
      setPreviewFullscreen(false);
    }
    if (event.key === "Escape") {
      if (state.pendingAgreementsExpanded) {
        setQueueExpanded("pendingAgreements", false);
      }
      if (state.tasksExpanded) {
        setQueueExpanded("tasks", false);
      }
    }
  });
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
  const options = { ...opts };
  if (!options.credentials) {
    options.credentials = "include";
  }
  const res = await fetch(url, options);
  if (res.status === 401) {
    showAuthOverlay();
  }
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

async function fetchOptionalJson(path, fallback) {
  try {
    const res = await apiFetch(path);
    return await res.json();
  } catch (err) {
    return fallback;
  }
}

async function fetchPermissionMatrix() {
  const res = await apiFetch("/api/permissions");
  return res.json();
}

async function updatePermissionMatrix(permissionKey, roles) {
  const res = await apiFetch(`/api/permissions/${encodeURIComponent(permissionKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roles }),
  });
  return res.json();
}

async function createNotificationUser(payload) {
  const res = await apiFetch("/api/notification-users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function deleteNotificationUser(userId) {
  await apiFetch(`/api/notification-users/${userId}`, { method: "DELETE" });
}

async function fetchAdminUsers() {
  const res = await apiFetch("/api/admin/users");
  return res.json();
}

async function fetchNewUserNotificationEmail() {
  const res = await apiFetch("/api/admin/new-user-notification-email");
  return res.json();
}

async function updateNewUserNotificationEmail(email) {
  const res = await apiFetch("/api/admin/new-user-notification-email", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return res.json();
}

async function createAdminUser(payload) {
  const res = await apiFetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function updateAdminUser(userId, payload) {
  const res = await apiFetch(`/api/admin/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function createRole(payload) {
  const res = await apiFetch("/api/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function updateRole(roleId, payload) {
  const res = await apiFetch(`/api/roles/${roleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function deleteRole(roleId) {
  await apiFetch(`/api/roles/${roleId}`, { method: "DELETE" });
}

async function createAgreementType(payload) {
  const res = await apiFetch("/api/agreement-types", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function deleteAgreementType(typeId) {
  await apiFetch(`/api/agreement-types/${typeId}`, { method: "DELETE" });
}

async function fetchAgreementTypeKeywords() {
  const res = await apiFetch("/api/agreement-type-keywords");
  return res.json();
}

async function createAgreementTypeKeyword(payload) {
  const res = await apiFetch("/api/agreement-type-keywords", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function deleteAgreementTypeKeyword(keywordId) {
  await apiFetch(`/api/agreement-type-keywords/${keywordId}`, { method: "DELETE" });
}

async function fetchProfitCenters() {
  const res = await apiFetch("/api/profit-centers");
  return res.json();
}

async function ensureProfitCentersLoaded() {
  if (state.profitCenters.length) return;
  try {
    state.profitCenters = await fetchProfitCenters();
  } catch {
    state.profitCenters = [];
  }
}

async function createProfitCenter(payload) {
  const res = await apiFetch("/api/profit-centers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function updateProfitCenter(profitCenterId, payload) {
  const res = await apiFetch(`/api/profit-centers/${profitCenterId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function deleteProfitCenter(profitCenterId) {
  await apiFetch(`/api/profit-centers/${profitCenterId}`, { method: "DELETE" });
}

async function fetchTagPermissions() {
  const res = await apiFetch("/api/tag-permissions");
  return res.json();
}

async function updateTagPermissions(tagId, roles) {
  const res = await apiFetch(`/api/tag-permissions/${tagId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roles }),
  });
  return res.json();
}

async function fetchNotificationLogs({ query = "", status = "all", kind = "all", limit = 40, offset = 0 } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (query) params.set("query", query);
  if (status) params.set("status", status);
  if (kind) params.set("kind", kind);
  return apiFetch(`/api/notification-logs?${params.toString()}`);
}

async function fetchPendingAgreementReminders() {
  const res = await apiFetch("/api/pending-agreement-reminders");
  return res.json();
}

async function createPendingAgreementReminder(payload) {
  const res = await apiFetch("/api/pending-agreement-reminders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function updatePendingAgreementReminder(reminderId, payload) {
  const res = await apiFetch(`/api/pending-agreement-reminders/${reminderId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function deletePendingAgreementReminder(reminderId) {
  await apiFetch(`/api/pending-agreement-reminders/${reminderId}`, { method: "DELETE" });
}

async function fetchPendingAgreements({ limit = 20, offset = 0, query = "" } = {}) {
  const params = new URLSearchParams();
  params.set("limit", limit);
  params.set("offset", offset);
  if (query) params.set("query", query);
  const res = await apiFetch(`/api/pending-agreements?${params.toString()}`);
  return res.json();
}

async function fetchPendingAgreementDetail(agreementId) {
  const res = await apiFetch(`/api/pending-agreements/${agreementId}`);
  return res.json();
}

async function updatePendingAgreement(agreementId, payload) {
  const res = await apiFetch(`/api/pending-agreements/${agreementId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function createPendingAgreement(payload) {
  const res = await apiFetch("/api/pending-agreements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function createPendingAgreementIntake(formData) {
  const res = await apiFetch("/api/pending-agreements/intake", {
    method: "POST",
    body: formData,
  });
  return res.json();
}

async function fetchPendingAgreementNotes(agreementId) {
  const res = await apiFetch(`/api/pending-agreements/${agreementId}/notes`);
  return res.json();
}

async function createPendingAgreementNote(agreementId, note) {
  const res = await apiFetch(`/api/pending-agreements/${agreementId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  return res.json();
}

async function fetchPendingAgreementFiles(agreementId) {
  const res = await apiFetch(`/api/pending-agreements/${agreementId}/files`);
  return res.json();
}

async function uploadPendingAgreementFile(agreementId, formData) {
  const res = await apiFetch(`/api/pending-agreements/${agreementId}/files`, {
    method: "POST",
    body: formData,
  });
  return res.json();
}

async function fetchPendingAgreementRecipients() {
  const res = await apiFetch("/api/admin/pending-agreement-recipients");
  return res.json();
}

async function updatePendingAgreementRecipients(recipients) {
  const res = await apiFetch("/api/admin/pending-agreement-recipients", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipients }),
  });
  return res.json();
}

async function deletePendingAgreement(agreementId) {
  await apiFetch(`/api/pending-agreements/${agreementId}`, { method: "DELETE" });
}

async function nudgePendingAgreement(agreementId) {
  const res = await apiFetch(`/api/pending-agreements/${agreementId}/nudge`, {
    method: "POST",
  });
  return res.json();
}

async function actionPendingAgreement(agreementId, action) {
  const res = await apiFetch(`/api/pending-agreements/${agreementId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return res.json();
}

async function fetchTasks({ limit = 20, offset = 0, query = "" } = {}) {
  const params = new URLSearchParams();
  params.set("limit", limit);
  params.set("offset", offset);
  if (query) params.set("query", query);
  const res = await apiFetch(`/api/tasks?${params.toString()}`);
  return res.json();
}

async function createTask(payload) {
  const res = await apiFetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function updateTaskStatus(taskId, completed) {
  const res = await apiFetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completed }),
  });
  return res.json();
}

async function nudgeTask(taskId) {
  const res = await apiFetch(`/api/tasks/${taskId}/nudge`, { method: "POST" });
  return res.json();
}

function formatDate(dateStr) {
  if (!dateStr) return "Unknown date";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "Unknown time";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

async function testApi() {
  try {
    await apiFetch("/openapi.json");
    return true;
  } catch (e) {
    console.warn("API check failed:", e);
    return false;
  }
}

async function loadReferenceData() {
  const [defsRes, tagsRes, agRes] = await Promise.all([
    apiFetch("/api/terms/definitions"),
    apiFetch("/api/tags"),
    apiFetch("/api/agreement-types"),
  ]);
  const permissionsResponse = await fetchOptionalJson("/api/permissions/me", { permissions: [] });
  state.userPermissions = permissionsResponse.permissions || [];
  const shouldLoadNotificationUsers =
    hasPermission("user_directory_view") ||
    hasPermission("pending_agreement_reminders_manage") ||
    hasPermission("tasks_manage");
  const [notificationUsers, roles] = await Promise.all([
    shouldLoadNotificationUsers ? fetchOptionalJson("/api/notification-users", []) : [],
    fetchOptionalJson("/api/roles", []),
  ]);
  state.definitions = await defsRes.json();
  state.tags = await tagsRes.json();
  state.agreementTypes = await agRes.json();
  state.notificationUsers = notificationUsers;
  state.roles = roles;
  renderAllContractsFilters();
  renderNotificationOptions();
  renderPendingReminderTable();
  renderUserDirectories();
  applyPermissionVisibility();
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

function formatProfitCentersSummary(centers) {
  if (!Array.isArray(centers) || !centers.length) return "Unassigned";
  const labels = centers.map((center) => {
    const code = center.code ? `${center.code}` : "";
    const name = center.name ? ` — ${center.name}` : "";
    return `${code}${name}`.trim();
  });
  const shown = labels.slice(0, 2);
  const remaining = labels.length - shown.length;
  return remaining > 0 ? `${shown.join(", ")} (+${remaining} more)` : shown.join(", ");
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
  const isAdmin = isAdminUser();

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
      const actions = [
        `<a href="${getApiBase()}/api/contracts/${id}/original" target="_blank">View</a>`,
        isAdmin ? `<a href="${getApiBase()}/api/contracts/${id}/download" target="_blank">Download</a>` : null,
      ]
        .filter(Boolean)
        .join("&nbsp;|&nbsp;");
      return `
        <tr data-contract-id="${id}" class="${activeClass}">
          <td>${badge(r.status)}</td>
          <td><a href="#" data-id="${id}" class="open" title="${escapeHtml(title)}">${shortTitle}</a></td>
          <td class="small">${uploaded}</td>
          <td class="small">
            ${actions}
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

  updateSelectedRows();
}

function renderAllContractsTable(rows, append = false) {
  const tbody = $("allContractsTable");
  if (!tbody) return;
  if (!rows.length && !append) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">No contracts found.</td></tr>`;
    return;
  }

  const isAdmin = isAdminUser();
  const html = rows
    .map((r) => {
      const id = r.id;
      const title = r.title || r.original_filename || id;
      const uploaded = r.uploaded_at || "";
      const activeClass = id === state.selectedContractId ? "active-row" : "";
      const actions = [
        `<a href="${getApiBase()}/api/contracts/${id}/original" target="_blank">View</a>`,
        isAdmin ? `<a href="${getApiBase()}/api/contracts/${id}/download" target="_blank">Download</a>` : null,
        isAdmin ? `<button class="reprocess-btn" data-id="${id}">Reprocess</button>` : null,
      ]
        .filter(Boolean)
        .join("&nbsp;|&nbsp;");
      return `
        <tr data-contract-id="${id}" class="${activeClass}">
          <td>${badge(r.status)}</td>
          <td><a href="#" data-id="${id}" class="open-contract">${title}</a></td>
          <td class="small">${r.vendor || ""}</td>
          <td class="small">${r.agreement_type || "Uncategorized"}</td>
          <td class="small">${escapeHtml(formatProfitCentersSummary(r.profit_centers))}</td>
          <td class="small">${uploaded}</td>
          <td class="small">
            ${actions}
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
    params.set("mode", "fulltext");
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
  const assignedProfitCenters = Array.isArray(c.profit_centers) ? c.profit_centers : [];
  const assignedProfitCenterIds = new Set(
    (c.profit_center_ids || assignedProfitCenters.map((center) => center.id)).map((id) => String(id)),
  );
  const availableProfitCenters = state.profitCenters.length ? state.profitCenters : assignedProfitCenters;
  const profitCenterSummaryHtml = assignedProfitCenters.length
    ? Object.entries(
        assignedProfitCenters.reduce((grouped, center) => {
          const group = center.group_name || "Ungrouped";
          if (!grouped[group]) grouped[group] = [];
          grouped[group].push(center);
          return grouped;
        }, {}),
      )
        .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
        .map(([groupName, centers]) => {
          const labels = centers.map((center) => `${center.code} — ${center.name}`).join(", ");
          return `
            <div class="profit-center-line">
              <span class="profit-center-group">${escapeHtml(groupName)}</span>
              <span class="profit-center-items">${escapeHtml(labels)}</span>
            </div>
          `;
        })
        .join("")
    : `<span class="muted small">No profit centers assigned.</span>`;
  const isAdmin = isAdminUser();
  const termLookup = new Map(terms.map((t) => [t.term_key, t]));
  const eventLookup = new Map(events.filter((e) => e.derived_from_term_key).map((e) => [e.derived_from_term_key, e]));
  const vendorTerm = termLookup.get("vendor");
  const vendorFromTerms = vendorTerm ? vendorTerm.value_normalized || vendorTerm.value_raw || "" : "";
  const vendorAutoValue = c.vendor || vendorFromTerms;
  const mimeType = (c.mime_type || "").toLowerCase();
  const hasPreview = mimeType === "application/pdf" || mimeType.startsWith("image/");
  const previewSrc = `${getApiBase()}/api/contracts/${c.id}/original`;
  const previewHtml = hasPreview
    ? `<div class="preview-pane"><iframe class="preview-frame" src="${previewSrc}" title="Contract file preview"></iframe></div>`
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

  const profitCenterOptionsHtml = availableProfitCenters.length
    ? `<div class="profit-center-group-list">
        ${Object.entries(
          availableProfitCenters.reduce((grouped, center) => {
            const group = center.group_name || "Ungrouped";
            if (!grouped[group]) grouped[group] = [];
            grouped[group].push(center);
            return grouped;
          }, {}),
        )
          .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
          .map(([groupName, centers]) => {
            const centerOptions = centers
              .map((center) => {
                const label = `${center.code} — ${center.name}`;
                const checked = assignedProfitCenterIds.has(String(center.id)) ? "checked" : "";
                return `
                  <label class="inline small" style="gap:6px;">
                    <input type="checkbox" value="${center.id}" ${checked} />
                    <span>${escapeHtml(label)}</span>
                  </label>
                `;
              })
              .join("");
            return `
              <div class="profit-center-group-block">
                <div class="profit-center-group-title">${escapeHtml(groupName)}</div>
                <div class="profit-center-checkboxes">
                  ${centerOptions}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>`
    : `<div class="muted small">No profit centers configured yet.</div>`;

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
          <summary class="sgh-collapsible-header">
            <span class="summary-title sgh-collapsible-title">
              ${t.name || t.term_key}
              <span class="muted small">${t.term_key}</span>
              ${termEventLabel(t.term_key) ? `<span class="pill">${termEventLabel(t.term_key)} event</span>` : ""}
            </span>
            <span class="summary-meta">
              ${statusPill(t.status)}
              <span>${(t.confidence ?? 0).toFixed(2)}</span>
            </span>
            <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
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
            <summary class="sgh-collapsible-header">
              <span class="summary-title sgh-collapsible-title">
                ${eventTypePill(e.event_type)}
                ${e.derived_from_term_key ? `<span class="pill">From ${e.derived_from_term_key}</span>` : ""}
              </span>
              <span class="summary-meta">${formatDate(e.event_date)}</span>
              <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
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

  const actionButtons = isAdmin && c.status !== "processed" ? `<button id="reprocessContract">Reprocess</button>` : "";

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
    <details class="section">
      <summary class="sgh-collapsible-header">
        <span class="summary-title sgh-collapsible-title">Profit Centers</span>
        <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
      </summary>
      <div class="muted small" style="margin-top:6px;">
        ${isAdmin ? "Assign profit centers to control contract visibility." : "Assigned profit centers for this contract."}
      </div>
      <div class="profit-center-summary" style="margin-top:6px;">
        ${profitCenterSummaryHtml}
      </div>
      ${
        isAdmin
          ? `
            <div class="muted small" style="margin-top:10px;">Update assignments</div>
            <div id="contractProfitCenterOptions" style="margin-top:6px;">
              ${profitCenterOptionsHtml}
            </div>
            <div class="row wrap" style="margin-top:8px;">
              <button id="saveContractProfitCenters">Save profit centers</button>
            </div>
          `
          : ""
      }
    </details>
    <div class="section">
      <h4>Extracted Terms</h4>
      <div class="row wrap" style="gap:6px;">${termSummaryHtml}</div>
    </div>

    <details class="section" id="contractContent" open>
      <summary class="sgh-collapsible-header">
        <span class="summary-title sgh-collapsible-title">Content Preview</span>
        <span class="summary-meta">
          PDF or OCR text
          <span class="inline" style="gap:6px;">
            <button class="link-button preview-mode-toggle" type="button" data-preview-mode="split" aria-pressed="true">
              Split
            </button>
            <button class="link-button preview-mode-toggle" type="button" data-preview-mode="pdf" aria-pressed="false">
              PDF
            </button>
            <button class="link-button preview-mode-toggle" type="button" data-preview-mode="ocr" aria-pressed="false">
              OCR
            </button>
          </span>
          <button id="togglePreviewFullscreen" class="link-button" type="button" aria-pressed="false">
            Expand
          </button>
        </span>
        <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
      </summary>
      <div class="preview-grid">
        <div class="preview-panel preview-panel-pdf">
          <div class="small muted" style="margin-bottom:6px;">Document preview</div>
          ${previewHtml}
        </div>
        <div class="preview-panel preview-panel-ocr">
          <div class="small muted" style="margin-bottom:6px;">OCR text</div>
          <pre id="contractText" class="contract-text">Open to load text…</pre>
        </div>
      </div>
    </details>

    <details class="section">
      <summary class="sgh-collapsible-header">
        <span class="summary-title sgh-collapsible-title">Tags</span>
        <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
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
      <summary class="sgh-collapsible-header">
        <span class="summary-title sgh-collapsible-title">Terms</span>
        <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
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
      <summary class="sgh-collapsible-header">
        <span class="summary-title sgh-collapsible-title">Events</span>
        <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
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
      <summary class="sgh-collapsible-header">
        <span class="summary-title sgh-collapsible-title">Advanced Details</span>
        <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
      </summary>
      <div style="margin-top:8px">Status: ${badge(c.status)}</div>
      <div style="margin-top:8px;">
        Actions:
        <span class="inline" style="gap:8px; margin-left:6px;">${actionButtons}</span>
      </div>
    </details>
  `;

  initCollapsibleHeaders($("detail"));

  $("togglePreviewFullscreen")?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPreviewFullscreen(!state.previewFullscreen);
  });

  document.querySelectorAll(".preview-mode-toggle").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      setPreviewMode(btn.dataset.previewMode);
    });
  });

  setPreviewMode(state.previewMode);
  setPreviewFullscreen(state.previewFullscreen);

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

  $("saveContractProfitCenters")?.addEventListener("click", async () => {
    const profitCenterIds = getCheckedValues("contractProfitCenterOptions").map((value) => Number(value));
    try {
      await apiFetch(`/api/contracts/${c.id}/profit-centers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profit_center_ids: profitCenterIds }),
      });
      await loadDetail(c.id);
      showToast("Contract profit centers updated.", { variant: "success" });
    } catch (e) {
      showToast(e.message || "Unable to update profit centers.", { variant: "error" });
      await showAlert(e.message, { title: "Update failed" });
    }
  });

  $("reprocessContract")?.addEventListener("click", () => reprocessContract(c.id));

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
    if (isAdminUser()) {
      await ensureProfitCentersLoaded();
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
              <summary class="sgh-collapsible-header">
                <span class="summary-title sgh-collapsible-title">
                  <button type="button" class="link-button open-contract" data-id="${contract.contractId}">
                    ${contract.title}
                  </button>
                </span>
                <span class="summary-meta">
                  <span class="muted small">${contract.vendor}</span>
                  ${contract.agreement_type ? `<span class="pill">${contract.agreement_type}</span>` : ""}
                  <span class="pill">${contract.events.length} event${contract.events.length === 1 ? "" : "s"}</span>
                </span>
                <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
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
          <summary class="sgh-collapsible-header">
            <span class="summary-title sgh-collapsible-title">${formatDate(group.date)}</span>
            <span class="summary-meta">${group.contracts.size} contract${group.contracts.size === 1 ? "" : "s"}</span>
            <span class="summary-chevron sgh-chevron" aria-hidden="true">▸</span>
          </summary>
          <div class="event-date-body">
            ${contractsHtml}
          </div>
        </details>
      `;
    })
    .join("");

  initCollapsibleHeaders(list);

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
    { key: "profit_centers", label: "Profit Centers" },
    { key: "status", label: "Status" },
    { key: "uploaded_at", label: "Uploaded At" },
  ];
  const rows = state.allContracts.map((c) => ({
    id: c.id || "",
    title: c.title || c.original_filename || "",
    vendor: c.vendor || "",
    agreement_type: c.agreement_type || "",
    profit_centers: formatProfitCentersSummary(c.profit_centers || []),
    status: c.status || "",
    uploaded_at: c.uploaded_at || "",
  }));
  downloadCsv(`contracts-${timestampForFilename()}.csv`, headers, rows);
}

const TASK_REMINDER_OPTIONS = ["7 days before", "1 day before", "Due date", "1 day after"];

function formatUserLabel(user) {
  return `${user.name} (${user.email})`;
}

function renderCheckboxList(containerId, items, selectedValues = []) {
  const container = $(containerId);
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="muted small">No options available.</div>`;
    return;
  }
  const selectedSet = new Set(selectedValues.map((value) => String(value)));
  container.innerHTML = items
    .map((item, index) => {
      let value = "";
      let label = "";
      if (typeof item === "string") {
        value = item;
        label = item;
      } else if (item && typeof item === "object") {
        if ("email" in item) {
          value = item.email;
          label = formatUserLabel(item);
        } else {
          value = String(item.id ?? "");
          label = item.name ?? value;
        }
      }
      const isChecked = selectedSet.has(String(value));
      return `
        <label class="inline small" style="gap:6px;">
          <input type="checkbox" value="${escapeHtml(value)}" ${isChecked ? "checked" : ""} />
          <span>${escapeHtml(label)}</span>
        </label>
      `;
    })
    .join("");
}

function getCheckedValues(containerId) {
  const container = $(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
}

function renderMultiSelectOptions(selectId, items, selectedValues = []) {
  const select = $(selectId);
  if (!select) return;
  if (!items.length) {
    select.innerHTML = `<option disabled>No options available.</option>`;
    select.disabled = true;
    return;
  }
  const selectedSet = new Set(selectedValues.map((value) => String(value)));
  select.innerHTML = items
    .map((item) => {
      let value = "";
      let label = "";
      if (typeof item === "string") {
        value = item;
        label = item;
      } else if (item && typeof item === "object") {
        if ("email" in item) {
          value = item.email;
          label = formatUserLabel(item);
        } else {
          value = String(item.id ?? "");
          label = item.name ?? value;
        }
      }
      return `<option value="${escapeHtml(value)}"${selectedSet.has(String(value)) ? " selected" : ""}>${escapeHtml(
        label,
      )}</option>`;
    })
    .join("");
  select.disabled = false;
}

function getSelectedValues(selectId) {
  const select = $(selectId);
  if (!select) return [];
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function getProfitCenterOptions() {
  return (state.profitCenters || []).map((center) => ({
    id: center.id,
    name: `${center.code} — ${center.name}${center.group_name ? ` (${center.group_name})` : ""}`,
  }));
}

function getProfitCenterGroups() {
  const groups = (state.profitCenters || [])
    .map((center) => center.group_name)
    .filter((group) => group && group.trim());
  return Array.from(new Set(groups)).sort((a, b) => a.localeCompare(b));
}

function applyProfitCenterGroupsToCenters() {
  const groupSelect = $("adminUserProfitCenterGroups");
  const centerSelect = $("adminUserProfitCenters");
  if (!groupSelect || !centerSelect) return;
  const selectedGroups = new Set(getSelectedValues("adminUserProfitCenterGroups"));
  if (!selectedGroups.size) return;
  const groupedIds = new Set(
    (state.profitCenters || [])
      .filter((center) => center.group_name && selectedGroups.has(center.group_name))
      .map((center) => String(center.id)),
  );
  Array.from(centerSelect.options).forEach((option) => {
    if (groupedIds.has(option.value)) {
      option.selected = true;
    }
  });
}

function renderUserDirectories() {
  const targets = ["pendingUserDirectory", "taskUserDirectory"];
  const canView = hasPermission("user_directory_view");
  const canManage = hasPermission("user_directory_manage");
  targets.forEach((targetId) => {
    const container = $(targetId);
    if (!container) return;
    if (!canView) {
      container.innerHTML = `<div class="muted small">You do not have access to the user directory.</div>`;
      return;
    }
    if (!state.notificationUsers.length) {
      container.innerHTML = `<div class="muted small">No users added yet.</div>`;
      return;
    }
    container.innerHTML = state.notificationUsers
      .map(
        (user) => `
        <div class="folder-card">
          <div class="folder-header">
            <div class="folder-title">${escapeHtml(user.name)}</div>
            ${
              canManage
                ? `<button class="link-button" data-remove-user="${user.id}" data-remove-email="${escapeHtml(
                    user.email,
                  )}">Remove</button>`
                : ""
            }
          </div>
          <div class="folder-body small">${escapeHtml(user.email)}</div>
        </div>
      `,
      )
      .join("");
  });

  targets.forEach((targetId) => {
    const container = $(targetId);
    if (!container) return;
    if (canManage) {
      container.querySelectorAll("button[data-remove-user]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const userId = Number.parseInt(btn.dataset.removeUser, 10);
          const email = btn.dataset.removeEmail;
          const user = state.notificationUsers.find((entry) => entry.id === userId);
          if (!user) {
            return;
          }
          try {
            await deleteNotificationUser(userId);
            state.notificationUsers = state.notificationUsers.filter((entry) => entry.id !== userId);
            renderUserDirectories();
            renderNotificationOptions();
          } catch (err) {
            await showAlert(`Unable to remove ${email}. ${err.message}`, {
              title: "Remove failed",
            });
          }
        });
      });
    }
  });
}

function renderNewUserNotificationEmail() {
  const input = $("adminNewUserNotificationEmail");
  if (!input) return;
  input.value = state.newUserNotificationEmail || "";
}

function setAdminUserModalMode(mode) {
  const title = $("adminUserModalTitle");
  const saveButton = $("adminUserSave");
  const status = $("adminUserStatus");
  const password = $("adminUserPassword");
  if (title) title.textContent = mode === "edit" ? "Edit User" : "Add User";
  if (saveButton) saveButton.setAttribute("data-mode", mode);
  if (saveButton) saveButton.textContent = "Save";
  if (status) status.textContent = "";
  if (password) {
    password.placeholder = mode === "edit" ? "Set or reset password" : "Set password";
  }
}

function resetAdminUserForm() {
  state.adminUserEditId = null;
  const name = $("adminUserName");
  const email = $("adminUserEmail");
  const password = $("adminUserPassword");
  const isActive = $("adminUserActive");
  const isAdmin = $("adminUserAdmin");
  if (name) name.value = "";
  if (email) email.value = "";
  if (password) password.value = "";
  if (isActive) isActive.checked = true;
  if (isAdmin) isAdmin.checked = false;
  renderCheckboxList("adminUserRoles", state.roles, []);
  renderMultiSelectOptions("adminUserProfitCenters", getProfitCenterOptions(), []);
  renderMultiSelectOptions("adminUserProfitCenterGroups", getProfitCenterGroups(), []);
  applyProfitCenterGroupsToCenters();
  setAdminUserModalMode("create");
}

function populateModalFromRow(row) {
  if (!row) return;
  const name = $("adminUserName");
  const email = $("adminUserEmail");
  const password = $("adminUserPassword");
  const isActive = $("adminUserActive");
  const isAdmin = $("adminUserAdmin");
  const roles = (row.dataset.roles || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));
  const profitCenterIds = (row.dataset.profitCenterIds || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));
  const profitCenterGroups = (row.dataset.profitCenterGroups || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  state.adminUserEditId = Number(row.dataset.userId || 0) || null;
  if (name) name.value = row.dataset.userName || "";
  if (email) email.value = row.dataset.userEmail || "";
  if (password) password.value = "";
  if (isActive) isActive.checked = row.dataset.active === "1";
  if (isAdmin) isAdmin.checked = row.dataset.admin === "1";
  renderCheckboxList("adminUserRoles", state.roles, roles);
  renderMultiSelectOptions("adminUserProfitCenters", getProfitCenterOptions(), profitCenterIds);
  renderMultiSelectOptions("adminUserProfitCenterGroups", getProfitCenterGroups(), profitCenterGroups);
  applyProfitCenterGroupsToCenters();
  setAdminUserModalMode("edit");
  const status = $("adminUserStatus");
  if (status) status.textContent = `Editing ${row.dataset.userName || row.dataset.userEmail || ""}`;
}

function openAddUserModal(trigger = null) {
  state.adminUserModalTrigger = trigger || document.activeElement;
  resetAdminUserForm();
  const overlay = $("adminUserModalOverlay");
  overlay?.classList.remove("hidden");
  overlay?.setAttribute("aria-hidden", "false");
  setTimeout(() => $("adminUserName")?.focus(), 0);
}

function openEditUserModal(trigger) {
  const row = trigger?.closest("tr");
  if (!row) return;
  state.adminUserModalTrigger = trigger || document.activeElement;
  populateModalFromRow(row);
  const overlay = $("adminUserModalOverlay");
  overlay?.classList.remove("hidden");
  overlay?.setAttribute("aria-hidden", "false");
  setTimeout(() => $("adminUserName")?.focus(), 0);
}

function closeModal() {
  const overlay = $("adminUserModalOverlay");
  overlay?.classList.add("hidden");
  overlay?.setAttribute("aria-hidden", "true");
  if (state.adminUserModalTrigger && typeof state.adminUserModalTrigger.focus === "function") {
    state.adminUserModalTrigger.focus();
  }
  state.adminUserModalTrigger = null;
}

function submitModal() {
  $("adminUserSave")?.click();
}

function openAdminProfitCenterModal(trigger = null) {
  state.adminProfitCenterModalTrigger = trigger || document.activeElement;
  const overlay = $("adminProfitCenterModalOverlay");
  overlay?.classList.remove("hidden");
  overlay?.setAttribute("aria-hidden", "false");
  setTimeout(() => $("adminProfitCenterCode")?.focus(), 0);
}

function closeAdminProfitCenterModal() {
  const overlay = $("adminProfitCenterModalOverlay");
  overlay?.classList.add("hidden");
  overlay?.setAttribute("aria-hidden", "true");
  if (
    state.adminProfitCenterModalTrigger &&
    typeof state.adminProfitCenterModalTrigger.focus === "function"
  ) {
    state.adminProfitCenterModalTrigger.focus();
  }
  state.adminProfitCenterModalTrigger = null;
}

function renderAdminUsers() {
  const tbody = $("adminUsersTable");
  if (!tbody) return;
  if (!state.adminUsers.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted small">No users found.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.adminUsers
    .map((user) => {
      const roles = formatRoleList(user.role_ids || [], "None");
      const roleIds = (user.role_ids || []).map((value) => String(value)).join(",");
      const profitCenterIds = (user.profit_center_ids || []).map((value) => String(value)).join(",");
      const profitCenterGroups = (user.profit_center_groups || []).map((value) => String(value)).join(",");
      return `
        <tr
          data-user-id="${user.id}"
          data-user-name="${escapeHtml(user.name || "")}"
          data-user-email="${escapeHtml(user.email || "")}"
          data-active="${user.is_active ? "1" : "0"}"
          data-admin="${user.is_admin ? "1" : "0"}"
          data-roles="${roleIds}"
          data-profit-center-ids="${profitCenterIds}"
          data-profit-center-groups="${profitCenterGroups}"
        >
          <td>${escapeHtml(user.name || "")}</td>
          <td>${escapeHtml(user.email || "")}</td>
          <td class="small">${escapeHtml(roles)}</td>
          <td>${user.is_admin ? "Yes" : "No"}</td>
          <td>${user.is_active ? "Active" : "Inactive"}</td>
          <td><button class="small admin-user-edit" data-user-id="${user.id}">Edit</button></td>
        </tr>
      `;
    })
    .join("");
  document.querySelectorAll(".admin-user-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      openEditUserModal(btn);
    });
  });
}

function resetAdminRoleForm() {
  state.adminRoleEditId = null;
  const name = $("adminRoleName");
  const description = $("adminRoleDescription");
  if (name) name.value = "";
  if (description) description.value = "";
  $("adminRoleSave")?.setAttribute("data-mode", "create");
  const adminRoleSave = $("adminRoleSave");
  if (adminRoleSave) adminRoleSave.textContent = "Add role";
  const status = $("adminRoleStatus");
  if (status) status.textContent = "";
}

function resetAdminProfitCenterForm() {
  state.adminProfitCenterEditId = null;
  const code = $("adminProfitCenterCode");
  const name = $("adminProfitCenterName");
  const group = $("adminProfitCenterGroup");
  if (code) code.value = "";
  if (name) name.value = "";
  if (group) group.value = "";
  setAdminProfitCenterModalMode("create");
  const status = $("adminProfitCenterStatus");
  if (status) status.textContent = "";
}

function setAdminProfitCenterModalMode(mode) {
  const title = $("adminProfitCenterModalTitle");
  const saveButton = $("adminProfitCenterSave");
  if (title) title.textContent = mode === "edit" ? "Edit profit center" : "Add profit center";
  if (saveButton) saveButton.setAttribute("data-mode", mode);
  if (saveButton) saveButton.textContent = mode === "edit" ? "Update profit center" : "Add profit center";
}

function openAdminRoleEdit(role) {
  state.adminRoleEditId = role.id;
  const name = $("adminRoleName");
  const description = $("adminRoleDescription");
  if (name) name.value = role.name || "";
  if (description) description.value = role.description || "";
  $("adminRoleSave")?.setAttribute("data-mode", "edit");
  const adminRoleSave = $("adminRoleSave");
  if (adminRoleSave) adminRoleSave.textContent = "Update role";
  const status = $("adminRoleStatus");
  if (status) status.textContent = `Editing ${role.name}`;
}

function openAdminProfitCenterEdit(center, trigger = null) {
  state.adminProfitCenterEditId = center.id;
  const code = $("adminProfitCenterCode");
  const name = $("adminProfitCenterName");
  const group = $("adminProfitCenterGroup");
  if (code) code.value = center.code || "";
  if (name) name.value = center.name || "";
  if (group) group.value = center.group_name || "";
  setAdminProfitCenterModalMode("edit");
  const status = $("adminProfitCenterStatus");
  if (status) status.textContent = `Editing ${center.code}`;
  openAdminProfitCenterModal(trigger);
}

function renderAdminRoles() {
  const tbody = $("adminRolesTable");
  if (!tbody) return;
  if (!state.roles.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted small">No roles found.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.roles
    .map((role) => {
      return `
        <tr>
          <td>${escapeHtml(role.name || "")}</td>
          <td class="small">${escapeHtml(role.description || "—")}</td>
          <td><button class="small admin-role-edit" data-role-id="${role.id}">Edit</button></td>
          <td><button class="small danger admin-role-delete" data-role-id="${role.id}">Delete</button></td>
        </tr>
      `;
    })
    .join("");
  document.querySelectorAll(".admin-role-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const roleId = Number(btn.dataset.roleId);
      const role = state.roles.find((item) => item.id === roleId);
      if (role) openAdminRoleEdit(role);
    });
  });
  document.querySelectorAll(".admin-role-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const roleId = Number(btn.dataset.roleId);
      const role = state.roles.find((item) => item.id === roleId);
      const confirmed = await showConfirm(
        `Delete role ${role?.name || roleId}? This will remove it from users and tags.`,
      );
      if (!confirmed) return;
      await deleteRole(roleId);
      await loadAdminData();
    });
  });
}

function renderAdminProfitCenters() {
  const tbody = $("adminProfitCentersTable");
  if (!tbody) return;
  if (!state.profitCenters.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted small">No profit centers configured yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.profitCenters
    .map((center) => {
      return `
        <tr>
          <td>${escapeHtml(center.code || "")}</td>
          <td>${escapeHtml(center.name || "")}</td>
          <td>${escapeHtml(center.group_name || "—")}</td>
          <td>
            <button class="small admin-profit-center-edit" data-profit-center-id="${center.id}">
              Edit
            </button>
            <button class="small danger admin-profit-center-delete" data-profit-center-id="${center.id}">
              Delete
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
  document.querySelectorAll(".admin-profit-center-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const centerId = Number(btn.dataset.profitCenterId);
      const center = state.profitCenters.find((item) => item.id === centerId);
      if (center) openAdminProfitCenterEdit(center, btn);
    });
  });
  document.querySelectorAll(".admin-profit-center-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const centerId = Number(btn.dataset.profitCenterId);
      const center = state.profitCenters.find((item) => item.id === centerId);
      const confirmed = await showConfirm(
        `Delete profit center ${center?.code || centerId}?`,
        { title: "Delete profit center" },
      );
      if (!confirmed) return;
      await deleteProfitCenter(centerId);
      await loadAdminData();
    });
  });
}

function renderAdminTagPermissions() {
  const tbody = $("adminTagPermissionsTable");
  if (!tbody) return;
  if (!state.tags.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted small">No tags available.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.tags
    .map((tag) => {
      const assigned = new Set(
        (state.tagPermissions[String(tag.id)] || state.tagPermissions[tag.id] || []).map(String),
      );
      const rolesHtml = state.roles.length
        ? state.roles
            .map((role) => {
              const checked = assigned.has(String(role.id));
              return `
                <label class="inline small" style="gap:6px;">
                  <input type="checkbox" value="${role.id}" ${checked ? "checked" : ""} />
                  <span>${escapeHtml(role.name || "")}</span>
                </label>
              `;
            })
            .join("")
        : `<div class="muted small">No roles available.</div>`;
      return `
        <tr>
          <td>${renderTagPill(tag)}</td>
          <td><div id="tagPermRoles-${tag.id}" class="row wrap">${rolesHtml}</div></td>
          <td><button class="small admin-tag-save" data-tag-id="${tag.id}">Save</button></td>
        </tr>
      `;
    })
    .join("");
  document.querySelectorAll(".admin-tag-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tagId = Number(btn.dataset.tagId);
      const roles = getCheckedValues(`tagPermRoles-${tagId}`).map((value) => Number(value));
      await updateTagPermissions(tagId, roles);
      state.tagPermissions[String(tagId)] = roles;
      const status = $("adminTagStatus");
      if (status) status.textContent = "Permissions saved.";
      setTimeout(() => {
        if (status && status.textContent === "Permissions saved.") {
          status.textContent = "";
        }
      }, 2000);
    });
  });
}

function renderAdminPermissionMatrix() {
  const tbody = $("adminPermissionMatrixTable");
  if (!tbody) return;
  if (!state.permissionDefinitions.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted small">No permissions configured yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.permissionDefinitions
    .map((permission) => {
      const assigned = new Set(
        (state.permissionAssignments[permission.key] || []).map((value) => String(value)),
      );
      const rolesHtml = state.roles.length
        ? state.roles
            .map((role) => {
              const checked = assigned.has(String(role.id));
              return `
                <label class="inline small" style="gap:6px;">
                  <input type="checkbox" value="${role.id}" ${checked ? "checked" : ""} />
                  <span>${escapeHtml(role.name || "")}</span>
                </label>
              `;
            })
            .join("")
        : `<div class="muted small">No roles available.</div>`;
      const defaultNote = permission.default_allow
        ? "Default: open when no roles are assigned."
        : "Default: restricted to admins only.";
      return `
        <tr>
          <td>${escapeHtml(permission.label || permission.key)}</td>
          <td>
            <div>${escapeHtml(permission.description || "")}</div>
            <div class="muted small">${escapeHtml(defaultNote)}</div>
          </td>
          <td><div id="permRoles-${permission.key}" class="row wrap">${rolesHtml}</div></td>
          <td><button class="small admin-permission-save" data-permission-key="${permission.key}">Save</button></td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".admin-permission-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const permissionKey = btn.dataset.permissionKey;
      const roles = getCheckedValues(`permRoles-${permissionKey}`).map((value) => Number(value));
      await updatePermissionMatrix(permissionKey, roles);
      state.permissionAssignments[permissionKey] = roles;
      const status = $("adminPermissionStatus");
      if (status) status.textContent = "Permissions saved.";
      setTimeout(() => {
        if (status && status.textContent === "Permissions saved.") {
          status.textContent = "";
        }
      }, 2000);
    });
  });
}

function renderAdminAgreementTypes() {
  const tbody = $("adminAgreementTypesTable");
  if (!tbody) return;
  if (!state.agreementTypeCatalog.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted small">No agreement types configured yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.agreementTypeCatalog
    .map((type) => {
      const keywordChips = type.keywords?.length
        ? type.keywords
            .map(
              (keyword) => `
                <span class="pill" style="display:inline-flex; align-items:center; gap:4px;">
                  ${escapeHtml(keyword.keyword)}
                  <button class="chip-btn admin-agreement-keyword-delete" data-keyword-id="${keyword.id}" title="Remove keyword">
                    ×
                  </button>
                </span>
              `,
            )
            .join(" ")
        : `<span class="muted small">No keywords yet.</span>`;
      return `
        <tr>
          <td>${escapeHtml(type.name || "")}</td>
          <td>
            <div class="row wrap" style="gap:6px;">${keywordChips}</div>
            <div class="row wrap" style="gap:6px; margin-top:6px;">
              <input id="agreementTypeKeyword-${type.id}" class="muted-input" placeholder="Add keyword" />
              <button class="small admin-agreement-keyword-add" data-type-id="${type.id}">Add</button>
            </div>
          </td>
          <td>
            <button class="small danger admin-agreement-type-delete" data-type-id="${type.id}">
              Delete
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".admin-agreement-type-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const typeId = Number(btn.dataset.typeId);
      const type = state.agreementTypeCatalog.find((entry) => entry.id === typeId);
      const confirmed = await showConfirm(`Delete agreement type "${type?.name || typeId}"?`, {
        title: "Delete agreement type",
      });
      if (!confirmed) return;
      await deleteAgreementType(typeId);
      await loadAgreementTypeCatalog();
    });
  });

  document.querySelectorAll(".admin-agreement-keyword-add").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const typeId = Number(btn.dataset.typeId);
      const input = $(`agreementTypeKeyword-${typeId}`);
      const keyword = input?.value.trim() || "";
      const status = $("adminAgreementTypeStatus");
      if (!keyword) {
        if (status) status.textContent = "Keyword is required.";
        return;
      }
      try {
        await createAgreementTypeKeyword({ agreement_type_id: typeId, keyword });
        if (input) input.value = "";
        await loadAgreementTypeCatalog();
        if (status) status.textContent = "Keyword added.";
      } catch (err) {
        if (status) status.textContent = err.message || "Unable to add keyword.";
      }
    });
  });

  document.querySelectorAll(".admin-agreement-keyword-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const keywordId = Number(btn.dataset.keywordId);
      await deleteAgreementTypeKeyword(keywordId);
      await loadAgreementTypeCatalog();
    });
  });
}

async function loadAgreementTypeCatalog() {
  const catalog = await fetchAgreementTypeKeywords();
  state.agreementTypeCatalog = catalog || [];
  state.agreementTypes = state.agreementTypeCatalog.map((entry) => entry.name);
  renderAdminAgreementTypes();
}

async function loadAdminData() {
  const [
    users,
    roles,
    tags,
    permissions,
    permissionMatrix,
    agreementTypes,
    profitCenters,
    newUserNotification,
  ] = await Promise.all([
    fetchAdminUsers(),
    apiFetch("/api/roles").then((res) => res.json()),
    apiFetch("/api/tags").then((res) => res.json()),
    fetchTagPermissions(),
    fetchPermissionMatrix(),
    fetchAgreementTypeKeywords(),
    fetchProfitCenters(),
    fetchNewUserNotificationEmail(),
  ]);
  state.adminUsers = users;
  state.roles = roles;
  state.tags = tags;
  state.tagPermissions = permissions || {};
  state.permissionDefinitions = permissionMatrix?.permissions || [];
  state.permissionAssignments = permissionMatrix?.assignments || {};
  state.agreementTypeCatalog = agreementTypes || [];
  state.agreementTypes = state.agreementTypeCatalog.map((entry) => entry.name);
  state.profitCenters = profitCenters || [];
  state.newUserNotificationEmail = newUserNotification?.email || "";
  renderNewUserNotificationEmail();
  renderAdminUsers();
  renderAdminRoles();
  renderAdminTagPermissions();
  renderAdminPermissionMatrix();
  renderAdminAgreementTypes();
  renderAdminProfitCenters();
  resetAdminUserForm();
  resetAdminRoleForm();
  resetAdminProfitCenterForm();
}

function initAdminUi() {
  $("adminRefresh")?.addEventListener("click", loadAdminData);
  $("adminUserAdd")?.addEventListener("click", (event) => openAddUserModal(event.currentTarget));
  $("adminProfitCenterAdd")?.addEventListener("click", (event) => {
    resetAdminProfitCenterForm();
    openAdminProfitCenterModal(event.currentTarget);
  });
  $("adminUserCancel")?.addEventListener("click", () => {
    resetAdminUserForm();
    closeModal();
  });
  $("adminUserModalClose")?.addEventListener("click", closeModal);
  $("adminUserForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitModal();
  });
  $("adminUserModalOverlay")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("adminUserModalOverlay")?.classList.contains("hidden")) {
      closeModal();
    }
    if (event.key === "Escape" && !$("adminProfitCenterModalOverlay")?.classList.contains("hidden")) {
      closeAdminProfitCenterModal();
    }
  });
  $("adminRoleCancel")?.addEventListener("click", resetAdminRoleForm);
  $("adminProfitCenterCancel")?.addEventListener("click", () => {
    resetAdminProfitCenterForm();
    closeAdminProfitCenterModal();
  });
  $("adminProfitCenterModalClose")?.addEventListener("click", closeAdminProfitCenterModal);
  $("adminProfitCenterForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    $("adminProfitCenterSave")?.click();
  });
  $("adminProfitCenterModalOverlay")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeAdminProfitCenterModal();
    }
  });
  $("adminUserProfitCenterGroups")?.addEventListener("change", () => {
    applyProfitCenterGroupsToCenters();
  });
  $("adminNewUserNotificationSave")?.addEventListener("click", async () => {
    const email = $("adminNewUserNotificationEmail")?.value.trim() || "";
    const status = $("adminNewUserNotificationStatus");
    if (!email) {
      if (status) status.textContent = "Notification email is required.";
      showToast("Notification email is required.", { variant: "warning" });
      return;
    }
    try {
      const response = await updateNewUserNotificationEmail(email);
      state.newUserNotificationEmail = response.email || email;
      renderNewUserNotificationEmail();
      if (status) status.textContent = "Notification email saved.";
      showToast("Notification email saved.", { variant: "success" });
    } catch (err) {
      const message = err.message || "Unable to save notification email.";
      if (status) status.textContent = message;
      showToast(message, { variant: "error" });
    }
  });

  $("adminUserSave")?.addEventListener("click", async () => {
    applyProfitCenterGroupsToCenters();
    const name = $("adminUserName")?.value.trim() || "";
    const email = $("adminUserEmail")?.value.trim() || "";
    const password = $("adminUserPassword")?.value || "";
    const isActive = $("adminUserActive")?.checked ?? true;
    const isAdmin = $("adminUserAdmin")?.checked ?? false;
    const roles = getCheckedValues("adminUserRoles").map((value) => Number(value));
    const profitCenterIds = getSelectedValues("adminUserProfitCenters").map((value) => Number(value));
    const profitCenterGroups = getSelectedValues("adminUserProfitCenterGroups");
    const status = $("adminUserStatus");

    if (!name || !email || (!state.adminUserEditId && !password)) {
      if (status) status.textContent = "Name, email, and password are required for new users.";
      showToast("Please fill in name, email, and password for new users.", { variant: "warning" });
      return;
    }
    try {
      if (state.adminUserEditId) {
        await updateAdminUser(state.adminUserEditId, {
          name,
          email,
          password: password || undefined,
          roles,
          profit_center_ids: profitCenterIds,
          profit_center_groups: profitCenterGroups,
          is_active: isActive,
          is_admin: isAdmin,
        });
      } else {
        await createAdminUser({
          name,
          email,
          password,
          roles,
          profit_center_ids: profitCenterIds,
          profit_center_groups: profitCenterGroups,
          is_active: isActive,
          is_admin: isAdmin,
        });
      }
      await loadAdminData();
      if (status) status.textContent = "User saved.";
      showToast("User saved.", { variant: "success" });
    } catch (err) {
      const message = err.message || "Unable to save user.";
      if (status) status.textContent = message;
      showToast(message, { variant: "error" });
    }
  });

  $("adminRoleSave")?.addEventListener("click", async () => {
    const name = $("adminRoleName")?.value.trim() || "";
    const description = $("adminRoleDescription")?.value.trim() || "";
    const status = $("adminRoleStatus");
    if (!name) {
      if (status) status.textContent = "Role name is required.";
      showToast("Role name is required.", { variant: "warning" });
      return;
    }
    try {
      if (state.adminRoleEditId) {
        await updateRole(state.adminRoleEditId, { name, description });
      } else {
        await createRole({ name, description });
      }
      await loadAdminData();
      if (status) status.textContent = "Role saved.";
      showToast("Role saved.", { variant: "success" });
    } catch (err) {
      const message = err.message || "Unable to save role.";
      if (status) status.textContent = message;
      showToast(message, { variant: "error" });
    }
  });

  $("adminProfitCenterSave")?.addEventListener("click", async () => {
    const code = $("adminProfitCenterCode")?.value.trim() || "";
    const name = $("adminProfitCenterName")?.value.trim() || "";
    const groupName = $("adminProfitCenterGroup")?.value.trim() || "";
    const status = $("adminProfitCenterStatus");
    if (!code || !name) {
      if (status) status.textContent = "Profit center code and name are required.";
      showToast("Profit center code and name are required.", { variant: "warning" });
      return;
    }
    try {
      if (state.adminProfitCenterEditId) {
        await updateProfitCenter(state.adminProfitCenterEditId, {
          code,
          name,
          group_name: groupName || null,
        });
      } else {
        await createProfitCenter({ code, name, group_name: groupName || null });
      }
      await loadAdminData();
      if (status) status.textContent = "Profit center saved.";
      showToast("Profit center saved.", { variant: "success" });
    } catch (err) {
      const message = err.message || "Unable to save profit center.";
      if (status) status.textContent = message;
      showToast(message, { variant: "error" });
    }
  });

  $("adminAgreementTypeAdd")?.addEventListener("click", async () => {
    const name = $("adminAgreementTypeName")?.value.trim() || "";
    const status = $("adminAgreementTypeStatus");
    if (!name) {
      if (status) status.textContent = "Agreement type name is required.";
      showToast("Agreement type name is required.", { variant: "warning" });
      return;
    }
    try {
      await createAgreementType({ name });
      const input = $("adminAgreementTypeName");
      if (input) input.value = "";
      await loadAgreementTypeCatalog();
      if (status) status.textContent = "Agreement type added.";
      showToast("Agreement type added.", { variant: "success" });
    } catch (err) {
      const message = err.message || "Unable to add agreement type.";
      if (status) status.textContent = message;
      showToast(message, { variant: "error" });
    }
  });
}

function renderNotificationOptions() {
  renderCheckboxList("pendingRoleOptions", state.roles);
  renderCheckboxList("pendingRecipientOptions", state.notificationUsers);
  renderCheckboxList("taskAssigneeOptions", state.notificationUsers);
  renderCheckboxList("taskReminderOptions", TASK_REMINDER_OPTIONS);
}

function renderPendingAgreementRecipientsInput() {
  const input = $("pendingAgreementRecipientsInput");
  if (!input) return;
  input.value = (state.pendingAgreementRecipients || [])
    .map((recipient) => recipient.email || "")
    .filter(Boolean)
    .join("\n");
}

async function loadPendingAgreementRecipients() {
  const section = $("pendingAgreementRecipientsSection");
  if (!hasPermission("pending_agreements_manage")) {
    section?.classList.add("hidden");
    return;
  }
  section?.classList.remove("hidden");
  try {
    const response = await fetchPendingAgreementRecipients();
    state.pendingAgreementRecipients = response.recipients || [];
  } catch (err) {
    state.pendingAgreementRecipients = [];
  }
  renderPendingAgreementRecipientsInput();
}

function updatePendingAgreementsMeta() {
  const meta = $("pendingAgreementsMeta");
  const loadMore = $("pendingAgreementsLoadMore");
  if (meta) {
    if (state.pendingAgreementsTotal) {
      meta.textContent = `Showing ${state.pendingAgreements.length} of ${state.pendingAgreementsTotal}`;
    } else if (state.pendingAgreementsQuery) {
      meta.textContent = "No pending agreements match this search.";
    } else {
      meta.textContent = "No pending agreements yet.";
    }
  }
  if (loadMore) {
    loadMore.classList.toggle("hidden", !state.pendingAgreementsHasMore);
    loadMore.disabled = !state.pendingAgreementsHasMore;
  }
}

async function loadPendingAgreements({ reset = false } = {}) {
  const table = $("pendingAgreementsTable");
  if (!hasPermission("pending_agreements_view")) {
    if (table) {
      table.innerHTML = `<tr><td colspan="10" class="muted">You do not have access to pending agreements.</td></tr>`;
    }
    state.pendingAgreementsHasMore = false;
    return;
  }
  if (reset && table) {
    table.innerHTML = `<tr><td colspan="10" class="muted">Loading…</td></tr>`;
  }
  try {
    const offset = reset ? 0 : state.pendingAgreementsOffset;
    const data = await fetchPendingAgreements({
      limit: state.pendingAgreementsLimit,
      offset,
      query: state.pendingAgreementsQuery,
    });
    const items = data.items || [];
    state.pendingAgreementsTotal = data.total || 0;
    if (reset) {
      state.pendingAgreements = items;
    } else {
      state.pendingAgreements = [...state.pendingAgreements, ...items];
    }
    state.pendingAgreementsOffset = state.pendingAgreements.length;
    state.pendingAgreementsHasMore = state.pendingAgreementsOffset < state.pendingAgreementsTotal;
    renderPendingAgreementsQueue();
  } catch (err) {
    if (table) {
      table.innerHTML = `<tr><td colspan="10" class="muted">Unable to load pending agreements. ${err.message}</td></tr>`;
    }
    state.pendingAgreementsHasMore = false;
  } finally {
    updatePendingAgreementsMeta();
  }
}

async function loadPendingAgreementReminders() {
  const table = $("pendingReminderTable");
  if (!hasPermission("pending_agreement_reminders_manage")) {
    if (table) {
      table.innerHTML = `<tr><td colspan="5" class="muted">You do not have access to reminder rules.</td></tr>`;
    }
    return;
  }
  if (table) {
    table.innerHTML = `<tr><td colspan="5" class="muted">Loading…</td></tr>`;
  }
  try {
    state.pendingAgreementReminders = await fetchPendingAgreementReminders();
    renderPendingReminderTable();
  } catch (err) {
    if (table) {
      table.innerHTML = `<tr><td colspan="5" class="muted">Unable to load reminders. ${err.message}</td></tr>`;
    }
  }
}

function updateTasksMeta() {
  const meta = $("taskQueueMeta");
  const loadMore = $("taskQueueLoadMore");
  if (meta) {
    if (state.tasksTotal) {
      meta.textContent = `Showing ${state.tasks.length} of ${state.tasksTotal}`;
    } else if (state.tasksQuery) {
      meta.textContent = "No tasks match this search.";
    } else {
      meta.textContent = "No tasks yet.";
    }
  }
  if (loadMore) {
    loadMore.classList.toggle("hidden", !state.tasksHasMore);
    loadMore.disabled = !state.tasksHasMore;
  }
}

async function loadTasks({ reset = false } = {}) {
  const table = $("taskTable");
  if (!hasPermission("tasks_view")) {
    if (table) {
      table.innerHTML = `<tr><td colspan="6" class="muted">You do not have access to tasks.</td></tr>`;
    }
    state.tasksHasMore = false;
    return;
  }
  if (reset && table) {
    table.innerHTML = `<tr><td colspan="6" class="muted">Loading…</td></tr>`;
  }
  try {
    const offset = reset ? 0 : state.tasksOffset;
    const data = await fetchTasks({
      limit: state.tasksLimit,
      offset,
      query: state.tasksQuery,
    });
    const items = data.items || [];
    state.tasksTotal = data.total || 0;
    if (reset) {
      state.tasks = items;
    } else {
      state.tasks = [...state.tasks, ...items];
    }
    state.tasksOffset = state.tasks.length;
    state.tasksHasMore = state.tasksOffset < state.tasksTotal;
    renderTaskTable();
  } catch (err) {
    if (table) {
      table.innerHTML = `<tr><td colspan="6" class="muted">Unable to load tasks. ${err.message}</td></tr>`;
    }
    state.tasksHasMore = false;
  } finally {
    updateTasksMeta();
  }
}

function renderPendingReminderTable() {
  const table = $("pendingReminderTable");
  if (!table) return;
  if (!hasPermission("pending_agreement_reminders_manage")) {
    table.innerHTML = `<tr><td colspan="5" class="muted">You do not have access to reminder rules.</td></tr>`;
    return;
  }
  if (!state.pendingAgreementReminders.length) {
    table.innerHTML = `<tr><td colspan="5" class="muted">No reminder rules saved yet.</td></tr>`;
    return;
  }

  const userLookup = new Map(state.notificationUsers.map((user) => [user.email, user.name]));
  table.innerHTML = state.pendingAgreementReminders
    .map((reminder) => {
      const recipients = reminder.recipients
        .map((email) => userLookup.get(email) || email)
        .join(", ");
      const roleNames = formatRoleList(reminder.roles, "None");
      return `
        <tr>
          <td>${escapeHtml(titleCase(reminder.frequency))}</td>
          <td>${escapeHtml(roleNames)}</td>
          <td>${escapeHtml(recipients || "None")}</td>
          <td>${escapeHtml(reminder.message || "")}</td>
          <td>
            <button data-edit-reminder="${reminder.id}">Edit</button>
            <button data-remove-reminder="${reminder.id}">Remove</button>
          </td>
        </tr>
      `;
    })
    .join("");

  table.querySelectorAll("button[data-edit-reminder]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const reminder = state.pendingAgreementReminders.find(
        (entry) => entry.id === btn.dataset.editReminder,
      );
      if (!reminder) return;
      openPendingReminderModal(reminder);
    });
  });

  table.querySelectorAll("button[data-remove-reminder]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reminder = state.pendingAgreementReminders.find(
        (entry) => entry.id === btn.dataset.removeReminder,
      );
      if (!reminder) return;
      const confirmed = await showConfirm(
        `Remove the reminder rule for ${titleCase(reminder.frequency)} reminders?`,
        { title: "Remove reminder" },
      );
      if (!confirmed) return;
      try {
        await deletePendingAgreementReminder(reminder.id);
        state.pendingAgreementReminders = state.pendingAgreementReminders.filter(
          (entry) => entry.id !== reminder.id,
        );
        renderPendingReminderTable();
      } catch (err) {
        await showAlert(`Unable to remove reminder rule. ${err.message}`, { title: "Remove failed" });
      }
    });
  });
}

function renderPendingAgreementsQueue() {
  const table = $("pendingAgreementsTable");
  if (!table) return;
  if (!hasPermission("pending_agreements_view")) {
    table.innerHTML = `<tr><td colspan="10" class="muted">You do not have access to pending agreements.</td></tr>`;
    return;
  }
  if (!state.pendingAgreements.length) {
    table.innerHTML = `<tr><td colspan="10" class="muted">No pending agreements right now.</td></tr>`;
    return;
  }
  const canManage = hasPermission("pending_agreements_manage");
  const formatRequester = (agreement) => {
    const name = agreement.team_member || agreement.owner || "Unknown";
    const email = agreement.requester_email || agreement.owner_email || "";
    return email ? `${name} (${email})` : name;
  };
  table.innerHTML = state.pendingAgreements
    .map(
      (agreement) => `
        <tr>
          <td>${escapeHtml(formatDate(agreement.created_at))}</td>
          <td>${escapeHtml(agreement.internal_company || "")}</td>
          <td>${escapeHtml(formatRequester(agreement))}</td>
          <td>${escapeHtml(agreement.attorney_assigned || "Unassigned")}</td>
          <td>${escapeHtml(agreement.matter || agreement.title || "")}</td>
          <td>${escapeHtml(agreement.latest_note || agreement.status_notes || "")}</td>
          <td>${escapeHtml(agreement.internal_completion_date ? formatDate(agreement.internal_completion_date) : "")}</td>
          <td>${escapeHtml(agreement.fully_executed_date ? formatDate(agreement.fully_executed_date) : "")}</td>
          <td>
            <button data-view-agreement="${agreement.id}">View</button>
          </td>
          <td>
            ${
              canManage
                ? `
                    <button data-nudge-agreement="${agreement.id}">Nudge</button>
                    <button data-edit-agreement="${agreement.id}">Manage</button>
                    <button data-remove-agreement="${agreement.id}">Remove</button>
                  `
                : `<span class="muted small">View only</span>`
            }
          </td>
        </tr>
      `,
    )
    .join("");

  if (!canManage) {
    return;
  }
  table.querySelectorAll("button[data-nudge-agreement]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const agreement = state.pendingAgreements.find((item) => item.id === btn.dataset.nudgeAgreement);
      if (!agreement) return;
      try {
        const response = await nudgePendingAgreement(agreement.id);
        const recipients = response.recipients?.join(", ") || agreement.owner;
        await showAlert(`Nudge email sent for "${agreement.matter || agreement.title}" to ${recipients}.`, {
          title: "Nudge sent",
        });
      } catch (err) {
        await showAlert(`Unable to send nudge. ${err.message}`, { title: "Nudge failed" });
      }
    });
  });

  table.querySelectorAll("button[data-edit-agreement]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const agreement = state.pendingAgreements.find((item) => item.id === btn.dataset.editAgreement);
      if (!agreement) return;
      openPendingAgreementModal(agreement);
    });
  });

  table.querySelectorAll("button[data-view-agreement]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const agreement = state.pendingAgreements.find((item) => item.id === btn.dataset.viewAgreement);
      if (!agreement) return;
      openPendingAgreementModal(agreement);
    });
  });

  table.querySelectorAll("button[data-remove-agreement]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const agreement = state.pendingAgreements.find((item) => item.id === btn.dataset.removeAgreement);
      if (!agreement) return;
      const confirmed = await showConfirm(
        `Remove "${agreement.matter || agreement.title}" from the pending queue?`,
        { title: "Remove pending agreement" },
      );
      if (!confirmed) return;
      try {
        await deletePendingAgreement(agreement.id);
        await loadPendingAgreements({ reset: true });
      } catch (err) {
        await showAlert(`Unable to remove pending agreement. ${err.message}`, { title: "Remove failed" });
      }
    });
  });

}

function renderTaskTable() {
  const table = $("taskTable");
  if (!table) return;
  if (!hasPermission("tasks_view")) {
    table.innerHTML = `<tr><td colspan="6" class="muted">You do not have access to tasks.</td></tr>`;
    return;
  }
  if (!state.tasks.length) {
    table.innerHTML = `<tr><td colspan="6" class="muted">No tasks have been created yet.</td></tr>`;
    return;
  }
  const canManage = hasPermission("tasks_manage");
  const userLookup = new Map(state.notificationUsers.map((user) => [user.email, user.name]));
  table.innerHTML = state.tasks
    .map((task) => {
      const assignees = task.assignees
        .map((email) => userLookup.get(email) || email)
        .join(", ");
      const reminders = task.reminders.join(", ");
      const statusLabel = task.completed ? "Completed" : "Open";
      return `
        <tr>
          <td>
            <div>${escapeHtml(task.title)}</div>
            <div class="muted small">${escapeHtml(task.description || "")}</div>
            <div class="muted small">Status: ${statusLabel}</div>
          </td>
          <td>${escapeHtml(assignees || "Unassigned")}</td>
          <td>${escapeHtml(formatDate(task.due_date || task.dueDate))}</td>
          <td>${escapeHtml(reminders || "None")}</td>
          <td>${escapeHtml(formatDate(task.created_at))}</td>
          <td>
            ${
              canManage
                ? `
                    <button data-task-nudge="${task.id}">Nudge</button>
                    <button data-task-toggle="${task.id}">${task.completed ? "Reopen" : "Complete"}</button>
                  `
                : `<span class="muted small">View only</span>`
            }
          </td>
        </tr>
      `;
    })
    .join("");

  if (!canManage) {
    return;
  }
  table.querySelectorAll("button[data-task-nudge]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const task = state.tasks.find((item) => item.id === btn.dataset.taskNudge);
      if (!task) return;
      try {
        const response = await nudgeTask(task.id);
        const recipients = response.recipients?.join(", ") || "assigned users";
        await showAlert(`Nudge email sent for "${task.title}" to ${recipients}.`, {
          title: "Nudge sent",
        });
      } catch (err) {
        await showAlert(`Unable to send nudge. ${err.message}`, { title: "Nudge failed" });
      }
    });
  });

  table.querySelectorAll("button[data-task-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const task = state.tasks.find((item) => item.id === btn.dataset.taskToggle);
      if (!task) return;
      const nextStatus = !task.completed;
      try {
        await updateTaskStatus(task.id, nextStatus);
        task.completed = nextStatus;
        renderTaskTable();
      } catch (err) {
        await showAlert(`Unable to update task status. ${err.message}`, { title: "Update failed" });
      }
    });
  });
}

function initPendingAgreementsUi() {
  renderNotificationOptions();
  renderPendingReminderTable();
  renderPendingAgreementsQueue();
  renderUserDirectories();
  loadPendingAgreementRecipients();

  const reminderModal = getPendingReminderModalElements();
  reminderModal.cancel?.addEventListener("click", closePendingReminderModal);
  reminderModal.close?.addEventListener("click", closePendingReminderModal);
  reminderModal.overlay?.addEventListener("click", (event) => {
    if (event.target === reminderModal.overlay) {
      closePendingReminderModal();
    }
  });
  reminderModal.save?.addEventListener("click", async () => {
    const reminderId = pendingReminderModalState.reminderId;
    if (!reminderId) return;
    const frequency = reminderModal.frequency?.value || "weekly";
    const roles = getCheckedValues("pendingReminderEditRoles")
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));
    const recipients = getCheckedValues("pendingReminderEditRecipients");
    const message = reminderModal.message?.value?.trim();

    if (!roles.length && !recipients.length) {
      await showAlert("Select at least one role or individual recipient.", { title: "Missing recipients" });
      return;
    }

    try {
      const updated = await updatePendingAgreementReminder(reminderId, {
        frequency,
        roles,
        recipients,
        message,
      });
      state.pendingAgreementReminders = state.pendingAgreementReminders.map((entry) =>
        entry.id === reminderId ? updated : entry,
      );
      renderPendingReminderTable();
      closePendingReminderModal();
      await showAlert("Reminder rule updated.", { title: "Changes saved" });
    } catch (err) {
      await showAlert(`Unable to update reminder rule. ${err.message}`, { title: "Save failed" });
    }
  });

  const agreementModal = getPendingAgreementModalElements();
  agreementModal.cancel?.addEventListener("click", closePendingAgreementModal);
  agreementModal.close?.addEventListener("click", closePendingAgreementModal);
  agreementModal.overlay?.addEventListener("click", (event) => {
    if (event.target === agreementModal.overlay) {
      closePendingAgreementModal();
    }
  });
  agreementModal.save?.addEventListener("click", async () => {
    const agreementId = pendingAgreementModalState.agreementId;
    if (!agreementId) return;
    const internalCompany = agreementModal.internalCompany?.value?.trim() || "";
    const teamMember = agreementModal.teamMember?.value?.trim() || "";
    const requesterEmail = agreementModal.requesterEmail?.value?.trim() || "";
    const attorneyAssigned = agreementModal.attorneyAssigned?.value?.trim() || "";
    const matter = agreementModal.matter?.value?.trim() || "";
    const status = agreementModal.status?.value?.trim() || "";
    const statusNotes = agreementModal.statusNotes?.value?.trim() || "";
    const internalCompletionDate = agreementModal.internalCompletionDate?.value || null;
    const fullyExecutedDate = agreementModal.fullyExecutedDate?.value || null;

    if (!internalCompany || !teamMember || !matter) {
      await showAlert("Entity, requester name, and matter are required.", { title: "Missing info" });
      return;
    }

    try {
      const updated = await updatePendingAgreement(agreementId, {
        internal_company: internalCompany,
        team_member: teamMember,
        requester_email: requesterEmail,
        attorney_assigned: attorneyAssigned || null,
        matter,
        status,
        status_notes: statusNotes,
        internal_completion_date: internalCompletionDate,
        fully_executed_date: fullyExecutedDate,
      });
      state.pendingAgreements = state.pendingAgreements.map((entry) =>
        entry.id === agreementId ? { ...entry, ...updated } : entry,
      );
      renderPendingAgreementsQueue();
      await showAlert("Pending agreement updated.", { title: "Changes saved" });
      closePendingAgreementModal();
    } catch (err) {
      await showAlert(`Unable to update pending agreement. ${err.message}`, { title: "Save failed" });
    }
  });

  agreementModal.noteAdd?.addEventListener("click", async () => {
    const agreementId = pendingAgreementModalState.agreementId;
    if (!agreementId) return;
    const note = agreementModal.noteInput?.value?.trim() || "";
    if (!note) {
      if (agreementModal.noteStatus) agreementModal.noteStatus.textContent = "Enter a note to add.";
      return;
    }
    try {
      await createPendingAgreementNote(agreementId, note);
      if (agreementModal.noteInput) agreementModal.noteInput.value = "";
      if (agreementModal.noteStatus) agreementModal.noteStatus.textContent = "Note added.";
      await loadPendingAgreementDetails(agreementId);
    } catch (err) {
      if (agreementModal.noteStatus) agreementModal.noteStatus.textContent = `Unable to add note. ${err.message}`;
    }
  });

  agreementModal.fileUploadButton?.addEventListener("click", async () => {
    const agreementId = pendingAgreementModalState.agreementId;
    if (!agreementId) return;
    const fileType = agreementModal.fileType?.value || "draft";
    const file = agreementModal.fileUpload?.files?.[0];
    if (!file) {
      if (agreementModal.fileStatus) agreementModal.fileStatus.textContent = "Choose a file to upload.";
      return;
    }
    const formData = new FormData();
    formData.append("file_type", fileType);
    formData.append("file", file);
    try {
      await uploadPendingAgreementFile(agreementId, formData);
      if (agreementModal.fileStatus) agreementModal.fileStatus.textContent = "File uploaded.";
      if (agreementModal.fileUpload) agreementModal.fileUpload.value = "";
      await loadPendingAgreementDetails(agreementId);
      await loadPendingAgreements({ reset: true });
    } catch (err) {
      if (agreementModal.fileStatus) agreementModal.fileStatus.textContent = `Upload failed. ${err.message}`;
    }
  });

  const intakeModal = getPendingAgreementIntakeElements();
  intakeModal.cancel?.addEventListener("click", closePendingAgreementIntakeModal);
  intakeModal.close?.addEventListener("click", closePendingAgreementIntakeModal);
  intakeModal.overlay?.addEventListener("click", (event) => {
    if (event.target === intakeModal.overlay) {
      closePendingAgreementIntakeModal();
    }
  });
  intakeModal.save?.addEventListener("click", async () => {
    const internalCompany = intakeModal.internalCompany?.value?.trim() || "";
    const teamMember = intakeModal.teamMember?.value?.trim() || "";
    const requesterEmail = intakeModal.requesterEmail?.value?.trim() || "";
    const attorneyAssigned = intakeModal.attorneyAssigned?.value?.trim() || "";
    const matter = intakeModal.matter?.value?.trim() || "";
    const statusNotes = intakeModal.statusNotes?.value?.trim() || "";
    if (!internalCompany || !teamMember || !matter || !statusNotes) {
      await showAlert("Entity, requester, matter, and status notes are required.", { title: "Missing fields" });
      return;
    }
    const formData = new FormData();
    formData.append("internal_company", internalCompany);
    formData.append("team_member", teamMember);
    formData.append("requester_email", requesterEmail);
    formData.append("attorney_assigned", attorneyAssigned);
    formData.append("matter", matter);
    formData.append("status_notes", statusNotes);
    const file = intakeModal.file?.files?.[0];
    if (file) {
      formData.append("file", file);
    }
    try {
      await createPendingAgreementIntake(formData);
      closePendingAgreementIntakeModal();
      await loadPendingAgreements({ reset: true });
      await showAlert("Intake submission created.", { title: "Submitted" });
    } catch (err) {
      await showAlert(`Unable to submit intake. ${err.message}`, { title: "Submission failed" });
    }
  });

  $("pendingAgreementsAdd")?.addEventListener("click", () => {
    openPendingAgreementIntakeModal();
  });
  $("pendingAgreementsQueueExpand")?.addEventListener("click", () => toggleQueueExpanded("pendingAgreements"));
  $("pendingAgreementsLoadMore")?.addEventListener("click", async () => {
    await loadPendingAgreements();
  });
  const pendingSearch = $("pendingAgreementsSearch");
  const pendingSearchButton = $("pendingAgreementsSearchButton");
  const pendingSearchClear = $("pendingAgreementsSearchClear");
  const runPendingSearch = async () => {
    state.pendingAgreementsQuery = pendingSearch?.value.trim() || "";
    await loadPendingAgreements({ reset: true });
  };
  pendingSearchButton?.addEventListener("click", runPendingSearch);
  pendingSearchClear?.addEventListener("click", async () => {
    if (pendingSearch) pendingSearch.value = "";
    state.pendingAgreementsQuery = "";
    await loadPendingAgreements({ reset: true });
  });
  pendingSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runPendingSearch();
    }
  });

  $("pendingReminderSave")?.addEventListener("click", async () => {
    if (!hasPermission("pending_agreement_reminders_manage")) {
      await showAlert("You do not have permission to manage reminders.", {
        title: "Access denied",
      });
      return;
    }
    const frequency = $("pendingReminderFrequency")?.value || "weekly";
    const roles = getCheckedValues("pendingRoleOptions")
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));
    const recipients = getCheckedValues("pendingRecipientOptions");
    const message = $("pendingReminderMessage")?.value?.trim();

    if (!roles.length && !recipients.length) {
      await showAlert("Select at least one role or individual recipient.", { title: "Missing recipients" });
      return;
    }

    try {
      const created = await createPendingAgreementReminder({
        frequency,
        roles,
        recipients,
        message,
      });
      state.pendingAgreementReminders.unshift(created);
      if ($("pendingReminderMessage")) $("pendingReminderMessage").value = "";
      renderPendingReminderTable();
      const status = $("pendingReminderStatus");
      if (status) status.textContent = "Reminder rule saved.";
      await showAlert("Reminder rule saved.", { title: "Saved" });
    } catch (err) {
      await showAlert(`Unable to save reminder rule. ${err.message}`, { title: "Save failed" });
    }
  });

  $("pendingUserAdd")?.addEventListener("click", async () => {
    if (!hasPermission("user_directory_manage")) {
      await showAlert("You do not have permission to manage the user directory.", {
        title: "Access denied",
      });
      return;
    }
    const name = $("pendingUserName")?.value?.trim();
    const email = $("pendingUserEmail")?.value?.trim();
    if (!name || !email) {
      await showAlert("Provide both name and email.", { title: "Missing info" });
      return;
    }
    if (state.notificationUsers.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
      await showAlert("That email is already in the list.", { title: "Duplicate user" });
      return;
    }
    try {
      const created = await createNotificationUser({ name, email });
      state.notificationUsers.push(created);
      if ($("pendingUserName")) $("pendingUserName").value = "";
      if ($("pendingUserEmail")) $("pendingUserEmail").value = "";
      renderUserDirectories();
      renderNotificationOptions();
      renderPendingAgreementOwnerEmails();
      const status = $("pendingUserStatus");
      if (status) status.textContent = "User added.";
    } catch (err) {
      await showAlert(`Unable to add user. ${err.message}`, { title: "Save failed" });
    }
  });

  $("pendingAgreementRecipientsSave")?.addEventListener("click", async () => {
    if (!hasPermission("pending_agreements_manage")) {
      await showAlert("You do not have permission to manage intake recipients.", {
        title: "Access denied",
      });
      return;
    }
    const input = $("pendingAgreementRecipientsInput");
    const status = $("pendingAgreementRecipientsStatus");
    const lines = (input?.value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      if (status) status.textContent = "Enter at least one email.";
      return;
    }
    const recipients = lines.map((email) => ({ name: email, email }));
    try {
      const response = await updatePendingAgreementRecipients(recipients);
      state.pendingAgreementRecipients = response.recipients || recipients;
      renderPendingAgreementRecipientsInput();
      if (status) status.textContent = "Recipients updated.";
    } catch (err) {
      if (status) status.textContent = `Unable to update recipients. ${err.message}`;
    }
  });

  loadPendingAgreements({ reset: true });
  loadPendingAgreementReminders();
}

function initTasksUi() {
  renderNotificationOptions();
  renderTaskTable();
  renderUserDirectories();

  $("taskQueueExpand")?.addEventListener("click", () => toggleQueueExpanded("tasks"));
  $("taskQueueLoadMore")?.addEventListener("click", async () => {
    await loadTasks();
  });
  const taskSearch = $("taskQueueSearch");
  const taskSearchButton = $("taskQueueSearchButton");
  const taskSearchClear = $("taskQueueSearchClear");
  const runTaskSearch = async () => {
    state.tasksQuery = taskSearch?.value.trim() || "";
    await loadTasks({ reset: true });
  };
  taskSearchButton?.addEventListener("click", runTaskSearch);
  taskSearchClear?.addEventListener("click", async () => {
    if (taskSearch) taskSearch.value = "";
    state.tasksQuery = "";
    await loadTasks({ reset: true });
  });
  taskSearch?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runTaskSearch();
    }
  });

  $("taskCreate")?.addEventListener("click", async () => {
    if (!hasPermission("tasks_manage")) {
      await showAlert("You do not have permission to manage tasks.", { title: "Access denied" });
      return;
    }
    const title = $("taskTitle")?.value?.trim();
    const description = $("taskDescription")?.value?.trim();
    const dueDate = $("taskDueDate")?.value;
    const recurrence = $("taskRecurrence")?.value || "none";
    const reminders = getCheckedValues("taskReminderOptions");
    const assignees = getCheckedValues("taskAssigneeOptions");

    if (!title || !dueDate) {
      await showAlert("Task title and due date are required.", { title: "Missing info" });
      return;
    }

    try {
      await createTask({
        title,
        description,
        due_date: dueDate,
        recurrence,
        reminders,
        assignees,
      });
      await loadTasks({ reset: true });
    } catch (err) {
      await showAlert(`Unable to create task. ${err.message}`, { title: "Save failed" });
      return;
    }
    if ($("taskTitle")) $("taskTitle").value = "";
    if ($("taskDescription")) $("taskDescription").value = "";
    if ($("taskDueDate")) $("taskDueDate").value = "";
    const status = $("taskStatus");
    if (status) status.textContent = "Task created.";
  });

  $("taskUserAdd")?.addEventListener("click", async () => {
    if (!hasPermission("user_directory_manage")) {
      await showAlert("You do not have permission to manage the user directory.", {
        title: "Access denied",
      });
      return;
    }
    const name = $("taskUserName")?.value?.trim();
    const email = $("taskUserEmail")?.value?.trim();
    if (!name || !email) {
      await showAlert("Provide both name and email.", { title: "Missing info" });
      return;
    }
    if (state.notificationUsers.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
      await showAlert("That email is already in the list.", { title: "Duplicate user" });
      return;
    }
    try {
      const created = await createNotificationUser({ name, email });
      state.notificationUsers.push(created);
      if ($("taskUserName")) $("taskUserName").value = "";
      if ($("taskUserEmail")) $("taskUserEmail").value = "";
      renderUserDirectories();
      renderNotificationOptions();
      const status = $("taskUserStatus");
      if (status) status.textContent = "User added.";
    } catch (err) {
      await showAlert(`Unable to add user. ${err.message}`, { title: "Save failed" });
    }
  });

  loadTasks({ reset: true });
}

function formatList(values, fallback = "—") {
  if (!values || !values.length) return fallback;
  return values.join(", ");
}

function formatRoleList(roleIds, fallback = "—") {
  if (!roleIds || !roleIds.length) return fallback;
  const lookup = new Map(state.roles.map((role) => [String(role.id), role.name]));
  return roleIds
    .map((roleId) => lookup.get(String(roleId)) || `Role ${roleId}`)
    .join(", ");
}

function renderNotificationEventTable() {
  const table = $("notificationEventTable");
  if (!table) return;
  if (!state.notificationEventReminders.length) {
    table.innerHTML = `<tr><td colspan="5" class="muted small">No event reminders configured yet.</td></tr>`;
    return;
  }
  table.innerHTML = state.notificationEventReminders
    .map((event) => {
      const reminder = event.reminder || {};
      const recipients = formatList(reminder.recipients);
      const offsets = reminder.offsets ? reminder.offsets.join(", ") : "—";
      return `
        <tr>
          <td>${event.title || "Untitled"}</td>
          <td><span class="pill event-type event-${event.event_type}">${event.event_type}</span></td>
          <td>${event.event_date || "—"}</td>
          <td>${offsets}</td>
          <td>${recipients}</td>
        </tr>
      `;
    })
    .join("");
}

function renderNotificationPendingTable() {
  const table = $("notificationPendingTable");
  if (!table) return;
  if (!state.notificationPendingReminders.length) {
    table.innerHTML = `<tr><td colspan="4" class="muted small">No pending agreement reminder rules configured yet.</td></tr>`;
    return;
  }
  table.innerHTML = state.notificationPendingReminders
    .map((reminder) => {
      const roles = formatRoleList(reminder.roles);
      const recipients = formatList(reminder.recipients);
      const message = reminder.message || "—";
      return `
        <tr>
          <td>${reminder.frequency}</td>
          <td>${roles}</td>
          <td>${recipients}</td>
          <td>${message}</td>
        </tr>
      `;
    })
    .join("");
}

function renderNotificationTaskTable() {
  const table = $("notificationTaskTable");
  if (!table) return;
  if (!state.notificationTaskReminders.length) {
    table.innerHTML = `<tr><td colspan="4" class="muted small">No task reminders configured yet.</td></tr>`;
    return;
  }
  table.innerHTML = state.notificationTaskReminders
    .map((task) => {
      const offsets = formatList(task.reminders);
      const assignees = formatList(task.assignees);
      return `
        <tr>
          <td>${task.title || "Untitled"}</td>
          <td>${task.due_date || "—"}</td>
          <td>${offsets}</td>
          <td>${assignees}</td>
        </tr>
      `;
    })
    .join("");
}

function renderNotificationLogTable() {
  const table = $("notificationLogTable");
  const meta = $("notificationLogMeta");
  if (!table) return;
  if (meta) {
    meta.textContent = `${state.notificationLogTotal} entries`;
  }
  if (!state.notificationLogs.length) {
    table.innerHTML = `<tr><td colspan="5" class="muted small">No notification logs match your search.</td></tr>`;
    return;
  }
  table.innerHTML = state.notificationLogs
    .map((entry) => {
      const recipients = formatList(entry.recipients);
      return `
        <tr>
          <td>${entry.created_at || "—"}</td>
          <td>${entry.kind || "—"}</td>
          <td>${recipients}</td>
          <td>${entry.subject || "—"}</td>
          <td>${entry.status || "—"}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadNotificationOverview() {
  try {
    const [eventsRes, pendingRes, tasksRes] = await Promise.all([
      apiFetch("/api/events?month=all&event_type=all&sort=date_asc"),
      apiFetch("/api/pending-agreement-reminders"),
      apiFetch("/api/tasks?limit=100&offset=0"),
    ]);
    const events = await eventsRes.json();
    const pendingReminders = await pendingRes.json();
    const taskPayload = await tasksRes.json();

    state.notificationEventReminders = (events || []).filter(
      (event) => event.reminder && event.reminder.enabled && event.reminder.recipients?.length,
    );
    state.notificationPendingReminders = pendingReminders || [];
    state.notificationTaskReminders = (taskPayload.items || []).filter(
      (task) => !task.completed && task.reminders?.length && task.assignees?.length,
    );

    renderNotificationEventTable();
    renderNotificationPendingTable();
    renderNotificationTaskTable();
  } catch (err) {
    await showAlert(`Unable to load notifications overview. ${err.message}`, { title: "Load failed" });
  }
}

async function loadNotificationLogs({ reset = false } = {}) {
  if (reset) {
    state.notificationLogOffset = 0;
    state.notificationLogs = [];
  }
  const res = await fetchNotificationLogs({
    query: state.notificationLogQuery,
    status: state.notificationLogStatus,
    kind: state.notificationLogKind,
    limit: state.notificationLogLimit,
    offset: state.notificationLogOffset,
  });
  const data = await res.json();
  const items = data.items || [];
  if (reset) {
    state.notificationLogs = items;
  } else {
    state.notificationLogs = [...state.notificationLogs, ...items];
  }
  state.notificationLogTotal = data.total || 0;
  state.notificationLogLimit = data.limit || state.notificationLogLimit;
  state.notificationLogOffset = (data.offset || 0) + items.length;
  state.notificationLogHasMore = state.notificationLogOffset < state.notificationLogTotal;
  $("notificationLogLoadMore")?.classList.toggle("hidden", !state.notificationLogHasMore);
  renderNotificationLogTable();
}

function initNotificationsUi() {
  const searchInput = $("notificationLogSearch");
  const statusFilter = $("notificationLogStatus");
  const kindFilter = $("notificationLogKind");

  const runSearch = async () => {
    state.notificationLogQuery = searchInput?.value.trim() || "";
    state.notificationLogStatus = statusFilter?.value || "all";
    state.notificationLogKind = kindFilter?.value || "all";
    await loadNotificationLogs({ reset: true });
  };

  $("notificationLogSearchButton")?.addEventListener("click", runSearch);
  $("notificationLogSearchClear")?.addEventListener("click", async () => {
    if (searchInput) searchInput.value = "";
    if (statusFilter) statusFilter.value = "all";
    if (kindFilter) kindFilter.value = "all";
    state.notificationLogQuery = "";
    state.notificationLogStatus = "all";
    state.notificationLogKind = "all";
    await loadNotificationLogs({ reset: true });
  });
  $("notificationLogRefresh")?.addEventListener("click", async () => {
    await loadNotificationOverview();
    await loadNotificationLogs({ reset: true });
  });
  $("notificationLogLoadMore")?.addEventListener("click", async () => {
    await loadNotificationLogs();
  });
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch();
    }
  });
}

function showPage(page) {
  if (page === "pendingAgreements" && !hasPermission("pending_agreements_view")) {
    showToast("You do not have access to Pending Agreements.", { variant: "warning" });
    return;
  }
  if (page === "tasks" && !hasPermission("tasks_view")) {
    showToast("You do not have access to Tasks.", { variant: "warning" });
    return;
  }
  const pages = [
    "contracts",
    "allContracts",
    "planner",
    "pendingAgreements",
    "tasks",
    "notifications",
    "admin",
    "outputs",
  ];
  closeTour();
  state.currentPage = page;
  pages.forEach((p) => {
    $(p + "Page")?.classList.toggle("hidden", p !== page);
    $("nav" + p.charAt(0).toUpperCase() + p.slice(1))?.classList.toggle("active", p === page);
  });

  if (page === "allContracts") {
    loadAllContracts(true);
  }
  if (page === "planner") {
    loadPlanner();
    if (!state.events.length) {
      loadEvents();
    }
  }
  if (page === "notifications") {
    loadNotificationOverview();
    loadNotificationLogs({ reset: true });
  }
  if (page === "admin") {
    loadAdminData();
  }
}

function getTourElements() {
  return {
    overlay: $("tourOverlay"),
    tooltip: $("tourTooltip"),
    stepLabel: $("tourStepLabel"),
    title: $("tourTitle"),
    body: $("tourBody"),
    back: $("tourBack"),
    next: $("tourNext"),
    close: $("tourClose"),
  };
}

function closeTour() {
  if (!tourState.active) return;
  const { overlay } = getTourElements();
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
  if (tourState.currentTarget) {
    tourState.currentTarget.classList.remove("tour-highlight");
  }
  tourState.active = false;
  tourState.steps = [];
  tourState.index = 0;
  tourState.currentTarget = null;
}

function positionTourTooltip(target, tooltip) {
  if (!target || !tooltip) return;
  const rect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const spacing = 12;
  let top = rect.bottom + spacing;
  if (top + tooltipRect.height > window.innerHeight - spacing) {
    top = rect.top - tooltipRect.height - spacing;
  }
  top = Math.max(spacing, Math.min(top, window.innerHeight - tooltipRect.height - spacing));
  let left = rect.left;
  if (left + tooltipRect.width > window.innerWidth - spacing) {
    left = window.innerWidth - tooltipRect.width - spacing;
  }
  left = Math.max(spacing, left);
  tooltip.style.top = `${top + window.scrollY}px`;
  tooltip.style.left = `${left + window.scrollX}px`;
}

function renderTourStep() {
  const { overlay, tooltip, stepLabel, title, body, back, next, close } = getTourElements();
  if (!overlay || !tooltip || !stepLabel || !title || !body || !back || !next || !close) return;
  const step = tourState.steps[tourState.index];
  if (!step) {
    closeTour();
    return;
  }
  if (tourState.currentTarget) {
    tourState.currentTarget.classList.remove("tour-highlight");
  }
  const target = $(step.targetId);
  if (!target) {
    closeTour();
    return;
  }
  tourState.currentTarget = target;
  target.classList.add("tour-highlight");
  stepLabel.textContent = `Step ${tourState.index + 1} of ${tourState.steps.length}`;
  title.textContent = step.title;
  body.textContent = step.body;
  back.disabled = tourState.index === 0;
  next.textContent = tourState.index === tourState.steps.length - 1 ? "Finish" : "Next";
  close.textContent = "End tour";
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  requestAnimationFrame(() => {
    positionTourTooltip(target, tooltip);
  });
}

function startTour(steps) {
  const filtered = steps.filter((step) => $(step.targetId));
  if (!filtered.length) {
    showAlert("No steps were found for this tour.", { title: "Tour unavailable" });
    return;
  }
  tourState.steps = filtered;
  tourState.index = 0;
  tourState.active = true;
  const { overlay } = getTourElements();
  if (overlay) {
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }
  renderTourStep();
}

function initGuidedTours() {
  const { overlay, back, next, close } = getTourElements();
  if (!overlay || !back || !next || !close) return;

  const pendingAgreementsSteps = [
    {
      targetId: "pendingUserAdd",
      title: "Add notification recipients",
      body: "Add names and emails so reminders and nudges have recipients to target.",
    },
    {
      targetId: "pendingReminderFrequency",
      title: "Set reminder cadence",
      body: "Choose daily, weekly, or monthly reminders for pending approvals.",
    },
    {
      targetId: "pendingReminderSave",
      title: "Save the reminder rule",
      body: "Save the rule so it appears in the reminders table for quick edits.",
    },
    {
      targetId: "pendingAgreementsAdd",
      title: "Create a submission",
      body: "Submit a Contracts & Agreements intake request for the pending queue.",
    },
    {
      targetId: "pendingAgreementsQueueCard",
      title: "Manage the queue",
      body: "Search, nudge, edit, or remove pending agreements from this list.",
    },
  ];

  const taskSteps = [
    {
      targetId: "taskUserAdd",
      title: "Add task assignees",
      body: "Add users so tasks can be assigned and nudged.",
    },
    {
      targetId: "taskTitle",
      title: "Describe the task",
      body: "Provide a clear title (and optional description) for the assignment.",
    },
    {
      targetId: "taskReminderOptions",
      title: "Pick reminder offsets",
      body: "Select when reminders should go out relative to the due date.",
    },
    {
      targetId: "taskAssigneeOptions",
      title: "Choose assignees",
      body: "Select the users who should receive the task and nudges.",
    },
    {
      targetId: "taskCreate",
      title: "Create the task",
      body: "Click Create Task to push it into the task queue.",
    },
  ];

  const notificationsSteps = [
    {
      targetId: "notificationEventRules",
      title: "Event reminder rules",
      body: "Review contract event reminders, offsets, and recipients.",
    },
    {
      targetId: "notificationPendingRules",
      title: "Pending agreement reminders",
      body: "See which roles and recipients receive pending agreement emails.",
    },
    {
      targetId: "notificationTaskRules",
      title: "Task reminder coverage",
      body: "Confirm task reminder offsets and who will be notified.",
    },
    {
      targetId: "notificationLogSection",
      title: "Search notification history",
      body: "Use filters to review sent and failed email notifications.",
    },
  ];

  $("pendingAgreementsGuide")?.addEventListener("click", () => startTour(pendingAgreementsSteps));
  $("tasksGuide")?.addEventListener("click", () => startTour(taskSteps));
  $("notificationsGuide")?.addEventListener("click", () => startTour(notificationsSteps));

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeTour();
    }
  });
  back.addEventListener("click", () => {
    tourState.index = Math.max(0, tourState.index - 1);
    renderTourStep();
  });
  next.addEventListener("click", () => {
    if (tourState.index >= tourState.steps.length - 1) {
      closeTour();
      return;
    }
    tourState.index += 1;
    renderTourStep();
  });
  close.addEventListener("click", closeTour);
  window.addEventListener("resize", () => {
    if (tourState.active) {
      renderTourStep();
    }
  });
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
$("navPlanner")?.addEventListener("click", () => showPage("planner"));
$("navPendingAgreements")?.addEventListener("click", () => showPage("pendingAgreements"));
$("navTasks")?.addEventListener("click", () => showPage("tasks"));
$("navNotifications")?.addEventListener("click", () => showPage("notifications"));
$("navAdmin")?.addEventListener("click", () => showPage("admin"));
$("navOutputs")?.addEventListener("click", () => showPage("outputs"));

$("refresh").addEventListener("click", loadRecent);

initModal();
initAuthUi();
initDropzone();
initEventsUi();
initPlannerUi();
initPendingAgreementsUi();
initTasksUi();
initNotificationsUi();
initAllContractsUi();
initThemeToggle();
initPreviewFullscreen();
initGuidedTours();
initAdminUi();
initCollapsibleHeaders();
showPage("contracts");

async function loadAppData() {
  await testApi();
  await loadReferenceData();
  await loadRecent();
  await loadEvents();
}

async function handlePendingAgreementDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const agreementId = params.get("pendingAgreementId");
  if (!agreementId) return;
  showPage("pendingAgreements");
  try {
    const detail = await fetchPendingAgreementDetail(agreementId);
    openPendingAgreementModal(detail);
  } catch (err) {
    console.error("Unable to load pending agreement detail", err);
  }
}

(async () => {
  try {
    const authed = await ensureAuth();
    if (authed) {
      await loadAppData();
      await handlePendingAgreementDeepLink();
    }
  } catch (e) {
    console.error(e);
  }
})();
