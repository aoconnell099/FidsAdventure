import { Scene, Mesh, Vector3, Color3,TransformNode, SceneLoader, ParticleSystem, Color4, Texture, PBRMetallicRoughnessMaterial, VertexBuffer, AnimationGroup, Sound, ExecuteCodeAction, ActionManager, Tags, MeshBuilder, StandardMaterial, CubeTexture, Vector2, PolygonMeshBuilder, Polygon, PBRMaterial, PhysicsImpostor, LoadAssetContainerAsync, AbstractMesh, HemisphericLight, DirectionalLight, SpotLight, PointLight, LensFlareSystem, CreateSphere, LensFlare, ShadowGenerator, AssetContainer, ImportMeshAsync, ArcRotateCamera, Vector4, Quaternion, Matrix, Axis, Bone, Space, Skeleton, DefaultRenderingPipeline, DepthOfFieldEffectBlurLevel, FreeCamera, Scalar } from "@babylonjs/core";
import { WaterMaterial } from "@babylonjs/materials";
import earcut from "earcut";
import HavokPhysics, { HavokPhysicsWithBindings } from "@babylonjs/havok";
import { PhysicsAggregate, HavokPlugin, PhysicsBody, PhysicsMotionType, PhysicsShapeMesh, PhysicsShape, PhysicsShapeType, PhysicsShapeBox, PhysicsShapeContainer, PhysicsShapeCapsule } from "@babylonjs/core/Physics";
//import { Player } from "./characterController";

type BoundsXZ = { min: Vector2; max: Vector2 };

interface PoissonOpts {
    bounds: BoundsXZ;                // AABB that encloses your domain
    isAllowed: (p: Vector2) => boolean;  // returns true if p is inside your shape *and* allowed
    r: number;                       // minimum spacing
    maxPoints?: number;              // default 8
    k?: number;                      // candidates per active point (default 30)
    seed?: number;                   // optional determinism
    initialSeeds?: number;           // default 1; >1 helps with disconnected shapes
}

export class Island {
    private _scene: Scene;

    public _earcut = earcut;

    // Cameras
    public camera: ArcRotateCamera;
    public uiCamera: FreeCamera;

    // Lights
    private _hemiLight: HemisphericLight;
    private _directLight: DirectionalLight;
    public spotLight: SpotLight;
    private _lensFlareLight: PointLight;

    // Pipeline
    public pipeline: DefaultRenderingPipeline;

    // Shadow Gen
    public directLightShadowGen: ShadowGenerator;
    public spotLightShadowGen: ShadowGenerator;

    // Lens Flare
    private _lensFlareSystem: LensFlareSystem;
  
    // Materials
    private _skyboxMaterial: StandardMaterial;
    public _waterMtl: WaterMaterial;
    private _sandMaterial: PBRMaterial;
    private _sunSphereMtl: StandardMaterial;

    // Layers / Masks
    private static LAYER_GROUND = 1 << 0;
    private static LAYER_PLAYER = 1 << 1;

    private static UI_MASK = 0x10000000;

    // Triggers
    private _shadowGenActive: boolean;

    // Asset Containers
    private _grassHousePierContainer: AssetContainer;
    private _treeContainer: AssetContainer;
    private _grassAndFlowersContainer: AssetContainer;
    private _fishingRodContainer: AssetContainer;

    public createdAssets: any;
    public importedAssets: any;

    // Meshes
    private _skybox: Mesh;
    private _sunSphere: Mesh;
    private _waterMesh: Mesh;
    private _sandMesh: Mesh;

    private _grassFloor: Mesh;
    private _houseMesh: Mesh;
    private _pierMesh: Mesh;
    
    private _treeMesh: Mesh; 
    private _treePositions: Vector2[];
    private _flowerArr: Mesh[]; // Array of different flower meshes
    private _grassFlower: Mesh; // Flower

    // -- Not Currently used
    private _treeArr: Array<any>;
    private _treeMeshList: Array<Mesh>;

    private _character?: Mesh;

    constructor(scene: Scene) {
        this._scene = scene;      
        this._scene.useRightHandedSystem = true; 
        this._scene.collisionsEnabled = true;

        // #region Camera and Pipeline
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

        this.uiCamera = new FreeCamera("uiCam", Vector3.Zero(), this._scene);
        this.uiCamera.layerMask = Island.UI_MASK;
        this._scene.activeCameras = [this.camera, this.uiCamera];

        this._shadowGenActive = true;

        this.pipeline = new DefaultRenderingPipeline("defaultPipeline", true, this._scene, [this.camera]);
        this.pipeline.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.High;
        this.pipeline.depthOfFieldEnabled = true;
        this.pipeline.imageProcessing.exposure = 1.5;
        this.pipeline.fxaaEnabled = true;
        // #endregion

        //#region Materials
        // Skybox
        const skyboxMaterial = new StandardMaterial("skyBox", this._scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.reflectionTexture = new CubeTexture("../textures/TropicalSunnyDay", this._scene);
        skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
        skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
        skyboxMaterial.specularColor = new Color3(0, 0, 0);
        skyboxMaterial.disableLighting = true;
        this._skyboxMaterial = skyboxMaterial;

        // Water Plane
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

        // Sand
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

        // Sun Sphere
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

    /** Helper function to set the collider mask and metadata for physics body and shape that will act as walkable surface */
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

//#region Created Assets

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
    //#endregion

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

        // Create the base ground for the scene -- this will be sand to simulate an island beachfront with 4 polygons extruding into the sea
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

//#endregion 

    private async _loadAssets() {
        // import the meshes to use in the scene -- handle all of their uses in the executeWhenReady func
        await this._loadGrassHouseAndPier();
        await this._loadGrassAndFlowers();
        await this._loadFishingRod();
        await this._loadPalmTrees();
        
        this.directLightShadowGen.getShadowMap().refreshRate = 0;
    }

//#region Imported Assets

    // #region GrassFloor, House, and Pier
    private async _loadGrassHouseAndPier() {
        // Grass, house, and pier all in one glb. Load into an asset container
        const islandImport =  await LoadAssetContainerAsync("../models/environment/small_world_glb.glb", this._scene);
        this._grassHousePierContainer = islandImport;
        // Get the root node created by babylon and loop through the children(grass, house, pier) assigning each a physics body
        let islandMeshParent = islandImport.meshes[0];
        let islandMeshList = islandMeshParent.getChildMeshes();
        islandMeshList.forEach(m => {
            // Adjust each mesh material while looping through
            m.material.backFaceCulling = true; // Stops rendering of meshes not in sight of the camera
            m.receiveShadows = true;
            m.checkCollisions = true;
            m.freezeWorldMatrix(); // Freezes mesh geometry..helps with performance and none of these meshes will move
            this._waterMtl.addToRenderList(m); // Allows mesh to be reflected in the water
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
            
            // Set the mesh parent to null so they are no longer in a root array within the scene
            m.setParent(null);

            // Create a body and shape for each mesh..using a physics shape mesh because they geomerty is not too complicated
            m.physicsBody = new PhysicsBody(m, PhysicsMotionType.STATIC, true, this._scene);
            m.physicsBody.shape = new PhysicsShapeMesh(m as Mesh, this._scene);
            // Mark as ground and set the mask for the physics collision observable
            this._markAsGround(m.physicsBody);
            
        });

        // dispose of the old root node
        islandMeshParent.dispose();

        islandImport.addAllToScene();
    }
    //#endregion

    // #region Grass and Flowers
    private async _loadGrassAndFlowers() {
        // MARK: TODO: Refactor this section for poisson disc
        const grassAndFlowersImport =  await LoadAssetContainerAsync("../models/environment/grass_and_flowers_glb.glb", this._scene);
        this._grassAndFlowersContainer = grassAndFlowersImport;

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
                this._grassFlower = m as Mesh;
            }
        });

        gfParent.dispose();

        grassAndFlowersImport.addAllToScene();
    }
    //#endregion

    // #region FishingRod
    private async _loadFishingRod() {
        
        const fishingRodImport =  await LoadAssetContainerAsync("../models/items/fishing_rod_glb.glb", this._scene);
        this._fishingRodContainer = fishingRodImport;
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

        fishingRodImport.addAllToScene();
    }
    //#endregion

    //#region Palm Tree

    //MARK: mainLoadtrees()
    private async _loadPalmTrees() {
        // Load palm tree asset and prepare it for use
        await this._loadPalmTree();
        
        this._placeFlowersAndTrees();
    }

    //MARK: _loadPalmAssets()
    private async _loadPalmTree() {
        // First get the asset container containing the mesh, skeleton, and animation group
        const treeImport =  await LoadAssetContainerAsync("../models/environment/palmTree.glb", this._scene);
        this._treeContainer = treeImport;
        // Get the mesh and skeleton root, reparent to the mesh root, and dispose of the root node created by babylon
        const palmGltfRoot: TransformNode = this._treeContainer.meshes[0];
        const palmVisualRoot: TransformNode = palmGltfRoot?.getChildren()[1] as TransformNode;
        const palmArmatureRoot: TransformNode = palmGltfRoot?.getChildren()[0] as TransformNode;

        palmVisualRoot.setParent(null);
        palmArmatureRoot.setParent(palmVisualRoot, true);

        palmGltfRoot.dispose();

        this._treeMesh = palmVisualRoot as Mesh;
        // Get the child primitives and set the metadata to be copied per instance
        const prims = palmVisualRoot.getChildMeshes() as Mesh[];

        const palmTrunk = prims[2];
        palmTrunk.name = "palmTrunk";
        palmTrunk.isPickable = true;
        palmTrunk.metadata ??= {};
        palmTrunk.metadata.groundType = "Wood";

        const palmBottomLeaf = prims[1];
        palmBottomLeaf.name = "palmBottomLeaf";
        palmBottomLeaf.isPickable = true;
        palmBottomLeaf.metadata ??= {};
        palmBottomLeaf.metadata.groundType = "PalmLeaf";

        const palmTopLeaf = prims[0];
        palmTopLeaf.name = "palmTopLeaf";
        palmTopLeaf.isPickable = true;
        palmTopLeaf.metadata ??= {};
        palmTopLeaf.metadata.groundType = "PalmLeaf";
    }

    //MARK: _placeFlowersAndTrees()
    private _placeFlowersAndTrees() {
        // Set up all necessary variables and functions for the poisson disc sampling
        const houseBounding = this._houseMesh.getBoundingInfo().boundingBox;
        const houseMax = new Vector2(houseBounding.maximumWorld.x, houseBounding.maximumWorld.z);
        const houseMin = new Vector2(houseBounding.minimumWorld.x, houseBounding.minimumWorld.z);
        const paddedHouse = this._expandAabbXZ({ min: houseMin, max: houseMax }, 2);

        const grassBounding = this._grassFloor.getBoundingInfo().boundingBox;
        const grassMax = new Vector2(grassBounding.maximumWorld.x, grassBounding.maximumWorld.z);
        const grassMin = new Vector2(grassBounding.minimumWorld.x, grassBounding.minimumWorld.z);
        const paddedGrass = this._expandAabbXZ({min: grassMin, max: grassMax}, 1);
        const grassPoly = [paddedGrass.min, paddedGrass.max];

        const bounds: BoundsXZ = this._aabbOfPoly([grassMax, grassMin]);

        const insidePaddedGrass = (p: Vector2) =>
            (p.x >= paddedGrass.min.x && p.x <= paddedGrass.max.x &&
                p.y >= paddedGrass.min.y && p.y <= paddedGrass.max.y);
        
        const outsidePaddedHouse = (p: Vector2) =>
            !(p.x >= paddedHouse.min.x && p.x <= paddedHouse.max.x &&
                p.y >= paddedHouse.min.y && p.y <= paddedHouse.max.y);

        const isAllowed = (p: Vector2) =>
            insidePaddedGrass(p) && outsidePaddedHouse(p);

        const r = 2.5;
        const maxPoints = 500;
        const seed = null;

        const points = this._poissonDiskSampleXZ({
            bounds: bounds,
            isAllowed: isAllowed,
            r: r,
            maxPoints: maxPoints,
            seed: seed,
            initialSeeds: 1
        });
        this._treePositions = points;

        const spawnPos = new Vector3(0, 0.08, 0);
        points.forEach((p, i)=> {
            spawnPos.x = p.x; spawnPos.z = p.y;
            this._instantiatePalmTree(i, spawnPos);
        })

    }

    //#region Palm Physics Helpers
    private _createPalmPhysics(visualRoot: TransformNode, palmPrims: Mesh[]) {

        const trunkBody = new PhysicsBody(visualRoot, PhysicsMotionType.STATIC, false, this._scene);
        const boundingInfo = palmPrims[2].getBoundingInfo();
        const trunkDimensions = {
            height: boundingInfo.boundingBox.maximum._y - boundingInfo.boundingBox.minimum._y,
            width: boundingInfo.boundingBox.maximum._x - boundingInfo.boundingBox.minimum._x,
            depth: boundingInfo.boundingBox.maximum._z - boundingInfo.boundingBox.minimum._z
        };
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
        trunkBody.disablePreStep = true;
        
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

    //MARK: FROND
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
    //MARK: INSTANTIATE
    private _instantiatePalmTree(i: number, pos: Vector3) {
        const inst = this._treeContainer.instantiateModelsToScene(
            (src) => `${src}_${i}`
        );
        const instVisualRoot: TransformNode = inst.rootNodes[0] as TransformNode;
        const instArmatureRoot: Skeleton = inst.skeletons[0];

        const instPrims: Mesh[] = instVisualRoot.getChildMeshes();
        const palmTrunk = instPrims[2];
        const palmBottomLeaf = instPrims[1];
        const palmTopLeaf = instPrims[0];
        this.directLightShadowGen.addShadowCaster(palmTrunk);
        this.directLightShadowGen.addShadowCaster(palmBottomLeaf);
        this.directLightShadowGen.addShadowCaster(palmTopLeaf);
         
        instVisualRoot.setAbsolutePosition(pos);
        instVisualRoot.rotation.y = Math.random() * Math.PI * 2;

        let speedRatio = Math.random() * (1.15 - 0.85) + 0.85; // Math.random() * (max - min) + min;
        inst.animationGroups[0].start(true, speedRatio);

        this._createPalmPhysics(instVisualRoot, instPrims);
    }
    //#endregion Palm Physics Helpers
    
    //MARK: Poisson-Disc
    /** Use Bridson's Algorithm to get a Poisson Disk Sampling for the placement of trees. 
    * This allows for random distribution of coordinates in a grid while maintaining a minimum distance from eachother.
    * Using the guide at https://sighack.com/post/poisson-disk-sampling-bridsons-algorithm 
    */
    private _poissonDiskSampleXZ(opts: PoissonOpts): Vector2[] {
        const { bounds, isAllowed, r, maxPoints = 8, k = 30, seed, initialSeeds = 1 } = opts;
        const rand = this._makeRng(seed);

        const cell = r / Math.SQRT2;
        const invCell = 1 / cell;

        const grid = new Map<string, number>();           // "i,j" -> index in points[]
        const points: Vector2[] = [];
        const active: number[] = [];
        const key = (i:number,j:number)=>`${i},${j}`;

        const gridIndex = (p: Vector2) => ({
            i: Math.floor((p.x - bounds.min.x) * invCell),
            j: Math.floor((p.y - bounds.min.y) * invCell),
        });

        // Check that suggested point is far enough away from surrounding grid points
        const farFromNeighbors = (p: Vector2): boolean => {
            // Find the candidate’s cell (i,j)
            const { i, j } = gridIndex(p);
            /* NOTE:
                Because of the cell size: cell = r/√2. 
                The diameter of a cell’s circumscribed circle equals r. 
                Two points closer than r cannot be separated by more than one cell offset in either axis. 
                Any point that could violate the r constraint must lie in the candidate’s cell or an immediately adjacent cell. 
                Therefore, checking the 3×3 block is sufficient and necessary.
                
                If another point were 2 cells away in x or y, then the minimum distance between the centers would be ≥ 2 * (r/√2) = √2 r > r.
                With point extents inside cells, the actual minimum remains ≥ r. Hence no need to look beyond the immediate neighbors.
            */
            // Only check th square grid around current tile
            for (let di=-1; di<=1; di++) {
                for (let dj=-1; dj<=1; dj++) {
                    const idx = grid.get(key(i+di, j+dj));
                    // If the point does exist, check if the distance is greater than the radius and return false if not
                    if (idx != null) {
                        const q = points[idx];
                        const dx = p.x - q.x, dz = p.y - q.y;
                        if (dx*dx + dz*dz < r*r) return false;
                    }
                }
            }     
            return true;
        };

        const randomInBounds = () =>
            new Vector2(
                bounds.min.x + (bounds.max.x - bounds.min.x) * rand(),
                bounds.min.y + (bounds.max.y - bounds.min.y) * rand()
            );
    
        // Seed: try to place N initial active points (helps with disconnected or very concave shapes)
        const trySeed = () => {
            let tries = 5000;
            while (tries-- > 0) {
                const p = randomInBounds();
                if (isAllowed(p) && farFromNeighbors(p)) {
                    const gi = gridIndex(p);
                    grid.set(key(gi.i, gi.j), points.length);
                    points.push(p);
                    active.push(points.length - 1);
                    return true;
                }
            }
            return false;
        };

        for (let s = 0; s < initialSeeds && points.length < maxPoints; s++) {
            if (!trySeed()) break;
        }

        if (points.length === 0) return [];

        // Main Bridson loop
        // Continue while we still have a frontier and we haven’t hit our target count.
        while (active.length && points.length < maxPoints) {
            // Pick a random active point (uniform among active). The bitwise | 0 floors.
            // pa is the actual Vector2 for that active index. Random spreads growth evenly, avoiding streaks/ordering bias.
            const aIdx = (rand() * active.length) | 0;
            const pa = points[active[aIdx]];
            let spawned = false;
            // Give this active point up to k chances to spawn a valid neighbor before we retire it.
            for (let t = 0; t < k; t++) {
                const radius = r * (1 + rand());          // uniform in [r, 2r]
                const angle = Scalar.TwoPi * rand();
                // Generate a candidate around pa in the annulus [r, 2r].
                // For area-uniform annulus sampling, use
                // const u = rand(); const radius = Math.sqrt(r*r + u*((2*r)*(2*r)-r*r));
                const q = new Vector2(pa.x + radius * Math.cos(angle), pa.y + radius * Math.sin(angle));
                // If not within custom shape rules, and farther than r from all existing points, skip to next attempt
                if (!isAllowed(q) || !farFromNeighbors(q)) continue;
                // Find the position on the grid and store it in the grid
                // Note: Order is important. 
                // Before the push, points.length is n. The new point will live at index n.
                const gi = gridIndex(q);
                // Set the grid value to n before pushing.
                grid.set(key(gi.i, gi.j), points.length);
                // Then push(q) (now points.length is n+1), and active.push(points.length - 1) also pushes n.
                // Grid and active both reference the same new index. No off-by-one.
                points.push(q);
                active.push(points.length - 1);
                spawned = true;
                // Stop early if we reached the target count.
                if (points.length >= maxPoints) break;
            }

            // If the active point couldn’t spawn anything in k tries, remove it from the frontier with a swap-pop
            if (!spawned) {
                // Replace active[aIdx] by the last element
                active[aIdx] = active[active.length - 1];
                // Then pop() the last element
                active.pop();
            }
        }

        return points;
    }

    // #region Poisson-Disc Helpers

    //MARK: SemiCircle Predicate    
    /** Keep points that are inside the disk and on the "keep" side of the diameter line. */
    private _makeSemicirclePredicate(C: Vector2, R: number, N: Vector2) {
        const R2 = R * R; const n = N.normalize();
        return (p: Vector2) => {
            const dx = p.x - C.x, dz = p.y - C.y;
            const insideCircle = dx*dx + dz*dz <= R2;
            const keepSide = (dx * n.x + dz * n.y) >= 0;   // dot((p-C), N) >= 0
            return insideCircle && keepSide;
        };
    }   

    //MARK: Crescent Predicate   
    private _makeCrescentPredicate(C1: Vector2, R1: number, C2: Vector2, R2: number) {
        const R1_2 = R1*R1, R2_2 = R2*R2;
        return (p: Vector2) => {
            const d1x = p.x - C1.x, d1z = p.y - C1.y;
            const d2x = p.x - C2.x, d2z = p.y - C2.y;
            const inOuter = d1x*d1x + d1z*d1z <= R1_2;
            const outInner = d2x*d2x + d2z*d2z >= R2_2;
            return inOuter && outInner;
        };
    }  

    //MARK: pointInPolyGonXZ   
    /** Uses the even-odd rule to determine if a point is inside a polygon by counting how many times a horizontal ray from point p to +X crosses polygon edges. Each crossing toggles inside. 
     * Inside a rectangle: the ray crosses exactly one vertical edge (the one to the right of the point). So you toggle once - inside = true.
     * Left of the rectangle: the ray crosses both vertical edges (both are to the right of the point), so you toggle twice - inside = false.
     * Right of the rectangle: crosses none - inside = false.
     * Exactly between two disjoint shapes: you might cross 0, 2, 4… edges - always outside.   
     * Inside between with disjointed shapes to the right: your cross the first edge, then 0, 2, 4… edges - always inside.
    */   
    private _pointInPolygonXZ(p: Vector2, poly: Vector2[]): boolean {
        let inside = false;
        for (let i=0, j=poly.length-1; i<poly.length; j=i++) {
            const xi = poly[i].x, zi = poly[i].y, xj = poly[j].x, zj = poly[j].y;
            const hit = ((zi > p.y) !== (zj > p.y)) && (p.x < (xj - xi) * (p.y - zi) / ((zj - zi) || 1e-12) + xi);
            if (hit) inside = !inside;
        }
        return inside;
    }
        
    //MARK: Helpers to determine boundary
    /** AABB(bounds) of a single polygon on XZ (Vector2.x = X, Vector2.y = Z). */
    private _aabbOfPoly(poly: Vector2[]): { min: Vector2; max: Vector2 } {
        if (!poly.length) throw new Error("aabbOfPoly: empty polygon");
        let minX = poly[0].x, maxX = poly[0].x;
        let minZ = poly[0].y, maxZ = poly[0].y;

        for (let i = 1; i < poly.length; i++) {
            const v = poly[i];
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.y < minZ) minZ = v.y;
            if (v.y > maxZ) maxZ = v.y;
        }
        return { min: new Vector2(minX, minZ), max: new Vector2(maxX, maxZ) };
    }

    /** AABB(bounds) of multiple polygons (union). Handy when you have several areas to plot. */
    private _aabbOfPolys(polys: Vector2[][]): { min: Vector2; max: Vector2 } {
        if (!polys.length) throw new Error("aabbOfPolys: no polygons");
        let first = true;
        let minX = 0, maxX = 0, minZ = 0, maxZ = 0;

        for (const poly of polys) {
            if (!poly.length) continue;
            const { min, max } = this._aabbOfPoly(poly);
            if (first) {
                minX = min.x; maxX = max.x; minZ = min.y; maxZ = max.y; first = false;
            } else {
                if (min.x < minX) minX = min.x;
                if (max.x > maxX) maxX = max.x;
                if (min.y < minZ) minZ = min.y;
                if (max.y > maxZ) maxZ = max.y;
            }
        }
        if (first) throw new Error("aabbOfPolys: all polygons were empty");
        return { min: new Vector2(minX, minZ), max: new Vector2(maxX, maxZ) };
    }

    //MARK: _expandAABB  
    /** Expand/shrink an AABB by padding (use negative pad to shrink). */
    private _expandAabbXZ(aabb: {min: Vector2; max: Vector2}, pad: number) {
        return {
            min: new Vector2(aabb.min.x - pad, aabb.min.y - pad),
            max: new Vector2(aabb.max.x + pad, aabb.max.y + pad),
        };
    }   
        
    //MARK: _makeRNG 
    private _makeRng(seed?: number): () => number {
        if (seed == null) return Math.random;
        let s = (seed >>> 0) || 1;
        return () => ((s = (1664525 * s + 1013904223) >>> 0), (s & 0xfffffff) / 0x10000000);
    }
    // #endregion
    
    //#endregion Palm Tree

//#endregion Imported Assets
 
}

