import { Instance } from "cs_script/point_script";

const SNIPER_ENTITY_NAME = "sniper";
const SNIPER_CLASS_NAME = "weapon_awp";
const LASER_ENTITY_NAME = "sniper_laser";
const HELICOPTER_LASER_ENTITY_NAME = "helicopter_laser";
const LASER_UPDATE_INTERVAL = 0.005;
const HELICOPTER_LASER_FOCUS_LERP_TIME = 0.15;

let sniperWeapons = [];
let sniperHolders = new Map();
let sniperLaser = undefined;
let sniperLaserDefaultTransform = undefined;
let sniperLaserAtDefault = true;
let debugActiveWeapon = undefined;
let debugActiveDescription = "";
let helicopterLaserActive = false;
let helicopterLaserParent = undefined;
let helicopterLaserTarget = undefined;
let helicopterLaserAngles = undefined;
let helicopterLaserLastUpdateTime = 0;

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

function RefreshSnipers() {
    sniperWeapons = Instance.FindEntitiesByName(SNIPER_ENTITY_NAME).filter((entity) => {
        return entity
            && entity.IsValid()
            && typeof entity.GetClassName === "function"
            && entity.GetClassName() === SNIPER_CLASS_NAME;
    });

    Instance.Msg(`items.js: found ${sniperWeapons.length} named sniper AWP entities.`);
    RefreshSniperLaser();
    RefreshSniperHolders();
}

function RefreshSniperLaser() {
    sniperLaser = Instance.FindEntitiesByName(LASER_ENTITY_NAME)[0];

    if (!sniperLaser || !sniperLaser.IsValid()) {
        Instance.Msg(`items.js: could not find prop_dynamic named ${LASER_ENTITY_NAME}.`);
        sniperLaserDefaultTransform = undefined;
        sniperLaserAtDefault = true;
        return;
    }

    sniperLaserDefaultTransform = {
        position: sniperLaser.GetAbsOrigin(),
        angles: sniperLaser.GetAbsAngles()
    };
    sniperLaserAtDefault = true;
}

function IsTrackedSniper(weapon) {
    if (!weapon || !weapon.IsValid()) {
        return false;
    }

    for (const sniper of sniperWeapons) {
        if (sniper && sniper.IsValid() && sniper === weapon) {
            return true;
        }
    }

    return IsNamedSniperWeapon(weapon);
}

function IsNamedSniperWeapon(weapon) {
    return weapon
        && weapon.IsValid()
        && typeof weapon.GetClassName === "function"
        && typeof weapon.GetEntityName === "function"
        && weapon.GetClassName() === SNIPER_CLASS_NAME
        && weapon.GetEntityName() === SNIPER_ENTITY_NAME;
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
    if (helicopterLaserActive || sniperHolders.size > 0) {
        Instance.SetNextThink(Instance.GetGameTime());
    }
}

function RefreshSniperHolders() {
    sniperHolders = new Map();

    for (const sniper of sniperWeapons) {
        if (!sniper || !sniper.IsValid()) {
            continue;
        }

        const owner = sniper.GetOwner();
        if (owner && owner.IsValid()) {
            sniperHolders.set(sniper, owner);
        }
    }
}

function TrackSniperPickup(weapon) {
    if (!IsTrackedSniper(weapon)) {
        return;
    }

    const owner = weapon.GetOwner();
    if (!owner || !owner.IsValid()) {
        return;
    }

    sniperHolders.set(weapon, owner);
    Instance.Msg("items.js: tracked sniper was picked up.");
    if (!helicopterLaserActive) {
        UpdateLaserForHolder(weapon, owner);
    }
    StartActiveCheck();
}

function TrackSniperDrop(weapon) {
    if (!IsTrackedSniper(weapon)) {
        return;
    }

    sniperHolders.delete(weapon);
    Instance.Msg("items.js: tracked sniper was dropped.");
    if (!helicopterLaserActive) {
        ResetLaserToDefault();
    }
}

function ResetLaserToDefault() {
    if (sniperLaserAtDefault) {
        return;
    }

    if (!sniperLaser || !sniperLaser.IsValid()) {
        RefreshSniperLaser();
    }

    if (!sniperLaser || !sniperLaser.IsValid() || !sniperLaserDefaultTransform) {
        return;
    }

    sniperLaser.SetParent(undefined);
    sniperLaser.Teleport(sniperLaserDefaultTransform);
    sniperLaserAtDefault = true;
    Instance.Msg("items.js: returned sniper_laser to its default map position.");
}

function UpdateLaserForHolder(weapon, pawn) {
    if (!sniperLaser || !sniperLaser.IsValid()) {
        RefreshSniperLaser();
    }

    if (!sniperLaser || !sniperLaser.IsValid() || !pawn || !pawn.IsValid() || !pawn.IsAlive()) {
        return;
    }

    const activeWeapon = pawn.GetActiveWeapon();
    if (!IsTrackedSniper(activeWeapon)) {
        const description = DescribeWeapon(activeWeapon);
        if (debugActiveDescription !== description) {
            Instance.Msg(`items.js: tracked sniper is held, active weapon is ${description}.`);
            debugActiveDescription = description;
        }
        ResetLaserToDefault();
        return;
    }

    if (debugActiveWeapon !== activeWeapon) {
        Instance.Msg("items.js: tracked sniper is held and active.");
        debugActiveWeapon = activeWeapon;
    }

    const position = pawn.GetEyePosition();
    const angles = pawn.GetEyeAngles();

    sniperLaser.SetParent(undefined);
    sniperLaser.Teleport({
        position,
        angles
    });
    sniperLaserAtDefault = false;
    Instance.Msg(`items.js: transformed sniper_laser to eye position (${position.x}, ${position.y}, ${position.z}) and angles (${angles.pitch}, ${angles.yaw}, ${angles.roll}).`);
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
    if (!sniperLaser || !sniperLaser.IsValid()) {
        RefreshSniperLaser();
    }

    helicopterLaserParent = Instance.FindEntitiesByName(HELICOPTER_LASER_ENTITY_NAME)[0];
    if (!sniperLaser || !sniperLaser.IsValid()) {
        Instance.Msg(`items.js: could not find prop_dynamic named ${LASER_ENTITY_NAME}.`);
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
    sniperLaserAtDefault = false;
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

function Think() {
    if (!helicopterLaserActive && sniperHolders.size === 0) {
        return;
    }

    Instance.SetNextThink(Instance.GetGameTime() + LASER_UPDATE_INTERVAL);

    if (helicopterLaserActive) {
        UpdateHelicopterLaser();
        return;
    }

    for (const [weapon, pawn] of sniperHolders) {
        if (!weapon || !weapon.IsValid() || !pawn || !pawn.IsValid() || !pawn.IsAlive()) {
            sniperHolders.delete(weapon);
            continue;
        }

        if (IsTrackedSniper(pawn.GetActiveWeapon())) {
            UpdateLaserForHolder(weapon, pawn);
            return;
        }
    }

    ResetLaserToDefault();
}

function UpdateLaserForExistingHolder() {
    for (const [weapon, pawn] of sniperHolders) {
        if (!weapon || !weapon.IsValid() || !pawn || !pawn.IsValid() || !pawn.IsAlive()) {
            sniperHolders.delete(weapon);
            continue;
        }

        if (pawn.GetActiveWeapon() === weapon) {
            UpdateLaserForHolder(weapon, pawn);
            return;
        }
    }
}

Instance.OnWeaponPickup((event) => {
    TrackSniperPickup(event.weapon);
});

Instance.OnWeaponDrop((event) => {
    TrackSniperDrop(event.weapon);
});

Instance.OnScriptInput("helicopter_laser", ({ activator }) => {
    ActivateHelicopterLaser(activator);
});

Instance.OnRoundStart(() => {
    if (helicopterLaserActive) {
        ResetLaserToDefault();
    }
    helicopterLaserActive = false;
    helicopterLaserParent = undefined;
    helicopterLaserTarget = undefined;
    helicopterLaserAngles = undefined;
    helicopterLaserLastUpdateTime = 0;
    RefreshSnipers();
    UpdateLaserForExistingHolder();
    StartActiveCheck();
});

RefreshSnipers();
Instance.SetThink(Think);
UpdateLaserForExistingHolder();
StartActiveCheck();
