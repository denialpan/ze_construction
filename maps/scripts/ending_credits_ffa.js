import { CSDamageFlags, CSDamageTypes, CSGearSlot, Entity, Instance } from "cs_script/point_script";

const INPUT_START = "start";
const CT_TEAM = 3;
const TARGET_MONEY = 67;
const GIVE_WEAPON = "weapon_usp_silencer";
const DEBUG_TRACE_LENGTH = 4096;
const DEBUG_TRACE_DURATION = 1.0;
const DEBUG_TRACE_COLOR = { r: 255, g: 0, b: 0 };
const USP_TRACE_DAMAGE = 20;
const DAMAGE_TEST_ENTITY_NAME = "damage_test";
const DAMAGE_TEST_DAMAGE = 100;
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

const trackedUsps = [];
let endingCreditsHud = null;
let hudCountdownState = null;

function IsAliveCTPawn(pawn) {
    return pawn
        && pawn.IsValid()
        && pawn.IsAlive()
        && pawn.GetTeamNumber() === CT_TEAM;
}

function RemoveWeaponSlot(pawn, slot) {
    const weapon = pawn.FindWeaponBySlot(slot);
    if (weapon && weapon.IsValid()) {
        pawn.DestroyWeapon(weapon);
    }
}

function SetPlayerMoney(player, amount) {
    const currentMoney = player.GetMoneySpendableNow();
    player.AddMoneySpendableNow(amount - currentMoney);
}

function TrackGivenUsp(pawn) {
    const weapon = pawn.FindWeaponBySlot(CSGearSlot.PISTOL);
    if (!weapon || !weapon.IsValid()) {
        return;
    }

    trackedUsps.push(weapon);
}

function IsTrackedUsp(weapon) {
    if (!weapon || !weapon.IsValid()) {
        return false;
    }

    for (const trackedUsp of trackedUsps) {
        if (trackedUsp && trackedUsp.IsValid() && trackedUsp === weapon) {
            return true;
        }
    }

    return weapon.GetClassName() === GIVE_WEAPON && IsOwnedByEligiblePlayer(weapon);
}

function IsOwnedByEligiblePlayer(weapon) {
    const owner = weapon.GetOwner();
    return IsAliveCTPawn(owner);
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

function AddVectors(a, b) {
    return {
        x: a.x + b.x,
        y: a.y + b.y,
        z: a.z + b.z
    };
}

function ScaleVector(vector, scale) {
    return {
        x: vector.x * scale,
        y: vector.y * scale,
        z: vector.z * scale
    };
}

function IsDifferentAliveCTPawn(pawn, shooter) {
    return IsAliveCTPawn(pawn) && pawn !== shooter;
}

function IsDamageTestEntity(entity) {
    return entity
        && entity.IsValid()
        && typeof entity.GetEntityName === "function"
        && entity.GetEntityName() === DAMAGE_TEST_ENTITY_NAME;
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
    Instance.SetNextThink(now);
}

function EndingCreditsHudThink() {
    if (!hudCountdownState) {
        return;
    }

    const now = Instance.GetGameTime();
    const remaining = Math.max(0, hudCountdownState.endTime - now);
    const elapsed = Math.min(HUD_SEQUENCE_DURATION, now - hudCountdownState.startTime);

    if (now >= hudCountdownState.nextUpdate) {
        UpdateEndingCreditsHud(elapsed, hudCountdownState.dissolveOrder);
        hudCountdownState.nextUpdate = now + HUD_UPDATE_INTERVAL;
    }

    if (remaining <= 0) {
        ResetEndingCreditsHud();
        return;
    }

    Instance.SetNextThink(Math.min(hudCountdownState.nextUpdate, hudCountdownState.endTime));
}

function DamagePassed(victim, beforeHealth, result) {
    if (!victim || !victim.IsValid()) {
        return true;
    }

    return result > 0 || victim.GetHealth() < beforeHealth || !victim.IsAlive();
}

function ApplyDamageWithFallback(victim, shooter, weapon, damage) {
    const beforeHealth = victim.GetHealth();
    const damageFlags = beforeHealth <= damage
        ? CSDamageFlags.IGNORE_ARMOR | CSDamageFlags.FORCE_DEATH
        : CSDamageFlags.IGNORE_ARMOR;

    const result = victim.TakeDamage({
        damage,
        damageTypes: CSDamageTypes.BULLET,
        damageFlags,
        inflictor: shooter,
        attacker: shooter,
        weapon
    });

    if (DamagePassed(victim, beforeHealth, result)) {
        return;
    }

    Instance.Msg("ending_credits_ffa.js: attributed damage did not pass, applying neutral fallback damage.");
    victim.TakeDamage({
        damage,
        damageTypes: CSDamageTypes.GENERIC,
        damageFlags: CSDamageFlags.IGNORE_ARMOR
    });
}

function KillRandomCTFromDamageTest(shooter, weapon) {
    const pawns = GetAliveCTPawns();
    if (pawns.length === 0) {
        return;
    }

    const pawn = pawns[Math.floor(Math.random() * pawns.length)];
    ApplyDamageWithFallback(pawn, shooter, weapon, DAMAGE_TEST_DAMAGE);
}

function ApplyScriptedUspDamage(victim, shooter, weapon) {
    ApplyDamageWithFallback(victim, shooter, weapon, USP_TRACE_DAMAGE);
}

function FireScriptedUspTrace(weapon) {
    const owner = weapon.GetOwner();
    if (!owner || !owner.IsValid()) {
        return;
    }

    const start = owner.GetEyePosition();
    const forward = GetForwardVector(owner.GetEyeAngles());
    const end = AddVectors(start, ScaleVector(forward, DEBUG_TRACE_LENGTH));
    const trace = Instance.TraceLine({
        start,
        end,
        ignoreEntity: owner,
        traceHitboxes: true
    });

    Instance.DebugLine({
        start,
        end: trace.didHit ? trace.end : end,
        duration: DEBUG_TRACE_DURATION,
        color: DEBUG_TRACE_COLOR
    });

    if (!trace.didHit) {
        Instance.Msg("ending_credits_ffa.js: scripted USP trace did not hit anything.");
        return;
    }

    Instance.Msg(`ending_credits_ffa.js: scripted USP trace hit ${DescribeEntity(trace.hitEntity)}.`);

    if (!trace.hitEntity) {
        return;
    }

    if (IsDamageTestEntity(trace.hitEntity)) {
        KillRandomCTFromDamageTest(owner, weapon);
        return;
    }

    if (!IsDifferentAliveCTPawn(trace.hitEntity, owner)) {
        return;
    }

    ApplyScriptedUspDamage(trace.hitEntity, owner, weapon);
}

function ApplyEndingCreditsFFA() {
    let affectedPlayers = 0;

    for (const player of Instance.GetAllPlayerControllers()) {
        const pawn = player.GetPlayerPawn();
        if (!IsAliveCTPawn(pawn)) {
            continue;
        }

        RemoveWeaponSlot(pawn, CSGearSlot.RIFLE);
        RemoveWeaponSlot(pawn, CSGearSlot.PISTOL);
        SetPlayerMoney(player, TARGET_MONEY);
        pawn.GiveNamedItem(GIVE_WEAPON, true);
        TrackGivenUsp(pawn);
        affectedPlayers++;
    }

    Instance.Msg(`ending_credits_ffa.js: applied FFA loadout to ${affectedPlayers} alive CT players.`);
}

Instance.OnScriptInput(INPUT_START, () => {
    ApplyEndingCreditsFFA();
    StartEndingCreditsCountdown();
});

Instance.OnActivate(ResetEndingCreditsHud);
Instance.OnBeginRoundRestart(ResetEndingCreditsHud);
Instance.OnRoundStart(ResetEndingCreditsHud);
Instance.SetThink(EndingCreditsHudThink);

Instance.OnGunFire((event) => {
    if (IsTrackedUsp(event.weapon)) {
        FireScriptedUspTrace(event.weapon);
    }
});
