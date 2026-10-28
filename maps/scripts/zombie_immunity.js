import { Instance } from "cs_script/point_script";

const T_TEAM = 2;
const CT_TEAM = 3;
const IMMUNITY_DURATION = 5;

const immunityExpiresBySlot = new Map();

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

function GrantImmunity(activator) {
    const player = GetPlayerController(activator);
    if (!player) {
        Instance.Msg("zombie_immunity.js: grant_immunity needs a player activator");
        return;
    }

    if (player.GetTeamNumber() !== CT_TEAM) {
        return;
    }

    immunityExpiresBySlot.set(
        player.GetPlayerSlot(),
        Instance.GetGameTime() + IMMUNITY_DURATION
    );
}

Instance.OnScriptInput("grant_immunity", ({ activator }) => {
    GrantImmunity(activator);
});

Instance.OnModifyPlayerDamage((event) => {
    if (
        event.player.GetTeamNumber() !== CT_TEAM ||
        event.attacker?.GetTeamNumber() !== T_TEAM
    ) {
        return;
    }

    const player = GetPlayerController(event.player);
    if (!player) {
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const expiresAt = immunityExpiresBySlot.get(playerSlot);
    if (expiresAt === undefined) {
        return;
    }

    if (Instance.GetGameTime() >= expiresAt) {
        immunityExpiresBySlot.delete(playerSlot);
        return;
    }

    return { abort: true };
});

Instance.OnPlayerDisconnect(({ playerSlot }) => {
    immunityExpiresBySlot.delete(playerSlot);
});

Instance.OnRoundStart(() => {
    immunityExpiresBySlot.clear();
});
