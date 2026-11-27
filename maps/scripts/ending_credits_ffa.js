import {
    CSDamageFlags,
    CSDamageTypes,
    CSGearSlot,
    CSWeaponAttackType,
    Entity,
    Instance
} from "cs_script/point_script";

const INPUT_START = "start";
const CT_TEAM = 3;
const TARGET_MONEY = 67;
const DEBUG_TRACE_LENGTH = 4096;
const KNIFE_TRACE_LENGTH = 64;
const DEBUG_TRACE_DURATION = 1.0;
const DEBUG_TRACE_COLOR = { r: 255, g: 0, b: 0 };
const KNIFE_TRACE_DAMAGE = 49.5;
const KNIFE_SECONDARY_TRACE_DAMAGE = 99;
const SNIPER_MAX_ENTITY_HITS = 5;
const SNIPER_PENETRATION_DAMAGE_MULTIPLIER = 0.8;
const SNIPER_WEAPON_CLASSES = new Set([
    "weapon_awp",
    "weapon_ssg08",
    "weapon_g3sg1",
    "weapon_scar20"
]);
const PLAYER_HULL_HALF_WIDTH = 16;
const PLAYER_HULL_STANDING_HEIGHT = 72;
const PLAYER_HULL_DUCKED_HEIGHT = 36;
const RAY_PARALLEL_EPSILON = 0.000001;
const DAMAGE_TEST_ENTITY_NAME = "damage_test";
const DAMAGE_TEST_DAMAGE = 100;
const PLAYER_FREEZE_ENTITY_NAME = "ending_credits_ffa_player_freeze";
const HUD_NAME = "hud_ending_credits_ffa";
const HUD_PANEL_ID = "ending_credits_ffa_hud";
const HUD_COUNTDOWN_LABEL_ID = "ending_credits_ffa_countdown";
const HUD_COUNTDOWN_DIALOG_VARIABLE = "ending_credits_ffa_time";
const HUD_UPPER_LABEL_ID = "ending_credits_ffa_upper_text";
const HUD_UPPER_DIALOG_VARIABLE = "ending_credits_ffa_upper";
const HUD_UPPER_PLACEHOLDER = "Match begins in:";
const HUD_ODOMETER_LABEL_ID = "ending_credits_ffa_odometer_text";
const HUD_ODOMETER_DIALOG_VARIABLE = "ending_credits_ffa_odometer";
const HUD_ODOMETER_FINAL_TEXT = "Eliminate other players.";
const HUD_ODOMETER_START_DELAY = 6;
const HUD_ODOMETER_REVEAL_DURATION = 3;
const HUD_ODOMETER_HOLD_DURATION = 2;
const HUD_ODOMETER_DISSOLVE_DURATION = 1;
const HUD_COUNTDOWN_DURATION = 6;
const HUD_ODOMETER_DURATION = HUD_ODOMETER_REVEAL_DURATION
    + HUD_ODOMETER_HOLD_DURATION
    + HUD_ODOMETER_DISSOLVE_DURATION;
const HUD_SEQUENCE_DURATION = HUD_ODOMETER_START_DELAY + HUD_ODOMETER_DURATION;
const HUD_UPDATE_INTERVAL = 1 / 100;
const HUD_ODOMETER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const HUD_ODOMETER_HIDDEN_CHARACTER = "\u00a0";
const ZONE_ADD_PLAYER_INPUT = "endings_credits_zone_add_player";
const ZONE_REMOVE_PLAYER_INPUT = "endings_credits_zone_remove_player";
const ZONE_PLAYER_COUNT_NAME = "ending_credits_ffa_player_count";
const ZONE_SUCCESS_RELAY_NAME = "relay_ending_credits_ffa";
const ZONE_REQUIRED_CT_RATIO = 0.75;
const ZONE_HOLD_DURATION = 5;
const FFA_WIN_SOUND_NAME = "sound_ending_credits_ffa_win";
const FFA_WIN_CHAT_REPETITIONS = 10;
const FFA_WIN_CHAT_INTERVAL = 0.3;
const RECOMMENDED_WEAPON_DAMAGE = new Map([
    ["weapon_mp9", 10.1],
    ["weapon_mac10", 10.1],
    ["weapon_mp7", 10.1],
    ["weapon_mp5sd", 10.1],
    ["weapon_ump45", 12.1],
    ["weapon_p90", 6.1],
    ["weapon_bizon", 4.7],
    ["weapon_m4a1_silencer", 25.0],
    ["weapon_ak47", 16.7],
    ["weapon_famas", 20.0],
    ["weapon_m4a1", 16.7],
    ["weapon_sg556", 16.7],
    ["weapon_aug", 16.7],
    ["weapon_galilar", 14.3],
    ["weapon_deagle", 21.6],
    ["weapon_cz75a", 12.6],
    ["weapon_usp_silencer", 12.6],
    ["weapon_p250", 11.7],
    ["weapon_tec9", 8.4],
    ["weapon_hkp2000", 11.7],
    ["weapon_glock", 7.6],
    ["weapon_fiveseven", 7.6],
    ["weapon_elite", 5.1],
    ["weapon_revolver", 18.9],
    ["weapon_awp", 99],
    ["weapon_ssg08", 80],
    ["weapon_negev", 8.7],
    ["weapon_m249", 4.0],
    ["weapon_g3sg1", 33.4],
    ["weapon_scar20", 33.4],
    ["weapon_xm1014", 28.8],
    ["weapon_mag7", 40.0],
    ["weapon_sawedoff", 28.8],
    ["weapon_nova", 25.2]
]);

const trackedRaytraceWeapons = new Map();
const zonePlayerSlots = new Set();
let endingCreditsHud = null;
let hudCountdownState = null;
let zoneSuccessTime = null;
let zoneCompleted = false;
let applyingRaytraceDamage = false;
let ffaActive = false;
let ffaResolved = false;

function IsAliveCTPawn(pawn) {
    return pawn
        && pawn.IsValid()
        && pawn.IsAlive()
        && pawn.GetTeamNumber() === CT_TEAM;
}

function SetPlayerMoney(player, amount) {
    const currentMoney = player.GetMoneySpendableNow();
    player.AddMoneySpendableNow(amount - currentMoney);
}

function RegisterPlayerRaytraceWeapons(pawn) {
    let registeredWeapons = 0;

    for (const slot of [CSGearSlot.RIFLE, CSGearSlot.PISTOL, CSGearSlot.KNIFE]) {
        const weapon = pawn.FindWeaponBySlot(slot);
        if (!weapon || !weapon.IsValid()) {
            continue;
        }

        const className = weapon.GetClassName();
        const damage = slot === CSGearSlot.KNIFE
            ? KNIFE_TRACE_DAMAGE
            : RECOMMENDED_WEAPON_DAMAGE.get(className);
        if (damage === undefined) {
            Instance.Msg(`ending_credits_ffa.js: no recommended damage configured for ${className}.`);
            continue;
        }

        trackedRaytraceWeapons.set(weapon, damage);
        registeredWeapons++;
        Instance.Msg(`ending_credits_ffa.js: registered existing ${className} with ${damage} raytrace damage.`);
    }

    if (registeredWeapons === 0) {
        Instance.Msg("ending_credits_ffa.js: alive CT has no supported firearm or knife to register.");
    }

    return registeredWeapons;
}

function IsTrackedRaytraceWeapon(weapon) {
    return weapon && weapon.IsValid() && trackedRaytraceWeapons.has(weapon);
}

function IsKnifeWeapon(weapon) {
    if (!weapon || !weapon.IsValid() || typeof weapon.GetData !== "function") {
        return false;
    }

    const weaponData = weapon.GetData();
    return weaponData
        && typeof weaponData.GetGearSlot === "function"
        && weaponData.GetGearSlot() === CSGearSlot.KNIFE;
}

function IsSniperWeapon(weapon) {
    return weapon
        && weapon.IsValid()
        && SNIPER_WEAPON_CLASSES.has(weapon.GetClassName());
}

function GetForwardVector(angles) {
    const pitchRadians = (angles.pitch * Math.PI) / 180;
    const yawRadians = (angles.yaw * Math.PI) / 180;
    const horizontalScale = Math.cos(pitchRadians);

    return {
        x: Math.cos(yawRadians) * horizontalScale,
        y: Math.sin(yawRadians) * horizontalScale,
        z: -Math.sin(pitchRadians)
    };
}

function IsDifferentAliveCTPawn(pawn, shooter) {
    return IsAliveCTPawn(pawn) && pawn !== shooter;
}

function GetRayAabbDistance(start, direction, mins, maxs, maxDistance) {
    let minimumDistance = 0;
    let maximumDistance = maxDistance;

    for (const axis of ["x", "y", "z"]) {
        const axisDirection = direction[axis];
        const axisStart = start[axis];

        if (Math.abs(axisDirection) <= RAY_PARALLEL_EPSILON) {
            if (axisStart < mins[axis] || axisStart > maxs[axis]) {
                return undefined;
            }
            continue;
        }

        const inverseDirection = 1 / axisDirection;
        let nearDistance = (mins[axis] - axisStart) * inverseDirection;
        let farDistance = (maxs[axis] - axisStart) * inverseDirection;

        if (nearDistance > farDistance) {
            const swap = nearDistance;
            nearDistance = farDistance;
            farDistance = swap;
        }

        minimumDistance = Math.max(minimumDistance, nearDistance);
        maximumDistance = Math.min(maximumDistance, farDistance);

        if (minimumDistance > maximumDistance) {
            return undefined;
        }
    }

    return minimumDistance <= maxDistance ? minimumDistance : undefined;
}

function GetPlayerHull(pawn) {
    const origin = pawn.GetAbsOrigin();
    const height = pawn.IsDucked()
        ? PLAYER_HULL_DUCKED_HEIGHT
        : PLAYER_HULL_STANDING_HEIGHT;

    return {
        mins: {
            x: origin.x - PLAYER_HULL_HALF_WIDTH,
            y: origin.y - PLAYER_HULL_HALF_WIDTH,
            z: origin.z
        },
        maxs: {
            x: origin.x + PLAYER_HULL_HALF_WIDTH,
            y: origin.y + PLAYER_HULL_HALF_WIDTH,
            z: origin.z + height
        }
    };
}

function IsDamageTestEntity(entity) {
    return entity
        && entity.IsValid()
        && typeof entity.GetEntityName === "function"
        && entity.GetEntityName() === DAMAGE_TEST_ENTITY_NAME;
}

function IsPlayerFreezeEntity(entity) {
    return entity
        && entity.IsValid()
        && typeof entity.GetEntityName === "function"
        && entity.GetEntityName() === PLAYER_FREEZE_ENTITY_NAME;
}

function DescribeEntity(entity) {
    if (!entity || !entity.IsValid()) {
        return "none";
    }

    const className = typeof entity.GetClassName === "function" ? entity.GetClassName() : "unknown_class";
    const entityName = typeof entity.GetEntityName === "function" ? entity.GetEntityName() : "unknown_name";
    return `${className}:${entityName}`;
}

function GetAliveCTPawns() {
    const pawns = [];

    for (const player of Instance.GetAllPlayerControllers()) {
        const pawn = player.GetPlayerPawn();
        if (IsAliveCTPawn(pawn)) {
            pawns.push(pawn);
        }
    }

    return pawns;
}

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

function GetAliveCTPlayerSlots() {
    const playerSlots = new Set();

    for (const player of Instance.GetAllPlayerControllers()) {
        if (!player || !player.IsConnected()) {
            continue;
        }

        if (IsAliveCTPawn(player.GetPlayerPawn())) {
            playerSlots.add(player.GetPlayerSlot());
        }
    }

    return playerSlots;
}

function GetAliveZoneCTPlayers() {
    const players = [];

    for (const player of Instance.GetAllPlayerControllers()) {
        if (!player || !player.IsConnected() || !zonePlayerSlots.has(player.GetPlayerSlot())) {
            continue;
        }

        if (IsAliveCTPawn(player.GetPlayerPawn())) {
            players.push(player);
        }
    }

    return players;
}

function GetSafeChatPlayerName(player) {
    if (!player || typeof player.GetPlayerName !== "function") {
        return "No winner";
    }

    const playerName = String(player.GetPlayerName() || "")
        .replace(/[\r\n;"\\]/g, "")
        .trim();
    return playerName || "Unnamed player";
}

function ResolveEndingCreditsFFAIfReady() {
    if (!ffaActive || ffaResolved) {
        return;
    }

    const aliveZoneCTPlayers = GetAliveZoneCTPlayers();
    if (aliveZoneCTPlayers.length > 1) {
        return;
    }

    ffaResolved = true;
    ffaActive = false;

    const winnerName = aliveZoneCTPlayers.length === 1
        ? GetSafeChatPlayerName(aliveZoneCTPlayers[0])
        : "No winner";

    Instance.EntFireAtName({ name: FFA_WIN_SOUND_NAME, input: "PlaySound" });
    for (let index = 0; index < FFA_WIN_CHAT_REPETITIONS; index++) {
        Instance.Delay((index + 1) * FFA_WIN_CHAT_INTERVAL).then(() => {
            Instance.ServerCommand(`say ${winnerName} has won the FFA!`);
        });
    }
    Instance.Delay((FFA_WIN_CHAT_REPETITIONS + 1) * FFA_WIN_CHAT_INTERVAL).then(() => {
        Instance.ServerCommand("mp_restartgame 4");
    });
    Instance.Msg(`ending_credits_ffa.js: FFA resolved with ${winnerName}; restarting round.`);
}

function SetZoneRemainingPlayerCount(remainingPlayers) {
    Instance.EntFireAtName({
        name: ZONE_PLAYER_COUNT_NAME,
        input: "SetMessage",
        value: String(remainingPlayers)
    });
}

function GetZoneStatus() {
    const aliveCTPlayerSlots = GetAliveCTPlayerSlots();
    let aliveCTsInZone = 0;

    for (const playerSlot of zonePlayerSlots) {
        if (aliveCTPlayerSlots.has(playerSlot)) {
            aliveCTsInZone++;
        }
    }

    const aliveCTCount = aliveCTPlayerSlots.size;
    const requiredCTCount = Math.ceil(aliveCTCount * ZONE_REQUIRED_CT_RATIO);

    return {
        aliveCTCount,
        aliveCTsInZone,
        requiredCTCount,
        remainingCTCount: Math.max(0, requiredCTCount - aliveCTsInZone),
        requirementMet: aliveCTCount > 0 && aliveCTsInZone >= requiredCTCount
    };
}

function ScheduleEndingCreditsThink() {
    const now = Instance.GetGameTime();
    let nextThinkTime = null;

    if (hudCountdownState) {
        nextThinkTime = Math.min(hudCountdownState.nextUpdate, hudCountdownState.endTime);
    }

    if (zoneSuccessTime !== null && !zoneCompleted) {
        nextThinkTime = nextThinkTime === null
            ? zoneSuccessTime
            : Math.min(nextThinkTime, zoneSuccessTime);
    }

    if (nextThinkTime !== null) {
        Instance.SetNextThink(Math.max(now, nextThinkTime));
    }
}

function RefreshEndingCreditsZone() {
    const status = GetZoneStatus();
    SetZoneRemainingPlayerCount(status.remainingCTCount);

    if (zoneCompleted) {
        return status;
    }

    if (!status.requirementMet) {
        zoneSuccessTime = null;
        return status;
    }

    if (zoneSuccessTime === null) {
        zoneSuccessTime = Instance.GetGameTime() + ZONE_HOLD_DURATION;
    }

    ScheduleEndingCreditsThink();
    return status;
}

function SetEndingCreditsZonePlayer(activator, isInside) {
    const player = GetPlayerController(activator);
    if (!player || !player.IsConnected()) {
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const wasInside = zonePlayerSlots.has(playerSlot);
    if (isInside) {
        if (!IsAliveCTPawn(player.GetPlayerPawn())) {
            return;
        }

        zonePlayerSlots.add(playerSlot);
    } else {
        zonePlayerSlots.delete(playerSlot);
    }

    const membershipChanged = wasInside !== zonePlayerSlots.has(playerSlot);
    const status = RefreshEndingCreditsZone();
    if (membershipChanged) {
        Instance.Msg(
            `ending_credits_ffa.js: CT player ${playerSlot} ${isInside ? "entered" : "left"} ending credits zone; `
            + `${status.aliveCTsInZone}/${status.requiredCTCount} required CTs inside `
            + `(${status.aliveCTCount} alive CTs total).`
        );
    }

    ResolveEndingCreditsFFAIfReady();
}

function CompleteEndingCreditsZoneIfReady() {
    if (zoneCompleted || zoneSuccessTime === null || Instance.GetGameTime() < zoneSuccessTime) {
        return;
    }

    const status = GetZoneStatus();
    SetZoneRemainingPlayerCount(status.remainingCTCount);

    if (!status.requirementMet) {
        zoneSuccessTime = null;
        return;
    }

    zoneCompleted = true;
    zoneSuccessTime = null;
    Instance.EntFireAtName({ name: ZONE_SUCCESS_RELAY_NAME, input: "Trigger" });
}

function ResetEndingCreditsZone() {
    zonePlayerSlots.clear();
    zoneSuccessTime = null;
    zoneCompleted = false;
    SetZoneRemainingPlayerCount(GetZoneStatus().remainingCTCount);
}

function GetEndingCreditsHud() {
    if (!(endingCreditsHud instanceof Entity) || !endingCreditsHud.IsValid()) {
        endingCreditsHud = Instance.FindEntitiesByName(HUD_NAME)[0];
    }

    return endingCreditsHud;
}

function FormatHudTime(seconds) {
    return String(Math.ceil(Math.max(0, seconds)));
}

function IsCountdownFontExpanded(seconds) {
    if (seconds <= 0) {
        return false;
    }

    const fraction = seconds - Math.floor(seconds);
    return fraction > 0 && fraction <= 0.2;
}

function CreateOdometerDissolveOrder() {
    const order = [];
    const characters = Array.from(HUD_ODOMETER_FINAL_TEXT);

    for (let index = 0; index < characters.length; index++) {
        if (characters[index] !== " ") {
            order.push(index);
        }
    }

    for (let index = order.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        const value = order[index];
        order[index] = order[swapIndex];
        order[swapIndex] = value;
    }

    return order;
}

function GetRandomOdometerLetter() {
    const index = Math.floor(Math.random() * HUD_ODOMETER_ALPHABET.length);
    return HUD_ODOMETER_ALPHABET[index];
}

function BuildOdometerText(elapsed, dissolveOrder) {
    const characters = Array.from(HUD_ODOMETER_FINAL_TEXT);

    if (elapsed < 0) {
        return characters.map(() => HUD_ODOMETER_HIDDEN_CHARACTER).join("");
    }

    if (elapsed < HUD_ODOMETER_REVEAL_DURATION) {
        const revealProgress = Math.max(0, elapsed) / HUD_ODOMETER_REVEAL_DURATION;
        const revealedCount = Math.floor(revealProgress * characters.length);

        return characters.map((character, index) => {
            if (index < revealedCount) {
                return character === " " ? HUD_ODOMETER_HIDDEN_CHARACTER : character;
            }

            if (index === revealedCount && character !== " ") {
                return GetRandomOdometerLetter();
            }

            return HUD_ODOMETER_HIDDEN_CHARACTER;
        }).join("");
    }

    const dissolveStart = HUD_ODOMETER_REVEAL_DURATION + HUD_ODOMETER_HOLD_DURATION;
    if (elapsed < dissolveStart) {
        return characters.map((character) => (
            character === " " ? HUD_ODOMETER_HIDDEN_CHARACTER : character
        )).join("");
    }

    const dissolveProgress = Math.min(
        1,
        Math.max(0, elapsed - dissolveStart) / HUD_ODOMETER_DISSOLVE_DURATION
    );
    const hiddenCount = Math.floor(dissolveProgress * dissolveOrder.length);
    const hiddenIndexes = new Set(dissolveOrder.slice(0, hiddenCount));

    return characters.map((character, index) => {
        if (character === " " || hiddenIndexes.has(index)) {
            return HUD_ODOMETER_HIDDEN_CHARACTER;
        }

        return character;
    }).join("");
}

function UpdateEndingCreditsHud(elapsed, dissolveOrder) {
    const layout = GetEndingCreditsHud();
    if (!layout) {
        return;
    }

    const countdownRemaining = Math.max(0, HUD_COUNTDOWN_DURATION - elapsed);
    const countdownVisible = elapsed < HUD_COUNTDOWN_DURATION;
    const odometerElapsed = elapsed - HUD_ODOMETER_START_DELAY;
    const odometerVisible = odometerElapsed >= 0 && odometerElapsed < HUD_ODOMETER_DURATION;
    const countdownText = FormatHudTime(countdownRemaining);
    const odometerText = BuildOdometerText(odometerElapsed, dissolveOrder);

    for (const player of Instance.GetAllPlayerControllers()) {
        if (!player || !player.IsConnected()) {
            continue;
        }

        const playerSlot = player.GetPlayerSlot();
        layout.SetDialogVariableStringForPlayer(
            playerSlot,
            HUD_COUNTDOWN_LABEL_ID,
            HUD_COUNTDOWN_DIALOG_VARIABLE,
            countdownText
        );
        layout.SetDialogVariableStringForPlayer(
            playerSlot,
            HUD_UPPER_LABEL_ID,
            HUD_UPPER_DIALOG_VARIABLE,
            HUD_UPPER_PLACEHOLDER
        );
        layout.SetDialogVariableStringForPlayer(
            playerSlot,
            HUD_ODOMETER_LABEL_ID,
            HUD_ODOMETER_DIALOG_VARIABLE,
            odometerText
        );
        layout.SetHasClassForPlayer(
            playerSlot,
            HUD_COUNTDOWN_LABEL_ID,
            "SecondTransition",
            countdownVisible && IsCountdownFontExpanded(countdownRemaining)
        );
        layout.SetHasClassForPlayer(
            playerSlot,
            HUD_UPPER_LABEL_ID,
            "Dismissed",
            !countdownVisible
        );
        layout.SetHasClassForPlayer(
            playerSlot,
            HUD_COUNTDOWN_LABEL_ID,
            "Dismissed",
            !countdownVisible
        );
        layout.SetHasClassForPlayer(
            playerSlot,
            HUD_ODOMETER_LABEL_ID,
            "Dismissed",
            !odometerVisible
        );
        layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "Dismissed", false);
    }
}

function HideEndingCreditsHud() {
    const layout = GetEndingCreditsHud();
    if (!layout) {
        return;
    }

    for (const player of Instance.GetAllPlayerControllers()) {
        if (player && player.IsConnected()) {
            layout.SetHasClassForPlayer(
                player.GetPlayerSlot(),
                HUD_COUNTDOWN_LABEL_ID,
                "SecondTransition",
                false
            );
            layout.SetHasClassForPlayer(
                player.GetPlayerSlot(),
                HUD_PANEL_ID,
                "Dismissed",
                true
            );
        }
    }
}

function ResetEndingCreditsHud() {
    hudCountdownState = null;
    HideEndingCreditsHud();
}

function StartEndingCreditsCountdown() {
    if (!GetEndingCreditsHud()) {
        Instance.Msg(`ending_credits_ffa.js: missing custom_hud_layout named ${HUD_NAME}`);
        return;
    }

    const now = Instance.GetGameTime();
    hudCountdownState = {
        startTime: now,
        endTime: now + HUD_SEQUENCE_DURATION,
        nextUpdate: now,
        dissolveOrder: CreateOdometerDissolveOrder()
    };

    UpdateEndingCreditsHud(0, hudCountdownState.dissolveOrder);
    ScheduleEndingCreditsThink();
}

function EndingCreditsHudThink() {
    const now = Instance.GetGameTime();
    if (hudCountdownState) {
        const remaining = Math.max(0, hudCountdownState.endTime - now);
        const elapsed = Math.min(HUD_SEQUENCE_DURATION, now - hudCountdownState.startTime);

        if (now >= hudCountdownState.nextUpdate) {
            UpdateEndingCreditsHud(elapsed, hudCountdownState.dissolveOrder);
            hudCountdownState.nextUpdate = now + HUD_UPDATE_INTERVAL;
        }

        if (remaining <= 0) {
            ResetEndingCreditsHud();
        }
    }

    CompleteEndingCreditsZoneIfReady();
    ScheduleEndingCreditsThink();
}

function DamagePassed(victim, beforeHealth, result) {
    if (!victim || !victim.IsValid()) {
        return true;
    }

    return result > 0 || victim.GetHealth() < beforeHealth || !victim.IsAlive();
}

function ApplyDamageWithFallback(
    victim,
    shooter,
    weapon,
    damage,
    damageTypes = CSDamageTypes.BULLET
) {
    const beforeHealth = victim.GetHealth();
    const baseDamageFlags = CSDamageFlags.IGNORE_ARMOR
        | CSDamageFlags.SUPPRESS_DAMAGE_MODIFICATION;
    const damageFlags = beforeHealth <= damage
        ? baseDamageFlags | CSDamageFlags.FORCE_DEATH
        : baseDamageFlags;

    applyingRaytraceDamage = true;
    try {
        const result = victim.TakeDamage({
            damage,
            damageTypes,
            damageFlags,
            inflictor: shooter,
            attacker: shooter,
            weapon
        });

        if (DamagePassed(victim, beforeHealth, result)) {
            return;
        }

        Instance.Msg("ending_credits_ffa.js: bullet damage did not pass, retrying attributed generic damage.");
        const fallbackResult = victim.TakeDamage({
            damage,
            damageTypes: CSDamageTypes.GENERIC,
            damageFlags,
            inflictor: shooter,
            attacker: shooter,
            weapon
        });

        if (!DamagePassed(victim, beforeHealth, fallbackResult)) {
            Instance.Msg("ending_credits_ffa.js: attributed generic fallback damage did not pass.");
        }
    } finally {
        applyingRaytraceDamage = false;
    }
}

function KillRandomCTFromDamageTest(shooter, weapon) {
    const pawns = GetAliveCTPawns();
    if (pawns.length === 0) {
        return;
    }

    const pawn = pawns[Math.floor(Math.random() * pawns.length)];
    ApplyDamageWithFallback(pawn, shooter, weapon, DAMAGE_TEST_DAMAGE);
}

function FireScriptedWeaponTrace(weapon, damageOverride) {
    const owner = weapon.GetOwner();
    if (!owner || !owner.IsValid() || !owner.IsAlive()) {
        return;
    }

    if (owner.GetActiveWeapon() !== weapon) {
        return;
    }

    const initialDamage = damageOverride ?? trackedRaytraceWeapons.get(weapon);
    if (initialDamage === undefined) {
        return;
    }

    const start = owner.GetEyePosition();
    const forward = GetForwardVector(owner.GetEyeAngles());
    const isKnife = IsKnifeWeapon(weapon);
    const isSniper = IsSniperWeapon(weapon);
    const traceLength = isKnife ? KNIFE_TRACE_LENGTH : DEBUG_TRACE_LENGTH;
    const end = {
        x: start.x + forward.x * traceLength,
        y: start.y + forward.y * traceLength,
        z: start.z + forward.z * traceLength
    };
    const hits = [];

    const safeguardTrace = Instance.TraceLine({
        start,
        end,
        ignoreEntity: owner,
        traceHitboxes: true
    });

    if (safeguardTrace.didHit && IsPlayerFreezeEntity(safeguardTrace.hitEntity)) {
        Instance.Msg(
            `ending_credits_ffa.js: ${weapon.GetClassName()} trace hit `
            + `${PLAYER_FREEZE_ENTITY_NAME}; ignoring the shot.`
        );
        return;
    }

    if (safeguardTrace.didHit && IsDamageTestEntity(safeguardTrace.hitEntity)) {
        KillRandomCTFromDamageTest(owner, weapon);
        return;
    }

    for (const player of Instance.GetAllPlayerControllers()) {
        if (!player || !player.IsConnected()) {
            continue;
        }

        const target = player.GetPlayerPawn();
        if (!IsDifferentAliveCTPawn(target, owner)) {
            continue;
        }

        const hull = GetPlayerHull(target);
        const distance = GetRayAabbDistance(
            start,
            forward,
            hull.mins,
            hull.maxs,
            traceLength
        );

        if (distance !== undefined) {
            hits.push({ target, distance });
        }
    }

    hits.sort((a, b) => a.distance - b.distance);

    Instance.DebugLine({
        start,
        end,
        duration: DEBUG_TRACE_DURATION,
        color: DEBUG_TRACE_COLOR
    });

    const maximumHits = isSniper
        ? Math.min(hits.length, SNIPER_MAX_ENTITY_HITS)
        : hits.length;
    let hitDamage = initialDamage;

    for (let hitIndex = 0; hitIndex < maximumHits; hitIndex++) {
        const hit = hits[hitIndex];
        Instance.Msg(
            `ending_credits_ffa.js: scripted ${weapon.GetClassName()} hull trace hit `
            + `${DescribeEntity(hit.target)} for ${hitDamage} damage.`
        );
        ApplyDamageWithFallback(hit.target, owner, weapon, hitDamage);

        if (isSniper) {
            hitDamage *= SNIPER_PENETRATION_DAMAGE_MULTIPLIER;
        }
    }

    Instance.Msg(
        `ending_credits_ffa.js: scripted ${weapon.GetClassName()} hull trace reached `
        + `${maximumHits} CT player(s) over ${traceLength} units.`
    );
}

function ApplyEndingCreditsFFA() {
    trackedRaytraceWeapons.clear();
    let affectedPlayers = 0;
    let registeredWeapons = 0;

    for (const player of Instance.GetAllPlayerControllers()) {
        const pawn = player.GetPlayerPawn();
        if (!IsAliveCTPawn(pawn)) {
            continue;
        }

        SetPlayerMoney(player, TARGET_MONEY);
        const playerWeaponCount = RegisterPlayerRaytraceWeapons(pawn);
        if (playerWeaponCount > 0) {
            affectedPlayers++;
            registeredWeapons += playerWeaponCount;
        }
    }

    Instance.Msg(
        `ending_credits_ffa.js: registered ${registeredWeapons} FFA weapons `
        + `for ${affectedPlayers} alive CT players.`
    );
}

Instance.OnScriptInput(INPUT_START, () => {
    ApplyEndingCreditsFFA();
    StartEndingCreditsCountdown();
    ffaActive = true;
    ffaResolved = false;
    ResolveEndingCreditsFFAIfReady();
});

Instance.OnScriptInput(ZONE_ADD_PLAYER_INPUT, ({ activator }) => {
    SetEndingCreditsZonePlayer(activator, true);
});

Instance.OnScriptInput(ZONE_REMOVE_PLAYER_INPUT, ({ activator }) => {
    SetEndingCreditsZonePlayer(activator, false);
});

function ResetEndingCreditsState() {
    trackedRaytraceWeapons.clear();
    ffaActive = false;
    ffaResolved = false;
    ResetEndingCreditsHud();
    ResetEndingCreditsZone();
}

Instance.OnActivate(ResetEndingCreditsState);
Instance.OnBeginRoundRestart(ResetEndingCreditsState);
Instance.OnRoundStart(ResetEndingCreditsState);
Instance.SetThink(EndingCreditsHudThink);

Instance.OnPlayerDisconnect((event) => {
    zonePlayerSlots.delete(event.playerSlot);
    RefreshEndingCreditsZone();
    ResolveEndingCreditsFFAIfReady();
});

Instance.OnPlayerKill((event) => {
    const player = GetPlayerController(event.player);
    if (player) {
        zonePlayerSlots.delete(player.GetPlayerSlot());
    }

    RefreshEndingCreditsZone();
    ResolveEndingCreditsFFAIfReady();
});

Instance.OnModifyPlayerDamage((event) => {
    if (
        !applyingRaytraceDamage
        && event.weapon
        && IsTrackedRaytraceWeapon(event.weapon)
    ) {
        return { abort: true };
    }
});

Instance.OnGunFire((event) => {
    if (IsTrackedRaytraceWeapon(event.weapon) && !IsKnifeWeapon(event.weapon)) {
        FireScriptedWeaponTrace(event.weapon);
    }
});

Instance.OnKnifeAttack((event) => {
    if (IsTrackedRaytraceWeapon(event.weapon) && IsKnifeWeapon(event.weapon)) {
        const damage = event.attackType === CSWeaponAttackType.SECONDARY
            ? KNIFE_SECONDARY_TRACE_DAMAGE
            : KNIFE_TRACE_DAMAGE;
        FireScriptedWeaponTrace(event.weapon, damage);
    }
});
