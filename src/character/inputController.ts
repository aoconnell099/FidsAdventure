import { ActionManager, ExecuteCodeAction, Scene } from "@babylonjs/core"

export class InputController {

    public inputMap: any
    private _scene: Scene;

    public direction: number;
    public mvmtKeydown: boolean;

    // actions
    public sprinting: boolean;
    public jumpPressed: boolean;
    public idle: boolean;

    constructor(scene: Scene) {

        this._scene = scene;

        this._scene.actionManager = new ActionManager(this._scene);

        this.inputMap = {};
        this._scene.actionManager.registerAction(new ExecuteCodeAction(ActionManager.OnKeyDownTrigger, (evt) => {
            this.inputMap[evt.sourceEvent.key] = evt.sourceEvent.type == "keydown";
            this.inputMap[evt.sourceEvent.code] = evt.sourceEvent.type == "keydown";
        }));
        this._scene.actionManager.registerAction(new ExecuteCodeAction(ActionManager.OnKeyUpTrigger, (evt) => {
            this.inputMap[evt.sourceEvent.key] = evt.sourceEvent.type == "keydown";
            this.inputMap[evt.sourceEvent.code] = evt.sourceEvent.type == "keydown";
        }));

         //add to the scene an observable that calls updateFromKeyboard before rendering
        scene.onBeforeRenderObservable.add(() => {
            this._updateFromKeyboard();
        });

    }

    private _updateFromKeyboard(): void {

        if (this.inputMap["KeyW"] || this.inputMap["KeyS"] || this.inputMap["KeyA"] || this.inputMap["KeyD"]) {
            this.mvmtKeydown = true;
        }

        if (this.inputMap["KeyW"] && this.inputMap["KeyA"]) {
            this.direction = 7;
        }
        else if (this.inputMap["KeyW"] && this.inputMap["KeyD"]) {
            this.direction = 9;
        }
        else if (this.inputMap["KeyS"] && this.inputMap["KeyA"]) {
            this.direction = 1;
        }
        else if (this.inputMap["KeyS"] && this.inputMap["KeyD"]) {
            this.direction = 3;
        }
        else if (this.inputMap["KeyW"]) {
            this.direction = 8;
        }
        else if (this.inputMap["KeyA"]) {
            this.direction = 4;
        }
        else if (this.inputMap["KeyS"]) {
            this.direction = 2;
        }
        else if (this.inputMap["KeyD"]) {
            this.direction = 6;
        }
        else {
            //this.direction = 5;
            this.mvmtKeydown = false; 
            //this.idle = true;
        }

        // //dash
        // if ((this.inputMap["Shift"] || this._mobileDash) && !this._ui.gamePaused) {
        //     this.dashing = true;
        // } else {
        //     this.dashing = false;
        // }
        if (this.inputMap["Shift"]) {
            this.sprinting = true;
        } else {
            this.sprinting = false;
        }
        // //Jump Checks (SPACE)
        if ((this.inputMap[" "])) {
            this.jumpPressed = true;
        } else {
            this.jumpPressed = false;
        }
        
        //console.log(this.direction);
    }
}