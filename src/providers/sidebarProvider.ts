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

      case "MARK_TASK_AS_ISSUE":
        await this._run(
          () => this.convexClient.markTaskAsIssue(msg.payload.taskId),
          () => {
            this._post({ type: "TASK_MARKED_AS_ISSUE", payload: { taskId: msg.payload.taskId } });
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
      <div id="task-type-row" class="form-row" style="flex-direction: column; gap: 8px;">
        <div class="field" style="width: 100%;">
          <label class="label">Tag Label</label>
          <input id="edit-type-label" class="input input-sm" type="text" placeholder="e.g. dashboard" maxlength="20" />
        </div>
        <div class="field" style="width: 100%;">
          <label class="label">Select Color</label>
          <div class="tag-color-picker">
            <span class="color-dot" data-color="#10b981" style="background-color: #10b981;"></span>
            <span class="color-dot" data-color="#b45309" style="background-color: #b45309;"></span>
            <span class="color-dot" data-color="#7c3aed" style="background-color: #7c3aed;"></span>
            <span class="color-dot" data-color="#2563eb" style="background-color: #2563eb;"></span>
            <span class="color-dot" data-color="#4b5563" style="background-color: #4b5563;"></span>
          </div>
          <input id="edit-type-color" type="hidden" value="#2563eb" />
        </div>
      </div>

      <!-- Link with Codebase (only for tasks) -->
      <div id="task-link-row" class="field" style="margin-top: 12px; position: relative;">
        <label class="label">Link with Codebase</label>
        <div style="display: flex; gap: 6px; align-items: center;">
          <input id="edit-link-codebase" class="input input-sm" type="text" placeholder="Select file from Repository Structure…" readonly style="flex: 1; background: var(--vscode-editor-inactiveSelectionBackground); cursor: pointer;" />
          <button id="btn-clear-codebase" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 11px; height: 24px;" title="Clear codebase link">Clear</button>
        </div>
        
        <div class="repo-structure-container hidden" id="repo-structure-container" style="position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; z-index: 1000; box-shadow: 0 4px 12px rgba(0,0,0,0.25);">
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">Repository Structure</div>
          <div id="repo-tree" style="font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; padding-right: 4px;">
            <!-- Tree nodes loaded dynamically -->
          </div>
        </div>
      </div>

      <!-- Blocked / Mark as Issue (only for tasks) -->
      <div id="task-blocked-row" class="field" style="margin-top: 12px;">
        <div class="blocked-row">
          <label class="label" style="margin: 0; display: flex; align-items: center; gap: 6px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><rect width="8" height="14" x="8" y="5" rx="4"/><path d="M19 7a1 1 0 0 0-1-1h-2M18 11.66A8 8 0 0 0 16 10M20 18a4 4 0 0 0-4-3.5M5 7a1 1 0 0 1 1-1h2M6 11.66A8 8 0 0 1 8 10M4 18a4 4 0 0 1 4-3.5M9 5a3 3 0 0 1 6 0M12 19v3M20 15h2M2 15h2"/></svg>
            Mark as Issue
          </label>
          <label class="toggle-switch">
            <input type="checkbox" id="edit-is-blocked" />
            <span class="toggle-slider"></span>
          </label>
        </div>
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
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let localMatched = false;
      let rootPath = "";

      if (workspaceFolders && workspaceFolders.length > 0) {
        rootPath = workspaceFolders[0].uri.fsPath;
        if (repoFullName) {
          const originUrl = this._getGitRemoteOrigin(rootPath);
          if (originUrl) {
            const remoteRepo = this._parseRepoFullName(originUrl);
            if (remoteRepo && remoteRepo.toLowerCase() === repoFullName.toLowerCase()) {
              localMatched = true;
            }
          }
        } else {
          localMatched = true;
        }
      }

      if (localMatched && rootPath) {
        const fileTree = this._getWorkspaceFileTree(rootPath);
        this._post({ type: "WORKSPACE_FILES", payload: fileTree });
        return;
      }

      if (repoFullName) {
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
      }

      if (rootPath) {
        const fileTree = this._getWorkspaceFileTree(rootPath);
        this._post({ type: "WORKSPACE_FILES", payload: fileTree });
      } else {
        this._post({ type: "WORKSPACE_FILES", payload: [] });
      }
    } catch (err) {
      console.error("Error fetching repository structure:", err);
      this._post({ type: "WORKSPACE_FILES", payload: [] });
    }
  }

  private _getGitRemoteOrigin(workspacePath: string): string | null {
    try {
      const { execSync } = require("child_process");
      const output = execSync("git config --get remote.origin.url", {
        cwd: workspacePath,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();
      return output || null;
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

  private _getWorkspaceFileTree(dir: string, baseDir: string = dir): any[] {
    try {
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
          name === "pnpm-lock.yaml"
        ) {
          continue;
        }

        const fullPath = path.join(dir, name);
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

        if (item.isDirectory()) {
          const children = this._getWorkspaceFileTree(fullPath, baseDir);
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
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from(
      { length: 32 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  }
}
