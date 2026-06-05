// ─────────────────────────────────────────────────────────────
//  Wekraft Sidebar — Webview Script  (production-grade)
//  Runs in the sandboxed webview browser context.
// ─────────────────────────────────────────────────────────────
// @ts-check

const vscode = acquireVsCodeApi();

// ── App state ─────────────────────────────────────────────────

const state = {
  /** @type {{ isAuthenticated: boolean, user: any|null }} */
  auth:         { isAuthenticated: false, user: null },
  /** @type {"tasks"|"issues"} */
  activeView:   "tasks",
  /** @type {string} */
  activeStatus: "all",
  /** @type {any[]} */
  tasks:        [],
  /** @type {any[]} */
  projects:     [],
  /** @type {any[]} */
  issues:       [],
  /** @type {any[]} */
  tickets:      [],
  /** @type {any[]} */
  teamMembers:  [],
  /** @type {string} */
  projectId:    "",
  /** @type {string} */
  sprintId:     "",
  /** @type {{ type: "task"|"issue", id: string }|null} */
  editing:      null,
  /** @type {boolean} */
  pendingMarkAsIssue: false,
  /**
   * Incremented on every loadAll(). Each fetch response carries the epoch
   * it was launched in; stale responses from a previous epoch are discarded.
   * This prevents a slow/failed API call from overwriting fresher data.
   * @type {number}
   */
  fetchEpoch: 0,
};

// ── Tag colour map — matches web-app named tokens exactly ─────

const TAG_COLOR_MAP = {
  green:  { bg: "rgba(16,185,129,0.15)",  text: "#10b981", border: "rgba(16,185,129,0.35)"  },
  yellow: { bg: "rgba(234,179,8,0.15)",   text: "#eab308", border: "rgba(234,179,8,0.35)"   },
  purple: { bg: "rgba(168,85,247,0.15)",  text: "#a855f7", border: "rgba(168,85,247,0.35)"  },
  blue:   { bg: "rgba(59,130,246,0.15)",  text: "#60a5fa", border: "rgba(59,130,246,0.35)"  },
  grey:   { bg: "rgba(115,115,115,0.15)", text: "#a3a3a3", border: "rgba(115,115,115,0.35)" },
};

// ── Dropdown Icons ────────────────────────────────────────────

const ICONS = {
  // Statuses
  "not started": `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,
  inprogress: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>`,
  reviewing: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M4 8V4a2 2 0 0 1 2-2h4M4 16v4a2 2 0 0 0 2 2h4M16 4h4a2 2 0 0 1 2 2v4M16 20h4a2 2 0 0 0 2-2v-4"/><circle cx="12" cy="12" r="3"/><line x1="14.14" y1="14.14" x2="16.5" y2="16.5"/></svg>`,
  testing: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/></svg>`,
  completed: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  "not opened": `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  opened: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  reopened: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  closed: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  // Priorities
  no_priority: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,
  low: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  medium: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  high: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  critical: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  // Environments
  local: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  dev: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  staging: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  production: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  project: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  sprint: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  task: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#1447E6"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="9" r="1.5" fill="white" /><path d="M11 9h5" stroke="white" stroke-width="2" stroke-linecap="round" /><circle cx="8" cy="15" r="1.5" fill="white" /><path d="M11 15h5" stroke="white" stroke-width="2" stroke-linecap="round" /></svg>`,
  issue: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="6" /><path d="M12 7a3 3 0 0 0-3-3h6a3 3 0 0 0-3 3z" fill="#ef4444" /><line x1="12" y1="7" x2="12" y2="19" /><path d="M9 4C9 3 8 2.5 8 2.5M15 4C15 3 16 2.5 16 2.5" /><path d="M6 10H3.5M5 14H2.5M6 18H3.5M18 10h2.5M19 14h2.5M18 18h2.5" /><circle cx="9.5" cy="11.5" r="0.8" fill="#ef4444" /><circle cx="14.5" cy="11.5" r="0.8" fill="#ef4444" /><circle cx="9.5" cy="15.5" r="0.8" fill="#ef4444" /><circle cx="14.5" cy="15.5" r="0.8" fill="#ef4444" /></svg>`
};


// ── DOM references ────────────────────────────────────────────

const $ = (/** @type {string} */ id) => document.getElementById(id);

const screenLogin   = $("screen-login");
const screenLoading = $("screen-loading");
const screenMain    = $("screen-main");

const btnLogin   = $("btn-login");
const btnLogout  = $("btn-logout");
const btnThemeToggle = $("btn-theme-toggle");
const iconSun = $("icon-sun");
const iconMoon = $("icon-moon");
const userAvatar = $("user-avatar");
const userName   = $("user-name");
const userRole   = $("user-role");

const selectProject = /** @type {HTMLInputElement} */ ($("select-project"));
const selectSprint  = /** @type {HTMLInputElement} */ ($("select-sprint"));

const teamSection = $("team-section");
const teamAvatars = $("team-avatars");

const mainTabs   = document.querySelectorAll(".main-tab");
const btnNewItem = $("btn-new-item");
const btnNewItemLabel = $("btn-new-item-label");
const itemList   = $("item-list");

const editPanel       = $("edit-panel");
const repoSearch      = $("repo-search");
const repoTree        = $("repo-tree");
let   rawWorkspaceFiles = [];
const editPanelTitle  = $("edit-panel-title");
const editTitle       = /** @type {HTMLInputElement} */   ($("edit-title"));
const editStatus      = /** @type {HTMLInputElement} */ ($("edit-status"));
const editPriority    = /** @type {HTMLInputElement} */ ($("edit-priority"));
const btnSaveEdit     = $("btn-save-edit");
const btnCloseEdit    = $("btn-close-edit");

// ── Extension → Webview messages ─────────────────────────────

window.addEventListener("message", ({ data: msg }) => {
  switch (msg.type) {
    case "AUTH_STATE":          onAuthState(msg.payload); break;
    case "PROJECTS_LOADED":     onProjectsLoaded(msg.payload); break;
    case "SPRINTS_LOADED":      onSprintsLoaded(msg.payload); break;
    case "TASKS_LOADED":        onTasksLoaded(msg.payload.tasks, msg.payload.epoch); break;
    case "ISSUES_LOADED":       onIssuesLoaded(msg.payload.issues, msg.payload.epoch); break;
    case "TEAM_MEMBERS_LOADED": onTeamLoaded(msg.payload); break;
    case "TASK_CREATED":        onTaskCreated(msg.payload); break;
    case "TASK_UPDATED":        onTaskUpdated(msg.payload); break;
    case "ISSUE_CREATED":       onIssueCreated(msg.payload); break;
    case "TASK_MARKED_AS_ISSUE":
      loadAll();
      closeEditPanel();
      break;
    case "TASK_DELETED":  onTaskDeleted(msg.payload.taskId); break;
    case "ISSUE_UPDATED": onIssueUpdated(msg.payload); break;
    case "ISSUE_DELETED": onIssueDeleted(msg.payload.issueId); break;
    case "TICKETS_LOADED": onTicketsLoaded(msg.payload.tickets, msg.payload.epoch); break;
    case "TICKET_UPDATED": onTicketUpdated(msg.payload); break;
    case "LOADING":
      if (msg.payload.isLoading) showScreen("loading");
      break;
    case "WORKSPACE_FILES":
      rawWorkspaceFiles = msg.payload;
      renderRepoTree(rawWorkspaceFiles, repoTree);
      break;
    case "ERROR":
      tasksLoading = false;
      issuesLoading = false;
      showError(msg.payload.message);
      break;
    case "REFRESH": loadAll(); break;
  }
});

// ── Auth ──────────────────────────────────────────────────────

function onAuthState(auth) {
  state.auth = auth;
  if (!auth.isAuthenticated) {
    // Full state reset
    state.tasks        = [];
    state.projects     = [];
    state.issues       = [];
    state.teamMembers  = [];
    state.projectId    = "";
    state.sprintId     = "";
    state.editing      = null;
    state.fetchEpoch   = 0;

    // DOM reset
    if (userName)        userName.textContent    = "—";
    if (userRole)        { userRole.textContent  = "FREE PLAN"; userRole.className = "user-role plan-badge plan-free"; }
    if (userAvatar)      {
      userAvatar.classList.remove("has-image");
      userAvatar.innerHTML    = "";
    }
    if (selectProject)   setupCustomDropdown("select-project", []);
    if (selectSprint)    setupCustomDropdown("select-sprint", [{ value: "", label: "All tasks", icon: "" }]);
    if (teamSection)     teamSection.classList.add("hidden");
    if (teamAvatars)     teamAvatars.innerHTML   = "";
    if (itemList)        itemList.innerHTML       = '<div class="empty-state">Select a project to load data.</div>';
    closeEditPanel();
    stopPolling();

    showScreen("login");
    return;
  }

  startPolling();

  const u = auth.user;
  if (u && userName && userRole && userAvatar) {
    userName.textContent = u.name || "Member";

    if (state.projects.length > 0) {
      updateUserRoleForSelectedProject();
    } else {
      userRole.textContent = "MEMBER";
      userRole.className   = "user-role plan-badge plan-member";
    }

    if (u.avatarUrl) {
      userAvatar.classList.add("has-image");
      userAvatar.innerHTML = `<img src="${safeImgSrc(u.avatarUrl)}" alt="Avatar" class="mini-avatar-img" style="width:48px;height:48px;border-radius:25%;" />`;
    } else {
      userAvatar.innerHTML = `<span style="font-size:18px;">${esc((u.name || "?")[0].toUpperCase())}</span>`;
    }
  }

  const hasLoadedProjectsOnce = state.projects.length > 0;
  if (!hasLoadedProjectsOnce || (!screenLogin.classList.contains("hidden") && screenMain.classList.contains("hidden"))) {
    showScreen("loading");
    post({ type: "FETCH_PROJECTS" });
  }
}

// ── Project / Sprint ──────────────────────────────────────────

function onProjectsLoaded(projects) {
  state.projects = projects;
  if (!selectProject) return;

    const opts = projects.map((p) => ({
    value: p.id || p._id || "",
    label: p.name || p.projectName || "(unnamed)",
    icon: ""
  }));

  if (opts.length === 0) {
    opts.push({ value: "", label: "No projects", icon: "" });
  }

  const currentOpts = opts.map(o => o.value);
  if (!state.projectId || !currentOpts.includes(state.projectId)) {
    const newVal = opts[0]?.value || "";
    state.projectId = newVal;
    const input = $("select-project");
    if (input) input.value = newVal;
  }

  setupCustomDropdown("select-project", opts, (val) => {
    state.projectId = val;
    state.sprintId  = "";
    state.tickets   = []; // clear stale tickets from previous project
    if (selectSprint) selectSprint.value = "";
    closeEditPanel();
    updateUserRoleForSelectedProject();
    updateProjectDeadline();
    loadAll();
  });

  updateUserRoleForSelectedProject();
  updateProjectDeadline();
  loadAll();
}

function formatDeadlineDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  const year = d.getFullYear();
  const month = d.toLocaleDateString("en-US", { month: "short" });
  
  let suffix = "th";
  if (day === 1 || day === 21 || day === 31) suffix = "st";
  else if (day === 2 || day === 22) suffix = "nd";
  else if (day === 3 || day === 23) suffix = "rd";
  
  return `${month} ${day}${suffix}, ${year}`;
}

function updateProjectDeadline() {
  const container = document.getElementById("project-deadline-container");
  const textEl = document.getElementById("project-deadline-text");
  if (!container || !textEl) return;
  
  if (!state.projectId || !state.projects) {
    container.style.display = "none";
    return;
  }
  
  const proj = state.projects.find(p => (p.id || p._id) === state.projectId);
  const deadline = proj?.projectDeadline || proj?.endDate || proj?.dueDate || proj?.deadline || proj?.targetDate;
  
  container.style.display = ""; // Always show the section
  
  if (deadline) {
    textEl.textContent = formatDeadlineDate(deadline);
    textEl.classList.remove("muted");
  } else {
    textEl.textContent = "No deadline set";
    textEl.classList.add("muted");
  }
}


function onSprintsLoaded(sprints) {
  if (!selectSprint) return;
  
  const opts = (sprints || []).map((s) => {
    const val = s.id || s._id || "";
    const label = s.sprintName || s.name || "(unnamed sprint)";
    const statusIcon = s.status === "active" ? "🟢" : s.status === "planned" ? "🔵" : "✓";
    
    let dateRange = "";
    const start = s.duration?.startDate ?? s.startDate;
    const end   = s.duration?.endDate   ?? s.endDate;
    if (start && end) {
      const fmt = (/** @type {number} */ ts) =>
        new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dateRange = ` (${fmt(start)} – ${fmt(end)})`;
    }
    
    return {
      value: val,
      label: `${statusIcon} ${label}${dateRange}`,
      icon: ICONS.sprint
    };
  });

  opts.unshift({ value: "", label: "All tasks", icon: "" });

  const currentOpts = opts.map(o => o.value);
  if (!state.sprintId || !currentOpts.includes(state.sprintId)) {
    state.sprintId = "";
    const input = $("select-sprint");
    if (input) input.value = "";
  }

  setupCustomDropdown("select-sprint", opts, (val) => {
    state.sprintId = val;
    if (state.activeView === "tasks") {
      // Don't wipe tasks immediately — keep current list visible while new data loads
      loadAll();
    }
  });
}

function updateUserRoleForSelectedProject() {
  if (!state.projectId || !state.auth.user) return;
  const currentProj = state.projects.find((p) =>
    (p.id || p._id) === state.projectId
  );
  if (!currentProj || !userRole) return;

  const userId = state.auth.user.id || state.auth.user._id;
  if (currentProj.ownerId === userId) {
    userRole.textContent = "OWNER";
    userRole.className   = "user-role plan-badge plan-owner";
  } else {
    const myMember = state.teamMembers.find(
      (m) => m.userId === userId || m.user?.id === userId
    );
    const role = myMember ? (myMember.role || "member") : "member";
    userRole.textContent = role.toUpperCase();
    userRole.className   = `user-role plan-badge plan-${role}`;
  }
}

// ── Fetch epoch — prevents stale API responses from overwriting good data ──

/**
 * Start a new load cycle. Returns the epoch number for this cycle.
 * Any response carrying a different epoch is silently discarded.
 */
function nextEpoch() {
  state.fetchEpoch += 1;
  return state.fetchEpoch;
}

let tasksLoading = false;
let issuesLoading = false;
let lastFetchStartTime = 0;
let lastLoadSilentTime = 0;

function loadAll() {
  if (!state.projectId) return;
  const epoch = nextEpoch();
  lastFetchStartTime = Date.now();
  tasksLoading = true;
  issuesLoading = true;

  // Only show the loading skeleton on the FIRST load (when we have nothing to display).
  // For all subsequent refreshes (tab switch, sprint change, project change), we keep
  // the current content visible and update it silently — no more flash of loading screen.
  const hasExistingData = state.tasks.length > 0 || state.issues.length > 0;
  if (!hasExistingData && screenLoading && screenMain && screenMain.classList.contains("hidden")) {
    showScreen("loading");
  }
  post({
    type: "FETCH_PROJECT_DATA",
    payload: { projectId: state.projectId, sprintId: state.sprintId || undefined, epoch }
  });
}

function loadAllSilent() {
  if (!state.projectId || !state.auth?.isAuthenticated || state.editing) return;
  
  // Smart polling: Do not spam the server if this VS Code window/tab is hidden in the background
  if (document.hidden) return;

  // Debounce rapid calls (e.g., from tab switching focus events) to prevent 429 Rate Limit
  const now = Date.now();
  if ((tasksLoading || issuesLoading) && (now - lastFetchStartTime < 15000)) {
    return;
  }

  if (now - lastLoadSilentTime < 5000) return;
  lastLoadSilentTime = now;
  lastFetchStartTime = now;

  tasksLoading = true;
  issuesLoading = true;

  const epoch = nextEpoch(); // Unique epoch for each poll to avoid races
  post({ type: "FETCH_PROJECTS" });
  post({
    type: "FETCH_PROJECT_DATA",
    payload: { projectId: state.projectId, sprintId: state.sprintId || undefined, epoch }
  });
}

// Background polling — every 30 minutes
let pollInterval = null;

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(loadAllSilent, 30 * 60 * 1000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Custom dropdowns handle their own onChange events.

// ── Data handlers ─────────────────────────────────────────────

/**
 * @param {any[]} tasks
 * @param {number|undefined} epoch
 */
function onTasksLoaded(tasks, epoch) {
  // Discard stale responses from a superseded fetch cycle
  if (epoch !== undefined && epoch !== state.fetchEpoch) return;
  tasksLoading = false;
  state.tasks = Array.isArray(tasks) ? tasks : [];
  // Always ensure the main screen is visible — never stay on loading screen
  showScreen("main");
  if (state.activeView === "tasks") {
    renderItems();
  }
}

/**
 * @param {any[]} issues
 * @param {number|undefined} epoch
 */
function onIssuesLoaded(issues, epoch) {
  if (epoch !== undefined && epoch !== state.fetchEpoch) return;
  issuesLoading = false;
  state.issues = Array.isArray(issues) ? issues : [];
  // Always ensure the main screen is visible
  showScreen("main");
  if (state.activeView === "issues") {
    renderItems();
  }
}

function onTeamLoaded(members) {
  state.teamMembers = Array.isArray(members) ? members : [];
  updateUserRoleForSelectedProject();

  if (!teamSection || !teamAvatars) return;

  if (state.teamMembers.length > 0) {
    teamSection.classList.remove("hidden");
    teamAvatars.innerHTML = state.teamMembers.map((m) => {
      const initial    = (m.user?.name || "?")[0].toUpperCase();
      const roleBadge  = m.role === "admin" || m.role === "owner" ? "👑 " : "";
      const avatarHtml = m.user?.avatarUrl
        ? `<img src="${safeImgSrc(m.user.avatarUrl)}" class="mini-avatar-img" />`
        : `<span class="mini-avatar">${esc(initial)}</span>`;

      return `<div class="team-avatar-item" title="${esc(m.user?.name || "")} (${m.role || ""})">
                ${avatarHtml}
                <span>${roleBadge}${esc(m.user?.name || "")}</span>
              </div>`;
    }).join("");
  } else {
    teamSection.classList.add("hidden");
  }
  // Rebuild assignee dropdown only if edit panel is open
  if (state.editing) {
    const assigneeEl = $("edit-assignee");
    if (assigneeEl) {
      let cur = [];
      try { cur = JSON.parse(assigneeEl.value || "[]"); } catch (e) { cur = []; }
      buildAvatarAssigneeSelect(cur);
    }
  }
}

function onTaskCreated(task) {
  if (!task) return;
  state.tasks = [task, ...state.tasks];
  if (state.activeView === "tasks") renderItems();
  closeEditPanel();

  if (state.pendingMarkAsIssue) {
    state.pendingMarkAsIssue = false;
    post({ type: "MARK_TASK_AS_ISSUE", payload: { taskId: task.id || task._id } });
  }
}

function onTaskUpdated(task) {
  if (!task) return;
  const id = task.id || task._id;
  state.tasks = state.tasks.map((t) => ((t.id || t._id) === id ? task : t));
  if (state.activeView === "tasks") renderItems();
  closeEditPanel();
}

function onTaskDeleted(taskId) {
  if (!taskId) return;
  state.tasks = state.tasks.filter((t) => (t.id || t._id) !== taskId);
  if (state.activeView === "tasks") renderItems();
}

function onIssueCreated(issue) {
  if (!issue) return;
  state.issues = [issue, ...state.issues];
  if (state.activeView === "issues") renderItems();
  closeEditPanel();
}

function onIssueUpdated(issue) {
  if (!issue) return;
  const id = issue.id || issue._id;
  state.issues = state.issues.map((i) => ((i.id || i._id) === id ? issue : i));

  if (issue.taskId && issue.status === "closed") {
    state.tasks = state.tasks.map((t) =>
      (t.id || t._id) === issue.taskId ? { ...t, isBlocked: false } : t
    );
  }
  renderItems();
  closeEditPanel();
}

function onIssueDeleted(issueId) {
  if (!issueId) return;
  const issue = state.issues.find((i) => (i.id || i._id) === issueId);
  if (issue?.taskId) {
    state.tasks = state.tasks.map((t) =>
      (t.id || t._id) === issue.taskId ? { ...t, isBlocked: false } : t
    );
  }
  state.issues = state.issues.filter((i) => (i.id || i._id) !== issueId);
  renderItems();
}

// ── Render ────────────────────────────────────────────────────

function renderItems() {
  if (!itemList) return;

  if (state.activeView === "tickets") {
    renderTickets();
    return;
  }

  const items    = state.activeView === "tasks" ? state.tasks : state.issues;
  const filtered = state.activeStatus === "all"
    ? items
    : items.filter((i) => i.status === state.activeStatus);

  if (editPanel && editPanel.parentNode === itemList) {
    const screenMain = document.getElementById("screen-main");
    if (screenMain) screenMain.appendChild(editPanel);
  }

  if (!filtered.length) {
    itemList.innerHTML = `<div class="empty-state">No ${state.activeView} found.</div>`;
    return;
  }

  if (editPanel && editPanel.parentNode === itemList) {
    const screenMain = document.getElementById("screen-main");
    if (screenMain) screenMain.appendChild(editPanel);
  }

  itemList.innerHTML = filtered.map((item) => itemCardHtml(item)).join("");

  itemList.querySelectorAll(".item-card").forEach((card) => {
    const id   = card.getAttribute("data-id") || "";
    const type = /** @type {"task"|"issue"} */ (card.getAttribute("data-type") || "task");

    card.querySelector(".btn-edit")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditPanel(type, id);
    });

    card.querySelector(".btn-delete")?.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmDelete(type, id);
    });

    card.querySelector(".item-status")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const wrap = /** @type {HTMLElement|null} */ (card.querySelector(".item-status-wrap"));
      const currentStatus = /** @type {HTMLElement} */ (e.currentTarget).getAttribute("data-status") || "";
      if (!wrap) return;
      if (activeStatusWrap === wrap) {
        closeStatusMenu();
        return;
      }
      openStatusMenu(wrap, type, id, currentStatus);
    });

    card.addEventListener("click", (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (target.closest(".btn-edit") || target.closest(".btn-delete") || target.closest(".status-menu")) return;
      const wrap = /** @type {HTMLElement|null} */ (card.querySelector(".item-status-wrap"));
      const statusEl = /** @type {HTMLElement|null} */ (card.querySelector(".item-status"));
      const currentStatus = statusEl?.getAttribute("data-status") || "";
      if (!wrap) return;
      openStatusMenu(wrap, type, id, currentStatus);
    });
  });
}

function renderTickets() {
  if (!itemList) return;

  if (editPanel && editPanel.parentNode === itemList) {
    const screenMainEl = document.getElementById("screen-main");
    if (screenMainEl) screenMainEl.appendChild(editPanel);
  }

  if (!state.tickets || state.tickets.length === 0) {
    itemList.innerHTML = `<div class="empty-state">No tickets assigned to or created by you.</div>`;
    return;
  }

  itemList.innerHTML = state.tickets.map((t) => ticketCardHtml(t)).join("");

  itemList.querySelectorAll(".ticket-card").forEach((card) => {
    const ticketId = card.getAttribute("data-id") || "";
    card.querySelector(".ticket-action-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const currentStatus = card.getAttribute("data-status") || "open";
      const newStatus = currentStatus === "open" ? "closed" : "open";
      updateTicketStatusLocally(ticketId, newStatus);
    });
  });
}

function ticketCardHtml(ticket) {
  const isClosed = ticket.status === "closed";
  const statusLabel = isClosed ? "CLOSED" : "OPEN";
  const actionLabel = isClosed ? "Reopen" : "Close";

  const dateStr = ticket.createdAt
    ? new Date(ticket.createdAt).toLocaleDateString("en-US", {
        month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      })
    : "";

  // ── Permission gate: only assignee or creator may toggle status ──
  const currentUserId = state.auth.user?.id || state.auth.user?._id || "";
  const canToggle = currentUserId && (
    ticket.assignedTo === currentUserId || ticket.createdBy === currentUserId
  );

  // ── Assignee avatar ──
  const assigneeName = ticket.assignee?.name || "Unassigned";
  const assigneeAvatar = ticket.assignee?.avatarUrl
    ? `<img src="${safeImgSrc(ticket.assignee.avatarUrl)}" class="ticket-person-avatar ticket-person-avatar--img" title="${esc(assigneeName)}" />`
    : `<span class="ticket-person-avatar ticket-person-avatar--initial" title="${esc(assigneeName)}">${esc((assigneeName[0] || "?").toUpperCase())}</span>`;

  // ── Creator avatar ──
  const creatorName = ticket.creator?.name || "Unknown";
  const creatorAvatar = ticket.creator?.avatarUrl
    ? `<img src="${safeImgSrc(ticket.creator.avatarUrl)}" class="ticket-person-avatar ticket-person-avatar--img" title="${esc(creatorName)}" />`
    : `<span class="ticket-person-avatar ticket-person-avatar--initial" title="${esc(creatorName)}">${esc((creatorName[0] || "?").toUpperCase())}</span>`;

  const actionBtn = canToggle
    ? `<button class="ticket-action-btn">${esc(actionLabel)}</button>`
    : `<button class="ticket-action-btn ticket-action-btn--disabled" disabled title="Only the assignee or creator can change this ticket">${esc(actionLabel)}</button>`;

  return /* html */ `
    <div class="ticket-card" data-id="${esc(ticket.id || ticket._id)}" data-status="${esc(ticket.status)}">
      <div class="ticket-header-row">
        <div class="ticket-date">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${esc(dateStr)}
        </div>
        <div class="ticket-header-right">
          <span class="ticket-status-badge ticket-status-badge--${esc(ticket.status)}">${esc(statusLabel)}</span>
          ${actionBtn}
        </div>
      </div>
      <div class="ticket-body">${esc(ticket.body || "No description")}</div>
      <div class="ticket-people-row">
        <div class="ticket-person">
          <span class="ticket-person-label">Assignee:</span>
          ${assigneeAvatar}
        </div>
        <div class="ticket-person">
          <span class="ticket-person-label">Creator:</span>
          ${creatorAvatar}
        </div>
      </div>
    </div>`;
}

function onTicketsLoaded(tickets, epoch) {
  if (epoch && epoch !== state.fetchEpoch) return;
  state.tickets = tickets || [];
  if (state.activeView === "tickets") renderItems();
}

function onTicketUpdated(ticket) {
  if (!ticket) return;
  const id = ticket.id || ticket._id;
  state.tickets = state.tickets.map((t) => ((t.id || t._id) === id ? ticket : t));
  if (state.activeView === "tickets") renderItems();
}

function updateTicketStatusLocally(ticketId, status) {
  state.tickets = state.tickets.map((t) => ((t.id || t._id) === ticketId ? { ...t, status } : t));
  post({ type: "UPDATE_TICKET", payload: { ticketId, status } });
  renderItems();
}


/**
 * Validates hex colors strictly to prevent CSS injection.
 * @param {string|null|undefined} colorStr
 * @returns {string}
 */
function cssSafeColor(colorStr) {
  const HEX_REGEX = /^#[0-9a-fA-F]{3,6}$/;
  const rawColor = (colorStr || "").trim();
  return HEX_REGEX.test(rawColor) ? rawColor : "#6366f1";
}

/**
 * @param {{ label: string, color: string }|null|undefined} tag
 */
function tagBadgeHtml(tag) {
  if (!tag || !tag.label) return "";
  const c = TAG_COLOR_MAP[tag.color];
  if (c) {
    return `<span style="font-size:9px;padding:2px 5px;border-radius:4px;margin-left:6px;background:${c.bg};color:${c.text};border:1px solid ${c.border};">${esc(tag.label)}</span>`;
  }
  // Fallback: legacy hex color — validated strictly to prevent CSS injection.
  const hex = cssSafeColor(tag.color);
  return `<span style="font-size:9px;padding:2px 5px;border-radius:4px;margin-left:6px;background:${hex}22;color:${hex};border:1px solid ${hex}44;">${esc(tag.label)}</span>`;
}

// ── Status badge slugify ──────────────────────────────────────

/** @param {string} status */
function statusClass(status) {
  return (status || "").replace(/[\s_]+/g, "-").toLowerCase();
}

const STATUS_LABELS = {
  "not started": "Not Started",
  inprogress: "In Progress",
  reviewing: "Reviewing",
  testing: "Testing",
  completed: "Completed",
  "not opened": "Not Opened",
  opened: "Opened",
  reopened: "Reopened",
  closed: "Closed",
};

let activeStatusMenu = null;
let activeStatusWrap = null;

function formatStatusLabel(status) {
  return STATUS_LABELS[status] || (status || "").replace(/_/g, " ");
}

function formatShortDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateRange(startTs, endTs) {
  const startDate = startTs ? new Date(startTs) : null;
  const endDate = endTs ? new Date(endTs) : null;
  if (startDate && Number.isNaN(startDate.getTime())) return "";
  if (endDate && Number.isNaN(endDate.getTime())) return "";

  if (startDate && endDate) {
    const startMonth = startDate.toLocaleDateString("en-US", { month: "short" });
    const endMonth = endDate.toLocaleDateString("en-US", { month: "short" });
    const startDay = startDate.getDate();
    const endDay = endDate.getDate();
    if (startMonth === endMonth && startDay === endDay && startDate.getFullYear() === endDate.getFullYear()) {
      return `${startMonth} ${startDay}`;
    }
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
  }

  return formatShortDate(startTs) || formatShortDate(endTs) || "No date";
}

function closeStatusMenu() {
  if (activeStatusMenu) {
    activeStatusMenu.remove();
    activeStatusMenu = null;
    activeStatusWrap = null;
  }
}

document.addEventListener("click", (e) => {
  if (activeStatusMenu && activeStatusWrap) {
    // Close if click is outside both the wrap AND the floating menu
    if (
      !activeStatusWrap.contains(/** @type {Node} */ (e.target)) &&
      !activeStatusMenu.contains(/** @type {Node} */ (e.target))
    ) {
      closeStatusMenu();
    }
  }
});

function updateItemStatus(type, id, status) {
  if (type === "task") {
    state.tasks = state.tasks.map((t) => ((t.id || t._id) === id ? { ...t, status } : t));
    post({ type: "UPDATE_TASK", payload: { taskId: id, status } });
  } else {
    state.issues = state.issues.map((i) => ((i.id || i._id) === id ? { ...i, status } : i));
    post({ type: "UPDATE_ISSUE", payload: { issueId: id, status } });
  }
  renderItems();
}

function openStatusMenu(wrap, type, id, currentStatus) {
  closeStatusMenu();
  const statuses = type === "issue" ? ISSUE_STATUSES : TASK_STATUSES;
  const menu = document.createElement("div");
  menu.className = "status-menu";
  menu.innerHTML = statuses.map((s) => {
    const iconHtml = ICONS[s] ? `<span style="opacity:0.8;display:flex;">${ICONS[s]}</span>` : "";
    return `<button type="button" class="status-menu-item${s === currentStatus ? " active" : ""}" data-status="${esc(s)}">
      <span style="flex:1;text-align:left;">${esc(formatStatusLabel(s))}</span>${iconHtml}
    </button>`;
  }).join("");

  menu.querySelectorAll(".status-menu-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const newStatus = /** @type {HTMLElement} */ (btn).getAttribute("data-status") || "";
      if (newStatus && newStatus !== currentStatus) {
        updateItemStatus(type, id, newStatus);
      }
      closeStatusMenu();
    });
  });

  // Append inside the wrap so the menu scrolls with the sidebar naturally.
  // overflow-y is removed from .item-list in CSS so nothing clips it.
  wrap.appendChild(menu);
  activeStatusMenu = menu;
  activeStatusWrap = wrap;
}

// ── Item card HTML ────────────────────────────────────────────

function itemCardHtml(item) {
  const isIssue = state.activeView === "issues";
  const itemId  = item.id || item._id || "";

  const priorityColors = {
    urgent:      "var(--priority-urgent)",
    critical:    "var(--priority-urgent)",
    high:        "var(--priority-high)",
    medium:      "var(--priority-medium)",
    low:         "var(--priority-low)",
    no_priority: "var(--priority-none)",
  };
  const dotColor    = priorityColors[item.priority] ?? "var(--priority-none)";
  const statusLabel = formatStatusLabel(item.status);
  const statusCls   = `badge-${statusClass(item.status)}`;

  const renderAssigneesHtml = (/** @type {any[]} */ assignees) => {
    if (!assignees || assignees.length === 0) return "";
    const maxShow = 3;
    const itemsHtml = assignees.slice(0, maxShow).map((a, idx) => {
      const z = maxShow - idx;
      const ml = idx > 0 ? "-6px" : "0";
      const name = a.name || a.user?.name || "Member";
      const avatar = a.avatarUrl || a.avatar || "";
      if (avatar) {
        return `<img src="${safeImgSrc(avatar)}" class="mini-avatar-img" style="margin-left:${ml};z-index:${z};" title="${esc(name)}" />`;
      }
      const initial = (name || "?")[0].toUpperCase();
      return `<span class="mini-avatar" style="margin-left:${ml};z-index:${z};" title="${esc(name)}">${esc(initial)}</span>`;
    }).join("");

    const extra = assignees.length > maxShow
      ? `<span class="item-assignee-extra">+${assignees.length - maxShow}</span>`
      : "";

    return `<div class="item-assignees">${itemsHtml}${extra}</div>`;
  };

  const assigneesList = Array.isArray(item.assignees) && item.assignees.length > 0
    ? item.assignees
    : (item.assignee ? [item.assignee] : []);

  const st = item.estimation?.startDate || item.duration?.startDate || item.startDate || item.start_date;
  const en = item.estimation?.endDate || item.duration?.endDate || item.endDate || item.end_date || item.dueDate || item.due_date;

  const dateLabel = isIssue
    ? (formatShortDate(en || st) || "No date")
    : formatDateRange(st, en);
  const dateHtml = dateLabel ? `<span class="item-pill item-date">
            <svg class="item-pill-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${esc(dateLabel)}
          </span>` : "";

  return /* html */ `
    <div class="item-card" data-id="${esc(itemId)}" data-type="${isIssue ? "issue" : "task"}">
      <div class="item-body">
        <div class="item-header">
          <div class="item-title" title="${esc(item.title || "")}">
            <span style="display:inline-flex;vertical-align:middle;margin-right:6px;">${(isIssue || item.isBlocked) ? ICONS.issue : ICONS.task}</span>
            ${esc(item.title || "")}
            ${item.linkWithCodebase ? `<span title="Linked: ${esc(item.linkWithCodebase)}" style="font-size:12px;margin-left:6px;opacity:0.6;">🔗</span>` : ""}
          </div>
          ${renderAssigneesHtml(assigneesList)}
        </div>
        <div class="item-meta">
          <div class="item-status-wrap">
            <button type="button" class="item-pill item-status ${statusCls}" data-status="${esc(item.status || "")}">${esc(statusLabel || "Status")}</button>
          </div>
          ${dateHtml}
        </div>
      </div>
      <div class="item-actions">
        <button class="btn-icon btn-edit" title="Edit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon btn-delete" title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// ── Inline edit panel ─────────────────────────────────────────

const TASK_STATUSES    = ["not started", "inprogress", "reviewing", "testing", "completed"];
const ISSUE_STATUSES   = ["not opened", "opened", "reopened", "closed"];
const TASK_PRIORITIES  = ["no_priority", "high", "medium", "low"];
const ISSUE_PRIORITIES = ["no_priority", "critical", "high", "medium", "low"];
const ENVIRONMENTS     = ["local", "dev", "staging", "production"];

// ── Custom Dropdown Engine ─────────────────────────────────────────────

/**
 * Sets up a fully custom dark-themed dropdown bound to a hidden <input>.
 * @param {string} id - The id of the hidden input element (e.g. "edit-status")
 * @param {{ value: string, label: string, icon: string }[]} options
 * @param {((val: string) => void) | undefined} [onChange]
 */
function setupCustomDropdown(id, options, onChange) {
  const wrapper    = $("wrapper-" + id);
  const display    = $("display-" + id);
  const dropdown   = $("dropdown-" + id);
  const hiddenInput = /** @type {HTMLInputElement|null} */ ($(id));

  if (!wrapper || !display || !dropdown || !hiddenInput) return;

  const textEl = display.querySelector(".wk-select-text");
  const iconEl = display.querySelector(".wk-select-icon");

  const renderSelected = () => {
    const currentVal = hiddenInput.value;
    const opt = options.find((o) => o.value === currentVal) || options[0];
    if (opt) {
      if (textEl) textEl.textContent = opt.label;
      if (iconEl) iconEl.innerHTML = opt.icon || "";
    }
  };

  const renderDropdown = () => {
    dropdown.innerHTML = options.map((opt) => {
      const isSelected = hiddenInput.value === opt.value;
      return `<div class="wk-select-option${isSelected ? " selected" : ""}" data-val="${esc(opt.value)}">` +
        `<span class="wk-select-option-label">${esc(opt.label)}</span>` +
        (opt.icon ? `<span class="wk-select-icon">${opt.icon}</span>` : "") +
        `</div>`;
    }).join("");

    dropdown.querySelectorAll(".wk-select-option").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const newVal = /** @type {HTMLElement} */ (el).getAttribute("data-val") || "";
        hiddenInput.value = newVal;
        renderSelected();
        display.classList.remove("open");
        dropdown.classList.add("hidden");
        if (onChange) onChange(newVal);
      });
    });
  };

  display.onclick = (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains("hidden");
    // Close all other open dropdowns
    document.querySelectorAll(".wk-select-display.open").forEach((el) => el.classList.remove("open"));
    document.querySelectorAll(".wk-select-dropdown").forEach((el) => el.classList.add("hidden"));
    if (!isOpen) {
      display.classList.add("open");
      renderDropdown();
      dropdown.classList.remove("hidden");
    }
  };

  renderSelected();
}

// Global click closes any open custom dropdown and wk-card menus
document.addEventListener("click", () => {
  document.querySelectorAll(".wk-select-display.open").forEach((el) => el.classList.remove("open"));
  document.querySelectorAll(".wk-select-dropdown").forEach((el) => el.classList.add("hidden"));
});


function openEditPanel(type, id) {
  if (!editTitle || !btnSaveEdit || !editPanel || !editPanelTitle) return;
  editTitle.disabled   = false;
  btnSaveEdit.disabled = false;

  let item = null;
  if (id) {
    item = type === "task"
      ? state.tasks.find((t) => (t.id || t._id) === id)
      : state.issues.find((i) => (i.id || i._id) === id);
    if (!item) return;
  }

  state.editing = { type, id: id || "" };
  editPanelTitle.textContent = !id
    ? (type === "task" ? "New Task" : "New Issue")
    : (type === "task" ? "Edit Task" : "Edit Issue");

  if (!editStatus || !editPriority) return;

  const statuses = type === "task" ? TASK_STATUSES : ISSUE_STATUSES;
  const statusOpts = statuses.map((s) => ({
    value: s,
    label: s.replace(/_/g, " "),
    icon: ICONS[s] || ""
  }));
  const currentStatus = item?.status || statuses[0];
  editStatus.value = currentStatus;
  setupCustomDropdown("edit-status", statusOpts);

  const priorities = type === "task" ? TASK_PRIORITIES : ISSUE_PRIORITIES;
  const priorityOpts = priorities.map((p) => ({
    value: p,
    label: p === "no_priority" ? "None" : p.charAt(0).toUpperCase() + p.slice(1),
    icon: ICONS[p] || ""
  }));
  const currentPriority = item?.priority || priorities[0];
  editPriority.value = currentPriority;
  setupCustomDropdown("edit-priority", priorityOpts);

  editTitle.value = item?.title ?? "";
  const descEl = $("edit-description");
  if (descEl) /** @type {HTMLTextAreaElement} */ (descEl).value = item?.description ?? "";

  const isTask             = type === "task";
  const taskDates          = $("task-dates");
  const taskTypeRow        = $("task-type-row");
  const taskLinkRow        = $("task-link-row");
  const taskBlocked        = $("task-blocked-row");
  const issueDueDateRow    = $("issue-due-date-row");
  const issueEnvironmentRow = $("issue-environment-row");

  if (taskDates)          taskDates.style.display          = isTask ? "" : "none";
  if (taskTypeRow)        taskTypeRow.style.display        = isTask ? "" : "none";
  if (taskLinkRow)        taskLinkRow.style.display        = "";
  if (taskBlocked)        taskBlocked.style.display        = isTask ? "" : "none";
  if (issueDueDateRow)    issueDueDateRow.style.display    = isTask ? "none" : "";
  if (issueEnvironmentRow) issueEnvironmentRow.style.display = isTask ? "none" : "";

  if (isTask) {
    const startEl  = /** @type {HTMLInputElement|null} */ ($("edit-start-date"));
    const endEl    = /** @type {HTMLInputElement|null} */ ($("edit-end-date"));
    const todayStr = new Date().toISOString().split("T")[0];

    if (startEl) {
      startEl.min             = todayStr;
      startEl.readOnly        = false;
      startEl.style.pointerEvents = "";
      startEl.style.opacity   = "";
      let startVal = todayStr;
      if (item?.estimation?.startDate) {
        const d = new Date(item.estimation.startDate).toISOString().split("T")[0];
        if (d >= todayStr) startVal = d;
      }
      startEl.value = startVal;
    }

    if (endEl) {
      const startVal  = startEl ? startEl.value : todayStr;
      const nextDay   = new Date(startVal);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split("T")[0];
      endEl.min = nextDayStr;
      let endVal = item?.estimation?.endDate
        ? new Date(item.estimation.endDate).toISOString().split("T")[0]
        : new Date(Date.now() + 86400000 * 7).toISOString().split("T")[0];
      if (endVal <= startVal) endVal = nextDayStr;
      endEl.value = endVal;
    }

    const typeLbl = /** @type {HTMLInputElement|null} */ ($("edit-type-label"));
    if (typeLbl) typeLbl.value = item?.type?.label ?? "";
    selectTagColor(item?.type?.color ?? "blue");

    const linkEl = /** @type {HTMLInputElement|null} */ ($("edit-link-codebase"));
    if (linkEl) linkEl.value = item?.linkWithCodebase ?? "";

    const blockedEl = /** @type {HTMLInputElement|null} */ ($("edit-is-blocked"));
    if (blockedEl) {
      blockedEl.checked  = !!item?.isBlocked;
      blockedEl.disabled = !!item?.isBlocked;
    }
  } else {
    const dueDateEl = /** @type {HTMLInputElement|null} */ ($("edit-due-date"));
    if (dueDateEl) {
      dueDateEl.value = item?.due_date
        ? new Date(item.due_date).toISOString().split("T")[0]
        : "";
    }
    const envOpts = ENVIRONMENTS.map((e) => ({
      value: e,
      label: e.charAt(0).toUpperCase() + e.slice(1),
      icon: ICONS[e] || ""
    }));
    const envEl = /** @type {HTMLInputElement|null} */ ($("edit-environment"));
    if (envEl) {
      envEl.value = item?.environment ?? "local";
      setupCustomDropdown("edit-environment", envOpts);
    }

    const linkEl = /** @type {HTMLInputElement|null} */ ($("edit-link-codebase"));
    if (linkEl) linkEl.value = item?.fileLinked ?? "";
  }

  const currentAssigneeIds = item?.assigneeIds?.length > 0
    ? item.assigneeIds
    : (item?.assigneeId ? [item.assigneeId] : []);
  buildAvatarAssigneeSelect(currentAssigneeIds);

  if (repoSearch) repoSearch.value = "";
  const activeProj   = state.projects.find((p) => (p.id || p._id) === state.projectId);
  const repoFullName = activeProj?.repoFullName || "";

  // ── Codebase link: gate on repo connection ─────────────────────
  const codebaseRow = /** @type {HTMLElement|null} */ ($("task-link-row"));
  const codebaseInput = /** @type {HTMLInputElement|null} */ ($("edit-link-codebase"));
  if (codebaseRow && codebaseInput) {
    if (!repoFullName) {
      // No repo linked to this project — lock the picker
      codebaseRow.setAttribute("data-no-repo", "true");
      codebaseInput.setAttribute("placeholder", "Connect a repo first");
      codebaseInput.setAttribute("title", "No repository is connected to this project. Connect one via the Wekraft dashboard.");
      codebaseInput.classList.add("no-repo");
      codebaseInput.value = ""; // always clear stale path from previous project
      // Clear the stale tree from the previous project immediately — without
      // this the old file tree stays visible until the user refreshes.
      rawWorkspaceFiles = [];
      renderRepoTree([], repoTree);
    } else {
      // Repo is linked — unlock the picker
      codebaseRow.removeAttribute("data-no-repo");
      codebaseInput.setAttribute("placeholder", "Click to pick a file\u2026");
      codebaseInput.removeAttribute("title");
      codebaseInput.classList.remove("no-repo");
      // Only request the tree when a repo is actually connected
      post({ type: "FETCH_REPO_STRUCTURE", payload: { repoFullName } });
    }
  }

  editPanel.classList.remove("hidden");
  editTitle.focus();

  // Move inline below the clicked card
  if (id) {
    const cardEl = document.querySelector(`.item-card[data-id="${id}"]`);
    if (cardEl) {
      cardEl.insertAdjacentElement("afterend", editPanel);
      editPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } else {
    if (itemList) {
      itemList.prepend(editPanel);
      editPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

function closeEditPanel() {
  state.editing = null;
  if (editPanel)   editPanel.classList.add("hidden");
  if (editTitle)   editTitle.disabled   = false;
  if (btnSaveEdit) btnSaveEdit.disabled = false;
}

/**
 * Select a tag colour by named token or legacy hex.
 * @param {string} colorNameOrHex
 */
function selectTagColor(colorNameOrHex) {
  const hiddenInput = /** @type {HTMLInputElement|null} */ ($("edit-type-color"));
  if (!hiddenInput) return;
  hiddenInput.value = colorNameOrHex;

  document.querySelectorAll(".tag-color-picker .color-dot").forEach((dot) => {
    if (dot.getAttribute("data-color") === colorNameOrHex) {
      dot.classList.add("active");
      dot.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="color:white;"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else {
      dot.classList.remove("active");
      dot.innerHTML = "";
    }
  });
}

function saveEdit() {
  if (!state.editing || !editTitle || !editStatus || !editPriority) return;
  const { type, id } = state.editing;

  if (!editTitle.value.trim()) {
    editTitle.focus();
    return;
  }

  const item = id
    ? (type === "task"
        ? state.tasks.find((t) => (t.id || t._id) === id)
        : state.issues.find((i) => (i.id || i._id) === id))
    : null;

  const descEl    = /** @type {HTMLTextAreaElement|null} */ ($("edit-description"));
  const assigneeEl = /** @type {HTMLInputElement|null} */ ($("edit-assignee"));

  /** @type {Record<string, any>} */
  const payload = {
    title:       editTitle.value.trim(),
    description: descEl?.value?.trim() || undefined,
    status:      editStatus.value || undefined,
  };

  let assigneeIds = /** @type {string[]} */ ([]);
  if (assigneeEl?.value) {
    try { assigneeIds = JSON.parse(assigneeEl.value); } catch (e) { assigneeIds = []; }
  }

  if (type === "task") {
    // Map no_priority sentinel → undefined (schema only allows high/medium/low)
    const rawPriority = editPriority.value;
    payload.priority    = (rawPriority && rawPriority !== "no_priority") ? rawPriority : undefined;
    payload.assigneeIds = assigneeIds;

    const startEl   = /** @type {HTMLInputElement|null} */ ($("edit-start-date"));
    const endEl     = /** @type {HTMLInputElement|null} */ ($("edit-end-date"));
    const typeLbl   = /** @type {HTMLInputElement|null} */ ($("edit-type-label"));
    const typeClr   = /** @type {HTMLInputElement|null} */ ($("edit-type-color"));
    const linkEl    = /** @type {HTMLInputElement|null} */ ($("edit-link-codebase"));
    const blockedEl = /** @type {HTMLInputElement|null} */ ($("edit-is-blocked"));

    if (startEl?.value && endEl?.value) {
      const todayStr = new Date().toISOString().split("T")[0];
      if (startEl.value < todayStr) {
        showNotificationError("Start Date cannot be in the past.");
        startEl.focus();
        return;
      }
      const startT = new Date(startEl.value).getTime();
      const endT   = new Date(endEl.value).getTime();
      if (startT >= endT) {
        showNotificationError("End Date must be after the Start Date.");
        endEl.focus();
        return;
      }
      payload.estimation = { startDate: startT, endDate: endT };
    }

    const tagLabel = typeLbl?.value?.trim();
    // Map null → undefined for CREATE (schema requires object or absent, not null)
    const typeVal = tagLabel ? { label: tagLabel, color: typeClr?.value || "blue" } : undefined;
    payload.type             = typeVal;
    // Map empty string/null → undefined for CREATE (schema: optional string, not null)
    payload.linkWithCodebase = linkEl?.value?.trim() || undefined;
    payload.isBlocked        = blockedEl ? blockedEl.checked : (item?.isBlocked ?? false);
  } else {
    const dueDateEl = /** @type {HTMLInputElement|null} */ ($("edit-due-date"));
    payload.due_date = dueDateEl?.value ? new Date(dueDateEl.value).getTime() : undefined;

    const envEl = /** @type {HTMLInputElement|null} */ ($("edit-environment"));
    if (envEl?.value) payload.environment = envEl.value;

    payload.severity = editPriority.value;

    const linkEl = /** @type {HTMLInputElement|null} */ ($("edit-link-codebase"));
    payload.fileLinked = linkEl?.value?.trim() || null;

    payload.assignees = assigneeIds.map((uid) => {
      const member = state.teamMembers.find((m) => m.userId === uid);
      return {
        userId: uid,
        name:   member?.user?.name || "Unknown",
        avatar: member?.user?.avatarUrl || undefined,
      };
    });
  }

  if (!id) {
    payload.projectId = state.projectId;
    if (type === "task") {
      if (state.sprintId) payload.sprintId = state.sprintId;
      if (!payload.estimation) {
        const now = Date.now();
        payload.estimation = { startDate: now, endDate: now + 86400000 * 7 };
      }
      const blockedEl = /** @type {HTMLInputElement|null} */ ($("edit-is-blocked"));
      state.pendingMarkAsIssue = blockedEl ? blockedEl.checked : false;
      post({ type: "CREATE_TASK", payload });
    } else {
      payload.type = "manual";
      post({ type: "CREATE_ISSUE", payload });
    }
    editTitle.disabled   = true;
    btnSaveEdit.disabled = true;
  } else {
    if (type === "task") {
      const wasBlocked = item?.isBlocked ?? false;
      const nowBlocked = payload.isBlocked ?? false;
      post({ type: "UPDATE_TASK", payload: { taskId: id, ...payload } });
      if (nowBlocked && !wasBlocked) {
        post({ type: "MARK_TASK_AS_ISSUE", payload: { taskId: id } });
      }
    } else {
      post({ type: "UPDATE_ISSUE", payload: { issueId: id, ...payload } });
    }
  }
}

// ── Assignee dropdown — built fresh per edit open ─────────────
// NOTE: The click-outside handler is registered ONCE globally below
// to avoid accumulating listeners on every open.

let _assigneeDropdownEl   = /** @type {HTMLElement|null} */ (null);
let _assigneeDisplayBtnEl = /** @type {HTMLElement|null} */ (null);

document.addEventListener("click", (e) => {
  if (_assigneeDropdownEl && _assigneeDisplayBtnEl) {
    if (
      !_assigneeDropdownEl.contains(/** @type {Node} */ (e.target)) &&
      !_assigneeDisplayBtnEl.contains(/** @type {Node} */ (e.target))
    ) {
      _assigneeDropdownEl.classList.add("hidden");
    }
  }
});

/** @param {string[]} selectedIds */
function buildAvatarAssigneeSelect(selectedIds = []) {
  const hiddenInput   = /** @type {HTMLInputElement|null} */ ($("edit-assignee"));
  const namePreview   = $("assignee-name-preview");
  const avatarPreview = $("assignee-avatar-preview");
  const dropdown      = $("assignee-dropdown");
  const displayBtn    = $("assignee-selected");
  if (!hiddenInput || !dropdown || !displayBtn || !namePreview || !avatarPreview) return;

  _assigneeDropdownEl   = dropdown;
  _assigneeDisplayBtnEl = displayBtn;

  let currentSelected = Array.isArray(selectedIds) ? [...selectedIds] : [];

  const allOptions = state.teamMembers.map((m) => ({
    userId:    m.userId || "",
    name:      m.user?.name || m.userId || "?",
    avatarUrl: m.user?.avatarUrl || null,
  }));

  const renderAvatar = (/** @type {string|null} */ av, /** @type {string} */ nm, size = 20) => av
    ? `<img src="${safeImgSrc(av)}" class="mini-avatar-img" style="width:${size}px;height:${size}px;border-radius:25%;flex-shrink:0;" />`
    : `<span class="mini-avatar" style="width:${size}px;height:${size}px;font-size:${Math.floor(size * 0.45)}px;border-radius:25%;flex-shrink:0;">${esc((nm || "?")[0].toUpperCase())}</span>`;

  const renderPreviews = () => {
    hiddenInput.value = JSON.stringify(currentSelected);
    if (currentSelected.length === 0) {
      avatarPreview.innerHTML = `<span style="width:20px;height:20px;border-radius:25%;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:11px;color:#71717a;flex-shrink:0;">?</span>`;
      namePreview.textContent = "Unassigned";
    } else if (currentSelected.length === 1) {
      const m = allOptions.find((o) => o.userId === currentSelected[0]);
      avatarPreview.innerHTML = m ? renderAvatar(m.avatarUrl, m.name) : `<span style="opacity:0.4;font-size:11px;">?</span>`;
      namePreview.textContent = m ? m.name : "Unknown User";
    } else {
      // Stacked avatars with proper overlap
      const stackHtml = currentSelected.slice(0, 3).map((uid, idx) => {
        const m = allOptions.find((o) => o.userId === uid);
        return m ? `<div style="margin-left:${idx > 0 ? "-6px" : "0"};z-index:${10 - idx};position:relative;">${renderAvatar(m.avatarUrl, m.name)}</div>` : "";
      }).join("");
      const extra = currentSelected.length > 3 ? `<span style="font-size:10px;margin-left:4px;color:#a3a3a3;">+${currentSelected.length - 3}</span>` : "";
      avatarPreview.innerHTML = `<div style="display:flex;align-items:center;">${stackHtml}</div>${extra}`;
      namePreview.textContent = `${currentSelected.length} Assignees`;
    }
  };

  const rebuildDropdown = () => {
    dropdown.innerHTML = allOptions.length === 0
      ? `<div style="padding:8px;font-size:11px;opacity:0.6;">No team members found.</div>`
      : allOptions.map((o) => {
          const isSelected = currentSelected.includes(o.userId);
          return `<div class="assignee-option" data-userid="${esc(o.userId)}" style="display:flex;align-items:center;justify-content:space-between;width:100%;">
            <div style="display:flex;align-items:center;gap:6px;">
              ${renderAvatar(o.avatarUrl, o.name)}
              <span>${esc(o.name)}</span>
            </div>
            ${isSelected ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ""}
          </div>`;
        }).join("");

    dropdown.querySelectorAll(".assignee-option").forEach((opt) => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        const uid = opt.getAttribute("data-userid") || "";
        if (currentSelected.includes(uid)) {
          currentSelected = currentSelected.filter((x) => x !== uid);
        } else {
          currentSelected.push(uid);
        }
        renderPreviews();
        rebuildDropdown();
      });
    });
  };

  renderPreviews();
  rebuildDropdown();
  dropdown.classList.add("hidden");

  // Replace onclick to avoid stacking handlers
  displayBtn.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  };
}

// ── Confirm delete ────────────────────────────────────────────

function confirmDelete(type, id) {
  const name = type === "task"
    ? (state.tasks.find((t) => (t.id || t._id) === id)?.title ?? "this task")
    : (state.issues.find((i) => (i.id || i._id) === id)?.title ?? "this issue");

  post({ type: "CONFIRM_DELETE", payload: { type, id, name } });
}

// ── Status tab bar ────────────────────────────────────────────

function updateNewButtonLabel() {
  if (!btnNewItem || !btnNewItemLabel) return;
  if (state.activeView === "tickets") {
    // Tickets are created on the web app only — hide the button
    btnNewItem.style.display = "none";
    return;
  }
  btnNewItem.style.display = "";
  const label = state.activeView === "issues" ? "New Issue" : "New Task";
  btnNewItemLabel.textContent = label;
  btnNewItem.title = label;
}

function renderStatusTabs() {
  const container = $("status-tabs");
  if (!container) return;

  updateNewButtonLabel();

  // Tickets tab has no status filter bar
  if (state.activeView === "tickets") {
    container.innerHTML = "";
    return;
  }

  const statuses = state.activeView === "tasks"
    ? [
        { val: "all",         label: "All" },
        { val: "not started", label: "Not Started" },
        { val: "inprogress",  label: "In Progress" },
        { val: "reviewing",   label: "Reviewing" },
        { val: "testing",     label: "Testing" },
        { val: "completed",   label: "Completed" },
      ]
    : [
        { val: "all",        label: "All" },
        { val: "not opened", label: "Not Opened" },
        { val: "opened",     label: "Opened" },
        { val: "reopened",   label: "Reopened" },
        { val: "closed",     label: "Closed" },
      ];

  if (!statuses.find((s) => s.val === state.activeStatus)) {
    state.activeStatus = "all";
  }

  container.innerHTML = statuses.map((s) =>
    `<button class="tab${state.activeStatus === s.val ? " active" : ""}" data-status="${s.val}">${s.label}</button>`
  ).join("");

  container.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeStatus = tab.getAttribute("data-status") || "all";
      renderItems();
    });
  });
}

mainTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    mainTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.activeView   = /** @type {"tasks"|"issues"|"tickets"} */ (tab.getAttribute("data-view") || "tasks");
    state.activeStatus = "all";
    renderStatusTabs();
    closeEditPanel();
    // On first visit to tickets tab, lazily fetch data
    if (state.activeView === "tickets" && state.tickets.length === 0 && state.projectId) {
      post({ type: "FETCH_TICKETS", payload: { projectId: state.projectId, epoch: state.fetchEpoch } });
    }
    renderItems();
  });
});

// ── Screen switching ──────────────────────────────────────────

function showScreen(/** @type {"login"|"loading"|"main"} */ name) {
  if (screenLogin)   screenLogin.classList.add("hidden");
  if (screenLoading) screenLoading.classList.add("hidden");
  if (screenMain)    screenMain.classList.add("hidden");
  const target = { login: screenLogin, loading: screenLoading, main: screenMain }[name];
  target?.classList.remove("hidden");
}

function showError(/** @type {string} */ msg) {
  console.error("[Wekraft]", msg);
  showScreen("main");
  if (itemList) {
    itemList.innerHTML = `
      <div class="empty-state" style="color:var(--vscode-errorForeground)">
        ⚠ ${esc(msg)}
      </div>`;
  }
}

// ── Utilities ─────────────────────────────────────────────────

function post(/** @type {any} */ msg) { vscode.postMessage(msg); }

/**
 * Escapes characters for HTML context only. Do NOT use for attribute values
 * without quotes, styles, or URL attributes (e.g. href, src).
 * @param {any} str
 * @returns {string}
 */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g,  "&amp;").replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;").replace(/"/g,  "&quot;");
}

/**
 * Ensures the image URL uses a safe protocol (http or https) and escapes it.
 * Prevents javascript: or data: URL injection inside image tags.
 * @param {string|null|undefined} url
 * @returns {string}
 */
function safeImgSrc(url) {
  const clean = (url || "").trim();
  if (/^https?:\/\//i.test(clean)) {
    return esc(clean);
  }
  return ""; // safe empty string fallback
}

function showNotificationError(msg) {
  post({ type: "SHOW_ERROR", payload: { message: msg } });
}

// ── Wire up static buttons ────────────────────────────────────

btnLogin?.addEventListener("click",   () => post({ type: "LOGIN_REQUEST" }));

// ── Theme Management ──────────────────────────────────────────

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    if (iconSun) iconSun.style.display = "none";
    if (iconMoon) iconMoon.style.display = "block";
  } else {
    document.documentElement.removeAttribute("data-theme");
    if (iconSun) iconSun.style.display = "block";
    if (iconMoon) iconMoon.style.display = "none";
  }
}

// Load saved theme on startup
const savedState = vscode.getState() || {};
const initialTheme = savedState.theme || "dark";
applyTheme(initialTheme);

btnThemeToggle?.addEventListener("click", () => {
  const currentState = vscode.getState() || {};
  const newTheme = document.documentElement.hasAttribute("data-theme") ? "dark" : "light";
  applyTheme(newTheme);
  vscode.setState({ ...currentState, theme: newTheme });
});

btnLogout?.addEventListener("click",  () => post({ type: "LOGOUT_REQUEST" }));
btnSaveEdit?.addEventListener("click",  saveEdit);
btnCloseEdit?.addEventListener("click", closeEditPanel);
$("btn-close-edit-bottom")?.addEventListener("click", closeEditPanel);

const btnClearCodebase = $("btn-clear-codebase");
const editLinkCodebase = /** @type {HTMLInputElement|null} */ ($("edit-link-codebase"));
if (btnClearCodebase && editLinkCodebase) {
  btnClearCodebase.addEventListener("click", () => {
    editLinkCodebase.value = "";
    repoTree?.querySelectorAll(".tree-node.active-file").forEach((n) => n.classList.remove("active-file"));
  });
}

const repoStructureContainer = $("repo-structure-container");
if (editLinkCodebase && repoStructureContainer) {
  editLinkCodebase.addEventListener("click", (e) => {
    e.stopPropagation();
    // Guard: if no repo is connected, do nothing — the CSS already signals the locked state
    const codebaseRow = /** @type {HTMLElement|null} */ ($("task-link-row"));
    if (codebaseRow?.getAttribute("data-no-repo") === "true") {
      // Ensure the dropdown stays closed
      repoStructureContainer.classList.add("hidden");
      return;
    }
    repoStructureContainer.classList.toggle("hidden");
  });
  repoStructureContainer.addEventListener("click", (e) => e.stopPropagation());
}

if (repoSearch && repoTree) {
  repoSearch.addEventListener("input", () => {
    renderRepoTree(rawWorkspaceFiles, repoTree, repoSearch.value);
  });
}

document.addEventListener("click", (e) => {
  if (repoStructureContainer && !/** @type {Element} */ (e.target).closest?.("#task-link-row")) {
    repoStructureContainer.classList.add("hidden");
  }
});

btnNewItem?.addEventListener("click", () => {
  openEditPanel(state.activeView === "issues" ? "issue" : "task", null);
});

if (editTitle) {
  editTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  saveEdit();
    if (e.key === "Escape") closeEditPanel();
  });
}

// Date cross-validation
const startDateEl = /** @type {HTMLInputElement|null} */ ($("edit-start-date"));
const endDateEl   = /** @type {HTMLInputElement|null} */ ($("edit-end-date"));
if (startDateEl && endDateEl) {
  startDateEl.addEventListener("change", () => {
    if (!startDateEl.value) return;
    const nextDay = new Date(startDateEl.value);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split("T")[0];
    endDateEl.min = nextDayStr;
    if (endDateEl.value && endDateEl.value <= startDateEl.value) {
      endDateEl.value = nextDayStr;
    }
  });
}

// Tag color picker dots (static in HTML, wired once at boot)
document.querySelectorAll(".tag-color-picker .color-dot").forEach((dot) => {
  dot.addEventListener("click", () => {
    const color = dot.getAttribute("data-color");
    if (color) selectTagColor(color);
  });
});

// ── Repo tree ─────────────────────────────────────────────────

function renderRepoTree(nodes, container, searchQuery = "") {
  if (!container) return;
  container.innerHTML = "";
  if (!nodes || nodes.length === 0) {
    container.innerHTML = `<div class="empty-state" style="font-size:11px;">No files found in repository.</div>`;
    return;
  }

  const query  = searchQuery.toLowerCase().trim();
  const linkEl = /** @type {HTMLInputElement|null} */ ($("edit-link-codebase"));

  function checkHasMatchingChild(/** @type {any} */ dirNode, /** @type {string} */ q) {
    if (!dirNode) return false;
    const name = (dirNode.name || "").toLowerCase();
    const path = (dirNode.path || "").toLowerCase();
    if (name.includes(q) || path.includes(q)) return true;
    return Array.isArray(dirNode.children) && dirNode.children.some((c) => checkHasMatchingChild(c, q));
  }

  function buildNodeHtml(/** @type {any} */ node, depth = 0) {
    if (!node) return null;
    const isDir = node.type === "directory";

    if (query) {
      if (isDir && !checkHasMatchingChild(node, query)) return null;
      if (!isDir && !((node.name || "").toLowerCase().includes(query) || (node.path || "").toLowerCase().includes(query))) return null;
    }

    const iconHtml = isDir
      ? `<svg class="folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`
      : `<svg class="file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

    const isActive = linkEl && linkEl.value === node.path;

    const itemEl = document.createElement("div");
    itemEl.className    = `tree-node${isActive ? " active-file" : ""}`;
    itemEl.dataset.path = node.path || "";
    itemEl.dataset.type = node.type || "";
    itemEl.innerHTML    = `<span class="tree-node-icon">${iconHtml}</span><span class="tree-node-label" title="${esc(node.name)}">${esc(node.name)}</span>`;

    const wrapper = document.createElement("div");
    wrapper.appendChild(itemEl);

    if (isDir && Array.isArray(node.children) && node.children.length > 0) {
      const childContainer        = document.createElement("div");
      childContainer.className    = "tree-children";
      if (!query) childContainer.classList.add("collapsed");

      node.children.forEach((child) => {
        const childEl = buildNodeHtml(child, depth + 1);
        if (childEl) childContainer.appendChild(childEl);
      });

      wrapper.appendChild(childContainer);
      itemEl.addEventListener("click", (e) => {
        e.stopPropagation();
        childContainer.classList.toggle("collapsed");
      });
    } else if (!isDir) {
      itemEl.addEventListener("click", (e) => {
        e.stopPropagation();
        container.querySelectorAll(".tree-node.active-file").forEach((n) => n.classList.remove("active-file"));
        itemEl.classList.add("active-file");
        if (linkEl) linkEl.value = node.path || "";
        const dropdown = $("repo-structure-container");
        if (dropdown) dropdown.classList.add("hidden");
      });
    }

    return wrapper;
  }

  nodes.forEach((node) => {
    const el = buildNodeHtml(node);
    if (el) container.appendChild(el);
  });
}

// ── Boot ──────────────────────────────────────────────────────

renderStatusTabs();
post({ type: "READY" });
