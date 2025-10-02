import {
  Scene, AnimationGroup, Skeleton, Bone, PhysicsBody, Scalar, Vector3,
} from "@babylonjs/core";

type Locomotion = "idle" | "run" | "sprint" | "jumpUp" | "fall" | "land";

export type Animations = {
  locomotion: Record<Locomotion, AnimationGroup>;
  overlays?: Record<string, AnimationGroup>;
};

type FrameRange = readonly [number, number];
type AirPhase   = "jumpUp" | "fall" | "land";
type Looper     = "run"  | "sprint";
type LoopTails  = Partial<Record<Looper, FrameRange>>;

type AnimConfig = {
  // blending / fade
  fadeMs?: number;

  // movement → clip-speed scaling
  runSpeedScale?: number;
  sprintSpeedScale?: number;

  // debug/power hygiene
  autoPauseZeroWeightMs?: number;

  // authoring ↔ runtime conversion
  authoringFps?: number;
  groundLoops?: LoopTails;

  // air segmentation (Blender frames)
  airFrames?: Record<AirPhase, FrameRange>;
  airSpeeds?: Partial<Record<AirPhase, number>>;
};

export class AnimationController {
  // ----- state machine
  private target: Locomotion = "idle";
  private current: Locomotion = "idle";
  private _fadeTarget: Locomotion | null = null;
  private fadeT = 1;

  // one-frame guard for decide()
  private _lastDecideFrame = -1;

  // landing micro-state (timer-based; no overlays)
  private _landUntil = -1;          // ms timestamp when land ends
  private _leftGroundAt = -1;       // ms when we left ground (for micro-air hysteresis)
  private _groundSettleUntil = 0;   // treat as grounded during this window

  // inputs from the world
  private grounded = false;
  private horizSpeed = 0;
  private vertSpeed  = 0;
  private sprintRequested = false;

  // housekeeping
  private _lastWeight = new WeakMap<AnimationGroup, number>();
  private lastActive  = new WeakMap<AnimationGroup, number>();
  private applySub?: any;

  constructor(
    private scene: Scene,
    private animations: Animations,
    private body?: PhysicsBody,
    private cfg: AnimConfig = {}
  ) {
    // Start only IDLE as a looper upfront.
    //this.animations.locomotion.idle?.start(true);

    // Enable per-track blending for smoother fades.
    for (const g of Object.values(this.animations.locomotion)) {
      g?.targetedAnimations?.forEach(ta => {
        (ta.animation as any).enableBlending = true;
        (ta.animation as any).blendingSpeed  = 0.08;
      });
    }
    for (const g of Object.values(this.animations.overlays ?? {})) {
      g?.targetedAnimations?.forEach(ta => {
        (ta.animation as any).enableBlending = true;
        (ta.animation as any).blendingSpeed  = 0.08;
      });
    }

    // Optional global skeleton blending.
    this.findSkeleton()?.enableBlending(0.10);

    // Drive both decide() + apply() from here (once per render frame before animation step).
    this.applySub = this.scene.onBeforeAnimationsObservable.add(this.apply);
  }

  dispose() {
    if (this.applySub) this.scene.onBeforeAnimationsObservable.remove(this.applySub);
  }

  // ===== world feeds ==========================================================

  /** External: update grounded state. Tracks rising/falling edges for hysteresis. */
  setGrounded(v: boolean) {
    const was = this.grounded;
    this.grounded = v;

    // left ground → remember when (micro-air delay uses this)
    if (was && !v) {
        this._leftGroundAt = performance.now();
    }

    // touched ground → if we’re not already in “land”, kill air pose immediately
    if (!was && v && this.target !== "land") {
        this.animations.locomotion.jumpUp.setWeightForAllAnimatables(0);
        this.animations.locomotion.fall.setWeightForAllAnimatables(0);
    }
  }

  setVelocities(horiz: number, vert: number) {
    this.horizSpeed = horiz;
    this.vertSpeed  = vert;
  }
  setSprintRequested(v: boolean) { this.sprintRequested = v; }

  /** External: called once when you detect a legitimate landing in the controller. */
  notifyLanding(impactY: number) {
    const now = performance.now();

    // If we’re already landing (timer active), ignore any duplicate edges.
    if (this.target === "land" && this._landUntil > now) return;

    // Stop fall/jumpUp pose so land can play cleanly
    try { this.animations.locomotion.fall?.stop(); } catch (e) { /*best-effort*/ }
    try { this.animations.locomotion.jumpUp?.stop(); } catch (e) { /*best-effort*/ }
    this.findSkeleton()?.enableBlending(0.12);

    // Lock target to “land” for exactly len ms; also treat as grounded for a short settle.
    this._landUntil = now + 500;
    this._groundSettleUntil = Math.max(this._groundSettleUntil, now + 100);

    this._setTarget("land");
  }

  // ===== core loop ===========================================================

  private apply = () => {
    // Pull velocity from physics if a body was given.
    if (this.body) {
      const v = this.body.getLinearVelocity() ?? Vector3.Zero();
      this.horizSpeed = Math.hypot(v.x, v.z);
      this.vertSpeed  = v.y;
    }

    // Finish landing when its timer elapses (do this before decide()).
    const now = performance.now();
    if (this.target === "land" && this._landUntil > 0 && now >= this._landUntil) {
      this._finishLanding();
    }

    // Decide target exactly once per frame.
    const frame = this.scene.getFrameId();
    if (frame !== this._lastDecideFrame) {
      this._lastDecideFrame = frame;
      this.decide();
    }

    // Crossfade lerp.
    const dt = this.scene.getEngine().getDeltaTime();
    const fadeMs = this.cfg.fadeMs ?? 120;
    if (this.fadeT < 1) this.fadeT = Math.min(1, this.fadeT + dt / fadeMs);

    // Build weights for all logical states.
    const w: Record<Locomotion, number> =
      { idle:0, run:0, sprint:0, jumpUp:0, fall:0, land:0 };
    w[this.target]  = this.fadeT;
    w[this.current] = Math.max(w[this.current], 1 - this.fadeT);

    const landingActive = this.target === "land" || this.current === "land" || this._landUntil > 0;

    if (!(this.current === "jumpUp" || this.target === "jumpUp")) w.jumpUp = 0;
    if (!(this.current === "fall" || this.target === "fall")) w.fall = 0;
    // IMPORTANT: don't zero land if we're actually landing or finishing a land
    if (!(this.current === "land" || this.target === "land")) w.land = 0; // || this._landUntil > 0

    // When grounded, kill jump/fall *but* allow land to show during the landing window.
    if (this.grounded && !landingActive) {
        w.jumpUp = 0;
        w.fall = 0;
        w.land = 0; // safe to zero only when not landing
    }

    const write = (g: AnimationGroup | undefined, weight: number) => {
      if (!g) return;
      g.setWeightForAllAnimatables(weight);
      //if (this.isLooper(g) && weight > 0 && !g.isPlaying) g.start(true);
      this.autoSleep(g, weight);
    };

    for (const [name, g] of Object.entries(this.animations.locomotion)) {
        write(g, (w as any)[name]);
        this._lastWeight.set(g, (w as any)[name]);
    }

    // Update "current" when fade completes.
    if (this.fadeT === 1 && this._fadeTarget === this.target) {
      this.current = this.target;
      this._fadeTarget = null;
    }

    // Drive looper speed from movement (run/sprint only).
    if (this.current === "run" || this.current === "sprint") {
      const k = (this.current === "sprint")
        ? (this.cfg.sprintSpeedScale ?? 6.0)
        : (this.cfg.runSpeedScale    ?? 4.0);
      //console.log(k);
      this.animations.locomotion[this.current].speedRatio =
        Scalar.Clamp(this.horizSpeed / k, 0.6, 1.8);
      //console.log(this.animations.locomotion[this.current].speedRatio);
    }
  };

  // Decide the next target. While land is active, we do nothing (timer owns it).
  private decide() {
    if (this.target === "land" && this._landUntil > performance.now()) return;

    // “Soft grounded”: real grounded OR brief settle window after land.
    const softGrounded = this.grounded || performance.now() < this._groundSettleUntil;

    let next: Locomotion;

    if (!softGrounded) {
      // Micro-air hysteresis so tiny drops don’t flip-flop jump/fall immediately.
      const armDelayMs  = 60;
      const minAirSpeed = 0.8;
      const now         = performance.now();
      const airMs       = (this._leftGroundAt > 0) ? (now - this._leftGroundAt) : Infinity;

      if (airMs < armDelayMs && Math.abs(this.vertSpeed) < minAirSpeed) {
        next = (this.horizSpeed < 1.0)
          ? "idle"
          : (this.sprintRequested || this.horizSpeed >= (this.cfg.sprintSpeedScale ?? 6))
              ? "sprint" : "run";
      } else {
        next = (this.vertSpeed > 0) ? "jumpUp" : "fall";
      }
    } else {
      next = (this.horizSpeed < 1.0)
        ? "idle"
        : (this.sprintRequested || this.horizSpeed >= (this.cfg.sprintSpeedScale ?? 6))
            ? "sprint" : "run";
    }

    if (next !== this.target) this._setTarget(next);
  }

  // ===== helpers =============================================================

  private _setTarget(next: Locomotion) {
    if (this.target === next && this._fadeTarget === next) return;
    this.target = next;
    this._fadeTarget = next;
    this.fadeT = 0;


    if (next === "run" || next === "sprint") {
      this.startGroundLoopers();
    } else {
        this.stopGroundLoopers();
    }

    if (next === "idle") {
    const g = this.animations.locomotion.idle;
    if (g) {
      // speed can be 1 or taken from cfg if you want dynamic timing
      this.playRangeOrLoop(g, g.from, g.to, 1, true).catch(() => {});
    }
  }
    // Start separate air segments when entering air targets:
    if (next === "jumpUp") this.armAirPhase("jumpUp");
    else if (next === "fall") this.armAirPhase("fall");
    else if (next === "land") this.armAirPhase("land");
  }

  /** When “land” ends, choose idle/run/sprint; kill air; drop skeleton blend a bit. */
  private _finishLanding() {
    this._landUntil = -1;
    this.animations.locomotion.land.setWeightForAllAnimatables(0);
    this.findSkeleton()?.enableBlending(0.10);

    const next: Locomotion = (this.horizSpeed < 1.0)
      ? "idle"
      : (this.sprintRequested || this.horizSpeed >= (this.cfg.sprintSpeedScale ?? 6))
          ? "sprint" : "run";
    this._setTarget(next);
  }

  // ===== segments / loops ====================================================

  /**
 * Play a sub-range of an AnimationGroup and resolve when it finishes (or immediately if loop=true).
 * Uses the scene loop to detect completion (more deterministic for physics-driven code).
 *
 * - ag: AnimationGroup
 * - from,to: Babylon frame numbers (already converted via bl2bab)
 * - speed: playback speed
 * - loop: if true, start as a looping range and resolve immediately (you must stop it externally)
 * - timeoutMs: safety fallback if the group never stops
 */
    private playRangeOrLoop(
    ag: AnimationGroup,
    from: number,
    to: number,
    speed = 1,
    loop = false,
    timeoutMs = 3000
    ): Promise<void> {
        return new Promise((resolve) => {
            if (!ag) { resolve(); return; }

            // Ensure clean state
            try { ag.stop(); } catch (e) {}

            if (loop) {
              // If we want a looping animation, start and resolve immediately.
              try { ag.start(true, Math.abs(speed), from, to); ag.speedRatio = Math.abs(speed); } catch {}
              resolve();
              return;
            }

            // Start non-looping range.
            try { ag.start(false, Math.abs(speed), from, to); ag.speedRatio = Math.abs(speed); } catch {}

            const startTime = performance.now();
            let sub: any = null;

            const tick = () => {
              // Finished if group stopped playing
              if (!ag.isPlaying) {
                  try { ag.goToFrame(to); } catch (e) { }
                  try { ag.pause(); } catch (e) { }
                  if (sub) this.scene.onBeforeAnimationsObservable.remove(sub);
                  resolve();
                  return;
              }

              // Safety timeout
              if (performance.now() - startTime > timeoutMs) {
                  try { ag.goToFrame(to); } catch (e) { }
                  try { ag.pause(); } catch (e) { }
                  if (sub) this.scene.onBeforeAnimationsObservable.remove(sub);
                  resolve();
                  return;
              }
            };

            // Add tick to scene loop; will be removed in tick when finished.
            sub = this.scene.onBeforeAnimationsObservable.add(tick);
        });
    }

  private armAirPhase(phase: AirPhase) {
    // Map the phase to the already-split animation groups you exported.
    const g = (phase === "jumpUp") ? this.animations.locomotion.jumpUp
            : (phase === "fall") ? this.animations.locomotion.fall
            : this.animations.locomotion.land;

    if (!g) return;

    const speed = this.cfg.airSpeeds?.[phase] ?? 1.0;
    
    //const loopFall = false;
    // Behavior:
    // - jumpUp: play once and pause at end (hold apex)
    // - fall  : play once and pause at end until landing
    // - land  : play once (then _finishLanding controls next target)
    if (phase === "jumpUp") {
        // one-shot, hold at final frame
        this.playRangeOrLoop(g, g.from, g.to, speed).catch(() => {});
    } else if (phase === "fall") {
        // one-shot and pause at end (if you prefer to hold a pose)
        this.playRangeOrLoop(g, g.from, g.to, speed).catch(() => {});
    } else { // land
        // one-shot land
        this.playRangeOrLoop(g, g.from, g.to, speed)
        .then(() => {
        // When the animation truly completes, finish landing immediately (guard against duplicates)
        if (this._landUntil > 0) {
          this._finishLanding();
        }
      }).catch(() => {
        // fallback: if promise rejects, still ensure we clear via timer
        setTimeout(() => { if (this._landUntil > 0) this._finishLanding(); });
      });
    }
  }
    /** Start both run & sprint loops (so they can blend smoothly between each other). */
  private startGroundLoopers() {
    const runG = this.animations.locomotion.run;
    const sptG = this.animations.locomotion.sprint;

    const startOne = (g: AnimationGroup | undefined) => {
      if (!g) return;
      try {
        // Use configured tail range if present, otherwise play whole group
        const key = (g === runG) ? "run" : "sprint";
        const tail = this.cfg.groundLoops?.[key as "run" | "sprint"];
        let from: number, to: number;
        if (tail) {
          [from, to] = this.bl2bab(g, tail[0], tail[1], this.cfg.authoringFps ?? 24);
        } 
        // Start looping range and leave weight controlled externally
        g.start(true, g.speedRatio ?? 1, from, to);
        // Ensure it's running and not paused.
        g.speedRatio = g.speedRatio ?? 1;
        } catch (e) {
          // best-effort
          try { g.start(true); } catch { /* ignore */ }
        }
    };

    startOne(runG);
    startOne(sptG);
  }

  /** Stop both run & sprint loops. */
  private stopGroundLoopers() {
    try { this.animations.locomotion.run?.stop(); } catch {}
    try { this.animations.locomotion.sprint?.stop(); } catch {}
  }
  

  // ===== hygiene / utils =====================================================

  private autoSleep(group?: AnimationGroup, weight?: number) {
    if (!group) return;
    const idleMs = this.cfg.autoPauseZeroWeightMs ?? 0;
    if (idleMs <= 0) return;
    if (this.isLooper(group)) return; // never sleep loopers

    const now = performance.now();
    if ((weight ?? 0) > 0) {
      this.lastActive.set(group, now);
      return;
    }
    const last = this.lastActive.get(group) ?? now;
    if (now - last > idleMs && group.isPlaying) group.pause();
  }

  private isLooper(g?: AnimationGroup) {
    const L = this.animations.locomotion;
    return !!g && (g === L.run || g === L.sprint);
  }

  private findSkeleton(): Skeleton | undefined {
    const anyGroup = Object.values(this.animations.locomotion)[0];
    const a = anyGroup?.targetedAnimations?.[0];
    return a && a.target instanceof Bone ? a.target.getSkeleton() : undefined;
  }

  private fpsOf(g: AnimationGroup): number {
    return g?.targetedAnimations?.[0]?.animation?.framePerSecond ?? 60;
  }

  private firstFrameOf(g: AnimationGroup): number {
    const ta = g?.targetedAnimations?.[0]?.animation;
    const keys = ta?.getKeys() ?? [];
    return keys.length ? keys[0].frame : 0;
  }

  /** Map Blender frames → Babylon frames for this group (handles fps conversion). */
  private bl2bab(g: AnimationGroup, blFrom: number, blTo: number, blenderFps = this.cfg.authoringFps ?? 24): [number, number] {
    const babFps = this.fpsOf(g);       // e.g., 60 after import
    const offset = this.firstFrameOf(g); // usually 0, but don’t assume
    const scale  = babFps / blenderFps; // e.g., 60/24 = 2.5
    const from   = offset + blFrom * scale;
    const to     = offset + blTo   * scale;
    return [from, to];
  }

  // (optional) inspector
  inspect() {
    return {
      current: this.current, target: this.target, fadeT: this.fadeT,
      grounded: this.grounded,
      speeds: { horiz: this.horizSpeed, vert: this.vertSpeed },
      landMsLeft: Math.max(0, this._landUntil - performance.now()),
    };
  }
}
