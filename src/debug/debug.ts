export enum DebugFlag {
  Physics    = 1 << 0,
  Collisions = 1 << 1,
  Normals    = 1 << 2,
  Raycasts   = 1 << 3,
  Actions    = 1 << 4,
  Anim       = 1 << 5,
  Input      = 1 << 6,
  Perf       = 1 << 7,
}

export class Debug {
  static flags = 0;
  static on(f: DebugFlag)      { this.flags |=  f; }
  static off(f: DebugFlag)     { this.flags &= ~f; }
  static toggle(f: DebugFlag)  { this.flags ^=  f; }
  static has(f: DebugFlag)     { return (this.flags & f) !== 0; }
  static log(f: DebugFlag, ...args: any[]) { if (this.has(f)) console.log(...args); }

  // nice colored tag
  static tag(name: string, color = "#09f") {
    return [`%c${name}`, `color:${color};font-weight:600;`];
  }
}