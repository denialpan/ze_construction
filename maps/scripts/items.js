import { Instance } from "cs_script/point_script";

const TRACKED_ITEM_CONFIGS = [
    {
        key: "sniper",
        entityName: "sniper_item",
        className: "weapon_awp",
        laserName: "sniper_laser_1"
    },
    {
        key: "bomb",
        entityName: "bomb_item",
        className: "weapon_c4",
        laserName: "sniper_laser_2"
    }
];
const HELICOPTER_LASER_ENTITY_NAME = "helicopter_laser";
const LASER_UPDATE_INTERVAL = 0.005;
const HELICOPTER_LASER_FOCUS_LERP_TIME = 0.15;

const trackedItemStates = new Map(TRACKED_ITEM_CONFIGS.map((config) => [
    config.key,
    {
        config,
        weapons: [],
        holders: new Map(),
        laser: undefined,
        laserDefaultTransform: undefined,
        laserAtDefault: true,
        debugActiveWeapon: undefined,
        debugActiveDescription: ""
    }
]));
const sniperItemState = trackedItemStates.get("sniper");
let helicopterLaserActive = false;
let helicopterLaserParent = undefined;
let helicopterLaserTarget = undefined;
let helicopterLaserAngles = undefined;
let helicopterLaserLastUpdateTime = 0;
let sniperLaserLockedAtDefault = false;

function GetPlayerController(entity) {
    if (!entity) {
        return undefined;
    }

    if (typeof entity.GetPlayerSlot === "function") {
        return entity;
    }

    if (typeof entity.GetPlayerController === "function") {
        return entity.GetPlayerController();
    }

    if (typeof entity.GetOriginalPlayerController === "function") {
        return entity.GetOriginalPlayerController();
    }

    return undefined;
}

function RefreshTrackedItems(state) {
    const { config } = state;
    state.weapons = Instance.FindEntitiesByName(config.entityName).filter((entity) => {
        return entity
            && entity.IsValid()
            && typeof entity.GetClassName === "function"
            && entity.GetClassName() === config.className;
    });

    Instance.Msg(
        `items.js: found ${state.weapons.length} ${config.className} entities named ${config.entityName}.`
    );
    RefreshTrackedLaser(state);
    RefreshTrackedHolders(state);
}

function RefreshAllTrackedItems() {
    for (const state of trackedItemStates.values()) {
        RefreshTrackedItems(state);
    }
}

function RefreshTrackedLaser(state) {
    const { config } = state;
    state.laser = Instance.FindEntitiesByName(config.laserName)[0];

    if (!state.laser || !state.laser.IsValid()) {
        Instance.Msg(`items.js: could not find prop_dynamic named ${config.laserName}.`);
        state.laserDefaultTransform = undefined;
        state.laserAtDefault = true;
        return;
    }

    state.laserDefaultTransform = {
        position: state.laser.GetAbsOrigin(),
        angles: state.laser.GetAbsAngles()
    };
    state.laserAtDefault = true;
}

function IsTrackedWeapon(state, weapon) {
    if (!weapon || !weapon.IsValid()) {
        return false;
    }

    for (const trackedWeapon of state.weapons) {
        if (trackedWeapon && trackedWeapon.IsValid() && trackedWeapon === weapon) {
            return true;
        }
    }

    return IsNamedTrackedWeapon(state, weapon);
}

function IsNamedTrackedWeapon(state, weapon) {
    const { config } = state;
    return weapon
        && weapon.IsValid()
        && typeof weapon.GetClassName === "function"
        && typeof weapon.GetEntityName === "function"
        && weapon.GetClassName() === config.className
        && weapon.GetEntityName() === config.entityName;
}

function FindTrackedItemState(weapon) {
    for (const state of trackedItemStates.values()) {
        if (IsTrackedWeapon(state, weapon)) {
            return state;
        }
    }

    return undefined;
}

function DescribeWeapon(weapon) {
    if (!weapon || !weapon.IsValid()) {
        return "none";
    }

    const className = typeof weapon.GetClassName === "function" ? weapon.GetClassName() : "unknown_class";
    const entityName = typeof weapon.GetEntityName === "function" ? weapon.GetEntityName() : "unknown_name";
    return `${className}:${entityName}`;
}

function StartActiveCheck() {
    const hasActiveItem = Array.from(trackedItemStates.values()).some((state) => {
        return state !== sniperItemState || !sniperLaserLockedAtDefault
            ? state.holders.size > 0
            : false;
    });

    if (helicopterLaserActive || hasActiveItem) {
        Instance.SetNextThink(Instance.GetGameTime());
    }
}

function RefreshTrackedHolders(state) {
    state.holders = new Map();

    for (const weapon of state.weapons) {
        if (!weapon || !weapon.IsValid()) {
            continue;
        }

        const owner = weapon.GetOwner();
        if (owner && owner.IsValid()) {
            state.holders.set(weapon, owner);
        }
    }
}

function TrackItemPickup(weapon) {
    const state = FindTrackedItemState(weapon);
    if (!state || (state === sniperItemState && sniperLaserLockedAtDefault)) {
        return;
    }

    const owner = weapon.GetOwner();
    if (!owner || !owner.IsValid()) {
        return;
    }

    state.holders.set(weapon, owner);
    Instance.Msg(`items.js: tracked ${state.config.entityName} was picked up.`);
    if (state !== sniperItemState || !helicopterLaserActive) {
        UpdateLaserForHolder(state, weapon, owner);
    }
    StartActiveCheck();
}

function TrackItemDrop(weapon) {
    const state = FindTrackedItemState(weapon);
    if (!state) {
        return;
    }

    state.holders.delete(weapon);
    Instance.Msg(`items.js: tracked ${state.config.entityName} was dropped.`);
    if (state !== sniperItemState || !helicopterLaserActive) {
        ResetLaserToDefault(state);
    }
}

function ResetLaserToDefault(state) {
    if (state.laserAtDefault) {
        return;
    }

    if (!state.laser || !state.laser.IsValid()) {
        RefreshTrackedLaser(state);
    }

    if (!state.laser || !state.laser.IsValid() || !state.laserDefaultTransform) {
        return;
    }

    state.laser.SetParent(undefined);
    state.laser.Teleport(state.laserDefaultTransform);
    state.laserAtDefault = true;
    Instance.Msg(`items.js: returned ${state.config.laserName} to its default map position.`);
}

function UpdateLaserForHolder(state, weapon, pawn) {
    if (!state.laser || !state.laser.IsValid()) {
        RefreshTrackedLaser(state);
    }

    if (!state.laser || !state.laser.IsValid() || !pawn || !pawn.IsValid() || !pawn.IsAlive()) {
        return;
    }

    const activeWeapon = pawn.GetActiveWeapon();
    if (!IsTrackedWeapon(state, activeWeapon)) {
        const description = DescribeWeapon(activeWeapon);
        if (state.debugActiveDescription !== description) {
            Instance.Msg(
                `items.js: tracked ${state.config.entityName} is held, active weapon is ${description}.`
            );
            state.debugActiveDescription = description;
        }
        ResetLaserToDefault(state);
        return;
    }

    if (state.debugActiveWeapon !== activeWeapon) {
        Instance.Msg(`items.js: tracked ${state.config.entityName} is held and active.`);
        state.debugActiveWeapon = activeWeapon;
    }

    const position = pawn.GetEyePosition();
    const angles = pawn.GetEyeAngles();

    state.laser.SetParent(undefined);
    state.laser.Teleport({
        position,
        angles
    });
    state.laserAtDefault = false;
    Instance.Msg(
        `items.js: transformed ${state.config.laserName} to eye position ` +
        `(${position.x}, ${position.y}, ${position.z}) and angles ` +
        `(${angles.pitch}, ${angles.yaw}, ${angles.roll}).`
    );
}

function GetAnglesToward(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const horizontalDistance = Math.sqrt(dx * dx + dy * dy);
    const radiansToDegrees = 180 / Math.PI;

    return {
        pitch: -Math.atan2(dz, horizontalDistance) * radiansToDegrees,
        yaw: Math.atan2(dy, dx) * radiansToDegrees,
        roll: 0
    };
}

function LerpAngle(current, target, amount) {
    const delta = ((target - current + 540) % 360) - 180;
    return current + delta * amount;
}

function LerpAngles(current, target, amount) {
    return {
        pitch: LerpAngle(current.pitch, target.pitch, amount),
        yaw: LerpAngle(current.yaw, target.yaw, amount),
        roll: LerpAngle(current.roll, target.roll, amount)
    };
}

function UpdateHelicopterLaser() {
    const sniperLaser = sniperItemState.laser;
    if (
        !helicopterLaserActive ||
        !helicopterLaserParent ||
        !helicopterLaserParent.IsValid() ||
        !sniperLaser ||
        !sniperLaser.IsValid()
    ) {
        return;
    }

    const target = helicopterLaserTarget;
    if (!target || !target.IsValid() || !target.IsAlive()) {
        return;
    }

    const laserPosition = sniperLaser.GetAbsOrigin();
    const targetPosition = target.GetEyePosition();
    const targetAngles = GetAnglesToward(laserPosition, targetPosition);
    const now = Instance.GetGameTime();
    const elapsed = Math.max(0, now - helicopterLaserLastUpdateTime);
    const lerpAmount = Math.min(
        1,
        1 - Math.exp((-5 * elapsed) / HELICOPTER_LASER_FOCUS_LERP_TIME)
    );
    const angles = helicopterLaserAngles
        ? LerpAngles(helicopterLaserAngles, targetAngles, lerpAmount)
        : targetAngles;

    helicopterLaserAngles = angles;
    helicopterLaserLastUpdateTime = now;

    sniperLaser.Teleport({
        angles
    });
    Instance.Msg(
        `items.js: helicopter laser tracking; laser=(${laserPosition.x}, ${laserPosition.y}, ${laserPosition.z}) ` +
        `target=(${targetPosition.x}, ${targetPosition.y}, ${targetPosition.z}) ` +
        `angles=(${angles.pitch}, ${angles.yaw}, ${angles.roll}) ` +
        `target_angles=(${targetAngles.pitch}, ${targetAngles.yaw}, ${targetAngles.roll}) ` +
        `lerp=${lerpAmount} ` +
        `parented=${sniperLaser.GetParent() === helicopterLaserParent}.`
    );
}

function ActivateHelicopterLaser(activator) {
    sniperLaserLockedAtDefault = false;

    if (!sniperItemState.laser || !sniperItemState.laser.IsValid()) {
        RefreshTrackedLaser(sniperItemState);
    }

    helicopterLaserParent = Instance.FindEntitiesByName(HELICOPTER_LASER_ENTITY_NAME)[0];
    const sniperLaser = sniperItemState.laser;
    if (!sniperLaser || !sniperLaser.IsValid()) {
        Instance.Msg(
            `items.js: could not find prop_dynamic named ${sniperItemState.config.laserName}.`
        );
        return;
    }

    if (!helicopterLaserParent || !helicopterLaserParent.IsValid()) {
        Instance.Msg(`items.js: could not find entity named ${HELICOPTER_LASER_ENTITY_NAME}.`);
        return;
    }

    const player = GetPlayerController(activator);
    const target = player?.GetPlayerPawn();
    if (!target || !target.IsValid() || !target.IsAlive()) {
        Instance.Msg("items.js: helicopter_laser needs a living player activator.");
        return;
    }

    const position = helicopterLaserParent.GetAbsOrigin();
    const targetPosition = target.GetEyePosition();
    const angles = GetAnglesToward(position, targetPosition);

    sniperLaser.SetParent(undefined);
    sniperLaser.Teleport({ position, angles });
    sniperLaser.SetParent(helicopterLaserParent);
    sniperItemState.laserAtDefault = false;
    helicopterLaserActive = true;
    helicopterLaserTarget = target;
    helicopterLaserAngles = angles;
    helicopterLaserLastUpdateTime = Instance.GetGameTime();
    const actualPosition = sniperLaser.GetAbsOrigin();
    Instance.Msg(
        `items.js: activated helicopter laser for player ${player.GetPlayerSlot()}; ` +
        `anchor=(${position.x}, ${position.y}, ${position.z}) ` +
        `laser=(${actualPosition.x}, ${actualPosition.y}, ${actualPosition.z}) ` +
        `target=(${targetPosition.x}, ${targetPosition.y}, ${targetPosition.z}) ` +
        `angles=(${angles.pitch}, ${angles.yaw}, ${angles.roll}) ` +
        `parented=${sniperLaser.GetParent() === helicopterLaserParent}.`
    );
    Instance.SetNextThink(Instance.GetGameTime());
}

function ResetSniperLaserForEnding() {
    sniperLaserLockedAtDefault = true;
    helicopterLaserActive = false;
    helicopterLaserParent = undefined;
    helicopterLaserTarget = undefined;
    helicopterLaserAngles = undefined;
    helicopterLaserLastUpdateTime = 0;
    sniperItemState.holders.clear();
    ResetLaserToDefault(sniperItemState);
}

function UpdateTrackedItem(state) {
    for (const [weapon, pawn] of state.holders) {
        if (!weapon || !weapon.IsValid() || !pawn || !pawn.IsValid() || !pawn.IsAlive()) {
            state.holders.delete(weapon);
            continue;
        }

        if (IsTrackedWeapon(state, pawn.GetActiveWeapon())) {
            UpdateLaserForHolder(state, weapon, pawn);
            return;
        }
    }

    ResetLaserToDefault(state);
}

function Think() {
    const hasTrackedHolders = Array.from(trackedItemStates.values()).some((state) => {
        return state !== sniperItemState || !sniperLaserLockedAtDefault
            ? state.holders.size > 0
            : false;
    });

    if (!helicopterLaserActive && !hasTrackedHolders) {
        return;
    }

    Instance.SetNextThink(Instance.GetGameTime() + LASER_UPDATE_INTERVAL);

    if (helicopterLaserActive) {
        UpdateHelicopterLaser();
    }

    for (const state of trackedItemStates.values()) {
        if (state === sniperItemState && (sniperLaserLockedAtDefault || helicopterLaserActive)) {
            continue;
        }

        UpdateTrackedItem(state);
    }
}

function UpdateLasersForExistingHolders() {
    for (const state of trackedItemStates.values()) {
        for (const [weapon, pawn] of state.holders) {
            if (!weapon || !weapon.IsValid() || !pawn || !pawn.IsValid() || !pawn.IsAlive()) {
                state.holders.delete(weapon);
                continue;
            }

            if (pawn.GetActiveWeapon() === weapon) {
                UpdateLaserForHolder(state, weapon, pawn);
                break;
            }
        }
    }
}

Instance.OnWeaponPickup((event) => {
    TrackItemPickup(event.weapon);
});

Instance.OnWeaponDrop((event) => {
    TrackItemDrop(event.weapon);
});

Instance.OnScriptInput("helicopter_laser", ({ activator }) => {
    ActivateHelicopterLaser(activator);
});

Instance.OnScriptInput("reset_sniper_laser", ResetSniperLaserForEnding);

Instance.OnRoundStart(() => {
    if (helicopterLaserActive) {
        ResetLaserToDefault(sniperItemState);
    }
    helicopterLaserActive = false;
    helicopterLaserParent = undefined;
    helicopterLaserTarget = undefined;
    helicopterLaserAngles = undefined;
    helicopterLaserLastUpdateTime = 0;
    sniperLaserLockedAtDefault = false;
    RefreshAllTrackedItems();
    UpdateLasersForExistingHolders();
    StartActiveCheck();
});

RefreshAllTrackedItems();
Instance.SetThink(Think);
UpdateLasersForExistingHolders();
StartActiveCheck();
