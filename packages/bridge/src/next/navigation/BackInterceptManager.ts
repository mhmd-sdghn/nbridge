const TRAP_STATE_KEY = "__backInterceptTrap";
const GLOBAL_PATH = "*";

/**
 * Which page an intercept belongs to.
 *
 * - `"*"` — every page.
 * - a string — exactly that app path, e.g. `"/point-info-form"`. Compared
 *   without the configured `basePath`, ignoring a trailing slash, so it is the
 *   same value `usePathname()` returns (with or without `trailingSlash`).
 * - a `RegExp` — tested against that same normalised app path.
 */
export type BackInterceptPath = string | RegExp;

export interface BackInterceptConfig {
  /**
   * The Next.js `basePath` the app is served under (e.g. `"/add-point"`).
   * Stripped from `window.location.pathname` before matching, so paths can be
   * written the way the app sees them.
   */
  basePath?: string;
}

interface InterceptEntry {
  id: string;
  onBackCallback: () => void;
  path: BackInterceptPath;
  isActive: boolean;
  /** Monotonic registration order, for LIFO selection. */
  order: number;
}

/** Leading slash, no trailing slash (except the root itself). */
function normalizePath(path: string): string {
  const withLead = path.startsWith("/") ? path : `/${path}`;
  const trimmed = withLead.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

class BackInterceptManager {
  private static instance: BackInterceptManager | null = null;
  private entries: InterceptEntry[] = [];
  private counter = 0;
  private basePath = "";
  private popstateHandler: (() => void) | null = null;
  /**
   * True while a `history.back()` issued by the manager to release a trap
   * entry has not landed yet. `history.back()` is asynchronous, so an
   * unregister→register cycle within the same tick (React StrictMode's dev
   * remount, effect-deps churn) would otherwise let the in-flight pop be
   * mistaken for a real user back press.
   */
  private selfPopInFlight = false;
  /** True while `backPastTrap()`'s traversal has not landed yet. */
  private leaveInFlight = false;
  /**
   * How many trap entries may still sit in session history, per URL. A trap is
   * pushed with the URL of the page under it, so a popstate that lands on a
   * non-trap entry with a counted URL is the user stepping back off a trap.
   * Any other popstate (a forward press, a back press between two real pages)
   * is not ours to handle. It also lets a trap left behind on a page the user
   * moved on from be recognised and skipped when they come back to it.
   */
  private trapCounts = new Map<string, number>();

  private constructor() {}

  static getInstance(): BackInterceptManager {
    if (!BackInterceptManager.instance) {
      BackInterceptManager.instance = new BackInterceptManager();
    }
    return BackInterceptManager.instance;
  }

  configure(config: BackInterceptConfig): void {
    if (config.basePath !== undefined) {
      const base = normalizePath(config.basePath);
      this.basePath = base === "/" ? "" : base;
    }
  }

  register(
    onBackCallback: () => void,
    path: BackInterceptPath = GLOBAL_PATH,
    isActive = true,
  ): string {
    if (typeof window === "undefined") return "";

    const id = this.generateId();
    this.entries.push({
      id,
      onBackCallback,
      path,
      isActive,
      order: this.counter,
    });
    this.syncTrap();
    return id;
  }

  unregister(id: string): void {
    if (typeof window === "undefined") return;
    this.entries = this.entries.filter((e) => e.id !== id);
    this.syncTrap();
  }

  update(
    id: string,
    patch: { isActive?: boolean; onBackCallback?: () => void },
  ): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    if (patch.isActive !== undefined) entry.isActive = patch.isActive;
    if (patch.onBackCallback !== undefined)
      entry.onBackCallback = patch.onBackCallback;
    this.syncTrap();
  }

  /**
   * Steps back off the current page for an in-app back button. When a trap
   * sits on top, a plain `history.back()` would only pop the trap and leave the
   * user on the same page, so this goes back past it instead.
   *
   * @returns `true` when it navigated; `false` when there is no trap on top and
   *   the caller should use its normal back (e.g. `router.back()`).
   */
  backPastTrap(): boolean {
    if (typeof window === "undefined" || !this.isTrapEntry()) return false;
    this.releaseTrapCount(window.location.href);
    this.leaveInFlight = true;
    window.history.go(-2);
    return true;
  }

  resetForTests(): void {
    this.teardownListener();
    this.entries = [];
    this.counter = 0;
    this.basePath = "";
    this.selfPopInFlight = false;
    this.leaveInFlight = false;
    this.trapCounts.clear();
  }

  private generateId(): string {
    return `intercept_${++this.counter}`;
  }

  /** The current pathname as the app sees it: no basePath, normalised. */
  private appPath(): string {
    let path = window.location.pathname;
    const base = this.basePath;
    if (base && (path === base || path.startsWith(`${base}/`))) {
      path = path.slice(base.length);
    }
    return normalizePath(path);
  }

  private pathMatches(path: BackInterceptPath, appPath: string): boolean {
    if (path === GLOBAL_PATH) return true;
    if (path instanceof RegExp) {
      path.lastIndex = 0; // a `g`/`y` flag would make test() stateful
      return path.test(appPath);
    }
    return normalizePath(path) === appPath;
  }

  /**
   * The active entry that should fire on the current page: among all matching
   * entries, the most recently registered wins (true LIFO, so a dialog's global
   * intercept registered after a page's intercept fires first).
   */
  private findBestActiveEntry(): InterceptEntry | undefined {
    const appPath = this.appPath();
    let best: InterceptEntry | undefined;
    for (const entry of this.entries) {
      if (!entry.isActive || !this.pathMatches(entry.path, appPath)) continue;
      if (!best || entry.order > best.order) best = entry;
    }
    return best;
  }

  private hasAnyActiveIntercept(): boolean {
    return this.entries.some((e) => e.isActive);
  }

  private isTrapEntry(): boolean {
    return !!window.history.state?.[TRAP_STATE_KEY];
  }

  private hasTrapAt(href: string): boolean {
    return (this.trapCounts.get(href) ?? 0) > 0;
  }

  private releaseTrapCount(href: string): void {
    const count = this.trapCounts.get(href) ?? 0;
    if (count <= 1) this.trapCounts.delete(href);
    else this.trapCounts.set(href, count - 1);
  }

  private pushTrap(): void {
    // Bypass Next.js's monkey-patched pushState and merge with current state
    // so the real page entry (behind the trap) keeps its original Next.js state.
    const currentState = window.history.state ?? {};
    History.prototype.pushState.call(
      window.history,
      { ...currentState, [TRAP_STATE_KEY]: true },
      "",
    );
    const href = window.location.href;
    this.trapCounts.set(href, (this.trapCounts.get(href) ?? 0) + 1);
  }

  private setupListener(): void {
    const handler = () => this.handlePopstate();
    window.addEventListener("popstate", handler);
    this.popstateHandler = handler;
  }

  private teardownListener(): void {
    if (this.popstateHandler) {
      window.removeEventListener("popstate", this.popstateHandler);
      this.popstateHandler = null;
    }
  }

  /** Pops the trap entry we are on; see `selfPopInFlight`. */
  private popTrapSilently(): void {
    this.releaseTrapCount(window.location.href);
    // Only a delivered popstate can consume the flag; without a listener the
    // pop lands unobserved and cannot be mistaken for a user press anyway.
    if (this.popstateHandler) {
      this.selfPopInFlight = true;
    }
    window.history.back();
  }

  private ensureTrap(): void {
    if (!this.popstateHandler) {
      this.setupListener();
    }
    // With a self-pop in flight we are still on the trap entry — keep it;
    // handlePopstate re-pushes after the pop lands.
    if (!this.isTrapEntry()) {
      this.pushTrap();
    }
  }

  private teardownTrap(): void {
    if (this.selfPopInFlight || this.leaveInFlight) return; // landing re-syncs
    if (this.isTrapEntry()) {
      // Keep the listener attached — it must consume the self-pop's popstate.
      this.popTrapSilently();
      return;
    }
    // A trap may still sit further back in history (the user moved on from
    // the page it guarded). Keep listening so it can be skipped on return.
    if (this.trapCounts.size === 0) {
      this.teardownListener();
    }
  }

  private syncTrap(): void {
    if (this.hasAnyActiveIntercept()) {
      this.ensureTrap();
    } else {
      this.teardownTrap();
    }
  }

  private handlePopstate(): void {
    if (this.selfPopInFlight || this.leaveInFlight) {
      // Our own traversal landing — not a user press.
      this.selfPopInFlight = false;
      this.leaveInFlight = false;
      this.syncTrap();
      return;
    }

    const href = window.location.href;

    if (this.isTrapEntry()) {
      // Landed on a trap entry. While an intercept guards this page it stays
      // armed; otherwise it is left over from an earlier visit and would cost
      // the user a press that visibly does nothing, so step past it.
      if (!this.findBestActiveEntry()) {
        this.popTrapSilently();
      }
      return;
    }

    if (!this.hasTrapAt(href)) {
      // Not a step back off one of our traps (a forward press, or a back press
      // between two real pages) — nothing to intercept.
      this.syncTrap();
      return;
    }

    // Pressed back FROM the trap entry to the real page under it. That trap is
    // now forward history, discarded by the next push.
    this.releaseTrapCount(href);
    const entry = this.findBestActiveEntry();

    if (entry) {
      // Re-push the trap to keep intercepting future presses, then fire.
      this.pushTrap();
      entry.onBackCallback();
      this.syncTrap();
      return;
    }

    // Intercepts are active, but none for this page (e.g. one armed from a
    // persistent layout for another route). Do not swallow the press: the trap
    // ate it, so complete the user's back intent.
    this.leaveInFlight = true;
    window.history.back();
  }
}

export { BackInterceptManager };
