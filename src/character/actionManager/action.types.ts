import { ACTIONS } from "./actions.config";

export type ActionName = keyof typeof ACTIONS;
export type ActionConfig = (typeof ACTIONS)[ActionName];
export type ActionCategory = typeof ACTIONS[ActionName]["category"]; // "locomotion" | "combat" | "interaction" | "posture" | "default"