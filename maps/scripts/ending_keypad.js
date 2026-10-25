import { Entity, Instance } from "cs_script/point_script";

const MAX_DIGITS = 10;
const CODE_REVEAL_DURATION = 5;
const DIGIT_REVEAL_INTERVAL = CODE_REVEAL_DURATION / MAX_DIGITS;
const ROLL_UPDATE_INTERVAL = 1 / 30;
const CODE_TEXT_ENTITY = "text_ending_keypad_code";
const REVEAL_COMPLETE_SOUND = "sound_ending_keypad_ding";
const SUCCESS_SOUND = "snd.end";
const ERROR_SOUND = "snd.hit";

let accessCode = "";
let codeRevealStartTime = 0;
let revealedDigitCount = 0;
let isCodeRevealActive = false;
let keypadLayout = null;
const entriesBySlot = new Map();
const failedSlots = new Set();

function SetCodeText(value) {
    Instance.EntFireAtName({
        name: CODE_TEXT_ENTITY,
        input: "SetMessage",
        value
    });
}

function GetRollingCodeText() {
    const revealedCode = accessCode.slice(0, revealedDigitCount);
    const rollingDigits = Array.from(
        { length: MAX_DIGITS - revealedDigitCount },
        () => Math.floor(Math.random() * 10)
    ).join("");

    return revealedCode + rollingDigits;
}

function GenerateCode() {
    accessCode = Array.from(
        { length: MAX_DIGITS },
        () => Math.floor(Math.random() * 10)
    ).join("");

    codeRevealStartTime = Instance.GetGameTime();
    revealedDigitCount = 0;
    isCodeRevealActive = true;
    SetCodeText(GetRollingCodeText());
    Instance.SetNextThink(codeRevealStartTime + ROLL_UPDATE_INTERVAL);
}

function CodeRevealThink() {
    if (!isCodeRevealActive) {
        return;
    }

    const elapsed = Instance.GetGameTime() - codeRevealStartTime;
    const nextDigitCount = Math.min(
        MAX_DIGITS,
        Math.floor(elapsed / DIGIT_REVEAL_INTERVAL)
    );

    revealedDigitCount = nextDigitCount;

    if (revealedDigitCount >= MAX_DIGITS) {
        SetCodeText(accessCode);
        Instance.EntFireAtName({
            name: REVEAL_COMPLETE_SOUND,
            input: "PlaySound"
        });
        isCodeRevealActive = false;
        return;
    }

    SetCodeText(GetRollingCodeText());
    Instance.SetNextThink(Instance.GetGameTime() + ROLL_UPDATE_INTERVAL);
}

function GetKeypadLayout() {
    if (!(keypadLayout instanceof Entity) || !keypadLayout.IsValid()) {
        keypadLayout = Instance.FindEntitiesByName("hud_keypad")[0];
    }
    return keypadLayout;
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

function SetScreenState(playerSlot, stateClass) {
    const layout = GetKeypadLayout();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, "screen", "ScreenReady", stateClass === "ScreenReady");
    layout.SetHasClassForPlayer(playerSlot, "screen", "ScreenError", stateClass === "ScreenError");
}

function SetPreview(playerSlot, value) {
    const layout = GetKeypadLayout();
    if (!layout) {
        return;
    }

    layout.SetDialogVariableStringForPlayer(playerSlot, "preview_text", "digits", "*".repeat(value.length));
}

function ResetEntry(playerSlot) {
    entriesBySlot.set(playerSlot, "");
    failedSlots.delete(playerSlot);
    SetPreview(playerSlot, "");
    SetScreenState(playerSlot, undefined);
}

function ShowKeypad(playerSlot) {
    const layout = GetKeypadLayout();
    if (!layout) {
        Instance.Msg("ending_keypad.js: missing custom_hud_layout named hud_keypad");
        return;
    }

    ResetEntry(playerSlot);
    layout.SetHasClassForPlayer(playerSlot, "keypad", "Dismissed", false);
    layout.SetInputCaptureEnabled(playerSlot, true);
}

function HideKeypad(playerSlot) {
    const layout = GetKeypadLayout();
    if (!layout) {
        return;
    }

    ResetEntry(playerSlot);
    layout.SetHasClassForPlayer(playerSlot, "keypad", "Dismissed", true);
    layout.SetInputCaptureEnabled(playerSlot, false);
}

function HideAllKeypads() {
    for (const player of Instance.GetAllPlayerControllers()) {
        if (player && player.IsConnected()) {
            HideKeypad(player.GetPlayerSlot());
        }
    }
}

function DisableKeypadButton() {
    Instance.EntFireAtName({ name: "button_keypad", input: "Disable" });
}

function PlaySound(soundName) {
    Instance.EntFireAtName({ name: soundName, input: "StartSound" });
}

function PressDigit(playerSlot, digit) {
    let currentEntry = entriesBySlot.get(playerSlot) || "";

    if (failedSlots.has(playerSlot)) {
        currentEntry = "";
        entriesBySlot.set(playerSlot, "");
        failedSlots.delete(playerSlot);
        SetScreenState(playerSlot, undefined);
    }

    if (currentEntry.length >= MAX_DIGITS) {
        return;
    }

    const nextEntry = currentEntry + digit;
    entriesBySlot.set(playerSlot, nextEntry);
    SetPreview(playerSlot, nextEntry);
    SetScreenState(playerSlot, undefined);

    if (nextEntry.length === MAX_DIGITS) {
        const wasCorrect = nextEntry === accessCode;
        SetScreenState(playerSlot, wasCorrect ? "ScreenReady" : "ScreenError");
        if (wasCorrect) {
            PlaySound(SUCCESS_SOUND);
            DisableKeypadButton();
            HideAllKeypads();
        } else {
            PlaySound(ERROR_SOUND);
            failedSlots.add(playerSlot);
        }
    }
}

Instance.OnScriptInput("generate_code", GenerateCode);
Instance.SetThink(CodeRevealThink);

Instance.OnScriptInput("ShowKeypad", ({ activator, caller }) => {
    const player = GetPlayerController(activator) || GetPlayerController(caller);
    if (!player) {
        Instance.Msg("ending_keypad.js: ShowKeypad needs a player activator or caller");
        return;
    }

    ShowKeypad(player.GetPlayerSlot());
});

Instance.OnCustomHudClicked((event) => {
    if (event.layout !== GetKeypadLayout()) {
        return;
    }

    const playerSlot = event.player.GetPlayerSlot();

    if (event.buttonId === "close_keypad_button") {
        HideKeypad(playerSlot);
        return;
    }

    if (event.buttonId === "clear_keypad_button") {
        ResetEntry(playerSlot);
        return;
    }

    if (event.buttonId.startsWith("keypad_digit_")) {
        PressDigit(playerSlot, event.buttonId.slice("keypad_digit_".length));
    }
});
