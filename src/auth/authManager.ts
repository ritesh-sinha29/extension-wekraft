import * as vscode from "vscode";
import { AuthState, WekraftUser, HandshakeExchangeResult } from "../types";

// ─────────────────────────────────────────────────────────────
//  AuthManager
//
//  Full auth lifecycle for 100K+ users:
//
//  LOGIN
//  1. Open browser →
//       https://wekraft.xyz/extension?callback_url=vscode://wekraft.wekraft-vscode/auth
//  2. User grants access on the web app.
//  3. Web app calls createHandshakeToken() — 5-min TTL, one-time-use hex token.
//  4. Browser redirects →
//       vscode://wekraft.wekraft-vscode/auth?token=<32-char-hex>
//  5. VS Code routes the URI to our registered UriHandler.
//  6. Extension calls Convex mutation exchangeHandshakeToken({ token }).
//     - Token is deleted in the same DB transaction (prevents replay attacks).
//  7. Convex returns { userId, apiKey }.
//  8. apiKey is stored ONLY in SecretStorage (OS-level encrypted keychain).
//     userId is stored in globalState (non-sensitive).
//
//  SECURITY NOTES (scaling to 100K users):
//  - SecretStorage is backed by the OS keychain — never written to disk in plaintext.
//  - apiKey is NEVER forwarded to the webview; only auth state (isAuthenticated, user).
//  - Token exchange is idempotent: the same token cannot be exchanged twice.
//  - Tokens expire after 5 minutes; a Convex cron prunes expired ones hourly.
// ─────────────────────────────────────────────────────────────

const SECRET_API_KEY = "wekraft.apiKey";
const GLOBAL_USER_ID = "wekraft.userId";
const GLOBAL_USER = "wekraft.user";

export class AuthManager {
  private _apiKey: string | null = null;
  private _userId: string | null = null;
  private _user: WekraftUser | null = null;

  private readonly _onAuthStateChanged =
    new vscode.EventEmitter<AuthState>();
  public readonly onAuthStateChanged = this._onAuthStateChanged.event;

  constructor(private readonly context: vscode.ExtensionContext) { }

  // ── Restore session on activation ────────────────────────

  async initialize(): Promise<void> {
    const [storedKey, storedUserId, storedUser] = await Promise.all([
      this.context.secrets.get(SECRET_API_KEY),
      Promise.resolve(
        this.context.globalState.get<string>(GLOBAL_USER_ID)
      ),
      Promise.resolve(
        this.context.globalState.get<WekraftUser>(GLOBAL_USER)
      ),
    ]);

    if (storedKey && storedUserId) {
      this._apiKey = storedKey;
      this._userId = storedUserId;
      this._user = storedUser ?? null;
      this._emit();
    }
  }

  // ── Getters ───────────────────────────────────────────────

  get isAuthenticated(): boolean {
    return !!this._apiKey;
  }

  /** Only used internally by ConvexClient — never sent to the webview. */
  get apiKey(): string | null {
    return this._apiKey;
  }

  get userId(): string | null {
    return this._userId;
  }

  get user(): WekraftUser | null {
    return this._user;
  }

  /** Safe snapshot for the webview — apiKey is intentionally omitted. */
  getAuthState(): AuthState {
    return {
      isAuthenticated: this.isAuthenticated,
      user: this._user,
    };
  }

  // ── Login (Step 1) ────────────────────────────────────────

  async initiateLogin(): Promise<void> {
    const webAppUrl = this._cfg("webAppUrl");
    // Dynamically get the IDE's scheme (e.g., 'vscode', 'vscode-insiders', 'antigravity')
    const uriScheme = vscode.env.uriScheme;
    // The callback_url tells the web app where to redirect after token creation.
    // Must match the URI scheme registered in package.json: wekraft.wekraft-vscode
    const callbackUrl = encodeURIComponent(
      `${uriScheme}://wekraft.wekraft-vscode/auth`
    );
    const loginUrl = `${webAppUrl}/extension?callback_url=${callbackUrl}`;

    await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
    vscode.window.showInformationMessage(
      "Wekraft: Browser opened — complete login in the web app."
    );
  }

  // ── Handle URI callback (Step 5–8) ───────────────────────

  /**
   * Called by the UriHandler in extension.ts when VS Code receives:
   *   vscode://wekraft.wekraft-vscode/auth?token=<hex>
   */
  async handleHandshakeCallback(token: string): Promise<void> {
    const HEX_TOKEN_RE = /^[0-9a-fA-F]{32,128}$/;
    if (!token || !HEX_TOKEN_RE.test(token)) {
      vscode.window.showErrorMessage("Wekraft: Invalid auth callback token format.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Wekraft: Completing sign-in…",
        cancellable: false,
      },
      async () => {
        try {
          const result = await this._exchangeToken(token);
          
          if (!result.user) {
            const siteUrl = this._cfg("convexSiteUrl");
            if (siteUrl) {
              // FIX-03: Add 15 s timeout to prevent the sign-in modal hanging forever
              const controller = new AbortController();
              const meTimeoutId = setTimeout(() => controller.abort(), 15_000);
              try {
                const meResponse = await fetch(`${siteUrl}/ext/me`, {
                  method: "GET",
                  headers: {
                    Authorization: `Bearer ${result.apiKey}`,
                    "X-Wekraft-Client": "vscode-extension/login",
                  },
                  signal: controller.signal,
                });
                if (meResponse.ok) {
                  const json = (await meResponse.json()) as {
                    id?: string;
                    name?: string;
                    avatarUrl?: string;
                    accountType?: string;
                  };
                  if (json && json.name) {
                    result.user = {
                      name: json.name,
                      avatarUrl: json.avatarUrl ?? "",
                      accountType: json.accountType || "free",
                    };
                  }
                }
              } catch (e) {
                const isTimeout = (e as any)?.name === "AbortError";
                console.error("[Wekraft] Failed to fetch user info on login:", isTimeout ? "timed out" : e);
              } finally {
                clearTimeout(meTimeoutId);
              }
            }
          }

          if (!result.user) {
            result.user = {
              name: "Wekraft User",
              avatarUrl: "",
              accountType: "free",
            };
          }

          await this._persistSession(result);
          vscode.window.showInformationMessage(
            `Wekraft: Welcome${this._user ? `, ${this._user.name}` : ""}! ✓`
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Wekraft: Sign-in failed — ${(err as Error).message}`
          );
        }
      }
    );
  }

  // ── Logout ────────────────────────────────────────────────

  async logout(): Promise<void> {
    await this.context.secrets.delete(SECRET_API_KEY);
    await this.context.globalState.update(GLOBAL_USER_ID, undefined);
    await this.context.globalState.update(GLOBAL_USER, undefined);
    this._apiKey = null;
    this._userId = null;
    this._user = null;
    this._emit();
    vscode.window.showInformationMessage("Wekraft: Signed out.");
  }

  // ── Private: Convex mutation via HTTP API ─────────────────

  /**
   * Calls the Convex mutation  extensions:exchangeHandshakeToken
   * using Convex's documented JSON HTTP API (no SDK required).
   *
   * POST https://<deployment>.convex.cloud/api/mutation
   * {
   *   "path": "extensions:exchangeHandshakeToken",
   *   "args": { "token": "<hex>" },
   *   "format": "json"
   * }
   *
   * The mutation on the Convex side MUST:
   *   1. Look up the token (by_token index — O(log N) at 100K users).
   *   2. Verify expiresAt > Date.now().
   *   3. DELETE the token in the same transaction (prevents replay attacks).
   *   4. Return { userId, apiKey }.
   */
  private async _exchangeToken(
    token: string
  ): Promise<HandshakeExchangeResult> {
    const convexUrl = this._cfg("convexUrl");

    // FIX-03: Abort if Convex takes longer than 15 s — prevents the sign-in modal hanging forever
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(`${convexUrl}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "apiKeys:exchangeHandshakeToken",
          args: { token },
          format: "json",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      // Convex HTTP API wraps the return value in { value: ... }
      const json = (await response.json()) as { value: HandshakeExchangeResult };

      if (!json.value?.userId || !json.value?.apiKey) {
        throw new Error("Invalid response from token exchange.");
      }

      return json.value;
    } catch (err) {
      const isTimeout = (err as any)?.name === "AbortError";
      if (isTimeout) {
        throw new Error("Sign-in timed out. Please check your connection and try again.");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async _persistSession(
    result: HandshakeExchangeResult
  ): Promise<void> {
    this._apiKey = result.apiKey;
    this._userId = result.userId;

    if (result.user) {
      this._user = {
        id: result.userId,
        name: result.user.name,
        email: "",
        avatarUrl: result.user.avatarUrl,
        accountType: result.user.accountType,
        role: "member"
      };
      await this.context.globalState.update(GLOBAL_USER, this._user);
    }

    // apiKey → SecretStorage (OS keychain, encrypted at rest)
    await this.context.secrets.store(SECRET_API_KEY, result.apiKey);
    // userId → globalState (non-sensitive, used for queries)
    await this.context.globalState.update(GLOBAL_USER_ID, result.userId);

    this._emit();
  }

  async updateUser(userUpdate: Partial<Omit<WekraftUser, "id">>): Promise<void> {
    if (!this._user) {
      this._user = { id: this._userId || "", name: "Unknown", email: "", accountType: "free", role: "member" };
    }
    this._user = { ...this._user, ...userUpdate };
    await this.context.globalState.update(GLOBAL_USER, this._user);
    this._emit();
  }

  private _emit(): void {
    this._onAuthStateChanged.fire(this.getAuthState());
  }

  private _cfg(key: string): string {
    // FIX-02: SECURITY — Read ONLY from user-level global configuration, never workspace.
    // A malicious .vscode/settings.json in an opened repo could otherwise redirect
    // API calls (including Bearer tokens) to an attacker-controlled server.
    // This mirrors the same pattern used in ConvexClient._getSiteUrl().
    const config = vscode.workspace.getConfiguration("wekraft");
    const inspected = config.inspect<string>(key);
    return inspected?.globalValue || inspected?.defaultValue || "";
  }

  dispose(): void {
    this._onAuthStateChanged.dispose();
  }
}
