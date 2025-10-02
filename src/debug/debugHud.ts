import { AdvancedDynamicTexture, TextBlock, Control } from "@babylonjs/gui";

export class DebugHUD {
  private ui = AdvancedDynamicTexture.CreateFullscreenUI("dbgUI");
  private text = new TextBlock("dbgTxt", "");
  private providers: Array<() => string> = [];

  constructor() {
    const UI_MASK = 0x10000000;
    this.text.fontSize = 12;
    this.text.color = "white";
    this.text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.text.textVerticalAlignment   = Control.VERTICAL_ALIGNMENT_TOP;
    this.text.paddingLeft = "8px";
    this.text.paddingTop  = "8px";
    this.ui.layer.layerMask = UI_MASK;
    this.ui.addControl(this.text);
  }

  addProvider(fn: () => string) { this.providers.push(fn); }

  tick() {
    this.text.text = this.providers.map((p) => p()).join("\n");
  }
}