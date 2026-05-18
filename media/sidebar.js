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
  projects: [],
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
const repoSearch = $("repo-search");
const repoTree = $("repo-tree");
let rawWorkspaceFiles = [];
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
    case "TASK_MARKED_AS_ISSUE":
      loadAll();
      closeEditPanel();
      break;
    case "TASK_DELETED": onTaskDeleted(msg.payload.taskId); break;
    case "ISSUE_UPDATED": onIssueUpdated(msg.payload); break;
    case "ISSUE_DELETED": onIssueDeleted(msg.payload.issueId); break;
    case "LOADING": if (msg.payload.isLoading) showScreen("loading"); break;
    case "WORKSPACE_FILES":
      rawWorkspaceFiles = msg.payload;
      renderRepoTree(rawWorkspaceFiles, repoTree);
      break;
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

    userRole.textContent = "MEMBER";
    userRole.className = "user-role plan-badge plan-member";

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
  state.projects = projects;
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
  updateUserRoleForSelectedProject();
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

function updateUserRoleForSelectedProject() {
  if (!state.projectId || !state.auth.user) return;
  const currentProj = state.projects.find((p) => p.id === state.projectId);
  if (currentProj) {
    if (currentProj.ownerId === state.auth.user.id) {
      userRole.textContent = "OWNER";
      userRole.className = "user-role plan-badge plan-owner";
    } else {
      const myMember = state.teamMembers.find((m) => m.user?.id === state.auth.user.id);
      const role = myMember ? myMember.role || "member" : "member";
      userRole.textContent = role.toUpperCase();
      userRole.className = `user-role plan-badge plan-${role}`;
    }
  }
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
  updateUserRoleForSelectedProject();
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
  updateUserRoleForSelectedProject();

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

  if (state.pendingMarkAsIssue) {
    state.pendingMarkAsIssue = false;
    post({ type: "MARK_TASK_AS_ISSUE", payload: { taskId: task.id } });
  }
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
          ${item.isBlocked ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; display: inline-block;"><rect width="8" height="14" x="8" y="5" rx="4"/><path d="M19 7a1 1 0 0 0-1-1h-2M18 11.66A8 8 0 0 0 16 10M20 18a4 4 0 0 0-4-3.5M5 7a1 1 0 0 1 1-1h2M6 11.66A8 8 0 0 1 8 10M4 18a4 4 0 0 1 4-3.5M9 5a3 3 0 0 1 6 0M12 19v3M20 15h2M2 15h2"/></svg>` : ''}${esc(item.title)}
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
  const taskDates = $("task-dates");
  const taskTypeRow = $("task-type-row");
  const taskLinkRow = $("task-link-row");
  const taskBlocked = $("task-blocked-row");
  if (taskDates) taskDates.style.display = isTask ? "" : "none";
  if (taskTypeRow) taskTypeRow.style.display = isTask ? "" : "none";
  if (taskLinkRow) taskLinkRow.style.display = isTask ? "" : "none";
  if (taskBlocked) taskBlocked.style.display = isTask ? "" : "none";

  if (isTask) {
    // Estimation dates
    const startEl = $("edit-start-date");
    const endEl = $("edit-end-date");
    const todayStr = new Date().toISOString().split("T")[0];

    if (startEl) {
      startEl.min = todayStr;
      startEl.readOnly = false;
      startEl.style.pointerEvents = "";
      startEl.style.opacity = "";
      startEl.style.cursor = "";

      let startVal = todayStr;
      if (item?.estimation?.startDate) {
        const itemStartStr = new Date(item.estimation.startDate).toISOString().split("T")[0];
        if (itemStartStr >= todayStr) {
          startVal = itemStartStr;
        }
      }
      startEl.value = startVal;
    }

    if (endEl) {
      const startVal = startEl ? startEl.value : todayStr;
      const nextDay = new Date(startVal);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split("T")[0];
      endEl.min = nextDayStr;

      let endVal = item?.estimation?.endDate
        ? new Date(item.estimation.endDate).toISOString().split("T")[0]
        : new Date(Date.now() + 86400000 * 7).toISOString().split("T")[0]; // default +7 days

      if (endVal <= startVal) {
        endVal = nextDayStr;
      }
      endEl.value = endVal;
    }

    // Type tag
    const typeLbl = $("edit-type-label");
    if (typeLbl) typeLbl.value = item?.type?.label ?? "";
    selectTagColor(item?.type?.color ?? "#2563eb");

    // Link with codebase
    const linkEl = $("edit-link-codebase");
    if (linkEl) linkEl.value = item?.linkWithCodebase ?? "";

    // Blocked toggle (Mark as Issue)
    const blockedEl = $("edit-is-blocked");
    if (blockedEl) {
      blockedEl.checked = !!item?.isBlocked;
      blockedEl.disabled = !!item?.isBlocked;
    }
  }

  buildAvatarAssigneeSelect(item?.assigneeId);

  // Clear repository search query and refresh structure highlights
  if (repoSearch) { repoSearch.value = ""; }
  
  const activeProj = state.projects.find((p) => p.id === state.projectId);
  const repoFullName = activeProj?.repoFullName || "";
  post({ type: "FETCH_REPO_STRUCTURE", payload: { repoFullName } });

  editPanel.classList.remove("hidden");
  editTitle.focus();
}

function closeEditPanel() {
  state.editing = null;
  editPanel.classList.add("hidden");
  editTitle.disabled = false;
  btnSaveEdit.disabled = false;
}

function selectTagColor(colorHex) {
  const hiddenInput = $("edit-type-color");
  if (!hiddenInput) return;
  hiddenInput.value = colorHex;

  const dots = document.querySelectorAll(".tag-color-picker .color-dot");
  dots.forEach((dot) => {
    const dotColor = dot.getAttribute("data-color");
    if (dotColor === colorHex) {
      dot.classList.add("active");
      dot.innerHTML = "✓";
    } else {
      dot.classList.remove("active");
      dot.innerHTML = "";
    }
  });
}

function saveEdit() {
  if (!state.editing) { return; }
  const { type, id } = state.editing;

  if (!editTitle.value.trim()) {
    editTitle.focus();
    return;
  }

  const descEl = $("edit-description");
  const assigneeEl = $("edit-assignee");

  const payload = {
    title: editTitle.value.trim(),
    description: descEl?.value?.trim() || undefined,
    status: editStatus.value || undefined,
    priority: editPriority.value || undefined,
    assigneeId: assigneeEl ? assigneeEl.value : undefined,
  };

  if (type === "task") {
    // Collect task-specific rich fields
    const startEl = $("edit-start-date");
    const endEl = $("edit-end-date");
    const typeLbl = $("edit-type-label");
    const typeClr = $("edit-type-color");
    const linkEl = $("edit-link-codebase");
    const blockedEl = $("edit-is-blocked");

    if (startEl?.value && endEl?.value) {
      const todayStr = new Date().toISOString().split("T")[0];
      if (startEl.value < todayStr) {
        alert("Start Date cannot be in the past.");
        startEl.focus();
        return;
      }

      const startT = new Date(startEl.value).getTime();
      const endT = new Date(endEl.value).getTime();
      if (startT >= endT) {
        alert("End Date must be after the Start Date.");
        endEl.focus();
        return;
      }

      payload.estimation = {
        startDate: startT,
        endDate: endT,
      };
    }

    const tagLabel = typeLbl?.value?.trim();
    payload.type = tagLabel ? { label: tagLabel, color: typeClr?.value ?? "#6366f1" } : null;
    payload.linkWithCodebase = linkEl?.value?.trim() || null;

    // Preserve existing blocked state if element is removed from UI
    const item = id ? state.tasks.find((t) => t.id === id) : null;
    payload.isBlocked = blockedEl ? blockedEl.checked : (item?.isBlocked ?? false);
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
      const blockedEl = $("edit-is-blocked");
      state.pendingMarkAsIssue = blockedEl ? blockedEl.checked : false;

      post({ type: "CREATE_TASK", payload });
      editTitle.disabled = true;
      btnSaveEdit.disabled = true;
    }
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

// ── Rich Avatar Assignee Dropdown ──────────────────────────────

function buildAvatarAssigneeSelect(selectedId = "") {
  const hiddenInput = $("edit-assignee");
  const namePreview = $("assignee-name-preview");
  const avatarPreview = $("assignee-avatar-preview");
  const dropdown = $("assignee-dropdown");
  const displayBtn = $("assignee-selected");
  if (!hiddenInput || !dropdown || !displayBtn) { return; }

  const allOptions = [
    { userId: "", name: "Unassigned", avatarUrl: null },
    ...state.teamMembers.map((m) => ({
      userId: m.userId,
      name: m.user?.name ?? m.userId,
      avatarUrl: m.user?.avatarUrl ?? null,
    }))
  ];

  const renderAvatar = (av, nm) => av
    ? `<img src="${esc(av)}" class="mini-avatar-img" style="width:18px;height:18px;border-radius:50%;"/>`
    : `<span class="mini-avatar" style="width:18px;height:18px;font-size:9px;flex-shrink:0;">${esc((nm || "?")[0].toUpperCase())}</span>`;

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
    return `<div class="assignee-option" data-userid="${o.userId}">
      ${renderAvatar(o.avatarUrl, o.name)}
      <span>${esc(o.name)}</span>
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
    ? [{ val: "all", label: "All" }, { val: "not started", label: "Not Started" }, { val: "inprogress", label: "Inprogress" }, { val: "reviewing", label: "Reviewing" }, { val: "testing", label: "Testing" }, { val: "completed", label: "Completed" }]
    : [{ val: "all", label: "All" }, { val: "not opened", label: "Not Opened" }, { val: "opened", label: "Opened" }, { val: "reopened", label: "Reopened" }, { val: "closed", label: "Closed" }];

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

const btnClearCodebase = $("btn-clear-codebase");
const editLinkCodebase = $("edit-link-codebase");
if (btnClearCodebase && editLinkCodebase) {
  btnClearCodebase.addEventListener("click", () => {
    editLinkCodebase.value = "";
    const activeNodes = repoTree.querySelectorAll(".tree-node.active-file");
    activeNodes.forEach((n) => n.classList.remove("active-file"));
  });
}// Toggle repository structure tree dropdown (exactly like SaaS popover dropdown)
const repoStructureContainer = $("repo-structure-container");
if (editLinkCodebase && repoStructureContainer) {
  editLinkCodebase.addEventListener("click", (e) => {
    e.stopPropagation();
    repoStructureContainer.classList.toggle("hidden");
  });
  
  // Prevent clicks inside the structure container from closing it
  repoStructureContainer.addEventListener("click", (e) => {
    e.stopPropagation();
  });
}

// Close the tree dropdown when clicking outside
document.addEventListener("click", (e) => {
  if (repoStructureContainer && !e.target.closest("#task-link-row")) {
    repoStructureContainer.classList.add("hidden");
  }
});

btnNewItem.addEventListener("click", () => {
  // Can only create tasks currently
  openEditPanel("task", null);
});

editTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { saveEdit(); }
  if (e.key === "Escape") { closeEditPanel(); }
});

// Dynamic validation for start & end date fields
const startEl = $("edit-start-date");
const endEl = $("edit-end-date");
if (startEl && endEl) {
  startEl.addEventListener("change", () => {
    if (startEl.value) {
      const nextDay = new Date(startEl.value);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split("T")[0];
      endEl.min = nextDayStr;
      if (endEl.value && endEl.value <= startEl.value) {
        endEl.value = nextDayStr;
      }
    }
  });
}

// Wire up color picker dots
const colorPickerDots = document.querySelectorAll(".tag-color-picker .color-dot");
colorPickerDots.forEach((dot) => {
  dot.addEventListener("click", () => {
    const color = dot.getAttribute("data-color");
    if (color) {
      selectTagColor(color);
    }
  });
});

// ── Repository Structure Tree Rendering ──────────────────────────

function renderRepoTree(nodes, container, searchQuery = "") {
  if (!container) return;
  container.innerHTML = "";
  if (!nodes || nodes.length === 0) {
    container.innerHTML = `<div class="empty-state" style="font-size: 11px;">No files found in repository.</div>`;
    return;
  }

  const query = searchQuery.toLowerCase().trim();
  const editLinkCodebase = $("edit-link-codebase");

  function buildNodeHtml(node, depth = 0) {
    const isDir = node.type === "directory";
    
    // If searching, check if node or any of its children match
    if (query) {
      if (isDir) {
        const hasMatchingChild = checkHasMatchingChild(node, query);
        if (!hasMatchingChild) return null;
      } else {
        if (!node.name.toLowerCase().includes(query) && !node.path.toLowerCase().includes(query)) {
          return null;
        }
      }
    }

    const iconHtml = isDir
      ? `<svg class="folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`
      : `<svg class="file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

    const isActive = editLinkCodebase && editLinkCodebase.value === node.path;
    const activeClass = isActive ? "active-file" : "";

    const itemEl = document.createElement("div");
    itemEl.className = `tree-node ${activeClass}`;
    itemEl.dataset.path = node.path;
    itemEl.dataset.type = node.type;
    itemEl.innerHTML = `
      <span class="tree-node-icon">${iconHtml}</span>
      <span class="tree-node-label" title="${esc(node.name)}">${esc(node.name)}</span>
    `;

    const wrapper = document.createElement("div");
    wrapper.appendChild(itemEl);

    if (isDir && node.children && node.children.length > 0) {
      const childContainer = document.createElement("div");
      childContainer.className = "tree-children";
      
      // Expand by default if searching, otherwise start collapsed
      if (!query) {
        childContainer.classList.add("collapsed");
      }

      node.children.forEach((child) => {
        const childNode = buildNodeHtml(child, depth + 1);
        if (childNode) {
          childContainer.appendChild(childNode);
        }
      });

      wrapper.appendChild(childContainer);

      // Handle directory expand/collapse
      itemEl.addEventListener("click", (e) => {
        e.stopPropagation();
        childContainer.classList.toggle("collapsed");
      });
    } else if (!isDir) {
      // Handle file selection
      itemEl.addEventListener("click", (e) => {
        e.stopPropagation();
        
        // Remove active class from previous active nodes
        const activeNodes = container.querySelectorAll(".tree-node.active-file");
        activeNodes.forEach((n) => n.classList.remove("active-file"));
        
        // Mark this node active
        itemEl.classList.add("active-file");
        
        // Update input field
        if (editLinkCodebase) {
          editLinkCodebase.value = node.path;
        }

        // Close dropdown
        const dropdown = $("repo-structure-container");
        if (dropdown) {
          dropdown.classList.add("hidden");
        }
      });
    }

    return wrapper;
  }

  function checkHasMatchingChild(dirNode, q) {
    if (dirNode.name.toLowerCase().includes(q) || dirNode.path.toLowerCase().includes(q)) {
      return true;
    }
    if (dirNode.children) {
      return dirNode.children.some((child) => checkHasMatchingChild(child, q));
    }
    return false;
  }

  nodes.forEach((node) => {
    const nodeEl = buildNodeHtml(node);
    if (nodeEl) {
      container.appendChild(nodeEl);
    }
  });
}

// ── Boot ──────────────────────────────────────────────────────

post({ type: "READY" });
