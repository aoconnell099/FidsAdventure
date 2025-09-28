import { ANIM } from "./animations.config";

export type GroundLocomotion = keyof typeof ANIM.locomotion; // "idle" | "run" | ...
export type WaterLocomotion  = keyof typeof ANIM.water;      // "tread" | "swim"
export type OverlayName      = keyof typeof ANIM.overlays;   // "standUp" | "sitDown" | "fish"