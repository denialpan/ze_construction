import { Entity, Instance } from "cs_script/point_script";

const CHECKPOINT_CONFIGS = {
    secret_kz: {
        inputPrefix: "secret_kz_checkpoint_",
        finalCheckpoint: 8,
        successRelayPrefix: "relay_secret_kz_success_",
        failureRelay: "relay_secret_kz_failure",
        failureResetInput: "secret_kz_failure_reset",
        showTimer: true,
        timerLimit: 30,
        consecutiveSuccesses: 1,
        conflicts: ["normal_kz"]
    },
	
	normal_kz: {
        inputPrefix: "normal_kz_checkpoint_",
        finalCheckpoint: 2,
        successRelayPrefix: "relay_normal_kz_success_",
        failureRelay: "relay_normal_kz_failure",
        failureResetInput: "normal_kz_failure_reset",
        showTimer: false,
        timerLimit: 0,
        consecutiveSuccesses: 50,
		conflicts: []
    }
};

const HUD_NAME = "hud_script_checkpoint_system";
const HUD_PANEL_ID = "script_checkpoint_timer";
const HUD_UPDATE_INTERVAL = 1 / 100;
const KZ_COUNTDOWN_HUD_NAME = "hud_kz_countdown";
const KZ_COUNTDOWN_PANEL_ID = "kz_countdown";
const KZ_COUNTDOWN_LABEL_ID = "kz_countdown_text";
const KZ_COUNTDOWN_DIALOG_VARIABLE = "kz_countdown_time";
const KZ_COUNTDOWN_DURATION = 4;
const ROUND_RESTART_DELAY = 5;
const FAILURE_HOLD_TIME = 2;
const SUCCESS_HOLD_TIME = 10;
const CHAT_COLOR_PREFIX = "\x03";
const JUMP_TRACK_WINDOW = 5;
const JUMP_POSITION_POLL_INTERVAL = 0.005;
const AVERAGE_CHAT_SUCCESS_MARKS = new Set([5, 10, 15, 20, 30, 40, 50]);
const NORMAL_KZ_KILL_SUCCESS_COUNT = 2;
const NORMAL_KZ_COUNTDOWN_SUCCESS_COUNT = 2;
const NORMAL_KZ_SUCCESS_40_RISE_SOUND = "sound_normal_kz_success_40_rise";
const NORMAL_KZ_FAILURE_KILL_SOUND = "sound_normal_kz_failure_kill_awp";

const progressByRun = new Map();
const timerByRun = new Map();
const successCountByRun = new Map();
const successDistanceByRun = new Map();
const armedJumpByRun = new Map();
const jumpStartByRun = new Map();
const jumpDistanceByRun = new Map();
const completionPendingByRun = new Set();
let checkpointHud = null;
let kzCountdownHud = null;
let kzCountdownState = null;
let kzCountdownPulseClass = null;

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

function FireRelay(name, player) {
    if (!name) {
        return;
    }

    Instance.EntFireAtName({
        name,
        input: "Trigger",
        activator: player
    });
}

function Say(message) {
    Instance.ServerCommand(`say ${message}`);
}

function RestartRound() {
    Instance.ServerCommand(`mp_restartgame ${ROUND_RESTART_DELAY}`);
}

function GetCheckpointHud() {
    if (!(checkpointHud instanceof Entity) || !checkpointHud.IsValid()) {
        checkpointHud = Instance.FindEntitiesByName(HUD_NAME)[0];
    }
    return checkpointHud;
}

function FormatTime(seconds) {
    return Math.max(0, seconds).toFixed(3);
}

function SetTimerText(playerSlot, seconds) {
    const layout = GetCheckpointHud();
    if (!layout) {
        return;
    }

    layout.SetDialogVariableStringForPlayer(playerSlot, "timer_text", "kz_time", FormatTime(seconds));
}

function ShowTimer(playerSlot) {
    const layout = GetCheckpointHud();
    if (!layout) {
        Instance.Msg(`script_checkpoint_system.js: missing custom_hud_layout named ${HUD_NAME}`);
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "Dismissed", false);
}

function HideTimer(playerSlot) {
    const layout = GetCheckpointHud();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "Dismissed", true);
}

function SetTimerState(playerSlot, stateClass) {
    const layout = GetCheckpointHud();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "TimerFailure", stateClass === "TimerFailure");
    layout.SetHasClassForPlayer(playerSlot, HUD_PANEL_ID, "TimerSuccess", stateClass === "TimerSuccess");
}

function GetKzCountdownHud() {
    if (!(kzCountdownHud instanceof Entity) || !kzCountdownHud.IsValid()) {
        kzCountdownHud = Instance.FindEntitiesByName(KZ_COUNTDOWN_HUD_NAME)[0];
        kzCountdownPulseClass = null;
    }
    return kzCountdownHud;
}

function TriggerKzCountdownPulse() {
    const layout = GetKzCountdownHud();
    if (!layout) {
        return;
    }

    const nextPulseClass = kzCountdownPulseClass === "PulseEven" ? "PulseOdd" : "PulseEven";
    if (kzCountdownPulseClass) {
        layout.SetHasClass(KZ_COUNTDOWN_PANEL_ID, kzCountdownPulseClass, false);
    }
    layout.SetHasClass(KZ_COUNTDOWN_PANEL_ID, nextPulseClass, true);
    kzCountdownPulseClass = nextPulseClass;
}

function UpdateKzCountdownHud(seconds) {
    const layout = GetKzCountdownHud();
    if (!layout) {
        return;
    }

    const text = FormatTime(seconds);

    for (const player of Instance.GetAllPlayerControllers()) {
        if (!player || !player.IsConnected()) {
            continue;
        }

        const playerSlot = player.GetPlayerSlot();
        layout.SetDialogVariableStringForPlayer(
            playerSlot,
            KZ_COUNTDOWN_LABEL_ID,
            KZ_COUNTDOWN_DIALOG_VARIABLE,
            text
        );
        layout.SetHasClassForPlayer(playerSlot, KZ_COUNTDOWN_PANEL_ID, "Dismissed", false);
    }
}

function HideKzCountdownHud() {
    const layout = GetKzCountdownHud();
    if (!layout) {
        return;
    }

    for (const player of Instance.GetAllPlayerControllers()) {
        if (player && player.IsConnected()) {
            layout.SetHasClassForPlayer(
                player.GetPlayerSlot(),
                KZ_COUNTDOWN_PANEL_ID,
                "Dismissed",
                true
            );
        }
    }
}

function StartKzCountdown(player) {
    if (!GetKzCountdownHud()) {
        Instance.Msg(`script_checkpoint_system.js: missing custom_hud_layout named ${KZ_COUNTDOWN_HUD_NAME}`);
        return;
    }

    const now = Instance.GetGameTime();
    kzCountdownState = {
        player,
        endTime: now + KZ_COUNTDOWN_DURATION,
        nextUpdate: now,
        displayedSecond: Math.ceil(KZ_COUNTDOWN_DURATION)
    };
    TriggerKzCountdownPulse();
    UpdateKzCountdownHud(KZ_COUNTDOWN_DURATION);
    Instance.SetNextThink(now);
}

function GetRunKey(systemId, playerSlot) {
    return `${systemId}:${playerSlot}`;
}

function StartTimer(runKey, systemId, player) {
    const now = Instance.GetGameTime();
    timerByRun.set(runKey, {
        systemId,
        player,
        playerSlot: player.GetPlayerSlot(),
        startTime: now,
        elapsed: 0,
        running: true,
        nextUpdate: 0,
        hideAt: 0
    });
    SetTimerState(player.GetPlayerSlot(), undefined);
    SetTimerText(player.GetPlayerSlot(), 0);
    ShowTimer(player.GetPlayerSlot());
    Instance.SetNextThink(now);
}

function IsTimerEnabled(config) {
    return config.showTimer === true;
}

function StopTimer(runKey) {
    const timer = timerByRun.get(runKey);
    if (!timer) {
        return 0;
    }

    timer.elapsed = Math.max(0, Instance.GetGameTime() - timer.startTime);
    timer.running = false;
    SetTimerText(timer.playerSlot, timer.elapsed);
    return timer.elapsed;
}

function ResetTimer(runKey, playerSlot) {
    timerByRun.delete(runKey);
    SetTimerState(playerSlot, undefined);
    SetTimerText(playerSlot, 0);
    HideTimer(playerSlot);
}

function HoldTimer(runKey, playerSlot, stateClass, holdTime) {
    const now = Instance.GetGameTime();
    const timer = timerByRun.get(runKey) || {
        playerSlot,
        startTime: now,
        elapsed: 0,
        running: false,
        nextUpdate: 0,
        hideAt: 0
    };

    timer.running = false;
    timer.hideAt = now + holdTime;
    timerByRun.set(runKey, timer);

    SetTimerText(playerSlot, timer.elapsed);
    SetTimerState(playerSlot, stateClass);
    ShowTimer(playerSlot);
    Instance.SetNextThink(now);
}

function ResetPlayerProgress(runKey) {
    progressByRun.delete(runKey);
    completionPendingByRun.delete(runKey);
}

function ResetJumpTracking(runKey) {
    armedJumpByRun.delete(runKey);
    jumpStartByRun.delete(runKey);
    jumpDistanceByRun.delete(runKey);
}

function ArmJumpTracking(runKey, systemId, player) {
    const playerSlot = player.GetPlayerSlot();
    armedJumpByRun.set(runKey, {
        systemId,
        player,
        playerSlot,
        expiresAt: Instance.GetGameTime() + JUMP_TRACK_WINDOW,
        nextPositionPoll: 0,
        lastPosition: undefined
    });
    jumpStartByRun.delete(runKey);
    jumpDistanceByRun.delete(runKey);
    Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} armed ${systemId} jump tracking`);
    Instance.SetNextThink(Instance.GetGameTime());
}

function ResetSuccessCount(runKey) {
    successCountByRun.delete(runKey);
    successDistanceByRun.delete(runKey);
}

function IsConsecutiveSuccessInProgress(runKey) {
    return (successCountByRun.get(runKey) || 0) > 0;
}

function AdvanceSuccessCount(runKey, config, jumpDistance) {
    const requiredSuccesses = Math.max(1, config.consecutiveSuccesses || 1);
    const nextSuccessCount = (successCountByRun.get(runKey) || 0) + 1;
    const nextDistanceSum = (successDistanceByRun.get(runKey) || 0) + Math.max(0, jumpDistance || 0);
    const averageDistance = nextDistanceSum / nextSuccessCount;

    if (nextSuccessCount >= requiredSuccesses) {
        successCountByRun.delete(runKey);
        successDistanceByRun.delete(runKey);
    } else {
        successCountByRun.set(runKey, nextSuccessCount);
        successDistanceByRun.set(runKey, nextDistanceSum);
    }

    return {
        count: nextSuccessCount,
        averageDistance
    };
}

function FireSuccessRelay(config, player, successCount) {
    if (!config.successRelayPrefix) {
        Instance.Msg("script_checkpoint_system.js: missing successRelayPrefix");
        return;
    }

    FireRelay(`${config.successRelayPrefix}${successCount}`, player);
}

function HandleNormalKzSuccess(player, successCount) {
    if (successCount === NORMAL_KZ_KILL_SUCCESS_COUNT) {
        const completingPlayerSlot = player.GetPlayerSlot();

        for (const otherPlayer of Instance.GetAllPlayerControllers()) {
            if (
                !otherPlayer ||
                !otherPlayer.IsConnected() ||
                otherPlayer.GetPlayerSlot() === completingPlayerSlot
            ) {
                continue;
            }

            const pawn = GetPlayerPawn(otherPlayer);
            if (pawn && pawn.IsAlive()) {
                pawn.Kill();
            }
        }
    }

    if (successCount === NORMAL_KZ_COUNTDOWN_SUCCESS_COUNT) {
        StartKzCountdown(player);
    }
}

function HandleNormalKzFailure(player, successCount) {
    if (successCount < NORMAL_KZ_KILL_SUCCESS_COUNT) {
        return;
    }

    Instance.EntFireAtName({
        name: NORMAL_KZ_SUCCESS_40_RISE_SOUND,
        input: "StopSound"
    });

    const pawn = GetPlayerPawn(player);
    if (pawn && pawn.IsAlive()) {
        Instance.EntFireAtName({
            name: NORMAL_KZ_FAILURE_KILL_SOUND,
            input: "PlaySound"
        });
        pawn.Kill();
        RestartRound();
    }
}

function GetPawnPosition(pawn) {
    if (!pawn || typeof pawn.GetAbsOrigin !== "function") {
        return undefined;
    }

    return pawn.GetAbsOrigin();
}

function GetPlayerPawn(player) {
    if (!player || typeof player.GetPlayerPawn !== "function") {
        return undefined;
    }

    const pawn = player.GetPlayerPawn();
    if (!pawn || !pawn.IsValid()) {
        return undefined;
    }

    return pawn;
}

function GetHorizontalDistance(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function GetJumpDistanceForCompletion(runKey, player) {
    const trackedDistance = jumpDistanceByRun.get(runKey);
    if (trackedDistance !== undefined) {
        return trackedDistance;
    }

    const startPosition = jumpStartByRun.get(runKey);
    const pawn = GetPlayerPawn(player);
    const endPosition = GetPawnPosition(pawn);
    if (!startPosition || !endPosition) {
        return 0;
    }

    return GetHorizontalDistance(startPosition, endPosition);
}

function GetTrackedPosition(state, pawn) {
    return state.lastPosition || GetPawnPosition(pawn);
}

function GetPlayerName(player) {
    if (player && typeof player.GetPlayerName === "function") {
        return player.GetPlayerName();
    }

    return `player ${player.GetPlayerSlot()}`;
}

function PrintSuccessChat(player, successCount, jumpDistance, averageDistance) {
    const playerName = GetPlayerName(player);
    const units = Math.max(0, jumpDistance || 0).toFixed(3);
    const averageUnits = Math.max(0, averageDistance || 0).toFixed(3);

    if (successCount === 1) {
        Say(`${CHAT_COLOR_PREFIX}[KZ] ${playerName} jumped ${units} units!`);
        return;
    }

    if (!AVERAGE_CHAT_SUCCESS_MARKS.has(successCount)) {
        return;
    }

    Say(`${CHAT_COLOR_PREFIX}[KZ] ${playerName} jumped an average of ${averageUnits} units ${successCount} times in a row!`);
}

function GetPlayerProgress(systemId, playerSlot) {
    return progressByRun.get(GetRunKey(systemId, playerSlot)) || 0;
}

function FailCheckpointSystem(systemId, config, player, reason) {
    const playerSlot = player.GetPlayerSlot();
    const runKey = GetRunKey(systemId, playerSlot);
    const successCount = successCountByRun.get(runKey) || 0;

    ResetPlayerProgress(runKey);
    ResetSuccessCount(runKey);
    ResetJumpTracking(runKey);
    if (IsTimerEnabled(config)) {
        StopTimer(runKey);
        HoldTimer(runKey, playerSlot, "TimerFailure", FAILURE_HOLD_TIME);
    }

    Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} failed ${systemId}${reason ? `; ${reason}` : ""}`);
    FireRelay(config.failureRelay, player);
    if (systemId === "normal_kz") {
        HandleNormalKzFailure(player, successCount);
    }
}

function GetBlockingActiveConflict(systemId, playerSlot) {
    for (const [activeSystemId, activeConfig] of Object.entries(CHECKPOINT_CONFIGS)) {
        if (activeSystemId === systemId) {
            continue;
        }

        if (!(activeConfig.conflicts || []).includes(systemId)) {
            continue;
        }

        if (GetPlayerProgress(activeSystemId, playerSlot) > 0) {
            return activeSystemId;
        }
    }

    return undefined;
}

function FailureReset(systemId, activator) {
    const config = CHECKPOINT_CONFIGS[systemId];
    if (!config) {
        Instance.Msg(`script_checkpoint_system.js: missing checkpoint config "${systemId}"`);
        return;
    }

    const player = GetPlayerController(activator);
    if (!player) {
        Instance.Msg(`script_checkpoint_system.js: ${systemId} failure reset needs a player activator`);
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const runKey = GetRunKey(systemId, playerSlot);
    const currentCheckpoint = progressByRun.get(runKey) || 0;

    if (currentCheckpoint === 0) {
        if (IsConsecutiveSuccessInProgress(runKey)) {
            Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored ${systemId} failure reset; waiting for checkpoint_1`);
            return;
        }

        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored ${systemId} failure reset; not started`);
        return;
    }

    FailCheckpointSystem(systemId, config, player, "failure reset input");
}

function EnterCheckpointVolume(systemId, checkpointNumber, playerSlot) {
    const config = CHECKPOINT_CONFIGS[systemId];

    if (config && checkpointNumber === config.finalCheckpoint - 1) {
        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} entered ${systemId} second-last volume`);
    }
}

function ExitCheckpointVolume(systemId, checkpointNumber, activator) {
    const player = GetPlayerController(activator);
    if (!player) {
        return;
    }

    Instance.Msg(`script_checkpoint_system.js: player ${player.GetPlayerSlot()} exited ${systemId} checkpoint_${checkpointNumber}`);
}

function CompleteCheckpointSystem(systemId, config, player) {
    const playerSlot = player.GetPlayerSlot();
    const runKey = GetRunKey(systemId, playerSlot);

    if ((progressByRun.get(runKey) || 0) !== config.finalCheckpoint) {
        completionPendingByRun.delete(runKey);
        return;
    }

    const elapsed = IsTimerEnabled(config) ? StopTimer(runKey) : 0;
    const jumpDistance = GetJumpDistanceForCompletion(runKey, player);
    if (IsTimerEnabled(config)) {
        HoldTimer(runKey, playerSlot, "TimerSuccess", SUCCESS_HOLD_TIME);
    }
    ResetPlayerProgress(runKey);
    const success = AdvanceSuccessCount(runKey, config, jumpDistance);
    Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} completed ${systemId} success_${success.count} in ${FormatTime(elapsed)}`);
    PrintSuccessChat(player, success.count, jumpDistance, success.averageDistance);
    FireSuccessRelay(config, player, success.count);
    if (systemId === "normal_kz") {
        HandleNormalKzSuccess(player, success.count);
    }
    ResetJumpTracking(runKey);
}

function QueueCheckpointCompletion(systemId, config, player) {
    const playerSlot = player.GetPlayerSlot();
    const runKey = GetRunKey(systemId, playerSlot);

    Instance.QueueAfterThinks(() => {
        CompleteCheckpointSystem(systemId, config, player);
    });
}

function TouchCheckpoint(systemId, checkpointNumber, activator) {
    const config = CHECKPOINT_CONFIGS[systemId];
    if (!config) {
        Instance.Msg(`script_checkpoint_system.js: missing checkpoint config "${systemId}"`);
        return;
    }

    Instance.Msg(`script_checkpoint_system.js: received ${systemId} checkpoint_${checkpointNumber}`);

    const player = GetPlayerController(activator);
    if (!player) {
        const activatorName = activator && typeof activator.GetEntityName === "function" ? activator.GetEntityName() : "none";
        const activatorClass = activator && typeof activator.GetClassName === "function" ? activator.GetClassName() : "none";
        Instance.Msg(`script_checkpoint_system.js: ${systemId} checkpoint_${checkpointNumber} needs a player activator; activator=${activatorName} class=${activatorClass}`);
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const runKey = GetRunKey(systemId, playerSlot);
    const currentCheckpoint = progressByRun.get(runKey) || 0;
    const expectedCheckpoint = currentCheckpoint + 1;

    if (currentCheckpoint === 0) {
        if (checkpointNumber !== 1) {
            if (IsConsecutiveSuccessInProgress(runKey)) {
                Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored ${systemId} checkpoint_${checkpointNumber}; waiting for checkpoint_1`);
                return;
            }

            Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored ${systemId} checkpoint_${checkpointNumber}; not started`);
            return;
        }

        const blockingConflict = GetBlockingActiveConflict(systemId, playerSlot);
        if (blockingConflict) {
            Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored ${systemId}; active ${blockingConflict} has priority`);
            return;
        }
    }

    if (checkpointNumber === 1 && currentCheckpoint > 0) {
        EnterCheckpointVolume(systemId, checkpointNumber, playerSlot);
        progressByRun.set(runKey, 1);
        if (IsTimerEnabled(config)) {
            StartTimer(runKey, systemId, player);
        }
        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} restarted ${systemId} at checkpoint_1`);
        return;
    }

    if (checkpointNumber <= currentCheckpoint) {
        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored previous ${systemId} checkpoint_${checkpointNumber}`);
        return;
    }

    if (checkpointNumber !== expectedCheckpoint) {
        FailCheckpointSystem(systemId, config, player, `checkpoint_${checkpointNumber}`);
        return;
    }

    EnterCheckpointVolume(systemId, checkpointNumber, playerSlot);
    progressByRun.set(runKey, checkpointNumber);
    Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} reached ${systemId} checkpoint_${checkpointNumber}`);

    if (checkpointNumber === 1 && IsTimerEnabled(config)) {
        StartTimer(runKey, systemId, player);
    }

    if (checkpointNumber === config.finalCheckpoint - 1) {
        ArmJumpTracking(runKey, systemId, player);
    }

    if (checkpointNumber === config.finalCheckpoint) {
        if (completionPendingByRun.has(runKey)) {
            Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} ignored duplicate ${systemId} completion`);
            return;
        }

        completionPendingByRun.add(runKey);
        if (jumpStartByRun.has(runKey) && !jumpDistanceByRun.has(runKey)) {
            Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} waiting for ${systemId} landing measurement`);
            return;
        }

        QueueCheckpointCompletion(systemId, config, player);
    }
}

function TrackPlayerJump(pawn) {
    const player = GetPlayerController(pawn);
    if (!player) {
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const now = Instance.GetGameTime();
    for (const [runKey, state] of armedJumpByRun) {
        if (state.playerSlot !== playerSlot || now > state.expiresAt) {
            continue;
        }

        const position = GetTrackedPosition(state, pawn);
        if (!position) {
            continue;
        }

        jumpStartByRun.set(runKey, position);
        jumpDistanceByRun.delete(runKey);
        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} started ${state.systemId} jump measurement`);
    }
}

function TrackPlayerLand(pawn) {
    const player = GetPlayerController(pawn);
    if (!player) {
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    const now = Instance.GetGameTime();
    for (const [runKey, state] of armedJumpByRun) {
        if (state.playerSlot !== playerSlot || now > state.expiresAt) {
            continue;
        }

        const position = GetTrackedPosition(state, pawn);
        if (!position) {
            continue;
        }

        const startPosition = jumpStartByRun.get(runKey);
        if (!startPosition) {
            continue;
        }

        const distance = GetHorizontalDistance(startPosition, position);
        jumpDistanceByRun.set(runKey, distance);
        armedJumpByRun.delete(runKey);
        Instance.Msg(`script_checkpoint_system.js: player ${playerSlot} landed ${state.systemId} jump ${distance.toFixed(3)} units`);

        const config = CHECKPOINT_CONFIGS[state.systemId];
        if (completionPendingByRun.has(runKey) && config && (progressByRun.get(runKey) || 0) === config.finalCheckpoint) {
            QueueCheckpointCompletion(state.systemId, config, player);
        }
    }
}

function TimerThink() {
    const now = Instance.GetGameTime();
    let needsNextThink = false;

    for (const [runKey, timer] of timerByRun) {
        if (timer.running) {
            needsNextThink = true;
            timer.elapsed = Math.max(0, now - timer.startTime);

            const config = CHECKPOINT_CONFIGS[timer.systemId];
            if (config && config.timerLimit > 0 && timer.elapsed >= config.timerLimit) {
                FailCheckpointSystem(timer.systemId, config, timer.player, "timer limit");
                continue;
            }

            if (now >= timer.nextUpdate) {
                SetTimerText(timer.playerSlot, timer.elapsed);
                timer.nextUpdate = now + HUD_UPDATE_INTERVAL;
            }

            continue;
        }

        if (timer.hideAt > 0) {
            if (now >= timer.hideAt) {
                HideTimer(timer.playerSlot);
                timerByRun.delete(runKey);
            } else {
                needsNextThink = true;
            }
        }
    }

    for (const [runKey, state] of armedJumpByRun) {
        if (now >= state.expiresAt) {
            armedJumpByRun.delete(runKey);
            jumpStartByRun.delete(runKey);
            jumpDistanceByRun.delete(runKey);
            Instance.Msg(`script_checkpoint_system.js: player ${state.playerSlot} ${state.systemId} jump tracking expired`);
        } else {
            if (now >= state.nextPositionPoll) {
                const pawn = GetPlayerPawn(state.player);
                const position = GetPawnPosition(pawn);
                if (position) {
                    state.lastPosition = position;
                }
                state.nextPositionPoll = now + JUMP_POSITION_POLL_INTERVAL;
            }
            needsNextThink = true;
        }
    }

    if (kzCountdownState) {
        const remaining = Math.max(0, kzCountdownState.endTime - now);
        const displayedSecond = Math.ceil(remaining);

        if (displayedSecond !== kzCountdownState.displayedSecond) {
            kzCountdownState.displayedSecond = displayedSecond;
            TriggerKzCountdownPulse();
        }

        if (now >= kzCountdownState.nextUpdate || remaining <= 0) {
            UpdateKzCountdownHud(remaining);
            kzCountdownState.nextUpdate = now + HUD_UPDATE_INTERVAL;
        }

        if (remaining <= 0) {
            const countdownPlayer = kzCountdownState.player;
            HideKzCountdownHud();
            kzCountdownState = null;

            const pawn = GetPlayerPawn(countdownPlayer);
            if (pawn && pawn.IsAlive()) {
                pawn.Kill();
            }
            RestartRound();
        } else {
            needsNextThink = true;
        }
    }

    if (needsNextThink) {
        Instance.SetNextThink(now);
    }
}

function ResetAllCheckpointState() {
    progressByRun.clear();
    timerByRun.clear();
    successCountByRun.clear();
    successDistanceByRun.clear();
    armedJumpByRun.clear();
    jumpStartByRun.clear();
    jumpDistanceByRun.clear();
    completionPendingByRun.clear();

    kzCountdownState = null;
    kzCountdownPulseClass = null;

    checkpointHud = null;
    kzCountdownHud = null;

    const checkpointLayout = GetCheckpointHud();
    if (checkpointLayout) {
        checkpointLayout.Reset();
    }

    const countdownLayout = GetKzCountdownHud();
    if (countdownLayout) {
        countdownLayout.Reset();
    }

    Instance.Msg("script_checkpoint_system.js: reset all checkpoint state");
}

for (const [systemId, config] of Object.entries(CHECKPOINT_CONFIGS)) {
    for (let checkpoint = 1; checkpoint <= config.finalCheckpoint; checkpoint += 1) {
        Instance.OnScriptInput(`${config.inputPrefix}${checkpoint}`, ({ activator }) => {
            TouchCheckpoint(systemId, checkpoint, activator);
        });

        Instance.OnScriptInput(`${config.inputPrefix}${checkpoint}_exit`, ({ activator }) => {
            ExitCheckpointVolume(systemId, checkpoint, activator);
        });
    }

    if (config.failureResetInput) {
        Instance.OnScriptInput(config.failureResetInput, ({ activator }) => {
            FailureReset(systemId, activator);
        });
    }
}

Instance.OnPlayerJump((event) => {
    TrackPlayerJump(event.player);
});

Instance.OnPlayerLand((event) => {
    TrackPlayerLand(event.player);
});

Instance.OnActivate(ResetAllCheckpointState);
Instance.OnRoundStart(ResetAllCheckpointState);

Instance.OnPlayerDisconnect((event) => {
    const suffix = `:${event.playerSlot}`;

    for (const runKey of progressByRun.keys()) {
        if (runKey.endsWith(suffix)) {
            progressByRun.delete(runKey);
        }
    }

    for (const runKey of timerByRun.keys()) {
        if (runKey.endsWith(suffix)) {
            timerByRun.delete(runKey);
        }
    }

    for (const runKey of successCountByRun.keys()) {
        if (runKey.endsWith(suffix)) {
            successCountByRun.delete(runKey);
        }
    }

    for (const runKey of successDistanceByRun.keys()) {
        if (runKey.endsWith(suffix)) {
            successDistanceByRun.delete(runKey);
        }
    }

    for (const runKey of armedJumpByRun.keys()) {
        if (runKey.endsWith(suffix)) {
            armedJumpByRun.delete(runKey);
        }
    }

    for (const runKey of jumpStartByRun.keys()) {
        if (runKey.endsWith(suffix)) {
            jumpStartByRun.delete(runKey);
        }
    }

    for (const runKey of jumpDistanceByRun.keys()) {
        if (runKey.endsWith(suffix)) {
            jumpDistanceByRun.delete(runKey);
        }
    }

    for (const runKey of completionPendingByRun.values()) {
        if (runKey.endsWith(suffix)) {
            completionPendingByRun.delete(runKey);
        }
    }
});

Instance.SetThink(TimerThink);
