import { Entity, Instance } from "cs_script/point_script";

const LAYOUT_NAME = "hud_crane";
const PANEL_ID = "crane_panel";
const CAMERA_DISABLED = 0;
const CAMERA_CONTROLLED = 1;
const UPDATE_INTERVAL = 0.5;
const BACKOFF_TIME = 0.15;
const START_POSITION_VALIDATION_TIME = 0.1;
const START_POSITION_MOVE_SPEED = 9999;
const HOOK_TOUCH_INPUT = "CraneHookTouch";

const CRANE_CONFIGS = {
	crane_secret: {
		showInput: "show_secret_crane",
		collisionInput: "CraneCollision",
		moveSpeed: 100,
		headSpawnDegreeRange: [90, 360],
		cameraEnterTime: 2,
		cameraExitTime: 1.0,
		cameraPosition: { x: 717, y: 732, z: 1017 },
		cameraAngles: { pitch: 38, yaw: -61, roll: 0 },
		hookTrigger: "crane_pulley_rotation_secret",
		components: {
			head: "crane_head_secret",
			headPush: "crane_head_push_secret",
			trolley: "crane_trolley_secret",
			pulley: "crane_pulley_secret",
			pulleyRotation: "crane_pulley_rotation_secret"
		}
	},
	
	crane_normal: {
		showInput: "show_normal_crane",
		collisionInput: "CraneCollision",
		moveSpeed: 100,
		headSpawnDegreeRange: [0, 360],
		cameraEnterTime: 2,
		cameraExitTime: 1.0,
		cameraPosition: { x: 574, y: 1190, z: 1700 },
		cameraAngles: { pitch: 46, yaw: -32, roll: 0 },
		hookTrigger: "crane_pulley_rotation_normal",
		components: {
			head: "crane_head_normal",
			headPush: "crane_head_push_normal",
			trolley: "crane_trolley_normal",
			pulley: "crane_pulley_normal",
			pulleyRotation: "crane_pulley_rotation_normal"
		}
	}
};

const RANDOM_ENTITY_SPAWN_CONFIGS = {
		cargo_surf_spawns: {
			entityName: "cargo_surf_hook",
			center: { x: 1304, y: 1051 },
			radiusRange: [64, 1024],
			zRange: [43, 1067],
			yawRange: [0, 360]
		}
};

const CARGO_HOOKS = [
	"cargo_container_1_hook",
	"cargo_surf_hook"
];

const STATIC_COLLISIONS = [
    "crane_collision_static"
];

const COLLISION_MOVERS = [
	"cargo_container_1",
	"crane_pulley_normal_model",
	"crane_pulley_secret_model",
	"cargo_surf_collision"
];

let craneLayout = null;
const cameras = new Map();
const activeUsers = new Map();
const missingEntities = new Set();
const invalidSpawnRegionReports = new Set();
const randomSpawnStates = new Map(Object.keys(RANDOM_ENTITY_SPAWN_CONFIGS).map((configName) => [configName, {
    validating: false,
    collisionDetected: false,
    validationEndsAt: 0
}]));
const states = new Map(Object.keys(CRANE_CONFIGS).map((id) => [id, {
    hookedCargo: null,
    backoffUntil: 0,
    randomizingStart: false,
    startCollisionDetected: false,
    startValidationEndsAt: 0,
    motion: { head: 0, trolley: null, pulley: null, pulleyRotation: 0 }
}]));

function GetLayout() {
    if (!(craneLayout instanceof Entity) || !craneLayout.IsValid()) {
        craneLayout = Instance.FindEntitiesByName(LAYOUT_NAME)[0];
    }
    return craneLayout;
}

function GetPlayer(entity) {
    if (!entity) return undefined;
    if (typeof entity.GetPlayerSlot === "function") return entity;
    if (typeof entity.GetPlayerController === "function") return entity.GetPlayerController();
    if (typeof entity.GetOriginalPlayerController === "function") return entity.GetOriginalPlayerController();
    return undefined;
}

function GetPawn(player) {
    if (!player || typeof player.GetPlayerPawn !== "function") return undefined;
    const pawn = player.GetPlayerPawn();
    return pawn && pawn.IsValid() ? pawn : undefined;
}

function GetNamedEntity(name) {
    const entity = Instance.FindEntityByName(name);
    if (entity && entity.IsValid()) return entity;
    if (!missingEntities.has(name)) {
        missingEntities.add(name);
        Instance.Msg(`crane.js: missing entity named ${name}`);
    }
    return undefined;
}

function GetEntityName(entity) {
    return entity && entity.IsValid() && typeof entity.GetEntityName === "function"
        ? entity.GetEntityName()
        : "";
}

function DescribeEntity(entity) {
    if (!entity || !entity.IsValid()) return "none";
    const className = typeof entity.GetClassName === "function" ? entity.GetClassName() : "unknown_class";
    return `${className}:${GetEntityName(entity) || "unnamed"}`;
}

function CollisionEntityBelongsToCrane(entity, config) {
    let current = entity;

    for (let depth = 0; depth < 4 && current && current.IsValid(); depth++) {
        const name = GetEntityName(current);
        for (const component of ["head", "trolley", "pulley"]) {
            const componentName = config.components[component];
            if (name === componentName || name.startsWith(`${componentName}_`)) return true;
        }

        if (typeof current.GetParent !== "function") break;
        current = current.GetParent();
    }

    return false;
}

function Lerp(a, b, t) {
    return a + (b - a) * t;
}

function LerpAngle(a, b, t) {
    let delta = (b - a) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return a + delta * t;
}

function LerpVector(a, b, t) {
    return { x: Lerp(a.x, b.x, t), y: Lerp(a.y, b.y, t), z: Lerp(a.z, b.z, t) };
}

function LerpAngles(a, b, t) {
    return {
        pitch: LerpAngle(a.pitch, b.pitch, t),
        yaw: LerpAngle(a.yaw, b.yaw, t),
        roll: LerpAngle(a.roll, b.roll, t)
    };
}

function EaseOutExpo(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function GetCamera(pawn) {
    return typeof pawn.GetCustomCamera === "function" ? pawn.GetCustomCamera() : pawn.GetCamera();
}

function EnableCamera(camera) {
    if (typeof camera.SetMode === "function") camera.SetMode(CAMERA_CONTROLLED);
    else {
        camera.SetIsControllingAngles(true);
        camera.SetEnabled(true);
    }
}

function DisableCamera(camera) {
    if (typeof camera.SetMode === "function") camera.SetMode(CAMERA_DISABLED);
    else {
        camera.SetEnabled(false);
        camera.SetIsControllingAngles(false);
    }
}

function StartCamera(player, craneId, config) {
    const pawn = GetPawn(player);
    if (!pawn) {
        Instance.Msg(`crane.js: ${config.showInput} needs an active player pawn`);
        return false;
    }
    const slot = player.GetPlayerSlot();
    const position = pawn.GetEyePosition();
    const angles = pawn.GetEyeAngles();
    const camera = GetCamera(pawn);
    camera.Teleport({ position, angles });
    EnableCamera(camera);
    cameras.set(slot, {
        craneId, camera, mode: "enter",
        startPosition: position, startAngles: angles,
        fromPosition: position, fromAngles: angles,
        toPosition: config.cameraPosition, toAngles: config.cameraAngles,
        duration: config.cameraEnterTime, startedAt: Instance.GetGameTime()
    });
    Instance.SetNextThink(Instance.GetGameTime());
    return true;
}

function ExitCamera(slot, config) {
    const cameraState = cameras.get(slot);
    if (!cameraState) return;
    cameraState.mode = "exit";
    cameraState.fromPosition = cameraState.camera.GetAbsOrigin();
    cameraState.fromAngles = cameraState.camera.GetAbsAngles();
    cameraState.toPosition = cameraState.startPosition;
    cameraState.toAngles = cameraState.startAngles;
    cameraState.duration = config.cameraExitTime;
    cameraState.startedAt = Instance.GetGameTime();
    Instance.SetNextThink(Instance.GetGameTime());
}

function UpdateCameras(now) {
    for (const [slot, state] of cameras) {
        if (!state.camera.IsValid()) {
            cameras.delete(slot);
            continue;
        }
        const elapsed = now - state.startedAt;
        const progress = state.duration <= 0 ? 1 : Math.min(elapsed / state.duration, 1);
        const t = EaseOutExpo(progress);
        state.camera.Teleport({
            position: LerpVector(state.fromPosition, state.toPosition, t),
            angles: LerpAngles(state.fromAngles, state.toAngles, t)
        });
        if (elapsed >= state.duration && state.mode === "exit") {
            DisableCamera(state.camera);
            cameras.delete(slot);
        }
    }
}

function IsInUse(craneId) {
    return Array.from(activeUsers.values()).includes(craneId);
}

function ShowControls(player, craneId) {
    const config = CRANE_CONFIGS[craneId];
    const layout = GetLayout();
    if (!layout) {
        Instance.Msg(`crane.js: missing custom_hud_layout named ${LAYOUT_NAME}`);
        return;
    }
    const slot = player.GetPlayerSlot();
    const previousCraneId = activeUsers.get(slot);
    if (previousCraneId && previousCraneId !== craneId) {
        HideControls(slot);
    }
    if (!StartCamera(player, craneId, config)) return;
    layout.SetHasClassForPlayer(slot, PANEL_ID, "Dismissed", false);
    layout.SetInputCaptureEnabled(slot, true);
    activeUsers.set(slot, craneId);
    if (config.components.headPush) {
        Instance.EntFireAtName({ name: config.components.headPush, input: "Enable" });
    }
}

function HideControls(slot) {
    const craneId = activeUsers.get(slot);
    if (!craneId) return;
    const config = CRANE_CONFIGS[craneId];
    const layout = GetLayout();
    if (layout) {
        layout.SetHasClassForPlayer(slot, PANEL_ID, "Dismissed", true);
        layout.SetInputCaptureEnabled(slot, false);
    }
    ExitCamera(slot, config);
    activeUsers.delete(slot);
    if (!IsInUse(craneId)) {
        StopAll(config, states.get(craneId));
        if (config.components.headPush) {
            Instance.EntFireAtName({ name: config.components.headPush, input: "Disable" });
        }
    }
}

function SetHeadSpeed(config, state, speed) {
    Instance.EntFireAtName({ name: config.components.head, input: "SetSpeed", value: speed });
    state.motion.head = speed;
}

function SetPulleyRotationSpeed(config, state, speed) {
    const pulleyRotation = config.components.pulleyRotation;
    if (!pulleyRotation) return;
    Instance.EntFireAtName({ name: pulleyRotation, input: "SetSpeed", value: speed });
    state.motion.pulleyRotation = speed;
}

function MoveComponent(config, state, component, input, direction) {
    const name = config.components[component];
    Instance.EntFireAtName({ name, input: "SetSpeed", value: config.moveSpeed });
    Instance.EntFireAtName({ name, input });
    state.motion[component] = direction;
}

function StopComponent(config, state, component) {
    Instance.EntFireAtName({ name: config.components[component], input: "SetSpeed", value: 0 });
    state.motion[component] = null;
}

function StopAll(config, state) {
    SetHeadSpeed(config, state, 0);
    SetPulleyRotationSpeed(config, state, 0);
    StopComponent(config, state, "trolley");
    StopComponent(config, state, "pulley");
}

function ReverseBriefly(config, component, direction) {
    if (!direction) return;
    const name = config.components[component];
    Instance.EntFireAtName({ name, input: "SetSpeed", value: config.moveSpeed });
    Instance.EntFireAtName({ name, input: direction === "open" ? "Close" : "Open" });
    Instance.EntFireAtName({ name, input: "SetSpeed", value: 0, delay: BACKOFF_TIME });
}

function BackOff(craneId, config, state) {
    if (state.motion.head !== 0) {
        Instance.EntFireAtName({ name: config.components.head, input: "SetSpeed", value: -state.motion.head });
        Instance.EntFireAtName({ name: config.components.head, input: "SetSpeed", value: 0, delay: BACKOFF_TIME });
    }
    if (state.motion.pulleyRotation !== 0 && config.components.pulleyRotation) {
        Instance.EntFireAtName({
            name: config.components.pulleyRotation,
            input: "SetSpeed",
            value: -state.motion.pulleyRotation
        });
        Instance.EntFireAtName({
            name: config.components.pulleyRotation,
            input: "SetSpeed",
            value: 0,
            delay: BACKOFF_TIME
        });
    }
    ReverseBriefly(config, "trolley", state.motion.trolley);
    ReverseBriefly(config, "pulley", state.motion.pulley);
    state.motion = { head: 0, trolley: null, pulley: null, pulleyRotation: 0 };
    state.backoffUntil = Instance.GetGameTime() + BACKOFF_TIME;
    Instance.Msg(`crane.js: ${craneId} collision backoff applied.`);
}

function HandleCollision(craneId, caller, activator) {
    const config = CRANE_CONFIGS[craneId];
    const state = states.get(craneId);
    const callerName = GetEntityName(caller);
    const activatorName = GetEntityName(activator);
    const hitStatic = STATIC_COLLISIONS.includes(callerName) || STATIC_COLLISIONS.includes(activatorName);
    if (hitStatic) HandleRandomSpawnCollision(caller, activator);

    const hitMover = COLLISION_MOVERS.includes(callerName) || COLLISION_MOVERS.includes(activatorName);
    if (!hitStatic || !hitMover) return;

    const belongsToCrane = CollisionEntityBelongsToCrane(caller, config) ||
        CollisionEntityBelongsToCrane(activator, config);
    if (!belongsToCrane) return;

    if (state.randomizingStart) {
        state.startCollisionDetected = true;
        Instance.SetNextThink(Instance.GetGameTime());
        return;
    }

    if (Instance.GetGameTime() < state.backoffUntil) return;
    BackOff(craneId, config, state);
}

function GetCraneIdFromHookEntity(entity) {
    const entityName = GetEntityName(entity);
    for (const [craneId, config] of Object.entries(CRANE_CONFIGS)) {
        if (entityName === config.hookTrigger) return craneId;
    }
    return undefined;
}

function AttachCargoFromHookTouch(craneId, cargoHookName) {
    const config = CRANE_CONFIGS[craneId];
    const state = states.get(craneId);
    if (state.hookedCargo && state.hookedCargo.IsValid()) {
        Instance.Msg(`crane.js: ${craneId} already has hooked cargo ${DescribeEntity(state.hookedCargo)}.`);
        return;
    }

    const cargoName = cargoHookName.replace(/_hook$/, "");
    const cargo = GetNamedEntity(cargoName);
    const cargoHook = GetNamedEntity(cargoHookName);
    const cargoParentName = config.components.pulleyRotation || config.components.pulley;
    const cargoParent = GetNamedEntity(cargoParentName);
    Instance.Msg(`crane.js: hook resolved crane=${craneId}, trigger=${cargoHookName}, cargo=${cargoName}, parent=${cargoParentName}.`);
    if (!cargo) {
        Instance.Msg(`crane.js: cannot hook because cargo entity ${cargoName} was not found.`);
        return;
    }
    if (!cargoHook) {
        Instance.Msg(`crane.js: cannot hook because cargo trigger ${cargoHookName} was not found.`);
        return;
    }
    if (!cargoParent) {
        Instance.Msg(`crane.js: cannot hook because parent entity ${cargoParentName} was not found.`);
        return;
    }

    const currentCargoParent = typeof cargo.GetParent === "function" ? cargo.GetParent() : undefined;
    if (currentCargoParent !== cargoHook) {
        Instance.Msg(`crane.js: cannot hook because ${cargoName} is not a child of ${cargoHookName}; current parent=${DescribeEntity(currentCargoParent)}.`);
        return;
    }

    const hookAngles = cargoHook.GetAbsAngles();
    const parentOrigin = cargoParent.GetAbsOrigin();
    Instance.Msg(`crane.js: calling SetParent on ${DescribeEntity(cargoHook)} with ${DescribeEntity(cargoParent)}.`);
    cargoHook.SetParent(cargoParent);
    cargoHook.Teleport({ position: parentOrigin, angles: hookAngles });
    Instance.Msg(`crane.js: snapped ${cargoHookName} origin to ${cargoParentName} at ${parentOrigin.x}, ${parentOrigin.y}, ${parentOrigin.z}.`);

    const actualParent = typeof cargoHook.GetParent === "function" ? cargoHook.GetParent() : undefined;
    if (actualParent === cargoParent) {
        state.hookedCargo = cargoHook;
        Instance.Msg(`crane.js: parent verified; ${cargoHookName} is now parented to ${cargoParentName}.`);
    } else {
        Instance.Msg(`crane.js: SetParent did not verify; ${cargoHookName} parent is ${DescribeEntity(actualParent)}.`);
    }
}

function HandleHookTouch(caller, activator) {
    Instance.Msg(`crane.js: ${HOOK_TOUCH_INPUT} received caller=${DescribeEntity(caller)} activator=${DescribeEntity(activator)}.`);
    const activatorCraneId = GetCraneIdFromHookEntity(activator);
    const callerCraneId = GetCraneIdFromHookEntity(caller);
    const craneId = activatorCraneId || callerCraneId;
    if (!craneId) {
        Instance.Msg(`crane.js: hook touch ignored because caller=${DescribeEntity(caller)} and activator=${DescribeEntity(activator)} do not directly match a configured hookTrigger.`);
        return;
    }

    const cargoHookEntity = activatorCraneId ? caller : activator;
    const cargoHookName = GetEntityName(cargoHookEntity);
    Instance.Msg(`crane.js: hook touch matched ${craneId}; candidate cargo trigger=${DescribeEntity(cargoHookEntity)}.`);
    if (!CARGO_HOOKS.includes(cargoHookName)) {
        Instance.Msg(`crane.js: hook touch ignored because ${cargoHookName || "unnamed"} is not listed in CARGO_HOOKS.`);
        return;
    }
    AttachCargoFromHookTouch(craneId, cargoHookName);
}

function Update() {
    const now = Instance.GetGameTime();
    UpdateCameras(now);

    let nextStartValidationTime = undefined;
    for (const [craneId, state] of states) {
        if (!state.randomizingStart) continue;

        if (state.startCollisionDetected) {
            ApplyRandomCraneStartPosition(craneId, CRANE_CONFIGS[craneId], state, now);
        } else if (now >= state.startValidationEndsAt) {
            RestoreCraneLinearMoveSpeed(CRANE_CONFIGS[craneId]);
            state.randomizingStart = false;
            continue;
        }

        nextStartValidationTime = nextStartValidationTime === undefined
            ? state.startValidationEndsAt
            : Math.min(nextStartValidationTime, state.startValidationEndsAt);
    }

    let nextEntityValidationTime = undefined;
    for (const [configName, state] of randomSpawnStates) {
        if (!state.validating) continue;

        if (state.collisionDetected) {
            ApplyRandomEntitySpawn(configName, RANDOM_ENTITY_SPAWN_CONFIGS[configName], state, now);
        } else if (now >= state.validationEndsAt) {
            state.validating = false;
            continue;
        }

        nextEntityValidationTime = nextEntityValidationTime === undefined
            ? state.validationEndsAt
            : Math.min(nextEntityValidationTime, state.validationEndsAt);
    }

    let nextThinkTime = undefined;
    if (cameras.size > 0) nextThinkTime = now;
    else if (activeUsers.size > 0) nextThinkTime = now + UPDATE_INTERVAL;

    if (nextStartValidationTime !== undefined) {
        nextThinkTime = nextThinkTime === undefined
            ? nextStartValidationTime
            : Math.min(nextThinkTime, nextStartValidationTime);
    }

    if (nextEntityValidationTime !== undefined) {
        nextThinkTime = nextThinkTime === undefined
            ? nextEntityValidationTime
            : Math.min(nextThinkTime, nextEntityValidationTime);
    }

    if (nextThinkTime !== undefined) Instance.SetNextThink(nextThinkTime);
}

function ApplyRandomCraneStartPosition(craneId, config, state, now) {
    const [minimumHeadDegrees, maximumHeadDegrees] = config.headSpawnDegreeRange;
    const headDegrees = minimumHeadDegrees + Math.random() * (maximumHeadDegrees - minimumHeadDegrees);

    state.hookedCargo = null;
    state.motion = { head: 0, trolley: null, pulley: null, pulleyRotation: 0 };
    state.backoffUntil = 0;
    state.randomizingStart = true;
    state.startCollisionDetected = false;
    state.startValidationEndsAt = now + START_POSITION_VALIDATION_TIME;

    Instance.EntFireAtName({
        name: config.components.trolley,
        input: "SetSpeed",
        value: START_POSITION_MOVE_SPEED
    });
    Instance.EntFireAtName({
        name: config.components.pulley,
        input: "SetSpeed",
        value: START_POSITION_MOVE_SPEED
    });

    Instance.EntFireAtName({
        name: config.components.head,
        input: "SetStartPos",
        value: { x: 0, y: headDegrees, z: 0 }
    });
    Instance.EntFireAtName({ name: config.components.head, input: "SnapToStartPos" });
    Instance.EntFireAtName({
        name: config.components.trolley,
        input: "SetPosition",
        value: Math.random()
    });
    Instance.EntFireAtName({
        name: config.components.pulley,
        input: "SetPosition",
        value: Math.random()
    });

}

function RestoreCraneLinearMoveSpeed(config) {
    Instance.EntFireAtName({
        name: config.components.trolley,
        input: "SetSpeed",
        value: config.moveSpeed
    });
    Instance.EntFireAtName({
        name: config.components.pulley,
        input: "SetSpeed",
        value: config.moveSpeed
    });
}

function RandomizeCraneStartPositions() {
    const now = Instance.GetGameTime();
    for (const [craneId, config] of Object.entries(CRANE_CONFIGS)) {
        ApplyRandomCraneStartPosition(craneId, config, states.get(craneId), now);
    }
    Instance.SetNextThink(now + START_POSITION_VALIDATION_TIME);
}

function RandomInRange(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
}

function SamplePointInAnnulus(config) {
    const innerRadius = config.radiusRange[0];
    const outerRadius = config.radiusRange[1];
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(
        innerRadius * innerRadius + Math.random() *
        (outerRadius * outerRadius - innerRadius * innerRadius)
    );
    return {
        x: config.center.x + Math.cos(angle) * radius,
        y: config.center.y + Math.sin(angle) * radius
    };
}

function ReportInvalidSpawnRegion(configName) {
    if (invalidSpawnRegionReports.has(configName)) return;
    invalidSpawnRegionReports.add(configName);
    Instance.Msg(`crane.js: random entity spawn config ${configName} has an invalid annulus or range.`);
}

function IsValidRandomSpawnConfig(config) {
    const validCenter = Number.isFinite(config.center?.x) && Number.isFinite(config.center?.y);
    const validRadiusRange = Array.isArray(config.radiusRange) && config.radiusRange.length === 2 &&
        config.radiusRange.every(Number.isFinite) && config.radiusRange[0] >= 0 &&
        config.radiusRange[1] > config.radiusRange[0];
    const validZRange = Array.isArray(config.zRange) && config.zRange.length === 2 &&
        config.zRange.every(Number.isFinite);
    const validYawRange = Array.isArray(config.yawRange) && config.yawRange.length === 2 &&
        config.yawRange.every(Number.isFinite);
    return Boolean(config.entityName && validCenter && validRadiusRange && validZRange && validYawRange);
}

function EntityOrParentHasName(entity, entityName) {
    let current = entity;
    for (let depth = 0; depth < 4 && current && current.IsValid(); depth++) {
        if (GetEntityName(current) === entityName) return true;
        if (typeof current.GetParent !== "function") break;
        current = current.GetParent();
    }
    return false;
}

function HandleRandomSpawnCollision(caller, activator) {
    for (const [configName, config] of Object.entries(RANDOM_ENTITY_SPAWN_CONFIGS)) {
        const state = randomSpawnStates.get(configName);
        if (!state?.validating) continue;
        if (!EntityOrParentHasName(caller, config.entityName) &&
            !EntityOrParentHasName(activator, config.entityName)) continue;

        state.collisionDetected = true;
        Instance.SetNextThink(Instance.GetGameTime());
    }
}

function ApplyRandomEntitySpawn(configName, config, state, now) {
    const entity = GetNamedEntity(config.entityName);
    if (!entity) {
        state.validating = false;
        return;
    }

    const horizontalPosition = SamplePointInAnnulus(config);
    state.validating = true;
    state.collisionDetected = false;
    state.validationEndsAt = now + START_POSITION_VALIDATION_TIME;
    entity.Teleport({
        position: {
            x: horizontalPosition.x,
            y: horizontalPosition.y,
            z: RandomInRange(config.zRange)
        },
        angles: { pitch: 0, yaw: RandomInRange(config.yawRange), roll: 0 }
    });
}

function RandomizeConfiguredEntitySpawns() {
    const now = Instance.GetGameTime();
    let hasValidation = false;
    for (const [configName, config] of Object.entries(RANDOM_ENTITY_SPAWN_CONFIGS)) {
        if (!IsValidRandomSpawnConfig(config)) {
            ReportInvalidSpawnRegion(configName);
            continue;
        }

        ApplyRandomEntitySpawn(configName, config, randomSpawnStates.get(configName), now);
        hasValidation = true;
    }
    if (hasValidation) Instance.SetNextThink(now + START_POSITION_VALIDATION_TIME);
}

function RandomizeAllSpawnPositions() {
    RandomizeCraneStartPositions();
    RandomizeConfiguredEntitySpawns();
}

for (const [id, config] of Object.entries(CRANE_CONFIGS)) {
    Instance.OnScriptInput(config.showInput, ({ activator, caller }) => {
        const player = GetPlayer(activator) || GetPlayer(caller);
        if (player) ShowControls(player, id);
        else Instance.Msg(`crane.js: ${config.showInput} needs a player activator or caller`);
    });
    Instance.OnScriptInput(config.collisionInput, ({ caller, activator }) => HandleCollision(id, caller, activator));
}

Instance.OnScriptInput(HOOK_TOUCH_INPUT, ({ caller, activator }) => {
    HandleHookTouch(caller, activator);
});

Instance.OnCustomHudClicked((event) => {
    if (event.layout !== GetLayout()) return;
    const slot = event.player.GetPlayerSlot();
    const id = activeUsers.get(slot);
    if (!id) return;
    const config = CRANE_CONFIGS[id];
    const state = states.get(id);
    switch (event.buttonId) {
        case "crane_rotate_ccw": SetHeadSpeed(config, state, 0.2); break;
        case "crane_rotate_cw": SetHeadSpeed(config, state, -0.2); break;
        case "crane_trolley_forward": MoveComponent(config, state, "trolley", "Open", "open"); break;
        case "crane_trolley_backward": MoveComponent(config, state, "trolley", "Close", "close"); break;
        case "crane_pulley_up": MoveComponent(config, state, "pulley", "Open", "open"); break;
        case "crane_pulley_down": MoveComponent(config, state, "pulley", "Close", "close"); break;
        case "crane_pulley_rotate_ccw": SetPulleyRotationSpeed(config, state, 0.2); break;
        case "crane_pulley_rotate_cw": SetPulleyRotationSpeed(config, state, -0.2); break;
        case "crane_stop": StopAll(config, state); break;
        case "crane_cancel": HideControls(slot); break;
    }
});

Instance.SetThink(Update);
Instance.OnActivate(RandomizeAllSpawnPositions);
Instance.OnRoundStart(RandomizeAllSpawnPositions);

Instance.OnPlayerDisconnect((event) => {
    const id = activeUsers.get(event.playerSlot);
    cameras.delete(event.playerSlot);
    activeUsers.delete(event.playerSlot);
    if (!id || IsInUse(id)) return;
    const config = CRANE_CONFIGS[id];
    StopAll(config, states.get(id));
    if (config.components.headPush) {
        Instance.EntFireAtName({ name: config.components.headPush, input: "Disable" });
    }
});
