const TRAP_STATE_KEY = "__backInterceptTrap";
const GLOBAL_PATH = "*";

interface InterceptEntry {
  id: string;
  onBackCallback: () => void;
  pathName: string;
  isActive: boolean;
}

class BackInterceptManager {
  private static instance: BackInterceptManager | null = null;
  private stacks: Map<string, InterceptEntry[]> = new Map();
  private counter = 0;
  private popstateHandler: (() => void) | null = null;

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
    stack.push({ id, onBackCallback, pathName, isActive });
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

  private findTopActiveFor(path: string): InterceptEntry | undefined {
    const stack = this.stacks.get(path);
    if (!stack) return undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      if (entry?.isActive) return entry;
    }
    return undefined;
  }

  /**
   * Finds the top active entry for the current pathname.
   *
   * Path-specific entries match when:
   *   - pathName equals the full pathname exactly  ("/add-point/point-info-form")
   *   - OR pathname ends with "/pathName"          ("point-info-form")
   *
   * Falls back to the global ("*") stack if no path-specific match is found.
   */
  private findBestActiveEntry(currentPath: string): InterceptEntry | undefined {
    for (const [path, stack] of this.stacks.entries()) {
      if (path === GLOBAL_PATH) continue;
      const matches = currentPath === path || currentPath.endsWith(`/${path}`);
      if (!matches) continue;
      for (let i = stack.length - 1; i >= 0; i--) {
        const entry = stack[i];
        if (entry?.isActive) return entry;
      }
    }
    return this.findTopActiveFor(GLOBAL_PATH);
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

  private ensureTrap(): void {
    if (!this.popstateHandler) {
      this.setupListener();
    }
    if (!this.isTrapEntry()) {
      this.pushTrap();
    }
  }

  private teardownTrap(): void {
    this.teardownListener();
    if (this.isTrapEntry()) {
      window.history.back();
    }
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
    const currentPath = window.location.pathname;
    const isTrap = this.isTrapEntry();

    if (isTrap) return;

    // Pressed back FROM the trap entry to the real page.
    // Re-push trap to keep intercepting future presses.
    this.pushTrap();

    const entry = this.findBestActiveEntry(currentPath);

    if (entry) {
      entry.onBackCallback();
      this.syncTrap();
      return;
    }

    // No active intercept found — remove listener first to prevent loop,
    // then pop the trap we just pushed so natural navigation proceeds.
    this.teardownListener();
    window.history.back();
  }
}

export { BackInterceptManager };
export const backInterceptManager = BackInterceptManager.getInstance;
