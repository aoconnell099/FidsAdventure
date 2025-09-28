import { ActionName } from "./action.types";

export type ActionDef = {
  category?: "locomotion" | "combat" | "interaction" | "posture" | "default";
  buffer?: number;
  cooldown?: number;
  lockout?: number;
  gcdGroup?: string;          // optional shared cooldown group
  requiresGrounded?: boolean; // optional gate
  lockGroup?: string;
};

type ActionMap = Record<string, ActionDef>;

export const ACTIONS = { 
      // Locomotion (grounded movement)
  jump:   { category: "locomotion", buffer: 120, cooldown: 200, lockout: 100, gcdGroup: "movement", requiresGrounded: true },
  dash:   { category: "locomotion", buffer: 120, cooldown: 800, lockout: 150, gcdGroup: "movement" },

  // Combat / interaction
  attack: { category: "combat",     buffer: 120, cooldown: 500, lockout: 200 },
  pickUp: { category: "interaction",buffer: 120, cooldown: 500, lockout: 200, requiresGrounded: true },

  // Posture (mutually exclusive, usually full-body)
  sit:    { category: "posture",    buffer: 120, cooldown: 300, lockout: 150, lockGroup: "posture" },
  stand:  { category: "posture",    buffer: 120, cooldown: 300, lockout: 150, lockGroup: "posture" },
} as const satisfies ActionMap;

