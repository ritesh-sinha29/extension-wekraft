import * as vscode from "vscode";
import {
  Task,
  Sprint,
  Project,
  Issue,
  TeamMember,
  CreateTaskInput,
  UpdateTaskInput,
  CreateIssueInput,
  UpdateIssueInput,
  Ticket,
  UpdateTicketInput,
  ApiResponse,
} from "../types";

// ─────────────────────────────────────────────────────────────
//  ConvexClient
//
//  Thin HTTP client for Convex HTTP Actions.
//  Authenticated API calls go to the `.convex.site` endpoint
//  with: Authorization: Bearer <apiKey>
//
//  All routes below are STUBS — implement the corresponding
//  Convex HTTP Actions (httpRouter) on the server side.
//
//  Scaling notes (100K users):
//  - Every request is stateless; Convex HTTP Actions scale horizontally.
//  - The `by_key` index on userApiKeys gives O(log N) key lookup.
//  - No connection pooling needed — fetch() is used per-request.
//  - Errors are returned as { success: false, error } — never thrown raw.
// ─────────────────────────────────────────────────────────────

export class ConvexClient {
  private siteUrl: string;

  constructor(private readonly getApiKey: () => string | null) {
    this.siteUrl = this._getSiteUrl();

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("wekraft.convexSiteUrl")) {
        this.siteUrl = this._getSiteUrl();
      }
    });
  }

  // ── Projects ─────────────────────────────────────────────

  /** GET /ext/projects  →  returns all projects the user can access */
  async getProjects(): Promise<Project[]> {
    const res = await this._get<Project[]>("/ext/projects");
    if (!res.success) throw new Error(res.error ?? "Failed to fetch projects");
    return res.data ?? [];
  }
  
  // ── User Profile ──────────────────────────────────────────
  
  /** GET /ext/me  — returns the current user's public profile */
  async getMe(): Promise<any> {
    const res = await this._get<any>("/ext/me");
    // /ext/me returns the user object directly at the root (not wrapped in { success, data }).
    // _get() wraps it as { success: true, data: <body> }, so we read res.data.
    if (!res.success || !res.data) {
      throw new Error((res as any).error ?? "Failed to fetch profile");
    }
    // Validate the response has at minimum a name field
    if (!res.data.name) {
      throw new Error("Malformed profile response from server");
    }
    return res.data;
  }

  // ── Sprints ──────────────────────────────────────────────

  /** GET /ext/sprints?projectId=<id>  →  all sprints in a project */
  async getSprints(projectId: string): Promise<Sprint[]> {
    const res = await this._get<Sprint[]>(
      `/ext/sprints?projectId=${encodeURIComponent(projectId)}`
    );
    if (!res.success) throw new Error(res.error ?? "Failed to fetch sprints");
    return res.data ?? [];
  }

  // ── Tasks ─────────────────────────────────────────────────

  /**
   * GET /ext/tasks?projectId=<id>[&sprintId=<id>]
   * Returns tasks for a project, optionally filtered to a sprint.
   */
  async getTasks(projectId: string, sprintId?: string): Promise<Task[]> {
    const qs = new URLSearchParams({ projectId });
    if (sprintId) { qs.set("sprintId", sprintId); }
    const res = await this._get<Task[]>(`/ext/tasks?${qs}`);
    if (!res.success) throw new Error(res.error ?? "Failed to fetch tasks");
    return res.data ?? [];
  }

  /**
   * POST /ext/tasks
   * Create a new task.
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    const res = await this._post<Task>(`/ext/tasks`, input);
    if (!res.success || !res.data) {
      throw new Error(res.error ?? "Failed to create task");
    }
    return res.data;
  }

  /**
   * PATCH /ext/tasks/:taskId
   * Partial update — only the fields present in `input` are changed.
   * No create endpoint exists on purpose.
   */
  async updateTask(input: UpdateTaskInput): Promise<Task> {
    const { taskId, ...fields } = input;
    const res = await this._patch<Task>(
      `/ext/tasks/${encodeURIComponent(taskId)}`,
      fields
    );
    if (!res.success || !res.data) {
      throw new Error(res.error ?? "Failed to update task");
    }
    return res.data;
  }

  /**
   * DELETE /ext/tasks/:taskId
   * Soft-delete or hard-delete depending on server policy.
   */
  async deleteTask(taskId: string): Promise<void> {
    const res = await this._delete(
      `/ext/tasks/${encodeURIComponent(taskId)}`
    );
    if (!res.success) {
      throw new Error(res.error ?? "Failed to delete task");
    }
  }

  /**
   * POST /ext/tasks/:taskId/mark-as-issue
   */
  async markTaskAsIssue(taskId: string): Promise<string> {
    const res = await this._post<{ issueId: string }>(
      `/ext/tasks/${encodeURIComponent(taskId)}/mark-as-issue`,
      {}
    );
    if (!res.success || !res.data) {
      throw new Error(res.error ?? "Failed to mark task as issue");
    }
    return res.data.issueId;
  }

  // ── Issues ────────────────────────────────────────────────

  /** GET /ext/issues?projectId=<id> */
  async getIssues(projectId: string): Promise<Issue[]> {
    const res = await this._get<Issue[]>(
      `/ext/issues?projectId=${encodeURIComponent(projectId)}`
    );
    if (!res.success) throw new Error(res.error ?? "Failed to fetch issues");
    return res.data ?? [];
  }

  /** POST /ext/issues */
  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const res = await this._post<Issue>("/ext/issues", input);
    if (!res.success || !res.data) {
      throw new Error(res.error ?? "Failed to create issue");
    }
    return res.data;
  }

  /** PATCH /ext/issues/:issueId */
  async updateIssue(input: UpdateIssueInput): Promise<Issue> {
    const { issueId, ...fields } = input;
    const res = await this._patch<Issue>(
      `/ext/issues/${encodeURIComponent(issueId)}`,
      fields
    );
    if (!res.success || !res.data) {
      throw new Error(res.error ?? "Failed to update issue");
    }
    return res.data;
  }

  /** DELETE /ext/issues/:issueId */
  async deleteIssue(issueId: string): Promise<void> {
    const res = await this._delete(
      `/ext/issues/${encodeURIComponent(issueId)}`
    );
    if (!res.success) {
      throw new Error(res.error ?? "Failed to delete issue");
    }
  }

  // ── Team ──────────────────────────────────────────────────

  /** GET /ext/team?projectId=<id> */
  async getTeamMembers(projectId: string): Promise<TeamMember[]> {
    const res = await this._get<TeamMember[]>(
      `/ext/team?projectId=${encodeURIComponent(projectId)}`
    );
    if (!res.success) throw new Error(res.error ?? "Failed to fetch team members");
    return res.data ?? [];
  }

  // ── Tickets ──────────────────────────────────────────────

  /** GET /ext/tickets?projectId=<id> — returns my tickets for a project */
  async getTickets(projectId: string): Promise<Ticket[]> {
    const res = await this._get<Ticket[]>(
      `/ext/tickets?projectId=${encodeURIComponent(projectId)}`
    );
    if (!res.success) throw new Error(res.error ?? "Failed to fetch tickets");
    return res.data ?? [];
  }

  /** PATCH /ext/tickets/:ticketId — close or reopen a ticket */
  async updateTicket(input: UpdateTicketInput): Promise<Ticket> {
    const { ticketId, ...fields } = input;
    const res = await this._patch<Ticket>(
      `/ext/tickets/${encodeURIComponent(ticketId)}`,
      fields
    );
    if (!res.success || !res.data) {
      throw new Error(res.error ?? "Failed to update ticket");
    }
    return res.data;
  }

  // ── HTTP helpers ─────────────────────────────────────────

  private _get<T>(path: string): Promise<ApiResponse<T>> {
    return this._request<T>("GET", path);
  }

  private _post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this._request<T>("POST", path, body);
  }

  private _patch<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this._request<T>("PATCH", path, body);
  }

  private _delete(path: string): Promise<ApiResponse<never>> {
    return this._request<never>("DELETE", path);
  }

  private async _request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      return { success: false, error: "Not authenticated" };
    }

    const url = `${this.siteUrl}${path}`;

    // LOW-03: Timeout every request at 15 s to prevent the UI hanging forever
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Wekraft-Client": "vscode-extension/0.0.1",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        let text = await response.text();
        if (response.status >= 500) {
          text = "An unexpected server error occurred. Please try again later.";
        } else if (text.length > 200 || text.includes("stack") || text.includes("Error:")) {
          text = "Request failed. Please check your connection or input.";
        }
        return {
          success: false,
          error: text || `HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as T;
      return { success: true, data };
    } catch (err) {
      const isTimeout = (err as any)?.name === "AbortError";
      return {
        success: false,
        error: isTimeout ? "Request timed out" : ((err as Error).message ?? "Network error"),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private _getSiteUrl(): string {
    // SECURITY (CRIT-03): Read ONLY from user-level global configuration, never workspace.
    // A malicious .vscode/settings.json in an opened repo could otherwise redirect
    // API calls (including Bearer tokens) to an attacker-controlled server.
    const config = vscode.workspace.getConfiguration("wekraft");
    const inspected = config.inspect<string>("convexSiteUrl");
    // Prefer explicit global/user value; fall back to default; ignore workspace value.
    const url = inspected?.globalValue || inspected?.defaultValue || "";
    if (!url || !url.startsWith("https://")) {
      return "";
    }
    return url;
  }
}
