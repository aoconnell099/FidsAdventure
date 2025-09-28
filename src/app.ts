import "@babylonjs/core/Debug/debugLayer";
import "@babylonjs/inspector";
import "@babylonjs/loaders/glTF";
import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, Mesh, MeshBuilder, FreeCamera, Color4, SceneLoader, PhysicsImpostor, ImportMeshAsync, AbstractMesh, LoadAssetContainerAsync, ShadowGenerator, AxesViewer } from "@babylonjs/core";
import { AdvancedDynamicTexture, Button, Control } from "@babylonjs/gui";
import HavokPhysics, { HavokPhysicsWithBindings } from "@babylonjs/havok";
import { PhysicsAggregate, HavokPlugin, PhysicsMotionType, PhysicsBody, PhysicsShapeMesh, PhysicsShapeCapsule, PhysicsShapeSphere, PhysicsShapeType } from "@babylonjs/core/Physics";
import { CharacterController } from "./character/characterController";
import { InputController } from "./character/inputController";
import { WaterMaterial } from "@babylonjs/materials";
import { Island } from "./island/island";
import { Debug, DebugFlag } from "./debug/debug";

enum State { START = 0, GAME = 1, LOSE = 2, CUTSCENE = 3 }

class App {
    // General Entire Application
    private _scene: Scene;
    private _canvas: HTMLCanvasElement;
    private _engine: Engine;
    // public _havok: HavokPhysicsWithBindings;
    // public _physicsPlugin: HavokPlugin

    //Scene - related
    private _state: number = 0;
    private _gamescene: Scene;
    private _cutScene: Scene;

    // Game State Related
    private _island: Island;
    private _input: InputController;
    private _character: CharacterController;
    private characterAssets: any;

    private _axesViewer: AxesViewer;
    constructor() {
        this._canvas = this._createCanvas();

        // initialize babylon scene and engine
        this._engine = new Engine(this._canvas, true);
        this._scene = new Scene(this._engine);

        // hide/show the Inspector
        window.addEventListener("keydown", (ev) => {
            // Shift+Ctrl+Alt+I
            if (ev.shiftKey && ev.ctrlKey && ev.altKey) {
                if (this._scene.debugLayer.isVisible()) {
                    this._scene.debugLayer.hide();
                    this._axesViewer.dispose();
                } else {
                    this._scene.debugLayer.show();
                    this._axesViewer = new AxesViewer(this._scene, 0.25);
                }
            }
            if (ev.code === "F1") Debug.toggle(DebugFlag.Normals);
            if (ev.code === "F2") Debug.toggle(DebugFlag.Collisions);
            if (ev.code === "F3") Debug.toggle(DebugFlag.Actions);
            if (ev.code === "F4") Debug.toggle(DebugFlag.Anim);
        });

        // run the main render loop
        this._main();
    }

    private _createCanvas(): HTMLCanvasElement {

        //Commented out for development
        document.documentElement.style["overflow"] = "hidden";
        document.documentElement.style.overflow = "hidden";
        document.documentElement.style.width = "100%";
        document.documentElement.style.height = "100%";
        document.documentElement.style.margin = "0";
        document.documentElement.style.padding = "0";
        document.body.style.overflow = "hidden";
        document.body.style.width = "100%";
        document.body.style.height = "100%";
        document.body.style.margin = "0";
        document.body.style.padding = "0";

        //create the canvas html element and attach it to the webpage
        this._canvas = document.createElement("canvas");
        this._canvas.style.width = "100%";
        this._canvas.style.height = "100%";
        this._canvas.id = "gameCanvas";
        document.body.appendChild(this._canvas);

        return this._canvas;
    }

    private async _main(): Promise<void> {
        await this._goToStart();

        // Register a render loop to repeatedly render the scene
        this._engine.runRenderLoop(() => {
            switch (this._state) {
                case State.START:
                    this._scene.render();
                    break;
                case State.CUTSCENE:
                    this._scene.render();
                    break;
                case State.GAME:
                    this._scene.render();
                    break;
                case State.LOSE:
                    this._scene.render();
                    break;
                default: break;
            }
        });

        //resize if the screen is resized/rotated
        window.addEventListener('resize', () => {
            this._engine.resize();
        });
    }
    private async _goToStart(){
        this._engine.displayLoadingUI();

        this._scene.detachControl();
        let scene = new Scene(this._engine);
        scene.clearColor = new Color4(0,0,0,1);
        let camera = new FreeCamera("camera1", new Vector3(0, 0, 0), scene);
        camera.setTarget(Vector3.Zero());

        //create a fullscreen ui for all of our GUI elements
        const guiMenu = AdvancedDynamicTexture.CreateFullscreenUI("UI");
        guiMenu.idealHeight = 720; //fit our fullscreen ui to this height

        //create a simple button
        const startBtn = Button.CreateSimpleButton("start", "PLAY");
        startBtn.width = 0.2
        startBtn.height = "40px";
        startBtn.color = "white";
        startBtn.top = "-14px";
        startBtn.thickness = 0;
        startBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        guiMenu.addControl(startBtn);

        //this handles interactions with the start button attached to the scene
        startBtn.onPointerDownObservable.add(() => {
            this._goToCutScene();
            scene.detachControl(); //observables disabled
        });

        //--SCENE FINISHED LOADING--
        await scene.whenReadyAsync();
        this._engine.hideLoadingUI();
        //lastly set the current state to the start state and set the scene to the start scene
        this._scene.dispose();
        this._scene = scene;
        this._state = State.START;
    }

    private async _goToCutScene(): Promise<void> {
        this._engine.displayLoadingUI();
        //--SETUP SCENE--
        //dont detect any inputs from this ui while the game is loading
        this._scene.detachControl();
        this._cutScene = new Scene(this._engine);
        let camera = new FreeCamera("camera1", new Vector3(0, 0, 0), this._cutScene);
        camera.setTarget(Vector3.Zero());
        this._cutScene.clearColor = new Color4(0, 0, 0, 1);

         //--GUI--
         const cutScene = AdvancedDynamicTexture.CreateFullscreenUI("cutscene");

        //--PROGRESS DIALOGUE--
        const next = Button.CreateSimpleButton("next", "NEXT");
        next.color = "white";
        next.thickness = 0;
        next.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        next.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        next.width = "64px";
        next.height = "64px";
        next.top = "-3%";
        next.left = "-12%";
        cutScene.addControl(next);

        next.onPointerUpObservable.add(() => {
            this._goToGame();
        })

        //--WHEN SCENE IS FINISHED LOADING--
        await this._cutScene.whenReadyAsync();
        this._engine.hideLoadingUI();
        this._scene.dispose();
        this._state = State.CUTSCENE;
        this._scene = this._cutScene;

        //--START LOADING AND SETTING UP THE GAME DURING THIS SCENE--
        var finishedLoading = false;
        await this._setUpGame().then(res =>{
            finishedLoading = true;
        });
    }

    private async _setUpGame() {
        let scene = new Scene(this._engine);

        const havok = await HavokPhysics();
        const physicsPlugin = new HavokPlugin(true, havok);
        let gravityVector = new Vector3(0, -9.81, 0);
        scene.enablePhysics(gravityVector, physicsPlugin);
        //scene.useRightHandedSystem = true;

        this._gamescene = scene;
    
        // create environment
        // const environment = new Environment(scene);
        // this._environment = environment;
        const island = new Island(scene);
        this._island = island;
        await this._island.load();
        
        // load all of the character assets and create the character controller
        // all of the character physics and animations are handled there
        await this._loadCharacterAssets(scene);
        this._input = new InputController(scene);
        const character = new CharacterController(this.characterAssets, scene, this._island, this._island.camera, this._input, this._island.pipeline);
        // const character = new CharacterController(this.characterAssets, scene, this._environment,this._environment.camera, this._input);
        this._character = character;
        
        //console.log(scene);
        //console.log(this.characterAssets); 
    }

    private async _goToGame(){
        //--SETUP SCENE--
        this._scene.detachControl();
        let scene = this._gamescene;
        //scene.clearColor = new Color4(0.01568627450980392, 0.01568627450980392, 0.20392156862745098); // a color that fit the overall color scheme better
        
        scene.activeCamera = this._island.camera;
        // scene.activeCamera = this._environment.camera;
        scene.activeCamera.attachControl(this._canvas); // Gives control of the camera to the mouse and keyboard
        
        //camera.useAutoRotationBehavior = true;
        //camera.autoRotationBehavior.idleRotationSpeed *= 1.8;

        //--GUI--
        const playerUI = AdvancedDynamicTexture.CreateFullscreenUI("UI");
        //dont detect any inputs from this ui while the game is loading
        scene.detachControl();

        //create a simple button
        const loseBtn = Button.CreateSimpleButton("lose", "LOSE");
        loseBtn.width = 0.2
        loseBtn.height = "40px";
        loseBtn.color = "white";
        loseBtn.top = "-14px";
        loseBtn.thickness = 0;
        loseBtn.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        playerUI.addControl(loseBtn);

        //this handles interactions with the start button attached to the scene
        loseBtn.onPointerDownObservable.add(() => {
            this._goToLose();
            scene.detachControl(); //observables disabled
        });

        //temporary scene objects
        // var light1: HemisphericLight = new HemisphericLight("light1", new Vector3(1, 1, 0), scene);
        // var sphere: Mesh = MeshBuilder.CreateSphere("sphere", { diameter: 1 }, scene);
        //scene.attachControl();
        //--WHEN SCENE FINISHED LOADING--
        await scene.whenReadyAsync();
        //get rid of start scene, switch to gamescene and change states
        this._scene.dispose();
        this._state = State.GAME;
        this._scene = scene;
        this._engine.hideLoadingUI();
        //the game is ready, attach control back
        this._scene.attachControl();
    }

    private async _goToLose(): Promise<void> {
        this._engine.displayLoadingUI();

        //--SCENE SETUP--
        this._scene.detachControl();
        let scene = new Scene(this._engine);
        scene.clearColor = new Color4(0, 0, 0, 1);
        let camera = new FreeCamera("camera1", new Vector3(0, 0, 0), scene);
        camera.setTarget(Vector3.Zero());

        //--GUI--
        const guiMenu = AdvancedDynamicTexture.CreateFullscreenUI("UI");
        const mainBtn = Button.CreateSimpleButton("mainmenu", "MAIN MENU");
        mainBtn.width = 0.2;
        mainBtn.height = "40px";
        mainBtn.color = "white";
        guiMenu.addControl(mainBtn);
        //this handles interactions with the start button attached to the scene
        mainBtn.onPointerUpObservable.add(() => {
            this._goToStart();
        });

        //--SCENE FINISHED LOADING--
        await scene.whenReadyAsync();
        this._engine.hideLoadingUI(); //when the scene is ready, hide loading
        //lastly set the current state to the lose state and set the scene to the lose scene
        this._scene.dispose();
        this._scene = scene;
        this._state = State.LOSE;
    }

    private async _loadCharacterAssets(scene): Promise<any> {
        
        async function loadCharacter(directShadow: ShadowGenerator, spotShadow: ShadowGenerator,  wtrMtl: WaterMaterial) {
            
            // babylon breaks up glb files into individual meshes with a __root__ as a parent
            // so first import all of the meshes, animations, and the skeleton for the character
            const characterContainer = await LoadAssetContainerAsync("../models/character/fiddlerJoinedUp.glb", scene);

            // constants to determine the size of the capsule that will represent the physics body for the character
            const scalingFactor = 0.35;
            const capsuleHeight = 1.6;
            const capsuleRadius = 0.35;
            const characterOffset = capsuleHeight/2.75;

            // next create the parent mesh that will act as the physics body for the character
            // this mesh will also replace __root__ as the parent for all of the "sub" character meshes
            const charParentMesh = MeshBuilder.CreateCapsule("charParent",{ height: capsuleHeight, radius: capsuleRadius}, scene);
            //console.log("charParentMesh Abs Post , Local Pos\n" +
                    //"======================\n");
            //console.log(charParentMesh.getAbsolutePosition() + ", " + charParentMesh.position);
            // to remove the root assigned by babylon, first get the root and loop through
            // all of its children and reassign the parent to the new capsule mesh
            let charMeshRoot = characterContainer.meshes[0];
            let charMeshChildren = charMeshRoot.getChildMeshes();
            //console.log("CHARMESHROOT GET CHILDREN\n" +
                    //"===========\n");
           // console.log(charMeshRoot.getChildren());

            
            
            charMeshChildren.forEach(m => {
                
                // handle any material property updates here 
                m.material.backFaceCulling = true;
                spotShadowGen.addShadowCaster(m);
                wtrMtl.addToRenderList(m);
                m.setParent(charParentMesh);
                m.position.y -= characterOffset; // need to move each piece of the character down so his feet line up with the bottom of the physics body
                // console.log("charMeshChildren Abs Post , Local Pos\n" +
                //     "======================\n");
                // console.log(m.getAbsolutePosition() + ", " + m.position);
            });

//#region Physics Aggregate and Shape Code
/* 
            const characterAggregate = new PhysicsAggregate(charParentMesh,
                PhysicsShapeType.CAPSULE,
                { mass: 1, friction: 0.5, restitution: 0,  },
                scene);
            
            const characterAggregate = new PhysicsAggregate(charParentMesh, PhysicsShapeType.CAPSULE, {
                                        mass: 1,
                                        radius: capsuleRadius,
                                        pointA: new Vector3(0, -capsuleHeight/2 + capsuleRadius, 0),
                                        pointB: new Vector3(0, capsuleHeight/2 - capsuleRadius, 0),
                                    }, scene);

            const characterPhysicShape = new PhysicsShapeCapsule(
                new Vector3(0, (-capsuleHeight/2) + capsuleRadius, 0), 
                new Vector3(0, (capsuleHeight/2) - capsuleRadius, 0), 
                capsuleRadius, 
                scene);

            const characterPhysicShape = new PhysicsShapeCapsule(
                new Vector3(0, ((-capsuleHeight/2) * scalingFactor) + (capsuleRadius * scalingFactor), 0), 
                new Vector3(0, ((capsuleHeight/2) * scalingFactor) - (capsuleRadius * scalingFactor), 0), 
                capsuleRadius * scalingFactor, 
                scene);
*/            
//#endregion          

            charParentMesh.scaling = new Vector3(scalingFactor, scalingFactor, scalingFactor);
            charParentMesh.position = new Vector3(4, 0.5, -1);
            charParentMesh.rotationQuaternion = null;

            //create the physics body and shape to be assigned to the parent capsule mesh
            const characterPhysicsBody = new PhysicsBody(charParentMesh, PhysicsMotionType.DYNAMIC, false, scene);
            const characterPhysicShape = new PhysicsShapeCapsule(
                new Vector3(0, ((-capsuleHeight/2) * scalingFactor) + (capsuleRadius * scalingFactor), 0), // starting point/bottom of cylinder
                new Vector3(0, ((capsuleHeight/2) * scalingFactor) - (capsuleRadius * scalingFactor), 0),  // top of the cylinder
                capsuleRadius * scalingFactor, // radius of the half sphere on each ond of the cylinder
                scene);
            // const characterPhysicShape = new PhysicsShapeCapsule(
            //     new Vector3(0, ((-capsuleHeight/2) * scalingFactor) + (capsuleRadius * scalingFactor), 0), // starting point/bottom of cylinder
            //     new Vector3(0, ((capsuleHeight/2) * scalingFactor) - (capsuleRadius * scalingFactor), 0),  // top of the cylinder
            //     capsuleRadius * scalingFactor, // radius of the half sphere on each ond of the cylinder
            //     scene);

            // Use collision filters so the world only reports events you care about
            const LAYER_GROUND = 1 << 0;
            const LAYER_PLAYER = 1 << 1;
            
            charParentMesh.physicsBody.shape = characterPhysicShape;
            charParentMesh.physicsBody.setCollisionCallbackEnabled(true);
            charParentMesh.physicsBody.shape.filterMembershipMask = LAYER_PLAYER;
            charParentMesh.physicsBody.shape.filterCollideMask   = LAYER_GROUND;
            charParentMesh.physicsBody.setMassProperties({ mass: 1, inertia: Vector3.ZeroReadOnly });
            charParentMesh.physicsBody.shape.material = { friction: 0.5, restitution: 0 };
            charParentMesh.isVisible = false;
            charParentMesh.checkCollisions =true;
             //  .setActivationControl(BABYLON.PhysicsActivationState.ALWAYS_ACTIVE);

            // charParentMesh.position = new Vector3(10, 4, 5);
            // dispose of the old root node
            charMeshRoot.dispose();

            // add the character to the scene and return all of the relevant assets to be used in the character controller
            characterContainer.addAllToScene();

            console.log(characterContainer);
            

            return {
                characterContainer: characterContainer,
                charParentMesh: charParentMesh
            }
        }
        let directShadowGen = this._island.directLightShadowGen
        let spotShadowGen = this._island.spotLightShadowGen
        let waterMaterial = this._island._waterMtl
        // let directShadowGen = this._environment.directLightShadowGen
        // let spotShadowGen = this._environment.spotLightShadowGen
        // let waterMaterial = this._environment._waterMtl
        this.characterAssets = await loadCharacter(directShadowGen, spotShadowGen, waterMaterial);
    }
}
new App();