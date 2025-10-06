export const ANIM = {
  // ground locomotion
  locomotion: {
    idle:   "idle",
    run:    "run",
    sprint: "sprint",
    jumpUp:   "jumpUp",
    fall:   "fall",
    land: "land", // add later if you author one
  },

  // water locomotion
  water: {
    tread: "tread", // in-water idle
    swim:  "swim",  // in-water moving
  },

  // one-shots / overlays (triggered)
  overlays: {
    standUp: "standUp", // one-shot
    sitDown: "sitDown", // one-shot
    fish:    "fish",    // loop or one-shot; likely upper-body overlay
  },
} as const;

export const ANIM_CONFIG = {
  fadeMs: 120,

  // thresholds (world-units/s)
  // runThreshold: 1.0,
  // sprintThreshold: 4.0,

  // speed-to-clip ratio scaling
  runSpeedScale: 3.3,    // horiz speed / 4 → 1.0x run cycle
  sprintSpeedScale: 4.8, // horiz speed / 6 → 1.0x sprint cycle

  overlayDefaults: { len: 450, inMs: 80, outMs: 120 },
  autoPauseZeroWeightMs: 600, //600,
  authoringFps: 24,

  groundLoops: {
    run: [11, 30],
    sprint: [7, 19],
  },
  groundLoopSecs: {
    run:    [11/24, 30/24], // [0.459, 1.25]     
    sprint: [ 7/24, 19/24], // [0.292, 0.792]  
  },

  airSpeeds: {
    jumpUp: 1.5, // default 2.2
    fall: 1.5, // default 1.5
    land: 1.8 // default 1.0
  }
} as const;
