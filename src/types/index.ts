// ─────────────────────────────────────────────────────────────
//  Wekraft VS Code Extension — Type Definitions
//  NOTE: No "Create" types — only Update & Delete are allowed
//        from the extension. Creation must happen on the web app.
// ─────────────────────────────────────────────────────────────

// ── Auth ──────────────────────────────────────────────────────

export interface WekraftUser {
  id: string;           // Convex userId (v.id("users"))
  name: string;
  email: string;
  avatarUrl?: string;
  role: "admin" | "member" | "viewer";
  accountType?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: WekraftUser | null;
  // apiKey is NEVER sent to the webview — only the extension host holds it
}

// ── Handshake (token exchange) ────────────────────────────────

export interface HandshakeExchangeResult {
  userId: string;
  apiKey: string;
  user?: {
    name: string;
    avatarUrl: string;
    accountType: string;
  };
}

// ── Workspace / Projects ──────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  createdAt: number;
}

// ── Sprints ───────────────────────────────────────────────────

export type SprintStatus = "planning" | "active" | "completed";

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal?: string;
  status: SprintStatus;
  startDate: number;
  endDate: number;
  createdAt: number;
}

// ── Tasks ─────────────────────────────────────────────────────

export type TaskStatus = "not started" | "inprogress" | "reviewing" | "testing" | "completed";
export type TaskPriority = "high" | "medium" | "low";

export interface Task {
  id: string;
  projectId: string;
  sprintId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string;
  assignee?: WekraftUser;
  reporterId: string;
  labels?: string[];
  dueDate?: number;
  estimatedHours?: number;
  estimation?: { startDate: number; endDate: number } | null;
  type?: { label: string; color: string } | null;
  isBlocked?: boolean;
  linkWithCodebase?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTaskInput {
  projectId: string;
  sprintId?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  dueDate?: number;
  estimatedHours?: number;
  estimation?: { startDate: number; endDate: number };
  type?: { label: string; color: string } | null;
  isBlocked?: boolean;
  linkWithCodebase?: string | null;
}

export interface UpdateTaskInput {
  taskId: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  sprintId?: string;
  labels?: string[];
  dueDate?: number;
  estimatedHours?: number;
  estimation?: { startDate: number; endDate: number };
  type?: { label: string; color: string } | null;
  isBlocked?: boolean;
  linkWithCodebase?: string | null;
}

// ── Issues ────────────────────────────────────────────────────

export type IssueStatus = "not opened" | "opened" | "reopened" | "closed";
export type IssuePriority = "critical" | "high" | "medium" | "low";

export interface Issue {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId?: string;
  assignee?: WekraftUser;
  reporterId: string;
  labels?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface UpdateIssueInput {
  issueId: string;
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assigneeId?: string;
  labels?: string[];
}

// ── Team ──────────────────────────────────────────────────────

export interface TeamMember {
  id: string;
  userId: string;
  user: WekraftUser;
  role: "admin" | "member" | "viewer";
  joinedAt: number;
}

// ── Generic API ───────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── Webview ↔ Extension Messages ─────────────────────────────

export type WebviewToExtensionMessage =
  | { type: "READY" }
  | { type: "LOGIN_REQUEST" }
  | { type: "LOGOUT_REQUEST" }
  | { type: "REFRESH" }
  | { type: "FETCH_PROJECTS" }
  | { type: "FETCH_SPRINTS";      payload: { projectId: string } }
  | { type: "FETCH_TASKS";        payload: { projectId: string; sprintId?: string } }
  | { type: "FETCH_ISSUES";       payload: { projectId: string } }
  | { type: "FETCH_TEAM_MEMBERS"; payload: { projectId: string } }
  | { type: "CREATE_TASK";        payload: CreateTaskInput }
  | { type: "UPDATE_TASK";        payload: UpdateTaskInput }
  | { type: "DELETE_TASK";        payload: { taskId: string } }
  | { type: "UPDATE_ISSUE";       payload: UpdateIssueInput }
  | { type: "DELETE_ISSUE";       payload: { issueId: string } };

export type ExtensionToWebviewMessage =
  | { type: "AUTH_STATE";          payload: AuthState }
  | { type: "PROJECTS_LOADED";     payload: Project[] }
  | { type: "SPRINTS_LOADED";      payload: Sprint[] }
  | { type: "TASKS_LOADED";        payload: Task[] }
  | { type: "ISSUES_LOADED";       payload: Issue[] }
  | { type: "TEAM_MEMBERS_LOADED"; payload: TeamMember[] }
  | { type: "TASK_CREATED";        payload: Task }
  | { type: "TASK_UPDATED";        payload: Task }
  | { type: "TASK_DELETED";        payload: { taskId: string } }
  | { type: "ISSUE_UPDATED";       payload: Issue }
  | { type: "ISSUE_DELETED";       payload: { issueId: string } }
  | { type: "ERROR";               payload: { message: string } }
  | { type: "LOADING";             payload: { isLoading: boolean } }
  | { type: "REFRESH" };
