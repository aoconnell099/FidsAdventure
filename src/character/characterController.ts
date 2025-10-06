import { Scene, Vector3, Ray, TransformNode, Mesh, Color3, Color4, UniversalCamera, Quaternion, AnimationGroup, ExecuteCodeAction, ActionManager, ParticleSystem, Texture, SphereParticleEmitter, Sound, Observable, ShadowGenerator, AssetContainer, ArcRotateCamera, Vector4, Camera, HavokPlugin, PhysicsEventType, DefaultRenderingPipeline, SolidParticleSystem, StandardMaterial, MeshBuilder, AnimationEvent } from "@babylonjs/core";
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
    private _footprintFrames = { run: { L: [28], R: [50] }, 
                                  sprint: { L: [18], R: [33] }}

    // character properties
    private _baseSpeed: number;
    private _characterSpeed: number;
    private _characterSpeedXZ: number;

    private _actionList: ActionName[] = [ "jump", "attack", "sit", "stand", "pickUp" ];
    private _actions = new CustomActionManager().add(this._actionList);

    //private _animationList: AnimationName[] = [ "jump", "attack", "swim", "sit", "stand", "pickUp" ];

    // states
    private _jumping: boolean;
    private _isGrounded: boolean;
    private _wasGroundedPrev = false;
    private _prevVelY = 0;
    private _leftGroundAt = -1;

    private _smokeSPS: SolidParticleSystem;
    private _smokeEmit: Mesh;
    private _landingSmokeTrigger: boolean;
    private _dustSPS: SolidParticleSystem;
    private _dustSPSTrigger: boolean;

    private _footprint: Mesh;
    private _footprintMaterial: StandardMaterial;
    private _footprintArray: Mesh[];

    private _lastGroundTouch: number = -1;
    private _groundedLockoutUntil: number = -1;
    private _jumpBufferedUntil: number = -1;
    private _jumpCooldownUntil: number = -1;
    private _currentGroundType: string;

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
    private _groundType: (m: Mesh) => string;
    private _draw: DebugDraw;
    private _hud: DebugHUD;
    private _dustEmit: any;

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

        this._addFootstepEvt(this._characterAnimationMap.get("run"), this._footprintFrames.run);
        this._addFootstepEvt(this._characterAnimationMap.get("sprint"), this._footprintFrames.sprint);

        this.camera.setTarget(this.characterMesh.getAbsolutePosition());

        this.currLevel.spotLight.position.set(-2, 5, -4);
        // Check for input controller and create a new one if not passed in
        // Included for now in case of change of base controller and add new properties for each level
        this._input = input ??= new InputController(scene);

        this._baseSpeed = 3.5;
 
        this._jumping = false;
        this._isGrounded = false;
        this._lastGroundTouch = 0;

        this._createSmokeSPS();
        this._createDustSPS();
        this._createFootprint();

       // --- Setup (one-time): mark pickable ground meshes ---
        /*
        groundMesh.isPickable = true;
        groundMesh.metadata = { groundType: "sand" }; // or "grass", "rock", etc.
        */

        // --- Reusable objects to avoid GC ---
        this._down = Vector3.Down();                   // direction is constant
        this._ray = new Ray(new Vector3(), this._down.clone(), 3.0); // origin set per-frame; length = max step/fall
        this._groundOnly = (m: Mesh) => m.isPickable && !!m.metadata?.groundType; // double bang checks that groundType is not null
        this._groundType = (m: Mesh) => this._groundOnly(m) ? m.metadata?.groundType : ''; // double bang checks that groundType is not null
        
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
                
                this._currentGroundType = (b !== this.characterMesh.physicsBody) ? this._groundType(b.transformNode as Mesh) : this._groundType(a.transformNode as Mesh);

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
            this._isGrounded = groundedNow;

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
            this._characterSpeedXZ = Math.hypot(v.x, v.z);
            this._animationController.setVelocities(this._characterSpeedXZ, v.y);

            if (landed) {
                this._landingSmokeTrigger = true;
                let charP = this.characterMesh.getAbsolutePosition();
                this._smokeEmit.position = new Vector3(charP.x, charP.y-0.3, charP.z);
                this._smokeSPS.initParticles();
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
            if (this._landingSmokeTrigger) {
                this._smokeEmit.unfreezeWorldMatrix();
                this._smokeEmit._unFreeze();
                //smokeEmit.position = new BABYLON.Vector3(this.character.position.x, this.character.position.y, this.character.position.z);
            
                this._smokeSPS.setParticles();
            }
            else {
                this._smokeEmit.freezeWorldMatrix();
                this._smokeEmit._freeze();
            }
            
            if (this._isGrounded && this._currentGroundType === "Sand") {
                // Check if the character is running
                let running = this._characterSpeedXZ >= this._baseSpeed - 0.5;
                this._updateDust(running);
                //if (running) this._updateFootprints();
            }
            this._fadeFootprints();

            if (Debug.has(DebugFlag.Actions)) {
                console.table(this._actions.inspect().actions);
            }
            if (Debug.has(DebugFlag.Anim)) {
                const s = this._animationController.inspect();
                Debug.log(DebugFlag.Anim, ...Debug.tag("ANIM", "#b0f"), s);
            }
        });
    }

    private _updateDust(isRunning: boolean) {
        if (isRunning) {
            this._dustEmit.unfreezeWorldMatrix();
            this._dustEmit._unFreeze();
        } else {
            this._dustEmit.freezeWorldMatrix();
            this._dustEmit._freeze();
        }
        let dustOffsetX = Math.sin(this.characterMesh.rotation.y+Math.PI) * 0.1;
        let dustOffsetZ = Math.cos(this.characterMesh.rotation.y+Math.PI) * 0.1;
        let p = this.characterMesh.getAbsolutePosition();
        this._dustEmit.position = new Vector3(p.x+dustOffsetX, p.y - 0.3, p.z+dustOffsetZ);
        this._dustSPS.setParticles();
    }

    private _addFootstepEvt(group: AnimationGroup, frames: {L:number[], R:number[]}) {
        // Ensure all tracks are on the same timeline so “frame X” means the same thing everywhere
        group.normalize(0, group.to); // normalize to [0..to] once after loading
        // Pick any track in the group to host the events (after normalize they share frames)
        const host = group.targetedAnimations[0].animation;

        const addEvt = (frame: number, side: "L" | "R") => {
            host.addEvent(new AnimationEvent(frame, () => this._placeFootprint(side), /*onlyOnce*/ false));
        };

        frames.L.forEach(f => addEvt(f, "L"));
        frames.R.forEach(f => addEvt(f, "R"));
    }

    private _placeFootprint(side: "L" | "R") {
        if (this._isGrounded && this._currentGroundType === "Sand" && this._characterSpeedXZ >= this._baseSpeed - 0.5) {
            let offsetX = (side == "L" ? (Math.sin(this.characterMesh.rotation.y-Math.PI/2) * 0.1) : (Math.sin(this.characterMesh.rotation.y+Math.PI/2) * 0.1));
            let offsetZ = (side == "L" ? (Math.cos(this.characterMesh.rotation.y-Math.PI/2) * 0.1) : (Math.cos(this.characterMesh.rotation.y+Math.PI/2) * 0.1));
            if (this._footprintArray.length==20) {
                this._footprintArray[19].dispose();
                this._footprintArray.pop();
            }
            let clone = this._footprint.clone(this._footprint.name + "_" + this._footprintArray.length, null, false, false);
            clone.position = new Vector3(this.characterMesh.position.x+offsetX, 0.09, this.characterMesh.position.z+offsetZ);
            clone.rotation.y = this.characterMesh.rotation.y;
            clone.setEnabled(true);
            clone.freezeWorldMatrix();
            this._footprintArray.unshift(clone);
        }
    }

    private async _updateFootprints() {
        let setFootPrint = true;
        let currentFrame = null;

        if (setFootPrint) {
            setFootPrint = false;
            if((currentFrame >= 86 && currentFrame <= 87) || (currentFrame >= 91.5 && currentFrame <= 92.5)) {
            let left = ((currentFrame >= 86 && currentFrame <= 87) ? true : false);
            let offsetX = (left == true ? (Math.sin(this.characterMesh.rotation.y-Math.PI/2) * 0.1) : (Math.sin(this.characterMesh.rotation.y+Math.PI/2) * 0.1));
            let offsetZ = (left == true ? (Math.cos(this.characterMesh.rotation.y-Math.PI/2) * 0.1) : (Math.cos(this.characterMesh.rotation.y+Math.PI/2) * 0.1));
            if (this._footprintArray.length==20) {
                this._footprintArray[19].dispose();
                this._footprintArray.pop();
            }
            let clone = this._footprint.clone(this._footprint.name + "_" + this._footprintArray.length, null, false, false);
            clone.position = new Vector3(this.characterMesh.position.x+offsetX, this.characterMesh.position.y - 0.09, this.characterMesh.position.z+offsetZ);
            clone.rotation.y = this.characterMesh.rotation.y;
            clone.freezeWorldMatrix();
            this._footprintArray.unshift(clone);
            }
        }
        await setTimeout(() =>{
            setFootPrint = true;
        }, 90); 
    }

    private _fadeFootprints() {
        if(this._footprintArray.length > 0) {
        this._footprintArray.forEach((mesh, index) => {

          if(index < 9) {
            mesh.visibility -= 0.0005;
          }
          else {
            mesh.visibility -= 0.0015;
          }
          if (mesh.visibility <= 0) {
            mesh.dispose();
            this._footprintArray.pop();
          }
        })
      }
    }
    
    private _mapAnimations<T extends { name: string }>(animArr: T[]): Map<string, T> {
        const map = new Map<string, T>();
        animArr.forEach((anim) => {
            map.set(anim.name, anim);
        });
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
            this._characterSpeed = this._baseSpeed * 5/this._baseSpeed;
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

    private _createSmokeSPS() {

        this._landingSmokeTrigger = false;
        const smokeSPS = new SolidParticleSystem("smokeSPS", this.scene);
        const boxSize = 0.6;
        const smoke = MeshBuilder.CreateBox("smoke", {size: boxSize},this.scene);
        const smokeNum = 20
        smokeSPS.addShape(smoke, smokeNum); 
        smoke.dispose();

        this._smokeEmit = smokeSPS.buildMesh();
        this._smokeEmit.setAbsolutePosition(this.characterMesh.getAbsolutePosition());
        const smokeMaterial = new StandardMaterial("smoke", this.scene);
        smokeMaterial.disableLighting = true;
        smokeMaterial.emissiveColor = new Color3(0.8, 0.8, 0.8);
        this._smokeEmit.material = smokeMaterial;

        smokeSPS.computeParticleRotation = false; // prevents from computing particle.rotation
        smokeSPS.computeParticleTexture = false; // prevents from computing particle.uvs
        smokeSPS.computeParticleColor = false; // prevents from computing particle.color
        smokeSPS.computeParticleVertex = false; // prevents from calling the custom updateParticleVertex() function

        // smokeSPS behavior definition
        const smokeSpeed = 0.02;
        const smokeGrav = 0;
        

        //const smokeSpeed;
        //const smokeGrav = 0.01

        // init
        smokeSPS.initParticles = () => {
            // just recycle everything
            for (let p = 0; p < smokeSPS.nbParticles; p++) {
                smokeSPS.particles[p].isVisible = false;
                smokeSPS.recycleParticle(smokeSPS.particles[p]);
            }
            };

        // recycle
        smokeSPS.recycleParticle = function(particle) {
            // Set particle new velocity, scale and rotation
            //particle.isVisible = true;
            
            const angInc = 360/smokeNum;
            const angle = (particle.idx * angInc) * Math.PI/180;
            const smokeOffsetX = -Math.sin(angle) * 0.1;
            const smokeOffsetZ = -Math.cos(angle) * 0.1;

            particle.position.x = smokeOffsetX;
            particle.position.y = 0;
            particle.position.z = smokeOffsetZ;
            particle.velocity.x = -Math.sin(angle) * smokeSpeed;
            particle.velocity.y = 0;
            particle.velocity.z = -Math.cos(angle) * smokeSpeed;
            const scale = (Math.random()*0.2 - 0.1) + 0.25;
            particle.scaling.x = scale;
            particle.scaling.y = scale;
            particle.scaling.z = scale;

            particle.color.a = 1;

            return particle;
        };
        // update : will be called by setParticles()
        smokeSPS.updateParticle = (particle) => {  
            
            if(this._landingSmokeTrigger) {

                particle.isVisible = true;
                particle.velocity.y += smokeGrav;                         // apply gravity to y
                (particle.position).addInPlace(particle.velocity); 
                const scalingDec = 0.015;
                particle.scaling.x -= scalingDec;
                particle.scaling.y -= scalingDec;
                particle.scaling.z -= scalingDec;

                if (particle.scaling.x <= 0 && particle.scaling.y <= 0 && particle.scaling.z <= 0) {
                particle.velocity.x = 0;
                particle.velocity.y = 0;
                particle.velocity.z = 0;
                (particle.position).addInPlace(particle.velocity);  
                particle.isVisible = false;
                }
            }
            else {
                particle.velocity.x = 0;
                particle.velocity.y = 0;
                particle.velocity.z = 0;
                (particle.position).addInPlace(particle.velocity);  
                particle.isVisible = false;
            }

            return particle;
        };

        this._smokeSPS = smokeSPS;

        // init all particle values and set them once to apply textures, colors, etc
        this._smokeSPS.initParticles();
        this._smokeSPS.setParticles();
    }

    private _getLandingTrigger(): boolean {
        return this._landingSmokeTrigger;
    }
    private _setLandingTrigger(trigger: boolean): void {
        this._landingSmokeTrigger = trigger;
    }

    private _createDustSPS() {
        const dustSPS = new SolidParticleSystem("dustSPS", this.scene);
        const boxSize = 0.1;
        const dust = MeshBuilder.CreateBox("dust", {size: boxSize},this.scene);
        const dustNum = 5
        dustSPS.addShape(dust, dustNum); 
        dust.dispose();

        this._dustEmit = dustSPS.buildMesh();
        this._dustEmit.setAbsolutePosition(this.characterMesh.getAbsolutePosition());
        const dustMaterial = new StandardMaterial("dust", this.scene);
        dustMaterial.disableLighting = true;
        dustMaterial.emissiveColor = new Color3(0.3, 0.3, 0.3);
        this._dustEmit.material = dustMaterial;

        dustSPS.computeParticleRotation = false; // prevents from computing particle.rotation
        dustSPS.computeParticleTexture = false; // prevents from computing particle.uvs
        dustSPS.computeParticleColor = false; // prevents from computing particle.color
        dustSPS.computeParticleVertex = false; // prevents from calling the custom updateParticleVertex() function

        // smokeSPS behavior definition
        const dustSpeed = 0.05;
        const dustGravity = -0.01;
        

        //const smokeSpeed;
        //const smokeGrav = 0.01

        // init
        dustSPS.initParticles = () => {
            // just recycle everything
            for (let p = 0; p < dustSPS.nbParticles; p++) {
                dustSPS.particles[p].isVisible = false;
                dustSPS.recycleParticle(dustSPS.particles[p]);
            }
        };

        // recycle
        const charMesh = this.characterMesh.physicsBody;
        dustSPS.recycleParticle = function(particle) {
            // Set particle new velocity, scale and rotation

            //particle.isVisible = false;
            particle.position.x = 0;
            particle.position.y = 0;
            particle.position.z = 0;
            let linVel = charMesh.getLinearVelocity();
            //.velocity.x = (Math.random()*0.2 - 0.1) * dustSpeed;
            if (linVel.x >= -0.5 && linVel.x <= 0.5) {
                particle.velocity.x = (Math.random() * dustSpeed/2 - (dustSpeed/4));
            }
            else {
                particle.velocity.x = ((-linVel.x/3) * dustSpeed) + ((((-linVel.x/3) * dustSpeed)/1.5) - 2*(((-linVel.x/3) * dustSpeed)/1.5)*Math.random()); // shoot paticles directly behind with a variance of +- 10%
            }
            particle.velocity.y = Math.random() * dustSpeed;
            //particle.velocity.z = (Math.random()*0.3) * dustSpeed;
            if (linVel.z >= -0.5 && linVel.z <= 0.5) {
                particle.velocity.z = (Math.random() * dustSpeed/2 - (dustSpeed/4));
            }
            else {
                particle.velocity.z = ((-linVel.z/3) * dustSpeed) + ((((-linVel.z/3) * dustSpeed)/1.5) - 2*(((-linVel.z/3) * dustSpeed)/1.5)*Math.random()); // shoot paticles directly behind with a variance of +- 10%
            }
            var scale = (Math.random()*0.2 - 0.1) + 0.25;
            particle.scaling.x = scale;
            particle.scaling.y = scale;
            particle.scaling.z = scale;

            particle.color.a = 1;

            return particle;
        };
        // update : will be called by setParticles()
        dustSPS.updateParticle = (particle) => {  
            if (this._characterSpeedXZ >= this._baseSpeed-0.5) {
                particle.isVisible = true;
                if (particle.position.y < -0.15) {
                    dustSPS.recycleParticle(particle);
                }
                else {
                    particle.velocity.y += dustGravity;                         // apply gravity to y
                    (particle.position).addInPlace(particle.velocity);      // update particle new position
                    particle.position.y += dustSpeed / 2;
                }
            }
            // if youre not running then freeze the particles and scale them down to nothing
            else {
                if (particle.position.y < -0.15) {
                particle.velocity.x = 0;
                particle.velocity.y = 0;
                particle.velocity.z = 0;
                (particle.position).addInPlace(particle.velocity);  
                particle.isVisible = false;
                }
                else {
                particle.velocity.y += dustGravity;                         // apply gravity to y
                (particle.position).addInPlace(particle.velocity);      // update particle new position
                particle.position.y += dustSpeed / 2;
                }
            }

      // intersection
      // if (bboxesComputed && particle.intersectsMesh(sphere)) {
      //   particle.position.addToRef(mesh.position, tmpPos);                  // particle World position
      //   tmpPos.subtractToRef(sphere.position, tmpNormal);                   // normal to the sphere
      //   tmpNormal.normalize();                                              // normalize the sphere normal
      //   tmpDot = BABYLON.Vector3.Dot(particle.velocity, tmpNormal);            // dot product (velocity, normal)
      //   // bounce result computation
      //   particle.velocity.x = -particle.velocity.x + 2.0 * tmpDot * tmpNormal.x;
      //   particle.velocity.y = -particle.velocity.y + 2.0 * tmpDot * tmpNormal.y;
      //   particle.velocity.z = -particle.velocity.z + 2.0 * tmpDot * tmpNormal.z;
      //   particle.velocity.scaleInPlace(restitution);                      // aply restitution
      //   particle.rotation.x *= -1.0;
      //   particle.rotation.y *= -1.0;
      //   particle.rotation.z *= -1.0;
      // }

            return particle;
        };

        this._dustSPS = dustSPS;

        // init all particle values and set them once to apply textures, colors, etc
        this._dustSPS.initParticles();
        this._dustSPS.setParticles();
    }

    private _createFootprint() {
        
        const footprint = MeshBuilder.CreateBox("footPrint", {height: 0.19, width: 0.19, depth: 0.05}, this.scene);
    // let footPrint = BABYLON.Mesh.CreatePlane('footPrint', 0.19, this.scene);
        footprint.scaling.x = 0.69;
        footprint.rotation.x = Math.PI/2;
        footprint.scaling.z = 0.5;
        footprint.position.y += 1;
        footprint.visibility = 0.45;
        
        const footprintMaterial = new StandardMaterial('footPrint', this.scene);
        footprintMaterial.diffuseColor = new Color3(0.25, 0.25, 0.25);
        footprintMaterial.alpha = 1;
        footprintMaterial.disableLighting = true;
        footprint.material = footprintMaterial;

        this._footprint = footprint;
        this._footprintMaterial = footprintMaterial;

        footprint.setEnabled(false);
        
        this._footprintArray = [];
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