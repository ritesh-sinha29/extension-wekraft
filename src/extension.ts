import * as vscode from "vscode";
import { AuthManager } from "./auth/authManager";
import { ConvexClient } from "./api/convexClient";
import { SidebarProvider } from "./providers/sidebarProvider";

// ─────────────────────────────────────────────────────────────
//  Extension entry point
//
//  URI scheme: vscode://wekraft.wekraft-vscode
//    ↑ publisher.name from package.json
//  Auth callback: vscode://wekraft.wekraft-vscode/auth?token=<hex>
// ─────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  console.log("[Wekraft] Extension activated.");

  // ── Core services ────────────────────────────────────────

  const authManager = new AuthManager(context);
  const convexClient = new ConvexClient(() => authManager.apiKey);

  // Restore session from OS keychain on startup (non-blocking)
  authManager.initialize().catch((err) =>
    console.error("[Wekraft] Failed to restore session:", err)
  );

  // ── Sidebar (Webview) ─────────────────────────────────────

  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    authManager,
    convexClient
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
      {
        // Keep webview alive when panel is hidden
        // so state (selected project, sprint, tab) is preserved
        webviewOptions: { retainContextWhenHidden: true },
      }
    )
  );

  // ── URI Handler ───────────────────────────────────────────
  //
  //  Handles the deep-link redirect from the web app after login:
  //    vscode://wekraft.wekraft-vscode/auth?token=<32-char-hex>
  //
  //  The token is short-lived (5 min) and single-use.
  //  It is exchanged for a permanent apiKey via Convex mutation.

  const uriHandler: vscode.UriHandler = {
    handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
      console.log("[Wekraft] URI received:", uri.toString());

      if (uri.path !== "/auth") {
        console.warn("[Wekraft] Unknown URI path:", uri.path);
        return;
      }

      const params = new URLSearchParams(uri.query);
      const token = params.get("token");

      if (!token || token.length < 32) {
        vscode.window.showErrorMessage(
          "Wekraft: Auth callback contained an invalid token."
        );
        return;
      }

      // Kick off token exchange (async — no need to await here)
      authManager.handleHandshakeCallback(token);
    },
  };

  context.subscriptions.push(
    vscode.window.registerUriHandler(uriHandler)
  );

  // ── Commands ──────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand("wekraft.login", async () => {
      if (authManager.isAuthenticated) {
        vscode.window.showInformationMessage(
          `Wekraft: Already signed in as ${authManager.user?.name ?? "unknown"}.`
        );
        return;
      }
      await authManager.initiateLogin();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wekraft.logout", async () => {
      if (!authManager.isAuthenticated) {
        vscode.window.showInformationMessage("Wekraft: You are not signed in.");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Sign out of Wekraft (${authManager.user?.name ?? ""})? Your local data will be cleared.`,
        { modal: true },
        "Sign Out"
      );
      if (confirm === "Sign Out") {
        await authManager.logout();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wekraft.refresh", () => {
      sidebarProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("wekraft.openWebApp", () => {
      const webAppUrl = vscode.workspace
        .getConfiguration("wekraft")
        .get<string>("webAppUrl", "http://localhost:3000");
      vscode.env.openExternal(vscode.Uri.parse(webAppUrl));
    })
  );

  // ── Status bar ────────────────────────────────────────────

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.command = "wekraft.openWebApp";
  statusBar.tooltip = "Open Wekraft web app";
  statusBar.text = "$(tasklist) Wekraft";
  statusBar.show();
  context.subscriptions.push(statusBar);

  authManager.onAuthStateChanged((state) => {
    statusBar.text = state.isAuthenticated && state.user
      ? `$(tasklist) Wekraft — ${state.user.name}`
      : "$(tasklist) Wekraft";
  });
}

export function deactivate(): void {
  console.log("[Wekraft] Extension deactivated.");
}
