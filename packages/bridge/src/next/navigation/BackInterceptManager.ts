const TRAP_STATE_KEY = "__backInterceptTrap";
const GLOBAL_PATH = "*";

interface InterceptEntry {
  id: string;
  onBackCallback: () => void;
  pathName: string;
  isActive: boolean;
  /** Monotonic registration order, for cross-stack LIFO selection. */
  order: number;
}

class BackInterceptManager {
  private static instance: BackInterceptManager | null = null;
  private stacks: Map<string, InterceptEntry[]> = new Map();
  private counter = 0;
  private popstateHandler: (() => void) | null = null;
  /**
   * True while a `history.back()` issued by the manager itself (to release
   * the trap entry) has not landed yet. `history.back()` is asynchronous, so
   * an unregister→register cycle within the same tick (React StrictMode's dev
   * remount, or effect-deps churn) would otherwise let the in-flight pop be
   * mistaken for a real user back press and misfire the intercept callback.
   * At most one self-pop is ever outstanding; handlePopstate consumes it.
   */
  private selfPopInFlight = false;

  private constructor() {}

  static getInstance(): BackInterceptManager {
    if (!BackInterceptManager.instance) {
      BackInterceptManager.instance = new BackInterceptManager();
    }
    return BackInterceptManager.instance;
  }

  register(
    onBackCallback: () => void,
    pathName = GLOBAL_PATH,
    isActive = true,
  ): string {
    if (typeof window === "undefined") return "";

    const id = this.generateId();
    const stack = this.stacks.get(pathName) ?? [];
    stack.push({
      id,
      onBackCallback,
      pathName,
      isActive,
      order: ++this.counter,
    });
    this.stacks.set(pathName, stack);
    this.syncTrap();
    return id;
  }

  unregister(id: string): void {
    if (typeof window === "undefined") return;
    this.removeEntry(id);
    this.syncTrap();
  }

  update(
    id: string,
    patch: { isActive?: boolean; onBackCallback?: () => void },
  ): void {
    for (const stack of this.stacks.values()) {
      const entry = stack.find((e) => e.id === id);
      if (entry) {
        if (patch.isActive !== undefined) entry.isActive = patch.isActive;
        if (patch.onBackCallback !== undefined)
          entry.onBackCallback = patch.onBackCallback;
        this.syncTrap();
        return;
      }
    }
  }

  resetForTests(): void {
    this.teardownListener();
    this.stacks.clear();
    this.counter = 0;
    this.selfPopInFlight = false;
  }

  private generateId(): string {
    return `intercept_${++this.counter}`;
  }

  private removeEntry(id: string): InterceptEntry | undefined {
    for (const [path, stack] of this.stacks.entries()) {
      const index = stack.findIndex((e) => e.id === id);
      if (index !== -1) {
        const [removed] = stack.splice(index, 1);
        if (stack.length === 0) {
          this.stacks.delete(path);
        }
        return removed;
      }
    }
    return undefined;
  }

  private pathMatches(path: string, currentPath: string): boolean {
    if (path === GLOBAL_PATH) return true;
    return currentPath === path || currentPath.endsWith(`/${path}`);
  }

  /**
   * Finds the active entry that should fire for the current pathname.
   *
   * Path-specific entries match when:
   *   - pathName equals the full pathname exactly  ("/add-point/point-info-form")
   *   - OR pathname ends with "/pathName"          ("point-info-form")
   * Global ("*") entries always match.
   *
   * Among ALL matching entries (path-scoped and global together), the one with
   * the highest registration order wins, giving true LIFO: a dialog's global
   * intercept registered after a page's scoped intercept fires first.
   */
  private findBestActiveEntry(currentPath: string): InterceptEntry | undefined {
    let best: InterceptEntry | undefined;
    for (const [path, stack] of this.stacks.entries()) {
      if (!this.pathMatches(path, currentPath)) continue;
      for (const entry of stack) {
        if (entry.isActive && (!best || entry.order > best.order)) {
          best = entry;
        }
      }
    }
    return best;
  }

  private hasAnyActiveIntercept(): boolean {
    for (const stack of this.stacks.values()) {
      for (const entry of stack) {
        if (entry.isActive) return true;
      }
    }
    return false;
  }

  private isTrapEntry(): boolean {
    return !!window.history.state?.[TRAP_STATE_KEY];
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

  /** Pops the trap entry; see `selfPopInFlight`. */
  private popTrapSilently(): void {
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
    if (this.selfPopInFlight) return; // the pop's landing re-syncs the trap
    if (this.isTrapEntry()) {
      // Keep the listener attached — it must consume the self-pop's popstate.
      this.popTrapSilently();
      return;
    }
    this.teardownListener();
  }

  private syncTrap(): void {
    const hasActive = this.hasAnyActiveIntercept();
    if (hasActive) {
      this.ensureTrap();
    } else {
      this.teardownTrap();
    }
  }

  private handlePopstate(): void {
    if (this.selfPopInFlight) {
      // Our own trap-release back() landing — not a user back press.
      this.selfPopInFlight = false;
      this.syncTrap();
      return;
    }

    const currentPath = window.location.pathname;
    const isTrap = this.isTrapEntry();

    if (isTrap) return;

    // Pressed back FROM the trap entry to the real page.
    const entry = this.findBestActiveEntry(currentPath);

    if (entry) {
      // Re-push the trap to keep intercepting future presses, then fire.
      this.pushTrap();
      entry.onBackCallback();
      this.syncTrap();
      return;
    }

    // Active intercepts exist, but none match the CURRENT path (e.g. a
    // path-scoped intercept armed from a persistent layout while the user is on
    // a different page). Do NOT re-push the trap and do NOT swallow the press:
    // complete the user's original back intent. Tear the listener down first so
    // the resulting popstate is not misread; syncTrap re-arms on the next
    // (re)registration.
    this.teardownListener();
    window.history.back();
  }
}

export { BackInterceptManager };
