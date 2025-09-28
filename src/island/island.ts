import { Scene, Mesh, Vector3, Color3,TransformNode, SceneLoader, ParticleSystem, Color4, Texture, PBRMetallicRoughnessMaterial, VertexBuffer, AnimationGroup, Sound, ExecuteCodeAction, ActionManager, Tags, MeshBuilder, StandardMaterial, CubeTexture, Vector2, PolygonMeshBuilder, Polygon, PBRMaterial, PhysicsImpostor, LoadAssetContainerAsync, AbstractMesh, HemisphericLight, DirectionalLight, SpotLight, PointLight, LensFlareSystem, CreateSphere, LensFlare, ShadowGenerator, AssetContainer, ImportMeshAsync, ArcRotateCamera, Vector4, Quaternion, Matrix, Axis, Bone, Space, Skeleton, DefaultRenderingPipeline, DepthOfFieldEffectBlurLevel } from "@babylonjs/core";
import { WaterMaterial } from "@babylonjs/materials";
import earcut from "earcut";
import HavokPhysics, { HavokPhysicsWithBindings } from "@babylonjs/havok";
import { PhysicsAggregate, HavokPlugin, PhysicsBody, PhysicsMotionType, PhysicsShapeMesh, PhysicsShape, PhysicsShapeType, PhysicsShapeBox, PhysicsShapeContainer, PhysicsShapeCapsule } from "@babylonjs/core/Physics";
//import { Player } from "./characterController";

export class Island {
    private _scene: Scene;

    public _earcut = earcut;

    //Meshes
    private _skybox: Mesh;
    private _skyboxMaterial: StandardMaterial;

    private _waterMesh: Mesh;
    public _waterMtl: WaterMaterial;

    private _sandMaterial: PBRMaterial;
    private _sandMesh: Mesh;

    private _flowerArr: Array<Mesh>;
    private _grass: Mesh; // Flower
    
    private _grassFloor: Mesh;
    private _houseMesh: Mesh;
    private _pierMesh: Mesh;

    private _treeContainer: AssetContainer;
    private _treeMesh: Mesh;
    private _treeArr: Array<any>;
    private _treeMeshList: Array<Mesh>;
    private static _scratchMatrix = new Matrix();
    
    private _hemiLight: HemisphericLight;

    private _directLight: DirectionalLight;
    public directLightShadowGen: ShadowGenerator;
    
    public spotLight: SpotLight;
    public spotLightShadowGen: ShadowGenerator;

    private _lensFlareLight: PointLight;
    private _lensFlareSystem: LensFlareSystem;

    private _sunSphere: Mesh;
    private _sunSphereMtl: StandardMaterial;
    //....

    private _islandContainer: AssetContainer;

    // Layers
    private static LAYER_GROUND = 1 << 0;
    private static LAYER_PLAYER = 1 << 1;

    // Triggers
    private _shadowGenActive: boolean;

    public createdAssets: any;
    public importedAssets: any;

    public camera: ArcRotateCamera;

    public pipeline: DefaultRenderingPipeline;

    private _character?: Mesh;

    constructor(scene: Scene) {
        this._scene = scene;      
        this._scene.useRightHandedSystem = true; 
        this._scene.collisionsEnabled = true;
        this.camera = new ArcRotateCamera("Camera", Math.PI / 2, Math.PI / 2, 2, Vector3.Zero(), scene);
        this.camera.lowerRadiusLimit = 2;
        this.camera.upperRadiusLimit = 8;
        this.camera.lowerBetaLimit = 0.1; // Stopes the camera from going through the ground
        this.camera.upperBetaLimit = (Math.PI/2) - 0.1; // Stops the camera from doing more than a 90 deg angle looking down
        this.camera.angularSensibilityX = 1000;
        this.camera.angularSensibilityY = 1000;
        this.camera.wheelPrecision = 75;
        //this.camera.checkCollisions = true;
        //this.camera.collisionRadius = new Vector3(1, 1, 1);
        this._shadowGenActive = true;
        // this.camera.minZ
        // this._character = this._scene.getMeshByName("charParent") as Mesh;

        this.pipeline = new DefaultRenderingPipeline("defaultPipeline", true, this._scene,);
        this.pipeline.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.High;
        this.pipeline.depthOfFieldEnabled = true;
        this.pipeline.imageProcessing.exposure = 1.5;
        this.pipeline.fxaaEnabled = true;

//#region Materials

        const skyboxMaterial = new StandardMaterial("skyBox", this._scene);
    
        skyboxMaterial.backFaceCulling = false;

        skyboxMaterial.reflectionTexture = new CubeTexture("../textures/TropicalSunnyDay", this._scene);
        skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;

        skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
        skyboxMaterial.specularColor = new Color3(0, 0, 0);

        skyboxMaterial.disableLighting = true;

        this._skyboxMaterial = skyboxMaterial;
        

        // Now create the material to be applied to the water "plane"
        const waterMtl = new WaterMaterial("waterMaterial", this._scene, new Vector2(256, 256));

        waterMtl.backFaceCulling = true;

        waterMtl.bumpTexture = new Texture("../textures/Water/waterbump.png", this._scene);

        waterMtl.windForce = -3;
        waterMtl.waveHeight = 0.008;    
        waterMtl.waveSpeed = 50.0;

        waterMtl.waterColor = new Color3(0, 0.13, 0.239); //0.12, 0.7, 1
        waterMtl.colorBlendFactor = 0.2;

        // Add the skybox to the render list of the water material for reflections of the sky
        waterMtl.addToRenderList(this._skybox);

        this._waterMtl = waterMtl;

        // Next create the material to be applied to the sand meshes
        const sandMaterial = new PBRMaterial("sandMaterial", this._scene);
        let uvScaleNum = 8;

        let _albedoTexture = new Texture("../textures/Sand/Sand_001_COLOR.png", this._scene);
        _albedoTexture.uScale = uvScaleNum;
        _albedoTexture.vScale = uvScaleNum;

        let _bumpTexture = new Texture("../textures/Sand/Sand_001_NRM.png", this._scene);
        _bumpTexture.uScale = uvScaleNum;
        _bumpTexture.vScale = uvScaleNum;

        let _ambientTexture = new Texture("../textures/Sand/Sand_001_OCC.png", this._scene);
        _ambientTexture.uScale = uvScaleNum;
        _ambientTexture.vScale = uvScaleNum;
        
        sandMaterial.albedoTexture = _albedoTexture;
        sandMaterial.bumpTexture = _bumpTexture;
        sandMaterial.ambientTexture = _ambientTexture;
        sandMaterial.roughness = 1;
        sandMaterial.metallic = 0.65;

        this._sandMaterial = sandMaterial

        // Create the sun sphere material
        const sunSphereMtl = new StandardMaterial("white", this._scene);
        sunSphereMtl.diffuseColor = new Color3(0, 0, 0);
        sunSphereMtl.specularColor = new Color3(0, 0, 0);
        sunSphereMtl.emissiveColor = new Color3(1, 1, 1);

        this._sunSphereMtl = sunSphereMtl;
//#endregion

    }

    public async load() {
        this.createdAssets = await this._createAssets();
        this.importedAssets =  await this._loadAssets();
    }

    private _markAsGround(physicsBody: PhysicsBody) {
        physicsBody.setCollisionCallbackEnabled(true);
        physicsBody.shape.filterMembershipMask = Island.LAYER_GROUND;
        physicsBody.shape.filterCollideMask = Island.LAYER_PLAYER;

        (physicsBody.transformNode as AbstractMesh).metadata ??= {};
        (physicsBody.transformNode as AbstractMesh).metadata.isGround = true;
    }

    private async _createAssets() {
        await this._createLights();
        await this._createShadowgen();
        await this._setUpCamPipeMoves();
        await this._createSkybox();
        await this._createWater();
        await this._createSand();   
    }

//#region Skybox
    private async _createSkybox() {
        // Create the skybox -- out in separate fun to create meshes
        const skybox = MeshBuilder.CreateBox("skyBox", { size: 1000 }, this._scene);
        skybox.position.y -= 60;
        skybox.scaling.z = -1;
        skybox.material = this._skyboxMaterial
        this._skybox = skybox;
    }
//#endregion
    
//#region Lights
    private async _createLights() {
        // create all lighting, lens flares, and the skybox
        const hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), this._scene);
        hemiLight.intensity = 0.9;

        this._hemiLight = hemiLight;
        
        const directLight = new DirectionalLight("directLight", new Vector3(25, -25, 30), this._scene);
        directLight.position = new Vector3(-25, 25, -30);
        directLight.intensity = 1.2;

        this._directLight = directLight;

        const spotLight = new SpotLight("spotLight", new Vector3(-25, 25, -30), new Vector3(25, -25, 30), 6.6, 3, this._scene); //6.6 for sharp
        spotLight.intensity = 100;
        spotLight.diffuse = new Color3(0.49,0.49,0.49);
        spotLight.direction = new Vector3(2, -5, 4);
        
        this.spotLight = spotLight;

        // skybox sun is located at (-180, 120, -480)
        const lensFlareLight = new PointLight("lensFlareLight", new Vector3(-180, 120, -480), this._scene);
        lensFlareLight.intensity = 0;

        this._lensFlareLight = lensFlareLight;
        // create light sphere/"sun"
        const sunSphere = CreateSphere("sunSphere", {segments: 16, diameter: 0.5}, this._scene);
        sunSphere.material = this._sunSphereMtl;
        sunSphere.position = this._lensFlareLight.position;
        //this._lensFlareLight.parent = sunSphere;
        this._sunSphere = sunSphere;
        
        // create the lens flare
        const lensFlareSystem = new LensFlareSystem("lensFlareSystem", this._lensFlareLight, this._scene);
        const flare00 = new LensFlare(0.2, 0, new Color3(1, 1, 1), "../textures/Flare2.png", lensFlareSystem);
        const flare01 = new LensFlare(0.5, 0.2, new Color3(0.5, 0.5, 1), "../textures/Flare3.png", lensFlareSystem);
        const flare02 = new LensFlare(0.2, 1.0, new Color3(1, 1, 1), "../textures/Flare3.png", lensFlareSystem);
        const flare03 = new LensFlare(0.4, 0.4, new Color3(1, 0.5, 1), "../textures/Flare.png", lensFlareSystem);
        const flare04 = new LensFlare(0.1, 0.6, new Color3(1, 1, 1), "../textures/Flare2.png", lensFlareSystem);
        const flare05 = new LensFlare(0.3, 0.8, new Color3(1, 1, 1), "../textures/Flare3.png", lensFlareSystem);

        this._lensFlareSystem = lensFlareSystem;
    }
//#endregion

//#region Pipeline/Camera moves
    private async _setUpCamPipeMoves() {
    
        // this._character ??=  this._scene.getMeshByName("charParent") as Mesh; 
        
        this._scene.onBeforeCameraRenderObservable.add(() => {
            
            // camera radius calculation 
            if (this.camera.beta > Math.PI/3) {
                this.camera.radius = 8-(5*(this.camera.beta-Math.PI/3)/((Math.PI/2-Math.PI/3)-0.1));
                let targetOffsetY = (-0.5*(this.camera.beta-Math.PI/3)/((Math.PI/2-Math.PI/3)-0.1));
                this.camera.targetScreenOffset = new Vector2(0,targetOffsetY);
                this.pipeline.depthOfField.focalLength = this.camera.radius*50;
                this.pipeline.depthOfField.fStop = this.camera.radius+(1.2*(this.camera.beta-Math.PI/3)/((Math.PI/2-Math.PI/3)-0.1));
                this.pipeline.depthOfField.focusDistance = (this.camera.radius*1000)+(1200*(this.camera.beta-Math.PI/3)/((Math.PI/2-Math.PI/3)-0.1));
            }
            else {
                let targetOffsetY = 0.5-(0.5*(this.camera.beta/(Math.PI/3)));
                this.camera.targetScreenOffset = new Vector2(0,targetOffsetY);
                this.camera.radius = 8;
                this.pipeline.depthOfField.focalLength = this.camera.radius*50;
                this.pipeline.depthOfField.fStop = this.camera.radius;
                this.pipeline.depthOfField.focusDistance = this.camera.radius*1000;
            }
        });
}

//#region ShadowGen
    private async _createShadowgen() {
        // create a shadow generator
        if (this._shadowGenActive) {
            const directLightShadowGen = new ShadowGenerator(5096, this._directLight);
            
            // shadowGenerator2.blurKernel = 32;
            directLightShadowGen.setDarkness(0);
            this.directLightShadowGen = directLightShadowGen;
            
            const spotLightShadowGen = new ShadowGenerator(5096, this.spotLight);
            spotLightShadowGen.useBlurExponentialShadowMap = true;
            // shadowGenerator4.blurKernel = 32;
            spotLightShadowGen.setDarkness(0);
            this.spotLightShadowGen = spotLightShadowGen;
        }
    }
//#endregion

//#region Water
    private async _createWater() {
        // Create the water mesh and position it
        const waterMesh = MeshBuilder.CreateGround("waterMesh", { width: 100, height: 100, subdivisions: 32, updatable: false}, this._scene);
        waterMesh.position.y = -0.12;
        // waterMesh.position.y = -0.5;
        waterMesh.position.z -= 8;
        waterMesh.rotation.y = Math.PI;

        waterMesh.material = this._waterMtl;

        this._waterMesh = waterMesh; 
    }
//#endregion

//#region Sand
    private async _createSand() {
        // Create an array to hold all of the ground sand meshes that will be merged into one once they are all created
        let sandArr = [];

        // create the base ground for the scene -- this will be sand to simulate an island beachfront with 4 polygons extruding into the sea
        let sand = MeshBuilder.CreateBox("sand", {
        width: 30,
        height: 1,
        depth: 30
        });
        sand.position.y -= 0.45;
        sand.position.z -= 8;
        // sand.checkCollisions = false;
        sand.material = this._sandMaterial;
        // sand.receiveShadows = true;
        //sand.alwaysSelectAsActiveMesh = true;
        sand.freezeWorldMatrix();
        sandArr.push(sand);

        let corners = [ 
            new Vector2(-25, -5),
            new Vector2(-15, 5),
            new Vector2(15, 5),
            new Vector2(25, -5),
        ];
        let poly_tri: PolygonMeshBuilder;
        let lowSand: Mesh;

        for (var i=1; i<6; i++) {
            if (i==1) {
                poly_tri = new PolygonMeshBuilder("polytri", corners, this._scene, earcut);
                lowSand = poly_tri.build(null, 0.1);
                lowSand.position.y-=0.45;
                lowSand.position.z-=27.95;
                lowSand.rotation.x-=0.1
            }
            else if (i==2) {
                corners = [ 
                    new Vector2(-25, -5),
                    new Vector2(-15, 5),
                    new Vector2(15, 5),
                    new Vector2(25, -5),
                ];
                poly_tri = new PolygonMeshBuilder("polytri", corners, this._scene, earcut);
                lowSand = poly_tri.build(null, 0.1);
                lowSand.position.y-=0.45;
                lowSand.position.x += 19.9;
                lowSand.position.z-=8;
                lowSand.rotation.x-=0.1
                lowSand.rotation.y-=Math.PI/2;
            }
            else if (i==3) {
                poly_tri = new PolygonMeshBuilder("polytri", corners, this._scene, earcut);
                lowSand = poly_tri.build(null, 0.1);
                lowSand.position.y-=0.45;
                lowSand.position.x -= 19.9;//5
                lowSand.position.z-=8;
                lowSand.rotation.x-=0.1
                lowSand.rotation.y += Math.PI/2;
            }
            else if (i==4) {
                poly_tri = new PolygonMeshBuilder("polytri", corners, this._scene, earcut);
                lowSand = poly_tri.build(null, 0.1);
                lowSand.position.y-=0.45;
                lowSand.position.z+=11.9
                lowSand.rotation.x-=0.1
                lowSand.rotation.y = Math.PI;
            }
            else if (i==5) {
                lowSand = MeshBuilder.CreatePlane('bottomPlane', { size: 100 } , this._scene);
                lowSand.position.y = -1.2;
                lowSand.position.z-=8;
                lowSand.rotation.x = Math.PI/2;
            }
            lowSand.material = this._sandMaterial;
            lowSand.receiveShadows = true;
            //lowSand.checkCollisions = false;
            //lowSand.alwaysSelectAsActiveMesh = true;
            //water.addToRenderList(lowSand);
            //lowSand.material.freeze();
            lowSand.freezeWorldMatrix();
            sandArr.push(lowSand);
        }

        let sandMesh = Mesh.MergeMeshes(sandArr);
        sandMesh.physicsBody = new PhysicsBody(sandMesh, PhysicsMotionType.STATIC, true, this._scene);
        sandMesh.physicsBody.shape = new PhysicsShapeMesh(sandMesh, this._scene);
        this._markAsGround(sandMesh.physicsBody);
        sandMesh.receiveShadows = true;
        sandMesh.checkCollisions = true;
        //pathEntrance.alwaysSelectAsActiveMesh = true;
        sandMesh.isPickable = true;
        sandMesh.metadata ??= {};
        sandMesh.metadata.groundType = "Sand";
        sandMesh.freezeWorldMatrix();
        this._waterMtl.addToRenderList(sandMesh);
        this._sandMesh = sandMesh;
    }
//#endregion

//#region Tree
    private _createFrond(leafInnerBone: Bone) {
        
        // Create the physics body and disable prestep so the collider moves with the animation
        const leafBody = new PhysicsBody( leafInnerBone.getTransformNode(), PhysicsMotionType.ANIMATED, false, this._scene);
        leafBody.disablePreStep = false;

        
        const leafSize = new Vector3(0.6, 0.08, 0.9);
        const leafShape= new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), leafSize, this._scene);
        const leafCompound = new PhysicsShapeContainer(this._scene);

        const innerOffset = 0.35;
        const outerOffset = 1.2;
        const xOff = -0.15;
        const zOff = -0.15;

        const innerRot = new Vector3(Math.PI/2, Math.PI/6, 0).toQuaternion();
        const outerRot = new Vector3(Math.PI/3, Math.PI/6, 0).toQuaternion();
        
        leafCompound.addChild(leafShape, new Vector3(0,innerOffset,0), innerRot);
        leafCompound.addChild(leafShape, new Vector3(xOff,outerOffset,zOff), outerRot);

        leafBody.shape = leafCompound;
        this._markAsGround(leafBody);
        
    }


    private _createPalmPhysics(visualRoot: TransformNode, palmPrims: Mesh[]) {

        const trunkBody = new PhysicsBody(visualRoot, PhysicsMotionType.STATIC, false, this._scene);
        const boundingInfo = palmPrims[2].getBoundingInfo();
        const trunkDimensions = {
            height: boundingInfo.boundingBox.maximum._y - boundingInfo.boundingBox.minimum._y,
            width: boundingInfo.boundingBox.maximum._x - boundingInfo.boundingBox.minimum._x,
            depth: boundingInfo.boundingBox.maximum._z - boundingInfo.boundingBox.minimum._z
        };
        console.log(trunkDimensions);
        const trunkBoxes = [
            { center: new Vector3(0, (trunkDimensions.height/3)/2, 0), size: new Vector3((trunkDimensions.width*0.8), (trunkDimensions.height/3), (trunkDimensions.depth*0.8)) },
            { center: new Vector3(0, (trunkDimensions.height/3)+((trunkDimensions.height/3)/2), 0), size: new Vector3((trunkDimensions.width*0.6), (trunkDimensions.height/3), (trunkDimensions.depth*0.6)) },
            { center: new Vector3(0, (2*(trunkDimensions.height/3))+((trunkDimensions.height/3)/2), 0), size: new Vector3((trunkDimensions.width*0.4), (trunkDimensions.height/3), (trunkDimensions.depth*0.4)) },
        ];

        const trunkCompound = new PhysicsShapeContainer(this._scene);
        for (const b of trunkBoxes) {
            const box = new PhysicsShapeBox(b.center, Quaternion.Identity(), b.size, this._scene);
            trunkCompound.addChild(box, Vector3.Zero(), Quaternion.Identity());
        }
        trunkBody.shape = trunkCompound;
        trunkBody.disablePreStep = false;
        
        const skeleton = palmPrims[0].skeleton;

        // Quick helper func to grab the bones
        const B = (name: string) => skeleton.bones.find(b => b.name === name)!;

        const FRONDS = [
        { inner: "Bone.003", outer: "Bone.013"},
        { inner: "Bone.004", outer: "Bone.011"},
        { inner: "Bone.005", outer: "Bone.015"},
        { inner: "Bone.006", outer: "Bone.017"},
        { inner: "Bone.007", outer: "Bone.014"},
        { inner: "Bone.008", outer: "Bone.012"},
        { inner: "Bone.009", outer: "Bone.016"},
        { inner: "Bone.010", outer: "Bone.018"}
        ];

        for (const f of FRONDS) {
            this._createFrond(B(f.inner));
        }
    }
    
    private _createPalmTree() {
        const palmGltfRoot: TransformNode = this._treeContainer.meshes[0];
        const palmVisualRoot: TransformNode = palmGltfRoot?.getChildren()[1] as TransformNode;
        const palmArmatureRoot: TransformNode = palmGltfRoot?.getChildren()[0] as TransformNode;

        palmVisualRoot.setParent(null);
        palmArmatureRoot.setParent(palmVisualRoot, true);
        
        palmGltfRoot.dispose();

        const prims = palmVisualRoot.getChildMeshes() as Mesh[];
        const palmTrunk = prims[2];
        palmTrunk.name = "palmTrunk";
        palmTrunk.isPickable = true;
        palmTrunk.metadata ??= {};
        palmTrunk.metadata.groundType = "Wood";
        this.directLightShadowGen.addShadowCaster(palmTrunk);
        const palmBottomLeaf = prims[1];
        palmBottomLeaf.name = "palmBottomLeaf";
        palmBottomLeaf.isPickable = true;
        palmBottomLeaf.metadata ??= {};
        palmBottomLeaf.metadata.groundType = "PalmLeaf";
        this.directLightShadowGen.addShadowCaster(palmBottomLeaf);
        const palmTopLeaf = prims[0];
        palmTopLeaf.name = "palmTopLeaf";
        palmTopLeaf.isPickable = true;
        palmTopLeaf.metadata ??= {};
        palmTopLeaf.metadata.groundType = "PalmLeaf";
        this.directLightShadowGen.addShadowCaster(palmTopLeaf);
        
        let spawnPos = new Vector3(2, 0.08, -2);
        palmVisualRoot.setAbsolutePosition(spawnPos);
        this._createPalmPhysics(palmVisualRoot, prims);
    }

    private async _loadTrees() {

        // First get the asset container containing the mesh, skeleton, and animation group
        const treeImport =  await LoadAssetContainerAsync("../models/environment/palmTree.glb", this._scene);
        this._treeContainer = treeImport;
        this._treeContainer.addAllToScene();
        this._createPalmTree();

        

        // this._treeContainer.addAllToScene();
    }

//#endregion

    private async _loadAssets() {
        // import the meshes to use in the scene -- handle all of their uses in the executeWhenReady func
        this._loadTrees();

//#region GrassFloor, House, and Pier
        // import the grass, house, and pier into an asset container
        const islandImport =  await LoadAssetContainerAsync("../models/environment/small_world_glb.glb", this._scene);

        // get the root node created by babylon and loop through the children(grass, house, pier) assigning each a physics body
        let islandMeshParent = islandImport.meshes[0];
        let islandMeshList = islandMeshParent.getChildMeshes();
        islandMeshList.forEach(m => {
            // adjust each mesh material while looping through
            m.material.backFaceCulling = true; // stops rendering of meshes not in sight of the camera
            m.receiveShadows = true;
            m.checkCollisions = true;
            m.freezeWorldMatrix(); // freezes mesh geometry..helps with performance and none of these meshes will move
            this._waterMtl.addToRenderList(m); // allows mesh to be reflected in the water
            if (m.name === "House") {
                m.isPickable = true;
                m.metadata ??= {};
                m.metadata.groundType = "Wood";
                this._houseMesh = m as Mesh;
                this.directLightShadowGen.addShadowCaster(m);
            }
            if (m.name === "Grass") {
                m.isPickable = true;
                m.metadata ??= {};
                m.metadata.groundType = "Grass";
                this._grassFloor = m as Mesh;
            }
            if (m.name === "Pier") {
                m.isPickable = true;
                m.metadata ??= {};
                m.metadata.groundType = "Wood";
                this._pierMesh = m as Mesh;
            }
            
            //set the mesh parent to null so they are no longer in a root array within the scene
            m.setParent(null);

            // create a body and shape for each mesh..using a physics shape mesh because they geomerty is not too complicated
            m.physicsBody = new PhysicsBody(m, PhysicsMotionType.STATIC, true, this._scene);
            m.physicsBody.shape = new PhysicsShapeMesh(m as Mesh, this._scene);
            this._markAsGround(m.physicsBody);
            
        });

        // dispose of the old root node
        islandMeshParent.dispose();
//#endregion
 
//#region Grass and Flowers
        // import the grass and flowers
        const grassAndFlowersImport =  await LoadAssetContainerAsync("../models/environment/grass_and_flowers_glb.glb", this._scene);
        // console.log("GRASS AND FLOWERS\n" +
        //             "===========\n");
        // console.log(grassAndFlowersImport);
        this._flowerArr = [];
        let gfParent = grassAndFlowersImport.meshes[0];
        let gfMeshList = gfParent.getChildMeshes();
        gfMeshList.forEach(m => {
            m.checkCollisions = false;
            m.freezeWorldMatrix();
            //m.setEnabled(false);
            m.setParent(null);
            m.receiveShadows=true;

            if (m.name !== "Grass_3") {
                this._flowerArr.push(m as Mesh);
            } 
            else {
                this._grass = m as Mesh;
            }
        });

        gfParent.dispose();
//#endregion

//#region FishingRod
        const fishingRodImport =  await LoadAssetContainerAsync("../models/items/fishing_rod_glb.glb", this._scene);

        let rodParent = fishingRodImport.meshes[0];
        let rodMeshList = rodParent.getChildMeshes();
        rodMeshList[0].checkCollisions = true;
        rodMeshList[0].setParent(null);
        rodMeshList[0].receiveShadows = true;
        this.directLightShadowGen.addShadowCaster(rodMeshList[0]);
        
        // var music = new Sound("IslandTheme", "assets/islandScene/music/islandSong.mp3", this._scene, null, {
        //     loop: true,
        //     autoplay: false
        //   });
        // const fishingRod = fishingRodImport.instantiateModelsToScene( (name) => 'FishingRod' );
        // const fishingRodRoot = fishingRod.rootNodes[0];
        // fishingRodRoot..rotation = new Vector3(140*Math.PI/180, 95*Math.PI/180, 142*Math.PI/180);
        // fishingRod.meshes[0].position.x += 0.35;
        // fishingRod.meshes[0].position.y += 0.05;
        // fishingRod.meshes[0].position.z -=0.05;

        rodParent.dispose();
//#endregion

        //this._generateFlowersAndTrees();

        islandImport.addAllToScene();
        //this._treeContainer.addAllToScene();
        grassAndFlowersImport.addAllToScene();
        fishingRodImport.addAllToScene();
        
        this.directLightShadowGen.getShadowMap().refreshRate = 0;
    }


    private _generateFlowersAndTrees() {
        let targetMesh = this._grassFloor;
        let instanceNum = 15;
        let clumpArr = [];
        let offsetX;
        let offsetZ

        for (let i=0; i<8; i++) {
            let clumpPositionX = targetMesh.position.x+6 - (Math.random()*12);
            let clumpPositionZ = targetMesh.position.z+4 - (Math.random()*11);
            while ( (clumpPositionX < 0 && clumpPositionX > -3) && (clumpPositionZ > 1 && clumpPositionZ < 4) ) 
            { //(clumpPositionZ > 1 && clumpPositionZ < 3)
                clumpPositionX = targetMesh.position.x+6 - (Math.random()*12);
                clumpPositionZ = targetMesh.position.z+4 - (Math.random()*11);
            }
            clumpArr.push({x: clumpPositionX, z: clumpPositionZ});
            if (i<2) {
                let instance = this._treeContainer.instantiateModelsToScene((name) => "palmTree_" + i);
                
                //console.log(instance);
                instance.rootNodes.forEach(m => {
                    //console.log(m);
                    let p = m as Mesh;
                    p.position.x = clumpPositionX;
                    p.position.z = clumpPositionX;
                    p.physicsBody = new PhysicsBody(p, PhysicsMotionType.STATIC, true, this._scene);
                    p.physicsBody.shape = new PhysicsShapeMesh(p, this._scene);
                    this.directLightShadowGen.addShadowCaster(p);
                });
                /*mj
                this._treeMeshList.forEach((m, index) => {
                    //let instance = m.createInstance("palmTree_" + index)
                    instance.position.x = clumpPositionX;
                    instance.position.y = 0.08;
                    instance.position.z = clumpPositionZ;
                    instance.rotation.y = Math.random() * (2*Math.PI);
                    instance.physicsBody = new PhysicsBody(instance, PhysicsMotionType.STATIC, true, this._scene);
                    instance.physicsBody.shape = new PhysicsShapeMesh(m as Mesh, this._scene);
                    instance.freezeWorldMatrix();
                    //instance.ignoreNonUniformScaling = true;
                    //instance.alwaysSelectAsActiveMesh = true;
                    this.directLightShadowGen.addShadowCaster(instance);
                    
                })  
                  */  
            }
            for (var j = 0; j < instanceNum; j++) {
                offsetX = 1.1 - (Math.random() * 2.1); 
                offsetZ = 1.1 - (Math.random() * 2.1);
                let instance = this._grass.createInstance("Grass_" + i);
                instance.scaling = (new Vector3(0.1, 0.1, 0.04));
                instance.position.x = clumpPositionX + offsetX; 
                instance.position.y = targetMesh.position.y+0.08;
                instance.position.z = clumpPositionZ + offsetZ;
                //instance.ignoreNonUniformScaling = true;
                //instance.alwaysSelectAsActiveMesh = true;
                instance.checkCollisions = false;
                instance.freezeWorldMatrix();
                //scene.getLightByName("spotLight").getShadowGenerator().addShadowCaster(scene.getMeshByName("Grass_Blade_"+ i));
            }
        }
        clumpArr.forEach((clump, index) => {
            instanceNum = 3;
            for (var i = 0; i < instanceNum; i++) {
                //let targetMesh = scene.getMeshByName("Grass");
                offsetX = 1.1 - (Math.random() * 2.2); 
                offsetZ = 1.1 - (Math.random() * 2.2);
                // checkRay(0,-1,0,"ground",new Vector3(offsetX, 2.5, offsetZ));
                // while(offsetX < 0 && offsetX > -3) {
                //     offsetX = 6 - Math.random()*12;
                // }
                // while(offsetZ > 1 && offsetZ < 3) {
                //     offsetZ = 6 - Math.random()*12;
                // }
                let flowerIndex = Math.floor(Math.random()*(this._flowerArr.length-0.1));
                //console.log(flowerIndex);
                let instance = this._flowerArr[flowerIndex].createInstance("Flower_" + i*index);
                instance.scaling = (new Vector3(0.1, 0.1, 0.04));
                instance.position.x = clump.x + offsetX;
                instance.position.y = this._grassFloor.position.y+0.15;
                instance.position.z = clump.z + offsetZ;
                //instance.ignoreNonUniformScaling = true;
                //instance.alwaysSelectAsActiveMesh = true;
                instance.checkCollisions = false;
                instance.freezeWorldMatrix();
                //scene.getLightByName("spotLight").getShadowGenerator().addShadowCaster(scene.getMeshByName("Grass_Blade_"+ i));
                //instance.physicsImpostor = new PhysicsImpostor(instance, PhysicsImpostor.MeshImpostor,{mass:0, friction:1, restitution: 0},scene);
            }
        });

        instanceNum = 7;
        let offsetY = 0;
        for (var i = 2; i<5; i++) {
            // if (i<2) {
            //     offsetX = targetMesh.position.x+6.5 - Math.random()*13;
            //     offsetZ = targetMesh.position.z-8.5 + Math.random()*8.8;
            //     while(offsetX < 0.2 && offsetX > -3.2) {
            //         offsetX = targetMesh.position.x+6.5 - Math.random()*13; 
            //     }
            //     // while(offsetZ < 0.3) {
            //     //     offsetZ = targetMesh.position.z-8.5 + Math.random()*8.8;
            //     // }
            //     offsetY = 0.08;
            // }
            // else 
            if (i<3) {
                offsetX = targetMesh.position.x-4 - (Math.random()*9);
                offsetZ = targetMesh.position.z-18 + (Math.random()*23);
                
                while((offsetZ > -9 && offsetZ < 5) && (offsetX < 0 && offsetX > -7)) {
                    offsetX = targetMesh.position.x-4 - (Math.random()*9);
                    offsetZ = targetMesh.position.z-18 + (Math.random()*23);
                }
                // if (offsetZ<5) {
                //     while((offsetX > -7 && offsetX < 7) ) {
                //         offsetX = targetMesh.position.x - (Math.random()*13);
                //     }
                // }
                // else {
                //     offsetX = targetMesh.position.x - (Math.random()*13);
                // }
                offsetY = 0;
            }
            else {
                offsetX = targetMesh.position.x+13 - (Math.random()*9);
                offsetZ = targetMesh.position.z-18 + (Math.random()*23);
                
                while((offsetZ > -9 && offsetZ < 5) && (offsetX > 0 && offsetX < 7)) {
                    offsetZ = targetMesh.position.z-18 + (Math.random()*23);
                    offsetX = targetMesh.position.x+13 - (Math.random()*9);
                }
                // if (offsetZ<5) {
                //     while((offsetX > 0 && offsetX < 7) ) {
                //         offsetX = targetMesh.position.x + 12 - (Math.random()*5);
                //     }
                // }
                // else {
                //     offsetX = targetMesh.position.x + 12 - (Math.random()*12);
                // }
                offsetY = 0;
            }

            this
            /*
            this._treeMeshList.forEach(m => {
                let instance = m.createInstance("palmTree_" + i);
                instance.position.x = offsetX;
                instance.position.y = offsetY;
                instance.position.z = offsetZ;
                instance.rotation.y = Math.random() * (2*Math.PI);
                //instance.ignoreNonUniformScaling = true;
                //instance.alwaysSelectAsActiveMesh = true;
                instance.physicsBody = new PhysicsBody(instance, PhysicsMotionType.STATIC, true, this._scene);
                instance.physicsBody.shape = new PhysicsShapeMesh(m as Mesh, this._scene); 
                instance.checkCollisions = false;
                instance.freezeWorldMatrix();
                this.directLightShadowGen.addShadowCaster(instance);
            });
            */
        }
        
    }

}

