import { Action } from "@babylonjs/core";
import { ActionDef, ACTIONS } from "./actions.config";
import { ActionCategory, ActionName } from "./action.types";
import { Debug, DebugFlag } from "../../debug/debug";

interface IActionState {
  bufferedUntil: number;
  cooldownUntil: number;
  lockoutUntil: number;
}

export class CustomActionManager {
  private states = new Map<ActionName, IActionState>();

  // Policy layers
  private categoryCooldownUntil = new Map<string, number>(); // e.g., "combat" → t
  private categoryLockUntil     = new Map<string, number>(); // e.g., "posture" → t
  private groupCooldownUntil    = new Map<string, number>(); // e.g., "movement" → t
  private globalCooldownUntil   = -Infinity;

  constructor(private now = () => performance.now()) {}

  add(action: ActionName | ActionName[]) {
    const addOne = (a: ActionName) =>
      this.states.set(a, { bufferedUntil: -1, cooldownUntil: -1, lockoutUntil: -1 });

    Array.isArray(action) ? action.forEach(addOne) : addOne(action);
    return this;
  }

  /** Check if a cooldown exists, and check if it has passed. Return true if no cooldown */
  private ready(t: number, until?: number) {
    return t >= (until ?? Number.NEGATIVE_INFINITY);
  }

  /**  Return action category or normalize missing category to a stable default key */
  private catKey(cfg: ActionDef) {
    return (cfg.category ?? "default") as string;
  }

  /** Set buffer to prevent double press */
  request(action: ActionName, bufferMs = ACTIONS[action].buffer ?? 0) {
    const s = this.states.get(action);
    if (!s) return;
    const t = this.now();
    s.bufferedUntil = Math.max(s.bufferedUntil, t + bufferMs);
  }

  can(action: ActionName) {
    const s = this.states.get(action);
    if (!s) return false;

    const t   = this.now();
    const cfg = ACTIONS[action] as ActionDef;

    const cat = this.catKey(cfg);

    // Category gates
    const catCdOk   = this.ready(t, this.categoryCooldownUntil.get(cat));
    const catLockOk = this.ready(t, this.categoryLockUntil.get(cat));

    // Shared cooldown group (optional)
    const gcdOk = !cfg.gcdGroup || this.ready(t, this.groupCooldownUntil.get(cfg.gcdGroup));

    // Global cooldown (optional)
    const globalOk = this.ready(t, this.globalCooldownUntil);

    return (
      t < (s.bufferedUntil ?? Number.POSITIVE_INFINITY) &&
      this.ready(t, s.cooldownUntil) &&
      this.ready(t, s.lockoutUntil) &&
      catCdOk && catLockOk && gcdOk && globalOk
    );
  }

  trigger(
    action: ActionName,
    opts?: Partial<{
      cooldown: number;
      lockout: number;
      categoryLockMs: number;
      categoryCooldownMs: number;
      gcdMs: number;
      globalCdMs: number;
    }>
  ) {
    const t   = this.now();
    const cfg = ACTIONS[action] as ActionDef;
    const s   = this.states.get(action);
    if (!s) return;

    const cooldown = opts?.cooldown ?? cfg.cooldown ?? 0;
    const lockout  = opts?.lockout  ?? cfg.lockout  ?? 0;

    // consume buffer + start per-action timers
    s.bufferedUntil = -1;
    s.cooldownUntil = t + cooldown;
    s.lockoutUntil  = t + lockout;

    const cat = this.catKey(cfg);

    // optional: category lock / cooldown
    if (opts?.categoryLockMs) {
      const until = t + opts.categoryLockMs;
      this.categoryLockUntil.set(cat, Math.max(this.categoryLockUntil.get(cat) ?? -Infinity, until));
    }
    if (opts?.categoryCooldownMs) {
      const until = t + opts.categoryCooldownMs;
      this.categoryCooldownUntil.set(cat, Math.max(this.categoryCooldownUntil.get(cat) ?? -Infinity, until));
    }

    // optional: shared group GCD
    if (cfg.gcdGroup && opts?.gcdMs) {
      const until = t + opts.gcdMs;
      this.groupCooldownUntil.set(cfg.gcdGroup, Math.max(this.groupCooldownUntil.get(cfg.gcdGroup) ?? -Infinity, until));
    }

    // optional: global cooldown
    if (opts?.globalCdMs) {
      this.globalCooldownUntil = Math.max(this.globalCooldownUntil ?? -Infinity, t + opts.globalCdMs);
    }
  }

  // Convenience helpers (for external systems)
  lockOthers(actions: ActionName[], ms: number) {
    const t = this.now();
    for (const a of actions) this.states.get(a)!.lockoutUntil = Math.max(this.states.get(a)!.lockoutUntil, t + ms);
  }
  
  lockCategory(cat: string, ms: number) {
    const t = this.now();
    const until = t + ms;
    this.categoryLockUntil.set(cat, Math.max(this.categoryLockUntil.get(cat) ?? -Infinity, until));
  }
  setCategoryCooldown(cat: string, ms: number) {
    const t = this.now();
    const until = t + ms;
    this.categoryCooldownUntil.set(cat, Math.max(this.categoryCooldownUntil.get(cat) ?? -Infinity, until));
  }

  /** Try to perform action; if allowed, run fn and start timers. */
  tryPerform(
    action: ActionName,
    fn: () => void,
    opts?: Partial<{
      cooldown: number;
      lockout: number;
      categoryLockMs: number;
      categoryCooldownMs: number;
      gcdMs: number;
      globalCdMs: number;
    }>
  ) {
    if (!this.can(action)) return false;
    fn();
    this.trigger(action, opts);
    return true;
  }

    /** Debug/UI helper */
  remaining(action: ActionName) {
    const s = this.states.get(action);
    if (!s) return { buffer: 0, cooldown: 0, lockout: 0 };
    const t = this.now();
    return {
      buffer:   Math.max(0, (s.bufferedUntil ?? -Infinity) - t),
      cooldown: Math.max(0, (s.cooldownUntil ?? -Infinity) - t),
      lockout:  Math.max(0, (s.lockoutUntil  ?? -Infinity) - t),
    };
  }

  inspect() {
    const t = this.now();
    return {
      global: this.globalCooldownUntil - t,
      categories: Object.fromEntries([...this["categoryCooldownUntil"].entries()]
                      .map(([k,v]) => [k, v - t])),
      locks: Object.fromEntries([...this["categoryLockUntil"].entries()]
                      .map(([k,v]) => [k, v - t])),
      groups: Object.fromEntries([...this["groupCooldownUntil"].entries()]
                      .map(([k,v]) => [k, v - t])),
      actions: [...this["states"].entries()].map(([name, s]) => ({
        name,
        buffer: s.bufferedUntil - t,
        cooldown: s.cooldownUntil - t,
        lockout: s.lockoutUntil - t,
      })),
    };
  }
}
/* USAGE
// input
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") actions.request("jump");
  if (e.code === "ShiftLeft") actions.request("dash");
});

// frame/update (e.g., in onBeforePhysicsObservable)
if (actions.tryPerform("jump", () => {
  // set Y velocity / apply impulse here
})) {
  // optional: prevent dash for 120ms after jump
  // actions.trigger("dash", { lockout: 120 });
}

actions.tryPerform("dash", () => {
  // apply dash impulse/velocity here
});
*/