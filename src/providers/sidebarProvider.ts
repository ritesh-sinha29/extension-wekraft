import * as vscode from "vscode";
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
  ) {}

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
          (data) => this._post({ type: "TASKS_LOADED", payload: data })
        );
        break;

      case "FETCH_ISSUES":
        await this._run(
          () => this.convexClient.getIssues(msg.payload.projectId),
          (data) => this._post({ type: "ISSUES_LOADED", payload: data })
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

      case "REFRESH":
        this.refresh();
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
      this._post({
        type: "ERROR",
        payload: { message: (err as Error).message ?? "Unknown error" },
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
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} https: data:`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
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
        <label class="label" for="select-project">Project</label>
        <select id="select-project" class="select"></select>
      </div>
      <div class="field">
        <label class="label" for="select-sprint">Sprint</label>
        <select id="select-sprint" class="select">
          <option value="">All tasks</option>
        </select>
      </div>
    </div>

    <!-- Teammates section -->
    <div class="team-section hidden" id="team-section">
      <div class="team-title">Teammates</div>
      <div id="team-avatars" class="team-avatars"></div>
    </div>

    <!-- Main tabs: Tasks | Issues -->
    <div class="main-tabs">
      <button class="main-tab active" data-view="tasks">Tasks</button>
      <button class="main-tab" data-view="issues">Issues</button>
    </div>

    <!-- Status filter tabs (shared by tasks & issues) -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin:4px 0;">
      <div class="tabs" id="status-tabs" style="overflow-x:auto; white-space:nowrap; padding-bottom:4px; margin-bottom:-4px;">
        <!-- Dynamically rendered based on activeView by sidebar.js -->
      </div>
      <button id="btn-new-item" class="btn-icon" title="New Item" style="background:var(--vscode-button-background); color:var(--vscode-button-foreground); padding:2px 6px; border-radius:10px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14m-7-7h14"/></svg>
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
      <input id="edit-title" class="input" type="text" placeholder="Title…" />

      <!-- Description -->
      <textarea id="edit-description" class="input edit-textarea" placeholder="Description (optional)…" rows="2"></textarea>

      <!-- Status + Priority -->
      <div class="form-row">
        <select id="edit-status" class="select select-sm"></select>
        <select id="edit-priority" class="select select-sm"></select>
      </div>

      <!-- Assignee (with avatar) -->
      <div class="field">
        <label class="label">Assignee</label>
        <div id="assignee-wrapper" class="assignee-select-wrapper">
          <div id="assignee-selected" class="assignee-selected-display">
            <span class="mini-avatar" id="assignee-avatar-preview">?</span>
            <span id="assignee-name-preview">Unassigned</span>
            <svg style="margin-left:auto;flex-shrink:0;" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div id="assignee-dropdown" class="assignee-dropdown hidden"></div>
        </div>
        <input type="hidden" id="edit-assignee" value="" />
      </div>

      <!-- Dates (only shown for tasks) -->
      <div id="task-dates" class="form-row">
        <div class="field">
          <label class="label">Start Date</label>
          <input id="edit-start-date" class="input input-sm" type="date" />
        </div>
        <div class="field">
          <label class="label">End Date</label>
          <input id="edit-end-date" class="input input-sm" type="date" />
        </div>
      </div>

      <!-- Tag / Type (only for tasks) -->
      <div id="task-type-row" class="form-row" style="align-items:center;">
        <div class="field" style="flex:1;">
          <label class="label">Tag Label</label>
          <input id="edit-type-label" class="input input-sm" type="text" placeholder="e.g. dashboard" maxlength="20" />
        </div>
        <div class="field" style="width:48px;">
          <label class="label">Color</label>
          <input id="edit-type-color" class="input-color" type="color" value="#6366f1" />
        </div>
      </div>

      <!-- Link with Codebase (only for tasks) -->
      <div id="task-link-row" class="field">
        <label class="label">Link with Codebase</label>
        <input id="edit-link-codebase" class="input input-sm" type="text" placeholder="e.g. src/api/tasks.ts" />
      </div>

      <!-- isBlocked toggle (only for tasks) -->
      <div id="task-blocked-row" class="blocked-row">
        <label class="label" for="edit-is-blocked">Mark as Blocked</label>
        <label class="toggle-switch">
          <input id="edit-is-blocked" type="checkbox" />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="form-actions">
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

  private _nonce(): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(
      { length: 32 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  }
}
