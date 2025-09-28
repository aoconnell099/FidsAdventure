import { Scene, Vector3, Color3, MeshBuilder, LinesMesh } from "@babylonjs/core";

type Glyph = { mesh: LinesMesh; dieAt: number };

export class DebugDraw {
  private glyphs: Glyph[] = [];
  constructor(private scene: Scene) {
    scene.onBeforeRenderObservable.add(() => this.tick());
  }

  /** Draw a line (useful for rays) */
  line(from: Vector3, to: Vector3, color = Color3.Yellow(), ttlMs = 300) {
    const mesh = MeshBuilder.CreateLines("dbgLine", { points: [from, to] }, this.scene);
    mesh.color = color;
    mesh.isPickable = false;
    this.glyphs.push({ mesh, dieAt: performance.now() + ttlMs });
    return mesh;
  }

  /** Draw an arrow (contact normals, velocities, etc.) */
  arrow(origin: Vector3, dir: Vector3, len = 0.6, color = Color3.Green(), ttlMs = 400) {
    const end = origin.add(dir.normalize().scale(len));
    // shaft
    const shaft = this.line(origin, end, color, ttlMs);
    // simple head (a V)
    const side = dir.normalize();
    const left = Vector3.Cross(side, Vector3.Up()).normalize().scale(len * 0.15);
    const right = left.scale(-1);
    this.line(end, end.add(left), color, ttlMs);
    this.line(end, end.add(right), color, ttlMs);
    return shaft;
  }

  private tick() {
    const now = performance.now();
    this.glyphs = this.glyphs.filter(g => {
      if (now >= g.dieAt) { g.mesh.dispose(); return false; }
      return true;
    });
  }
}