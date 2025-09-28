import { Scene, Vector3, Ray, TransformNode, Mesh, Color3, Color4, UniversalCamera, Quaternion, AnimationGroup, ExecuteCodeAction, ActionManager, ParticleSystem, Texture, SphereParticleEmitter, Sound, Observable, ShadowGenerator, AssetContainer, ArcRotateCamera, Vector4, Camera, HavokPlugin, PhysicsEventType, DefaultRenderingPipeline } from "@babylonjs/core";
import { InputController } from "./inputController";
import { Island } from "../island/island";
import { ActionName } from "./actionManager/action.types";
import { CustomActionManager } from "./actionManager/customActionManager";
import { AnimationController, Animations } from "./animationController/animationController";
import { ANIM_CONFIG } from "./animationController/animations.config";
import { Debug, DebugFlag } from "../debug/debug";
import { DebugDraw } from "../debug/debugDraw";
import { DebugHUD } from "../debug/debugHud";

export class CharacterController {

    public scene: Scene;
    public camera: ArcRotateCamera;
    public currLevel: Island;
    private _input: InputController;
    private _plugin: HavokPlugin;

    public characterAssets: AssetContainer;
    public characterMesh: Mesh;
    private _meshRot: Vector3;

    private _characterAnimationMap: Map<string, AnimationGroup>
    private _characterAnimations: Animations;
    private _animationController: AnimationController;

    // character properties
    private _baseSpeed: number;
    private _characterSpeed: number;

    private _actionList: ActionName[] = [ "jump", "attack", "sit", "stand", "pickUp" ];
    private _actions = new CustomActionManager().add(this._actionList);

    //private _animationList: AnimationName[] = [ "jump", "attack", "swim", "sit", "stand", "pickUp" ];

    // states
    private _jumping: boolean;
    private _isGrounded: boolean;
    private _wasGroundedPrev = false;
    private _prevVelY = 0;
    private _leftGroundAt = -1;



    private _lastGroundTouch: number = -1;
    private _groundedLockoutUntil: number = -1;
    private _jumpBufferedUntil: number = -1;
    private _jumpCooldownUntil: number = -1;

    private static COYOTE_MS = 300;
    private static BUFFER_MS = 140;
    private static LOCKOUT_MS = 100;
    private static COOLDOWN_MS = 200;
    private static MAX_SLOPE_DEG = 55;
    private static MAX_SLOPE_COS = Math.cos(CharacterController.MAX_SLOPE_DEG * Math.PI / 180);
    private static MIN_FALL_SPEED = 0.6;  // tune to your scale
    private static MIN_AIR_MS     = 80;   // ignore micro “lands” when walking down steps

    private initialContactFlag = false;

    // raycasting
    private _down: Vector3;
    private _ray: Ray;

    private _groundOnly: (m: Mesh) => boolean;
    private _draw: DebugDraw;
    private _hud: DebugHUD;

    // animations

    // animation trackers

    constructor(characterAssets: any, scene: Scene, currLevel?: Island, camera?: ArcRotateCamera, input?: InputController, pipeline?: DefaultRenderingPipeline) {
        this.scene = scene;
        this.currLevel = currLevel;
        this._plugin = scene.getPhysicsEngine()!.getPhysicsPlugin() as HavokPlugin;
        this.camera = camera;

        this._draw = new DebugDraw(this.scene);
        this._hud = new DebugHUD();
        this.scene.onBeforeRenderObservable.add(() => this._hud.tick());
        this._hud.addProvider(() => {
            if (!Debug.has(DebugFlag.Perf)) return "";
            const fps = Math.round(this.scene.getEngine().getFps());
            return `FPS: ${fps}`;
        });
        this._hud.addProvider(() => {
            if (!Debug.has(DebugFlag.Anim)) return "";
            const s = this._animationController.inspect();
            return `Anim: cur=${s.current} tgt=${s.target} fade=${s.fadeT.toFixed(2)} grounded=${s.grounded} v=${s.speeds.vert.toFixed(2)}`;
        });
        this._hud.addProvider(() => {
            if (!Debug.has(DebugFlag.Actions)) return "";
            const a = this._actions.inspect();
            const j = a.actions.find(x => x.name === "jump");
            return `Jump cd=${Math.max(0, j?.cooldown ?? 0).toFixed(0)} ms lock=${Math.max(0, j?.lockout ?? 0).toFixed(0)} ms`;
        });

        this.characterAssets = characterAssets.characterContainer;
        this.characterMesh = characterAssets.charParentMesh;
        this._meshRot = new Vector3();
        this._characterAnimationMap = this._mapAnimations(this.characterAssets.animationGroups);
        this._characterAnimations = this._buildAnimations(this._characterAnimationMap);

        this._animationController = new AnimationController(
            this.scene,
            this._characterAnimations,
            this.characterMesh.physicsBody,
            ANIM_CONFIG
            
        );
        
        this.camera.setTarget(this.characterMesh.getAbsolutePosition());

        this.currLevel.spotLight.position.set(-2, 5, -4);
        //this.currLevel.spotLight.position = new Vector3(this.characterMesh.position.x-2, this.characterMesh.position.y+5, this.characterMesh.position.z-4);
        //check for input controller and create a new one if not passed in
        // included for now in case of change of base controller and add new properties for each level
        this._input = input ??= new InputController(scene);

        this._baseSpeed = 2.5;
 
        this._jumping = false;
        this._isGrounded = false;
        this._lastGroundTouch = 0;

       // --- Setup (one-time): mark pickable ground meshes ---
        /*
        groundMesh.isPickable = true;
        groundMesh.metadata = { groundType: "sand" }; // or "grass", "rock", etc.
        */

        // --- Reusable objects to avoid GC ---
        this._down = Vector3.Down();                   // direction is constant
        this._ray = new Ray(new Vector3(), this._down.clone(), 3.0); // origin set per-frame; length = max step/fall
        this._groundOnly = (m: Mesh) => m.isPickable && !!m.metadata?.groundType; // double bang checks that groundType is not null
        

        // Plugin-level collision: record “support” contacts
        this._plugin.onCollisionObservable.add((ev: any) => {
            const a = ev.collider, b = ev.collidedAgainst;
            if (a !== this.characterMesh.physicsBody && b !== this.characterMesh.physicsBody) return;

            // Ignore during post-jump lockout
            const now = performance.now();
            if (now < this._groundedLockoutUntil) return;

            const nInto = this._contactNormalIntoSelf(ev);
            if (!nInto) return;

            const support = this._isSupportContact(nInto);
            const startedOrContinued =
                ev.type === PhysicsEventType.COLLISION_STARTED ||
                ev.type === PhysicsEventType.COLLISION_CONTINUED;

            if (support && startedOrContinued) {
                // Forced fix for initial sticking anim. Not worth it. Leave out
                // const v = this.characterMesh.physicsBody.getLinearVelocity() ?? new Vector3(0, 0, 0);
                // this.characterMesh.physicsBody.setLinearVelocity(new Vector3(v.x, 0.0001, v.z));
                // this.characterMesh.physicsBody.setLinearVelocity(v);

                this._lastGroundTouch = now; // only when it's actually "ground-ish"
            }

            if (Debug.has(DebugFlag.Normals)) {
                const contact = ev.point ?? this.characterMesh.getAbsolutePosition().add(new Vector3(0, -0.9, 0));
                this._draw.arrow(contact, nInto, 0.8, Color3.Green(), 600);
            }
            Debug.log(DebugFlag.Collisions, ...Debug.tag("COLLIDE", "#0a0"), { type: ev.type, normal: nInto, self: a, other: b });

            

        });

        let lastAppliedFrame = -1;

        this.scene.onBeforePhysicsObservable.add(() => {
            //this._checkJump(); 
            const frame = scene.getFrameId();
            if (frame === lastAppliedFrame) return;      // avoid multi-apply on substeps
            lastAppliedFrame = frame;

            this._updateFromControls(); 

            const groundedNow = (performance.now() - this._lastGroundTouch) < CharacterController.COYOTE_MS;
            const canJump = groundedNow;
            if (canJump && this._actions.tryPerform("jump", () => 
                {
                    this.characterMesh.physicsBody.applyImpulse(new Vector3(0, 4, 0), this.characterMesh.position);

                    const now = performance.now();
                    this._groundedLockoutUntil = now + CharacterController.LOCKOUT_MS;
                    this._lastGroundTouch = -Infinity;         // guarantees not “recently grounded”
                    this._leftGroundAt = now;                  // for your landing filter
                    this._animationController.setGrounded(false);
                }, 
                { gcdMs: 300, categoryLockMs: 80 })) 
            {
            // additional actions to perform \\ inside if
            // prevent dash for 120ms after jump
            // this._actions.trigger("dash", { lockout: 120 });
            }
            
            const v = this.characterMesh.physicsBody.getLinearVelocity() ?? Vector3.Zero();
            this._prevVelY = v.y;

            // Grounded at the **start** of this step?
            this._wasGroundedPrev = (performance.now() - this._lastGroundTouch) < CharacterController.COYOTE_MS;
            
        });

        this.scene.onAfterPhysicsObservable.add(() => {
            const now = performance.now();
            const groundedNow = (now - this._lastGroundTouch) < CharacterController.COYOTE_MS;

            // Track when we left ground to filter tiny micro-lands
            if (this._wasGroundedPrev && !groundedNow) this._leftGroundAt = now;

            // Rising edge + coming down fast enough + airborne long enough
            const airMs = this._leftGroundAt > 0 ? (now - this._leftGroundAt) : Infinity;
            const landed = (!this._wasGroundedPrev) &&
                            groundedNow &&
                            (this._prevVelY < -CharacterController.MIN_FALL_SPEED) &&
                            (airMs > CharacterController.MIN_AIR_MS);


            this._animationController.setGrounded(groundedNow);
            this._animationController.setSprintRequested(this._input.sprinting);

            const v = this.characterMesh.physicsBody.getLinearVelocity() ?? Vector3.Zero();
            this._animationController.setVelocities(Math.hypot(v.x, v.z), v.y);

            if (landed) {
                this._animationController.notifyLanding(Math.abs(this._prevVelY));
            }


            this.characterMesh.rotation = this._meshRot;
            // Can also set lockedTarget and check so you can switch back and forth // if (!camera.lockedTarget)
            // this.camera.target = this.characterMesh.position;
            // this.camera.setTarget(this.characterMesh.getAbsolutePosition());
            this.currLevel.spotLight.position = new Vector3(this.characterMesh.position.x-2, this.characterMesh.position.y+5, this.characterMesh.position.z-4);
        });

        // this.scene.onBeforeCameraRenderObservable.add(() => {

        // });

        this.scene.onBeforeRenderObservable.add(() => {
            if (Debug.has(DebugFlag.Actions)) {
                console.table(this._actions.inspect().actions);
            }
            if (Debug.has(DebugFlag.Anim)) {
                const s = this._animationController.inspect();
                Debug.log(DebugFlag.Anim, ...Debug.tag("ANIM", "#b0f"), s);
            }
        });
    }
    
    private _mapAnimations<T extends { name: string }>(animArr: T[]): Map<string, T> {
        const map = new Map<string, T>();
        animArr.forEach((anim) => {
            map.set(anim.name, anim);
        });
        console.log(map);
        return map;
    }

    private _buildAnimations(map: Map<string, AnimationGroup>): Animations {
        const req = (name: string): AnimationGroup => {
            const g = this._characterAnimationMap.get(name);
            if (!g) throw new Error(`AnimationGroup '${name}' not found.`);
            return g;
        };
        
        return {
            locomotion: {
                idle:   req("idle"),
                run:    req("run"),
                sprint: req("sprint"),
                jumpUp:   req("jumpUp"), // jump frames 2-10
                fall:   req("fall"), // jump frames 11-21 
                land:   req("land") // jump frames 22-30
            },
            overlays: {
                sitUp:  req("sitUp"),
                fish:   req("fish"),
            }
        };
    }

    private _updateFromControls(): void {

        let linVel = this.characterMesh.physicsBody.getLinearVelocity();
        this._characterSpeed = this._baseSpeed;

        if (this._input.sprinting) {
            this._characterSpeed = this._baseSpeed * 2;
        }

        // the input direction stays the same when you stop moving so this block needs to stay independent for now
        if (this._input.direction === 8) {
            // this.characterMesh.rotation = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(3*Math.PI/2), 0);
            this._meshRot = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(3*Math.PI/2), 0);
            this.characterMesh.physicsBody.setLinearVelocity(new Vector3(this._characterSpeed * Math.sin(this.characterMesh.rotation.y), linVel.y, this._characterSpeed * Math.cos(this.characterMesh.rotation.y)));
        }
        else if (this._input.direction === 9) {
            // this.characterMesh.rotation = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(5*Math.PI/4), 0);
            this._meshRot  = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(5*Math.PI/4), 0);
            this.characterMesh.physicsBody.setLinearVelocity(new Vector3(this._characterSpeed * Math.sin(this.characterMesh.rotation.y), linVel.y, this._characterSpeed * Math.cos(this.characterMesh.rotation.y)));
        }
        else if (this._input.direction === 6) {
            // this.characterMesh.rotation = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(2*Math.PI/2), 0);
            this._meshRot  = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(2*Math.PI/2), 0);
            this.characterMesh.physicsBody.setLinearVelocity(new Vector3(this._characterSpeed * Math.sin(this.characterMesh.rotation.y), linVel.y, this._characterSpeed * Math.cos(this.characterMesh.rotation.y)));
        }
        else if (this._input.direction === 3) {
            // this.characterMesh.rotation = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(3*Math.PI/4), 0);
            this._meshRot  = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(3*Math.PI/4), 0);
            this.characterMesh.physicsBody.setLinearVelocity(new Vector3(this._characterSpeed * Math.sin(this.characterMesh.rotation.y), linVel.y, this._characterSpeed * Math.cos(this.characterMesh.rotation.y)));
        }
        else if (this._input.direction === 2) {
            // this.characterMesh.rotation = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(Math.PI/2), 0);
            this._meshRot  = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(Math.PI/2), 0);
            this.characterMesh.physicsBody.setLinearVelocity(new Vector3(this._characterSpeed * Math.sin(this.characterMesh.rotation.y), linVel.y, this._characterSpeed * Math.cos(this.characterMesh.rotation.y)));
        }
        else if (this._input.direction === 1) {
            // this.characterMesh.rotation = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(Math.PI/4), 0);
            this._meshRot  = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(Math.PI/4), 0);
            this.characterMesh.physicsBody.setLinearVelocity(new Vector3(this._characterSpeed * Math.sin(this.characterMesh.rotation.y), linVel.y, this._characterSpeed * Math.cos(this.characterMesh.rotation.y)));
        }
        else if (this._input.direction === 4) {
            // this.characterMesh.rotation = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI)), 0);
            this._meshRot  = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI)), 0);
            this.characterMesh.physicsBody.setLinearVelocity(new Vector3(this._characterSpeed * Math.sin(this.characterMesh.rotation.y), linVel.y, this._characterSpeed * Math.cos(this.characterMesh.rotation.y)));
        }
        else if (this._input.direction === 7) {
            // this.characterMesh.rotation = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(7*Math.PI/4), 0);
            this._meshRot  = new Vector3(0, ((-this.camera.alpha)%(2*Math.PI))+(7*Math.PI/4), 0);
            this.characterMesh.physicsBody.setLinearVelocity(new Vector3(this._characterSpeed * Math.sin(this.characterMesh.rotation.y), linVel.y, this._characterSpeed * Math.cos(this.characterMesh.rotation.y)));
        }
        
        if (this._input.jumpPressed) {
            this._actions.request("jump");
        }
        
        //check after the movement block to set the velocity to 0 but the rotation remans the same
        if (this._input.mvmtKeydown === false) {
            this.characterMesh.physicsBody.setLinearVelocity(new Vector3(0, linVel.y, 0));
        }
    
    }

    private _setUpAnimations(): void {

    }

    private _animatePlayer(): void{ 

    }
    /** Up = opposite of gravity (works for any handedness / tilted gravity) */
    private _up(): Vector3 {
        const g = this.scene.getPhysicsEngine()?.gravity;
        if (!g || g.lengthSquared() < 1e-9) return Vector3.Up();
        return g.scale(-1).normalize();
    }

    /** Make the event normal point into character body */ 
    private _contactNormalIntoSelf(ev: any): Vector3 | null {
        const raw = ev.normal as Vector3 | undefined;
        if (!raw) return null;
        const n = raw.clone();
        if (ev.collider === this.characterMesh.physicsBody) n.scaleInPlace(-1);
        return n.normalize();
    }

    /** Check if normal vector satisfies max vert angle for the ground */
    private _isSupportContact(nInto: Vector3): boolean {
        const up = this._up();
        const cosThresh = CharacterController.MAX_SLOPE_COS; // cos(55°) ≈ 0.574
        return Vector3.Dot(nInto, up) >= cosThresh;
    }
        
}