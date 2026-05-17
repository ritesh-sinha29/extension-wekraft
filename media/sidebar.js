// ─────────────────────────────────────────────────────────────
//  Wekraft Sidebar — Webview Script
//  Runs in the sandboxed webview browser context.
//  No create allowed — only update and delete.
// ─────────────────────────────────────────────────────────────
// @ts-check

const vscode = acquireVsCodeApi();

// ── App state ─────────────────────────────────────────────────

const state = {
  /** @type {{ isAuthenticated: boolean, user: any|null }} */
  auth: { isAuthenticated: false, user: null },
  /** @type {"tasks"|"issues"} */
  activeView: "tasks",
  /** @type {string} */
  activeStatus: "all",
  /** @type {any[]} */
  tasks: [],
  /** @type {any[]} */
  issues: [],
  /** @type {any[]} */
  teamMembers: [],
  /** @type {string} */
  projectId: "",
  /** @type {string} */
  sprintId: "",
  /** @type {{ type: "task"|"issue", id: string }|null} */
  editing: null,
};

// ── DOM references ────────────────────────────────────────────

const $ = (/** @type {string} */ id) => document.getElementById(id);

const screenLogin = $("screen-login");
const screenLoading = $("screen-loading");
const screenMain = $("screen-main");

const btnLogin = $("btn-login");
const btnLogout = $("btn-logout");
const userAvatar = $("user-avatar");
const userName = $("user-name");
const userRole = $("user-role");

const selectProject = /** @type {HTMLSelectElement} */ ($("select-project"));
const selectSprint = /** @type {HTMLSelectElement} */ ($("select-sprint"));

const teamSection = $("team-section");
const teamAvatars = $("team-avatars");

const mainTabs = document.querySelectorAll(".main-tab");
const statusTabs = document.querySelectorAll(".tab");
const statusTabsEl = $("status-tabs");
const btnNewItem = $("btn-new-item");

const itemList = $("item-list");

const editPanel = $("edit-panel");
const editPanelTitle = $("edit-panel-title");
const editTitle = /** @type {HTMLInputElement} */ ($("edit-title"));
const editStatus = /** @type {HTMLSelectElement} */ ($("edit-status"));
const editPriority = /** @type {HTMLSelectElement} */ ($("edit-priority"));
const editAssignee = /** @type {HTMLSelectElement} */ ($("edit-assignee"));
const btnSaveEdit = $("btn-save-edit");
const btnCloseEdit = $("btn-close-edit");

// ── Extension → Webview messages ─────────────────────────────

window.addEventListener("message", ({ data: msg }) => {
  switch (msg.type) {
    case "AUTH_STATE": onAuthState(msg.payload); break;
    case "PROJECTS_LOADED": onProjectsLoaded(msg.payload); break;
    case "SPRINTS_LOADED": onSprintsLoaded(msg.payload); break;
    case "TASKS_LOADED": onTasksLoaded(msg.payload); break;
    case "ISSUES_LOADED": onIssuesLoaded(msg.payload); break;
    case "TEAM_MEMBERS_LOADED": onTeamLoaded(msg.payload); break;
    case "TASK_CREATED": onTaskCreated(msg.payload); break;
    case "TASK_UPDATED": onTaskUpdated(msg.payload); break;
    case "TASK_DELETED": onTaskDeleted(msg.payload.taskId); break;
    case "ISSUE_UPDATED": onIssueUpdated(msg.payload); break;
    case "ISSUE_DELETED": onIssueDeleted(msg.payload.issueId); break;
    case "LOADING": if (msg.payload.isLoading) showScreen("loading"); break;
    case "ERROR": showError(msg.payload.message); break;
    case "REFRESH": loadAll(); break;
  }
});

function onAuthState(auth) {
  state.auth = auth;
  if (!auth.isAuthenticated) {
    showScreen("login");
    return;
  }
  const u = auth.user;
  if (u) {
    userName.textContent = u.name || "Member";
    userRole.textContent = u.role === "admin" ? "Admin" : "Member";
    if (u.avatarUrl) {
      userAvatar.innerHTML = `<img src="${esc(u.avatarUrl)}" alt="Avatar" class="mini-avatar-img" style="width:32px; height:32px; border-radius:50%;" />`;
    } else {
      userAvatar.innerHTML = `<span style="font-size:16px;">${esc((u.name || "?")[0].toUpperCase())}</span>`;
    }
  }
  showScreen("loading");
  post({ type: "FETCH_PROJECTS" });
}

// ── Project / Sprint ──────────────────────────────────────────

function onProjectsLoaded(projects) {
  selectProject.innerHTML = "";
  if (!projects.length) {
    selectProject.innerHTML = '<option value="">No projects</option>';
    showScreen("main");
    return;
  }
  projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    selectProject.appendChild(opt);
  });
  state.projectId = projects[0].id;
  loadAll();
}

function onSprintsLoaded(sprints) {
  selectSprint.innerHTML = '<option value="">All tasks</option>';
  sprints.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    const icon = s.status === "active" ? "🟢 " : s.status === "planning" ? "🔵 " : "✓ ";
    opt.textContent = icon + s.name;
    selectSprint.appendChild(opt);
  });
}

function loadAll() {
  if (!state.projectId) { return; }
  showScreen("loading");
  post({ type: "FETCH_SPRINTS", payload: { projectId: state.projectId } });
  post({ type: "FETCH_TASKS", payload: { projectId: state.projectId, sprintId: state.sprintId || undefined } });
  post({ type: "FETCH_ISSUES", payload: { projectId: state.projectId } });
  post({ type: "FETCH_TEAM_MEMBERS", payload: { projectId: state.projectId } });
}

selectProject.addEventListener("change", () => {
  state.projectId = selectProject.value;
  state.sprintId = "";
  selectSprint.value = "";
  closeEditPanel();
  loadAll();
});

selectSprint.addEventListener("change", () => {
  state.sprintId = selectSprint.value;
  post({ type: "FETCH_TASKS", payload: { projectId: state.projectId, sprintId: state.sprintId || undefined } });
});

// ── Data handlers ─────────────────────────────────────────────

function onTasksLoaded(tasks) {
  state.tasks = tasks;
  if (state.activeView === "tasks") { renderItems(); showScreen("main"); }
}

function onIssuesLoaded(issues) {
  state.issues = issues;
  if (state.activeView === "issues") { renderItems(); showScreen("main"); }
  // Show main after both are done if tasks already loaded
  if (state.tasks.length >= 0) { showScreen("main"); }
}

function onTeamLoaded(members) {
  state.teamMembers = members;
  buildAssigneeSelect();

  if (members.length > 0) {
    teamSection.classList.remove("hidden");
    teamAvatars.innerHTML = members.map((m) => {
      const initial = (m.user?.name || "?")[0].toUpperCase();
      const roleBadge = m.role === "admin" || m.role === "owner" ? "👑 " : "";
      const avatarHtml = m.user?.avatarUrl
        ? `<img src="${esc(m.user.avatarUrl)}" class="mini-avatar-img" />`
        : `<span class="mini-avatar">${esc(initial)}</span>`;

      return `<div class="team-avatar-item" title="${esc(m.user?.name)} (${m.role})">
                ${avatarHtml}
                <span>${roleBadge}${esc(m.user?.name)}</span>
              </div>`;
    }).join("");
  } else {
    teamSection.classList.add("hidden");
  }
}

function onTaskCreated(task) {
  state.tasks = [task, ...state.tasks];
  if (state.activeView === "tasks") {
    renderItems();
  }
  closeEditPanel();
}

function onTaskUpdated(task) {
  state.tasks = state.tasks.map((t) => (t.id === task.id ? task : t));
  renderItems();
  closeEditPanel();
}

function onTaskDeleted(taskId) {
  state.tasks = state.tasks.filter((t) => t.id !== taskId);
  renderItems();
}

function onIssueUpdated(issue) {
  state.issues = state.issues.map((i) => (i.id === issue.id ? issue : i));
  renderItems();
  closeEditPanel();
}

function onIssueDeleted(issueId) {
  state.issues = state.issues.filter((i) => i.id !== issueId);
  renderItems();
}

// ── Render ────────────────────────────────────────────────────

function renderItems() {
  const items = state.activeView === "tasks" ? state.tasks : state.issues;
  const filtered = state.activeStatus === "all"
    ? items
    : items.filter((i) => i.status === state.activeStatus);

  if (!filtered.length) {
    itemList.innerHTML = `<div class="empty-state">No ${state.activeView} found.</div>`;
    return;
  }

  itemList.innerHTML = filtered.map((item) => itemCardHtml(item)).join("");

  itemList.querySelectorAll(".item-card").forEach((card) => {
    const id = card.getAttribute("data-id");
    const type = /** @type {"task"|"issue"} */ (card.getAttribute("data-type"));

    card.querySelector(".btn-edit")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditPanel(type, id);
    });

    card.querySelector(".btn-delete")?.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmDelete(type, id);
    });
  });
}

function itemCardHtml(item) {
  const isIssue = state.activeView === "issues";

  const priorityColors = {
    urgent: "var(--priority-urgent)",
    critical: "var(--priority-urgent)",
    high: "var(--priority-high)",
    medium: "var(--priority-medium)",
    low: "var(--priority-low)",
    no_priority: "var(--priority-none)",
  };
  const dotColor = priorityColors[item.priority] ?? "var(--priority-none)";

  const statusLabel = (item.status || "").replace(/_/g, " ");
  const statusCls = `badge-${item.status}`;

  const assigneeName = item.assignee?.name ?? "";
  const assigneeInitial = assigneeName ? assigneeName[0].toUpperCase() : "";

  return /* html */ `
    <div class="item-card" data-id="${item.id}" data-type="${isIssue ? "issue" : "task"}">
      <div class="item-dot" style="background:${dotColor}"></div>
      <div class="item-body">
        <div class="item-title" title="${esc(item.title)}">
          ${item.isBlocked ? '⚠️ ' : ''}${esc(item.title)}
          ${item.type && item.type.label ? `<span style="font-size: 9px; padding: 2px 4px; border-radius: 4px; margin-left: 6px; background-color: ${esc(item.type.color)}33; color: ${esc(item.type.color)}; border: 1px solid ${esc(item.type.color)}55;">${esc(item.type.label)}</span>` : ''}
          ${item.linkWithCodebase ? `<span title="Linked to: ${esc(item.linkWithCodebase)}" style="font-size: 10px; margin-left: 6px; opacity: 0.6;">🔗</span>` : ''}
        </div>
        <div class="item-meta">
          <span class="task-badge ${statusCls}">${statusLabel}</span>
          ${assigneeName
      ? `<span class="item-assignee">
                ${item.assignee?.avatarUrl ? `<img src="${esc(item.assignee.avatarUrl)}" class="mini-avatar-img" style="width:14px;height:14px;border-radius:50%;"/>` : `<span class="mini-avatar">${esc(assigneeInitial)}</span>`}${esc(assigneeName)}
               </span>`
      : ""}
          ${!isIssue && item.estimation?.endDate
      ? `<span class="item-assignee" style="margin-left:auto; opacity:0.8;">⏱ ${new Date(item.estimation.endDate).toLocaleDateString()}</span>`
      : ""}
        </div>
      </div>
      <div class="item-actions">
        <button class="btn-icon btn-edit" title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon btn-delete" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2">
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

const TASK_STATUSES = ["not started", "inprogress", "reviewing", "testing", "completed"];
const ISSUE_STATUSES = ["not opened", "opened", "reopened", "closed"];
const TASK_PRIORITIES = ["high", "medium", "low"];
const ISSUE_PRIORITIES = ["critical", "medium", "low"];

function openEditPanel(type, id) {
  let item = null;
  if (id) {
    item = type === "task"
      ? state.tasks.find((t) => t.id === id)
      : state.issues.find((i) => i.id === id);
    if (!item) return;
  }

  state.editing = { type, id };
  editPanelTitle.textContent = !id
    ? (type === "task" ? "New Task" : "New Issue")
    : (type === "task" ? "Edit Task" : "Edit Issue");

  // Populate status select
  const statuses = type === "task" ? TASK_STATUSES : ISSUE_STATUSES;
  editStatus.innerHTML = statuses.map((s) =>
    `<option value="${s}" ${item?.status === s ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`
  ).join("");

  // Populate priority select
  const priorities = type === "task" ? TASK_PRIORITIES : ISSUE_PRIORITIES;
  editPriority.innerHTML = priorities.map((p) =>
    `<option value="${p}" ${item?.priority === p ? "selected" : ""}>${p.replace(/_/g, " ")}</option>`
  ).join("");

  // Title & description
  editTitle.value = item?.title ?? "";
  const descEl = $("edit-description");
  if (descEl) descEl.value = item?.description ?? "";

  // Task-specific fields
  const isTask = type === "task";
  const taskDates    = $("task-dates");
  const taskTypeRow  = $("task-type-row");
  const taskLinkRow  = $("task-link-row");
  const taskBlocked  = $("task-blocked-row");
  if (taskDates)   taskDates.style.display   = isTask ? "" : "none";
  if (taskTypeRow) taskTypeRow.style.display = isTask ? "" : "none";
  if (taskLinkRow) taskLinkRow.style.display = isTask ? "" : "none";
  if (taskBlocked) taskBlocked.style.display = isTask ? "" : "none";

  if (isTask) {
    // Estimation dates
    const startEl = $("edit-start-date");
    const endEl   = $("edit-end-date");
    if (startEl) startEl.value = item?.estimation?.startDate
      ? new Date(item.estimation.startDate).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];
    if (endEl) endEl.value = item?.estimation?.endDate
      ? new Date(item.estimation.endDate).toISOString().split("T")[0]
      : new Date(Date.now() + 86400000 * 7).toISOString().split("T")[0]; // default +7 days

    // Type tag
    const typeLbl = $("edit-type-label");
    const typeClr = $("edit-type-color");
    if (typeLbl) typeLbl.value = item?.type?.label ?? "";
    if (typeClr) typeClr.value = item?.type?.color ?? "#6366f1";

    // Link with codebase
    const linkEl = $("edit-link-codebase");
    if (linkEl) linkEl.value = item?.linkWithCodebase ?? "";

    // isBlocked
    const blockedEl = $("edit-is-blocked");
    if (blockedEl) blockedEl.checked = item?.isBlocked ?? false;
  }

  buildAvatarAssigneeSelect(item?.assigneeId);

  editPanel.classList.remove("hidden");
  editTitle.focus();
}

function closeEditPanel() {
  state.editing = null;
  editPanel.classList.add("hidden");
  editTitle.disabled = false;
  btnSaveEdit.disabled = false;
}

function saveEdit() {
  if (!state.editing) { return; }
  const { type, id } = state.editing;

  if (!editTitle.value.trim()) {
    editTitle.focus();
    return;
  }

  const descEl    = $("edit-description");
  const assigneeEl = $("edit-assignee");

  const payload = {
    title:      editTitle.value.trim(),
    description: descEl?.value?.trim() || undefined,
    status:     editStatus.value || undefined,
    priority:   editPriority.value || undefined,
    assigneeId: assigneeEl?.value || undefined,
  };

  if (type === "task") {
    // Collect task-specific rich fields
    const startEl   = $("edit-start-date");
    const endEl     = $("edit-end-date");
    const typeLbl   = $("edit-type-label");
    const typeClr   = $("edit-type-color");
    const linkEl    = $("edit-link-codebase");
    const blockedEl = $("edit-is-blocked");

    if (startEl?.value && endEl?.value) {
      payload.estimation = {
        startDate: new Date(startEl.value).getTime(),
        endDate:   new Date(endEl.value).getTime(),
      };
    }

    const tagLabel = typeLbl?.value?.trim();
    payload.type = tagLabel ? { label: tagLabel, color: typeClr?.value ?? "#6366f1" } : null;
    payload.linkWithCodebase = linkEl?.value?.trim() || null;
    payload.isBlocked = blockedEl?.checked ?? false;
  }

  if (!id) {
    // Create Mode (tasks only)
    payload.projectId = state.projectId;
    if (state.sprintId) { payload.sprintId = state.sprintId; }
    if (type === "task") {
      if (!payload.estimation) {
        const now = Date.now();
        payload.estimation = { startDate: now, endDate: now + 86400000 * 7 };
      }
      post({ type: "CREATE_TASK", payload });
      editTitle.disabled = true;
      btnSaveEdit.disabled = true;
    }
  } else {
    if (type === "task") {
      post({ type: "UPDATE_TASK", payload: { taskId: id, ...payload } });
    } else {
      post({ type: "UPDATE_ISSUE", payload: { issueId: id, ...payload } });
    }
  }
}

// ── Rich Avatar Assignee Dropdown ──────────────────────────────

function buildAvatarAssigneeSelect(selectedId = "") {
  const hiddenInput   = $("edit-assignee");
  const namePreview   = $("assignee-name-preview");
  const avatarPreview = $("assignee-avatar-preview");
  const dropdown      = $("assignee-dropdown");
  const displayBtn    = $("assignee-selected");
  if (!hiddenInput || !dropdown || !displayBtn) { return; }

  const myMember = state.teamMembers.find((m) => m.userId === state.auth.user?.id);
  const isAdmin  = myMember && (myMember.role === "admin" || myMember.role === "owner");

  const allOptions = [
    { userId: "", name: "Unassigned", avatarUrl: null },
    ...state.teamMembers.map((m) => ({
      userId:    m.userId,
      name:      m.user?.name ?? m.userId,
      avatarUrl: m.user?.avatarUrl ?? null,
    }))
  ];

  const renderAvatar = (av, nm) => av
    ? `<img src="${esc(av)}" class="mini-avatar-img" style="width:18px;height:18px;border-radius:50%;"/>`
    : `<span class="mini-avatar" style="width:18px;height:18px;font-size:9px;flex-shrink:0;">${esc((nm||"?")[0].toUpperCase())}</span>`;

  const setSelected = (userId) => {
    hiddenInput.value = userId;
    if (!userId) {
      avatarPreview.innerHTML = `<span style="opacity:0.4;font-size:11px;">?</span>`;
      namePreview.textContent = "Unassigned";
    } else {
      const m = allOptions.find(o => o.userId === userId);
      if (m) {
        avatarPreview.innerHTML = renderAvatar(m.avatarUrl, m.name);
        namePreview.textContent = m.name;
      }
    }
  };

  setSelected(selectedId ?? "");

  dropdown.innerHTML = allOptions.map((o) => {
    const canSelect = isAdmin || !o.userId || o.userId === state.auth.user?.id;
    return `<div class="assignee-option${canSelect ? "" : " disabled"}" data-userid="${o.userId}">
      ${renderAvatar(o.avatarUrl, o.name)}
      <span>${esc(o.name)}</span>
      ${!canSelect ? '<span style="margin-left:auto;font-size:9px;opacity:0.4;">admin only</span>' : ""}
    </div>`;
  }).join("");

  // Toggle dropdown
  displayBtn.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  };

  // Select option
  dropdown.querySelectorAll(".assignee-option:not(.disabled)").forEach((opt) => {
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      setSelected(opt.getAttribute("data-userid") ?? "");
      dropdown.classList.add("hidden");
    });
  });

  // Close on outside click
  const closeHandler = () => dropdown.classList.add("hidden");
  setTimeout(() => document.addEventListener("click", closeHandler, { once: true }), 0);
}


function confirmDelete(type, id) {
  const name = type === "task"
    ? (state.tasks.find((t) => t.id === id)?.title ?? "this task")
    : (state.issues.find((i) => i.id === id)?.title ?? "this issue");
  if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) { return; }
  if (type === "task") {
    post({ type: "DELETE_TASK", payload: { taskId: id } });
  } else {
    post({ type: "DELETE_ISSUE", payload: { issueId: id } });
  }
}



// ── Tab switching ─────────────────────────────────────────────

function renderStatusTabs() {
  const container = $("status-tabs");
  if (!container) return;

  const statuses = state.activeView === "tasks"
    ? [{val: "all", label: "All"}, {val: "not started", label: "Not Started"}, {val: "inprogress", label: "Inprogress"}, {val: "reviewing", label: "Reviewing"}, {val: "testing", label: "Testing"}, {val: "completed", label: "Completed"}]
    : [{val: "all", label: "All"}, {val: "not opened", label: "Not Opened"}, {val: "opened", label: "Opened"}, {val: "reopened", label: "Reopened"}, {val: "closed", label: "Closed"}];

  // If current activeStatus doesn't exist in new view, reset to "all"
  if (!statuses.find(s => s.val === state.activeStatus)) {
    state.activeStatus = "all";
  }

  container.innerHTML = statuses.map(s =>
    `<button class="tab ${state.activeStatus === s.val ? "active" : ""}" data-status="${s.val}">${s.label}</button>`
  ).join("");

  // Re-attach event listeners
  container.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeStatus = tab.getAttribute("data-status");
      renderItems();
    });
  });
}

mainTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    mainTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.activeView = tab.getAttribute("data-view");
    renderStatusTabs();
    closeEditPanel();
    renderItems();
  });
});

// Initialize status tabs on load
renderStatusTabs();

// ── Screen switching ──────────────────────────────────────────

function showScreen(name) {
  screenLogin.classList.add("hidden");
  screenLoading.classList.add("hidden");
  screenMain.classList.add("hidden");
  ({ login: screenLogin, loading: screenLoading, main: screenMain }[name])
    ?.classList.remove("hidden");
}

function showError(msg) {
  console.error("[Wekraft]", msg);
  if (screenMain.classList.contains("hidden")) { showScreen("main"); }
  itemList.innerHTML = `
    <div class="empty-state" style="color:var(--vscode-errorForeground)">
      ⚠ ${esc(msg)}
    </div>`;
}

// ── Utilities ─────────────────────────────────────────────────

function post(msg) { vscode.postMessage(msg); }

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Wire up buttons ───────────────────────────────────────────

btnLogin.addEventListener("click", () => post({ type: "LOGIN_REQUEST" }));
btnLogout.addEventListener("click", () => post({ type: "LOGOUT_REQUEST" }));
btnSaveEdit.addEventListener("click", saveEdit);
btnCloseEdit.addEventListener("click", closeEditPanel);

btnNewItem.addEventListener("click", () => {
  // Can only create tasks currently
  openEditPanel("task", null);
});

editTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { saveEdit(); }
  if (e.key === "Escape") { closeEditPanel(); }
});

// ── Boot ──────────────────────────────────────────────────────

post({ type: "READY" });
