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
  ownerId?: string;
  repoFullName?: string;
  /** Unix timestamp (ms) — fetched from projectDetails.targetDate */
  projectDeadline?: number | null;
}

// ── Sprints ───────────────────────────────────────────────────

/** Matches Convex schema: status is "planned" (not "planning") */
export type SprintStatus = "planned" | "active" | "completed";

export interface Sprint {
  id: string;
  projectId: string;
  /** Convex field: sprintName */
  sprintName: string;
  /** Convex field: sprintGoal */
  sprintGoal?: string;
  status: SprintStatus;
  /** Convex field: duration.startDate */
  duration: {
    startDate: number;
    endDate: number;
  };
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
  assigneeIds?: string[];
  assignees?: WekraftUser[];
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
  assigneeIds?: string[];
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
  assigneeIds?: string[];
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
  assigneeIds?: string[];
  assignees?: WekraftUser[];
  reporterId: string;
  labels?: string[];
  createdAt: number;
  updatedAt: number;
  environment?: "local" | "dev" | "staging" | "production";
  severity?: "critical" | "medium" | "low";
  due_date?: number;
  fileLinked?: string | null;
}

export interface CreateIssueInput {
  projectId: string;
  title: string;
  description?: string;
  status: IssueStatus;
  severity?: "critical" | "medium" | "low";
  environment?: "local" | "dev" | "staging" | "production";
  due_date?: number;
  fileLinked?: string | null;
  type: "manual" | "task-issue" | "github";
  assignees?: { userId: string; name: string; avatar?: string }[];
}

export interface UpdateIssueInput {
  issueId: string;
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority; // mapped to severity on backend
  severity?: "critical" | "medium" | "low";
  environment?: "local" | "dev" | "staging" | "production";
  due_date?: number;
  fileLinked?: string | null;
  assignees?: { userId: string; name: string; avatar?: string }[];
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

// ── Tickets ───────────────────────────────────────────────────

export type TicketStatus = "open" | "closed";

export interface Ticket {
  id: string;
  projectId: string;
  body: string;
  status: TicketStatus;
  createdAt: number;
  updatedAt?: number;
  createdBy?: string;    // raw userId — used to gate the Close/Reopen button
  assignedTo?: string;   // raw userId — used to gate the Close/Reopen button
  assignee?: { name: string; avatarUrl?: string } | null;
  creator?: { name: string; avatarUrl?: string } | null;
}

export interface UpdateTicketInput {
  ticketId: string;
  status: TicketStatus;
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
  | { type: "FETCH_PROJECT_DATA"; payload: { projectId: string; sprintId?: string; epoch?: number } }
  | { type: "FETCH_SPRINTS"; payload: { projectId: string } }
  | { type: "FETCH_TASKS"; payload: { projectId: string; sprintId?: string; epoch?: number } }
  | { type: "FETCH_ISSUES"; payload: { projectId: string; epoch?: number } }
  | { type: "FETCH_TEAM_MEMBERS"; payload: { projectId: string } }
  | { type: "FETCH_TICKETS"; payload: { projectId: string; epoch?: number } }
  | { type: "UPDATE_TICKET"; payload: UpdateTicketInput }
  | { type: "CREATE_TASK"; payload: CreateTaskInput }
  | { type: "UPDATE_TASK"; payload: UpdateTaskInput }
  | { type: "MARK_TASK_AS_ISSUE"; payload: { taskId: string } }
  | { type: "DELETE_TASK"; payload: { taskId: string } }
  | { type: "CREATE_ISSUE"; payload: CreateIssueInput }
  | { type: "UPDATE_ISSUE"; payload: UpdateIssueInput }
  | { type: "FETCH_REPO_STRUCTURE"; payload: { repoFullName?: string } }
  | { type: "CONFIRM_DELETE"; payload: { type: "task" | "issue"; id: string; name: string } }
  | { type: "SHOW_ERROR"; payload: { message: string } }
  | { type: "DELETE_ISSUE"; payload: { issueId: string } };

export type ExtensionToWebviewMessage =
  | { type: "AUTH_STATE"; payload: AuthState }
  | { type: "PROJECTS_LOADED"; payload: Project[] }
  | { type: "SPRINTS_LOADED"; payload: Sprint[] }
  | { type: "TASKS_LOADED"; payload: { tasks: Task[]; epoch?: number } }
  | { type: "ISSUES_LOADED"; payload: { issues: Issue[]; epoch?: number } }
  | { type: "TEAM_MEMBERS_LOADED"; payload: TeamMember[] }
  | { type: "TICKETS_LOADED"; payload: { tickets: Ticket[]; epoch?: number } }
  | { type: "TICKET_UPDATED"; payload: Ticket }
  | { type: "TASK_CREATED"; payload: Task }
  | { type: "TASK_UPDATED"; payload: Task }
  | { type: "TASK_MARKED_AS_ISSUE"; payload: { taskId: string } }
  | { type: "TASK_DELETED"; payload: { taskId: string } }
  | { type: "ISSUE_CREATED"; payload: Issue }
  | { type: "ISSUE_UPDATED"; payload: Issue }
  | { type: "ISSUE_DELETED"; payload: { issueId: string } }
  | { type: "ERROR"; payload: { message: string } }
  | { type: "LOADING"; payload: { isLoading: boolean } }
  | { type: "WORKSPACE_FILES"; payload: any[] }
  | { type: "REFRESH" };
