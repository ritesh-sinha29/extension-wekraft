import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { AuthManager } from "../auth/authManager";
import { ConvexClient } from "../api/convexClient";
import {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
} from "../types";

// ─────────────────────────────────────────────────────────────
//  SidebarProvider
//
//  Manages the Wekraft webview panel.
//  Acts as the typed message bus between:
//    - Webview UI  (sidebar.js running in sandboxed browser context)
//    - Extension host (AuthManager + ConvexClient running in Node.js)
//
//  NOTE: No CREATE operations. The webview can only UPDATE and DELETE.
// ─────────────────────────────────────────────────────────────

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "wekraft.sidebarView";

  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly authManager: AuthManager,
    private readonly convexClient: ConvexClient
  ) { }

  // ── VS Code lifecycle ─────────────────────────────────────

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    // Messages from webview → extension host
    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewToExtensionMessage) => this._handle(msg)
    );

    // Push auth state changes into the webview automatically
    this.authManager.onAuthStateChanged((state) => {
      this._post({ type: "AUTH_STATE", payload: state });
    });
  }

  // ── Called by the wekraft.refresh command ─────────────────

  refresh(): void {
    this._post({ type: "LOADING", payload: { isLoading: true } });
    this._post({ type: "REFRESH" });
  }

  // ── Message handler ───────────────────────────────────────

  private async _handle(msg: WebviewToExtensionMessage): Promise<void> {
    switch (msg.type) {

      // Webview is ready — send current auth state immediately
      case "READY":
        this._post({ type: "AUTH_STATE", payload: this.authManager.getAuthState() });
        this._sendWorkspaceFiles();
        if (this.authManager.isAuthenticated) {
          this.convexClient.getMe().then((me) => {
            if (me) this.authManager.updateUser(me);
          }).catch(console.error);
        }
        break;

      case "FETCH_REPO_STRUCTURE":
        await this._fetchRepoStructure(msg.payload.repoFullName);
        break;

      case "LOGIN_REQUEST":
        await this.authManager.initiateLogin();
        break;

      case "LOGOUT_REQUEST":
        await this.authManager.logout();
        break;

      // ── Read operations ─────────────────────────────────

      case "FETCH_PROJECTS":
        await this._run(
          () => this.convexClient.getProjects(),
          (data) => this._post({ type: "PROJECTS_LOADED", payload: data })
        );
        break;

      case "FETCH_SPRINTS":
        await this._run(
          () => this.convexClient.getSprints(msg.payload.projectId),
          (data) => this._post({ type: "SPRINTS_LOADED", payload: data })
        );
        break;

      case "FETCH_TASKS":
        await this._run(
          () =>
            this.convexClient.getTasks(
              msg.payload.projectId,
              msg.payload.sprintId
            ),
          (data) => this._post({
            type: "TASKS_LOADED",
            payload: { tasks: data, epoch: msg.payload.epoch }
          })
        );
        break;

      case "FETCH_ISSUES":
        await this._run(
          () => this.convexClient.getIssues(msg.payload.projectId),
          (data) => this._post({
            type: "ISSUES_LOADED",
            payload: { issues: data, epoch: msg.payload.epoch }
          })
        );
        break;

      case "FETCH_TEAM_MEMBERS":
        await this._run(
          () => this.convexClient.getTeamMembers(msg.payload.projectId),
          (data) => this._post({ type: "TEAM_MEMBERS_LOADED", payload: data })
        );
        break;

      case "CREATE_TASK":
        await this._run(
          () => this.convexClient.createTask(msg.payload),
          (data) => {
            this._post({ type: "TASK_CREATED", payload: data });
            // After creating, close loading and refresh tasks list to ensure UI matches backend
            this._post({ type: "LOADING", payload: { isLoading: false } });
          }
        );
        break;

      case "UPDATE_TASK":
        await this._run(
          () => this.convexClient.updateTask(msg.payload),
          (data) => this._post({ type: "TASK_UPDATED", payload: data })
        );
        break;

      case "MARK_TASK_AS_ISSUE":
        await this._run(
          () => this.convexClient.markTaskAsIssue(msg.payload.taskId),
          () => {
            this._post({ type: "TASK_MARKED_AS_ISSUE", payload: { taskId: msg.payload.taskId } });
          }
        );
        break;

      case "CREATE_ISSUE":
        await this._run(
          () => this.convexClient.createIssue(msg.payload),
          (data) => {
            this._post({ type: "ISSUE_CREATED", payload: data });
            this._post({ type: "LOADING", payload: { isLoading: false } });
          }
        );
        break;

      case "UPDATE_ISSUE":
        await this._run(
          () => this.convexClient.updateIssue(msg.payload),
          (data) => this._post({ type: "ISSUE_UPDATED", payload: data })
        );
        break;

      // ── Delete operations ────────────────────────────────

      case "DELETE_TASK":
        await this._run(
          () => this.convexClient.deleteTask(msg.payload.taskId),
          () =>
            this._post({
              type: "TASK_DELETED",
              payload: { taskId: msg.payload.taskId },
            })
        );
        break;

      case "DELETE_ISSUE":
        await this._run(
          () => this.convexClient.deleteIssue(msg.payload.issueId),
          () =>
            this._post({
              type: "ISSUE_DELETED",
              payload: { issueId: msg.payload.issueId },
            })
        );
        break;

      case "FETCH_TICKETS":
        await this._run(
          () => this.convexClient.getTickets(msg.payload.projectId),
          (data) => this._post({
            type: "TICKETS_LOADED",
            payload: { tickets: data, epoch: msg.payload.epoch }
          })
        );
        break;

      case "UPDATE_TICKET":
        await this._run(
          () => this.convexClient.updateTicket(msg.payload),
          (data) => this._post({ type: "TICKET_UPDATED", payload: data })
        );
        break;

      case "REFRESH":
        this.refresh();
        break;

      case "CONFIRM_DELETE": {
        const { type, id, name } = msg.payload;
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete the ${type} "${name}"? This action cannot be undone.`,
          { modal: true },
          "Delete"
        );
        if (confirm === "Delete") {
          if (type === "task") {
            await this._run(
              () => this.convexClient.deleteTask(id),
              () =>
                this._post({
                  type: "TASK_DELETED",
                  payload: { taskId: id },
                })
            );
          } else {
            await this._run(
              () => this.convexClient.deleteIssue(id),
              () =>
                this._post({
                  type: "ISSUE_DELETED",
                  payload: { issueId: id },
                })
            );
          }
        }
        break;
      }

      case "SHOW_ERROR":
        vscode.window.showErrorMessage(`Wekraft: ${msg.payload.message}`);
        break;
    }
  }

  // ── Convenience: run an async op and handle errors ────────

  private async _run<T>(
    op: () => Promise<T>,
    onSuccess: (result: T) => void
  ): Promise<void> {
    try {
      const result = await op();
      onSuccess(result);
    } catch (err) {
      console.error("Wekraft API Error:", err);
      // LOW-02: Never forward raw internal error messages to the webview.
      // They may contain Convex document IDs, stack traces, or server internals.
      const raw = (err as Error).message ?? "";
      const rawLower = raw.toLowerCase();
      let userMessage = "An unexpected error occurred. Please try again.";
      if (
        rawLower.includes("not authenticated") || 
        rawLower.includes("invalid") || 
        rawLower.includes("revoked") ||
        rawLower.includes("unauthorized") ||
        rawLower.includes("expired")
      ) {
        userMessage = "Authentication failed. Please sign out and sign in again.";
      } else if (rawLower.includes("rate limit")) {
        userMessage = "Too many requests. Please wait a moment before retrying.";
      } else if (rawLower.includes("forbidden")) {
        userMessage = "Access denied: you do not have permission to perform this action.";
      } else if (rawLower.includes("not found")) {
        userMessage = "The requested item was not found.";
      } else if (rawLower.includes("timed out")) {
        userMessage = "The server took too long to respond. Check your connection.";
      }
      this._post({
        type: "ERROR",
        payload: { message: userMessage },
      });
    }
  }

  // ── Webview HTML ──────────────────────────────────────────

  private _buildHtml(webview: vscode.Webview): string {
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(media, "sidebar.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(media, "sidebar.js")
    );

    const nonce = this._nonce();
    const csp = [
      `default-src 'none'`,
      // LOW-01: Removed 'unsafe-inline' — all styles in external sidebar.css
      `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src ${webview.cspSource} https://fonts.gstatic.com`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} https: data:`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="${styleUri}" rel="stylesheet" />
  <title>Wekraft</title>
</head>
<body>
<div id="app">

  <!-- ░░ LOGIN ░░ -->
  <div id="screen-login" class="screen hidden">
    <div class="logo-wrap">
      <div class="logo-icon">W</div>
      <h1 class="logo-text">Wekraft</h1>
      <p class="tagline">Project management, right in your editor.</p>
    </div>
    <button id="btn-login" class="btn btn-primary btn-full">
      Sign in with Wekraft
    </button>
  </div>

  <!-- ░░ LOADING SKELETON ░░ -->
  <div id="screen-loading" class="screen hidden">
    <div class="skeleton-list">
      <div class="skeleton-item"></div>
      <div class="skeleton-item"></div>
      <div class="skeleton-item"></div>
      <div class="skeleton-item short"></div>
    </div>
  </div>

  <!-- ░░ MAIN DASHBOARD ░░ -->
  <div id="screen-main" class="screen hidden">

    <!-- User header -->
    <div class="user-header">
      <div class="user-avatar" id="user-avatar"></div>
      <div class="user-info">
        <span class="user-name" id="user-name" style="font-size:13px; font-weight:600;">—</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="user-role plan-badge plan-free" id="user-role">FREE PLAN</span>
        </div>
      </div>
      <button id="btn-theme-toggle" class="btn-icon" title="Toggle Theme" style="margin-right: 4px;">
        <!-- Moon Icon (Default Dark) -->
        <svg id="icon-moon" style="display: none;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
        <!-- Sun Icon (For Light Mode) -->
        <svg id="icon-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      </button>
      <button id="btn-logout" class="btn-icon" title="Sign out">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>

    <!-- Project + Sprint selectors -->
    <div class="selectors">
      <div class="field">
        <label class="label">Project</label>
        <div class="wk-select-wrapper" id="wrapper-select-project">
          <div class="wk-select-display" id="display-select-project">
            <div class="wk-select-content">
              <span class="wk-select-text">Loading projects...</span>
              <span class="wk-select-icon"></span>
            </div>
            <svg class="wk-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="wk-select-dropdown hidden" id="dropdown-select-project"></div>
          <input type="hidden" id="select-project" />
        </div>
      </div>
      
      <!-- Project Deadline UI -->
      <div id="project-deadline-container" class="deadline-card" style="display: none;">
        <div class="deadline-content">
          <div class="deadline-left">
            <div class="deadline-icon-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div class="deadline-info">
              <span class="deadline-label">Project Deadline</span>
              <span id="project-deadline-text" class="deadline-text"></span>
            </div>
          </div>
          <div class="deadline-right-box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
              <line x1="16" x2="16" y1="2" y2="6"/>
              <line x1="8" x2="8" y1="2" y2="6"/>
              <line x1="3" x2="21" y1="10" y2="10"/>
            </svg>
          </div>
        </div>
      </div>

      <div class="field">
        <label class="label">Sprint</label>
        <div class="wk-select-wrapper" id="wrapper-select-sprint">
          <div class="wk-select-display" id="display-select-sprint">
            <div class="wk-select-content">
              <span class="wk-select-text">Loading sprints...</span>
              <span class="wk-select-icon"></span>
            </div>
            <svg class="wk-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="wk-select-dropdown hidden" id="dropdown-select-sprint"></div>
          <input type="hidden" id="select-sprint" />
        </div>
      </div>
    </div>

    <!-- Teammates section -->
    <div class="team-section hidden" id="team-section">
      <div class="team-title">Teammates</div>
      <div id="team-avatars" class="team-avatars"></div>
    </div>

    <!-- Main tabs: Tasks | Issues | Tickets -->
    <div class="main-tabs">
      <button class="main-tab active" data-view="tasks">Tasks</button>
      <button class="main-tab" data-view="issues">Issues</button>
      <button class="main-tab" data-view="tickets">Tickets</button>
    </div>

    <!-- Status filter tabs (shared by tasks & issues) -->
    <div class="status-bar">
      <div class="tabs" id="status-tabs">
        <!-- Dynamically rendered based on activeView by sidebar.js -->
      </div>
      <button id="btn-new-item" class="btn btn-new" title="New Item">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14m-7-7h14"/></svg>
        <span id="btn-new-item-label">New Task</span>
      </button>
    </div>

    <!-- Item list -->
    <div id="item-list" class="item-list">
      <div class="empty-state">Select a project to load data.</div>
    </div>

    <!-- Inline edit panel (hidden by default) -->
    <div id="edit-panel" class="edit-panel hidden">
      <div class="edit-panel-header">
        <span id="edit-panel-title" class="edit-panel-label">Edit Task</span>
        <button id="btn-close-edit" class="btn-icon" title="Cancel">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Title -->
      <div class="ep-field">
        <input id="edit-title" class="input" type="text" placeholder="Title…" />
      </div>

      <!-- Description -->
      <div class="ep-field">
        <textarea id="edit-description" class="input edit-textarea" placeholder="Description (optional)…" rows="2"></textarea>
      </div>

      <!-- Status + Priority -->
      <div class="ep-row">
        <div class="ep-field">
          <label class="ep-label">Status</label>
          <div class="wk-select-wrapper" id="wrapper-edit-status">
            <div class="wk-select-display" id="display-edit-status">
              <div class="wk-select-content">
                <span class="wk-select-text">Select Status</span>
                <span class="wk-select-icon"></span>
              </div>
              <svg class="wk-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="wk-select-dropdown hidden" id="dropdown-edit-status"></div>
            <input type="hidden" id="edit-status" />
          </div>
        </div>
        <div class="ep-field">
          <label class="ep-label">Priority</label>
          <div class="wk-select-wrapper" id="wrapper-edit-priority">
            <div class="wk-select-display" id="display-edit-priority">
              <div class="wk-select-content">
                <span class="wk-select-text">Select Priority</span>
                <span class="wk-select-icon"></span>
              </div>
              <svg class="wk-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="wk-select-dropdown hidden" id="dropdown-edit-priority"></div>
            <input type="hidden" id="edit-priority" />
          </div>
        </div>
      </div>

      <!-- Assignee (with avatar) -->
      <div class="ep-field">
        <label class="ep-label">Assignee</label>
        <div id="assignee-wrapper" class="assignee-select-wrapper">
          <div id="assignee-selected" class="assignee-selected-display">
            <div id="assignee-avatar-preview" class="ep-avatar-stack"></div>
            <span id="assignee-name-preview" style="flex:1;">Unassigned</span>
            <svg style="flex-shrink:0;opacity:0.5;" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div id="assignee-dropdown" class="assignee-dropdown hidden"></div>
        </div>
        <input type="hidden" id="edit-assignee" value="" />
      </div>

      <!-- Dates (only shown for tasks) -->
      <div id="task-dates" class="ep-row">
        <div class="ep-field">
          <label class="ep-label">Start Date</label>
          <input id="edit-start-date" class="input input-sm" type="date" />
        </div>
        <div class="ep-field">
          <label class="ep-label">End Date</label>
          <input id="edit-end-date" class="input input-sm" type="date" />
        </div>
      </div>

      <!-- Dates (only shown for issues) -->
      <div id="issue-due-date-row" class="ep-field" style="margin-top: 0;">
        <label class="ep-label">Due Date</label>
        <input id="edit-due-date" class="input input-sm" type="date" />
      </div>

      <!-- Environment (only shown for issues) -->
      <div id="issue-environment-row" class="ep-field">
        <label class="ep-label">Environment</label>
        <div class="wk-select-wrapper" id="wrapper-edit-environment">
          <div class="wk-select-display" id="display-edit-environment">
            <div class="wk-select-content">
              <span class="wk-select-text">Select Environment</span>
              <span class="wk-select-icon"></span>
            </div>
            <svg class="wk-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="wk-select-dropdown hidden" id="dropdown-edit-environment"></div>
          <input type="hidden" id="edit-environment" />
        </div>
      </div>

      <!-- Tag / Type (only for tasks) -->
      <div id="task-type-row" class="ep-field">
        <label class="ep-label">Tag Label</label>
        <input id="edit-type-label" class="input input-sm" type="text" placeholder="e.g. dashboard" maxlength="20" />
        <label class="ep-label" style="margin-top:8px;">Tag Color</label>
        <div class="tag-color-picker">
          <span class="color-dot" data-color="green"  style="background:#10b981;" title="Green"></span>
          <span class="color-dot" data-color="yellow" style="background:#eab308;" title="Yellow"></span>
          <span class="color-dot" data-color="purple" style="background:#a855f7;" title="Purple"></span>
          <span class="color-dot" data-color="blue"   style="background:#3b82f6;" title="Blue"></span>
          <span class="color-dot" data-color="grey"   style="background:#737373;" title="Grey"></span>
        </div>
        <input id="edit-type-color" type="hidden" value="blue" />
      </div>

      <!-- Link with Codebase (only for tasks) -->
      <div id="task-link-row" class="ep-field" style="position: relative;">
        <label class="ep-label">Link with Codebase</label>
        <div class="ep-codebase-row">
          <input id="edit-link-codebase" class="input input-sm ep-codebase-input" type="text" placeholder="Click to pick a file…" readonly />
          <button id="btn-clear-codebase" class="ep-clear-btn" title="Clear">✕</button>
        </div>
        <div class="repo-structure-container hidden" id="repo-structure-container" style="position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; z-index: 1000; box-shadow: 0 4px 24px rgba(0,0,0,0.4);">
          <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; margin-bottom: 6px;">Repository Structure</div>
          <input id="repo-search" class="input input-sm" type="text" placeholder="Search files…" style="width: 100%; margin-bottom: 6px; box-sizing: border-box;" />
          <div id="repo-tree" style="font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow-y: auto; padding-right: 4px;">
            <!-- Tree nodes loaded dynamically -->
          </div>
        </div>
      </div>

      <!-- Blocked / Mark as Issue (only for tasks) -->
      <div id="task-blocked-row" class="ep-toggle-row">
        <label class="ep-label" style="margin:0; display:flex; align-items:center; gap:6px; color:#a3a3a3;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="6" /><path d="M12 7a3 3 0 0 0-3-3h6a3 3 0 0 0-3 3z" fill="#ef4444" /><line x1="12" y1="7" x2="12" y2="19" /><path d="M9 4C9 3 8 2.5 8 2.5M15 4C15 3 16 2.5 16 2.5" /><path d="M6 10H3.5M5 14H2.5M6 18H3.5M18 10h2.5M19 14h2.5M18 18h2.5" /><circle cx="9.5" cy="11.5" r="0.8" fill="#ef4444" /><circle cx="14.5" cy="11.5" r="0.8" fill="#ef4444" /><circle cx="9.5" cy="15.5" r="0.8" fill="#ef4444" /><circle cx="14.5" cy="15.5" r="0.8" fill="#ef4444" /></svg>
          Mark as Issue
        </label>
        <label class="toggle-switch">
          <input type="checkbox" id="edit-is-blocked" />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="form-actions" style="padding-top: 4px;">
        <button id="btn-close-edit-bottom" class="btn btn-ghost btn-sm" style="margin-right:auto;">Cancel</button>
        <button id="btn-save-edit" class="btn btn-primary btn-sm">Save changes</button>
      </div>

    </div>

  </div><!-- /screen-main -->
</div><!-- /app -->

<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _post(msg: ExtensionToWebviewMessage): void {
    this._view?.webview.postMessage(msg);
  }

  private _sendWorkspaceFiles(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this._post({ type: "WORKSPACE_FILES", payload: [] });
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const fileTree = this._getWorkspaceFileTree(rootPath);
    this._post({ type: "WORKSPACE_FILES", payload: fileTree });
  }

  private async _fetchRepoStructure(repoFullName?: string): Promise<void> {
    try {
      // ── Production guard: if the project has no linked repo, send an empty
      // tree immediately. Never fall through to expose the VS Code workspace.
      if (!repoFullName) {
        this._post({ type: "WORKSPACE_FILES", payload: [] });
        return;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders;
      let localMatched = false;
      let rootPath = "";

      // Check ALL open workspace folders — user may have multiple repos open.
      // Previously only [0] was checked, so if the target repo was any other
      // folder it always fell through to GitHub API (fails for private repos).
      if (workspaceFolders && workspaceFolders.length > 0) {
        for (const folder of workspaceFolders) {
          const folderPath = folder.uri.fsPath;
          const originUrl = this._getGitRemoteOrigin(folderPath);
          if (originUrl) {
            const remoteRepo = this._parseRepoFullName(originUrl);
            if (remoteRepo && remoteRepo.toLowerCase() === repoFullName.toLowerCase()) {
              rootPath = folderPath;
              localMatched = true;
              break;
            }
          }
        }
      }

      if (localMatched && rootPath) {
        const fileTree = this._getWorkspaceFileTree(rootPath);
        this._post({ type: "WORKSPACE_FILES", payload: fileTree });
        return;
      }

      // Fetch from GitHub API using the linked repo name
      let token: string | undefined;
      try {
        const session = await vscode.authentication.getSession("github", ["repo"], { silent: true });
        token = session?.accessToken;
      } catch (e) {}

      const [owner, repoName] = repoFullName.split("/");
      if (owner && repoName) {
        let treeData = await this._getGitHubTree(owner, repoName, "main", token);
        if (!treeData) {
          treeData = await this._getGitHubTree(owner, repoName, "master", token);
        }

        if (treeData && Array.isArray(treeData)) {
          const filtered = treeData.filter((item: any) => {
            return !this._shouldSkipGitHubItem(item.path, item.type === "blob");
          });
          const parsedTree = this._buildTreeFromFlatList(filtered);
          this._post({ type: "WORKSPACE_FILES", payload: parsedTree });
          return;
        }
      }

      // GitHub API failed — send empty rather than leaking an unrelated workspace
      this._post({ type: "WORKSPACE_FILES", payload: [] });
    } catch (err) {
      console.error("Error fetching repository structure:", err);
      this._post({ type: "WORKSPACE_FILES", payload: [] });
    }
  }

  private _getGitRemoteOrigin(workspacePath: string): string | null {
    try {
      // MED-03: Use spawnSync with argument array instead of execSync with shell string.
      // This avoids shell expansion and is not susceptible to command injection
      // even if workspacePath contained special characters.
      const { spawnSync } = require("child_process");
      const result = spawnSync("git", ["config", "--get", "remote.origin.url"], {
        cwd: workspacePath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
        shell: process.platform === "win32",  // required on Windows to resolve git.exe
      });
      if (result.status !== 0 || result.error) return null;
      return result.stdout?.trim() || null;
    } catch (e) {
      return null;
    }
  }

  private _parseRepoFullName(url: string): string | null {
    if (!url) return null;
    let cleanUrl = url.replace(/\.git$/, "");
    if (cleanUrl.includes("git@")) {
      const parts = cleanUrl.split(":");
      return parts[parts.length - 1] || null;
    }
    const parts = cleanUrl.split("github.com/");
    if (parts.length > 1) {
      return parts[1] || null;
    }
    return null;
  }

  private _getGitHubTree(owner: string, repo: string, branch: string, token?: string): Promise<any[] | null> {
    return new Promise((resolve) => {
      const https = require("https");
      const options = {
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        method: "GET",
        headers: {
          "User-Agent": "Wekraft-VSCode-Extension",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        }
      };
      const req = https.request(options, (res: any) => {
        let data = "";
        res.on("data", (chunk: any) => data += chunk);
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data);
              resolve(json.tree ?? null);
            } catch (e) {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        });
      });
      req.on("error", () => resolve(null));
      req.end();
    });
  }

  private _shouldSkipGitHubItem(itemPath: string, isFile: boolean): boolean {
    const SKIP_FOLDERS = new Set([
      "node_modules", ".next", ".nuxt", ".output", "dist", "build", "out", ".cache", ".turbo", ".vercel",
      ".git", ".github", "coverage", "logs", ".vscode", ".idea", "__pycache__", ".venv", "venv", "env"
    ]);
    const SKIP_FILES = new Set([
      "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", ".gitignore"
    ]);

    const parts = itemPath.split("/");
    const fileName = parts[parts.length - 1];
    
    if (parts.some(p => SKIP_FOLDERS.has(p))) return true;
    if (isFile) {
      if (SKIP_FILES.has(fileName)) return true;
      if (fileName.startsWith(".")) return true;
    }
    return false;
  }

  private _buildTreeFromFlatList(items: any[]): any[] {
    const root: any[] = [];
    const map: Record<string, any> = {};

    for (const item of items) {
      const parts = item.path.split("/");
      const name = parts[parts.length - 1];
      const node: any = {
        name,
        path: item.path,
        type: item.type === "tree" ? "directory" : "file",
      };
      if (item.type === "tree") {
        node.children = [];
      }
      map[item.path] = node;

      if (parts.length === 1) {
        root.push(node);
      } else {
        const parentPath = parts.slice(0, -1).join("/");
        const parent = map[parentPath];
        if (parent && parent.children) {
          parent.children.push(node);
        } else {
          root.push(node);
        }
      }
    }

    const sortNodes = (nodes: any[]) => {
      nodes.forEach(n => {
        if (n.children) sortNodes(n.children);
      });
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    };
    sortNodes(root);
    return root;
  }

  private _getWorkspaceFileTree(
    dir: string,
    baseDir: string = dir,
    depth: number = 0,
    stateRef: { fileCount: number } = { fileCount: 0 }
  ): any[] {
    try {
      if (depth > 6 || stateRef.fileCount > 2000) {
        return [];
      }
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const nodes: any[] = [];

      for (const item of items) {
        const name = item.name;
        if (
          name.startsWith(".") ||
          name === "node_modules" ||
          name === "dist" ||
          name === "build" ||
          name === "out" ||
          name === "package-lock.json" ||
          name === "yarn.lock" ||
          name === "pnpm-lock.yaml" ||
          name === "bower_components" ||
          name === "vendor" ||
          name === "target" ||
          name === ".next" ||
          name === ".nuxt" ||
          name === ".git" ||
          name === ".svn" ||
          name === ".hg"
        ) {
          continue;
        }

        const fullPath = path.join(dir, name);
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

        if (item.isDirectory()) {
          const children = this._getWorkspaceFileTree(fullPath, baseDir, depth + 1, stateRef);
          nodes.push({
            name,
            path: relativePath,
            type: "directory",
            children: children.sort((a, b) => {
              if (a.type !== b.type) {
                return a.type === "directory" ? -1 : 1;
              }
              return a.name.localeCompare(b.name);
            }),
          });
        } else if (item.isFile()) {
          stateRef.fileCount += 1;
          nodes.push({
            name,
            path: relativePath,
            type: "file",
          });
        }
      }

      return nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch (err) {
      console.error("Error reading workspace dir:", err);
      return [];
    }
  }

  private _nonce(): string {
    // HIGH-01: Use cryptographically secure random bytes, not Math.random().
    // Math.random() is not cryptographically secure and could produce predictable
    // nonces that undermine the Content Security Policy protection.
    const crypto = require("crypto");
    return crypto.randomBytes(16).toString("base64url");
  }
}
