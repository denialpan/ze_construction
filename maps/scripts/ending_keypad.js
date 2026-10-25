import { Instance } from "cs_script/point_script";

const MAX_DIGITS = 10;
const CODE_REVEAL_DURATION = 5;
const DIGIT_REVEAL_INTERVAL = CODE_REVEAL_DURATION / MAX_DIGITS;
const ROLL_UPDATE_INTERVAL = 1 / 30;
const GREEN_FLASH_DURATION = 0.1;
const COLOR_FADE_DURATION = 1.5;
const CODE_TEXT_ENTITY = "text_ending_keypad_code";
const CODE_COLOR_RED = { r: 255, g: 0, b: 0, a: 255 };
const CODE_COLOR_GREEN = { r: 0, g: 255, b: 0, a: 255 };
const CODE_COLOR_BLACK = { r: 0, g: 0, b: 0, a: 255 };
const REVEAL_PROGRESS_SOUND = "sound_ending_keypad_cooking";
const REVEAL_COMPLETE_SOUND = "sound_ending_keypad_ding";

const KEYPAD_BUTTON_PREFIX = "keypad_ending_";
const KEYPAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const KEYPAD_PRESS_RELAY = "relay_keypad_ending_button_press";
const KEYPAD_SUCCESS_RELAY = "relay_keypad_ending_button_correct";
const KEYPAD_FAILURE_RELAY = "relay_keypad_ending_button_incorrect";

let accessCode = "";
let codeRevealStartTime = 0;
let revealedDigitCount = 0;
let isCodeRevealActive = false;
let greenFlashEndTime = 0;
let isGreenFlashActive = false;
let colorFadeStartTime = 0;
let isColorFadeActive = false;
let keypadEntry = "";
let isKeypadComplete = false;

function SetCodeText(value) {
    Instance.EntFireAtName({
        name: CODE_TEXT_ENTITY,
        input: "SetMessage",
        value
    });
}

function SetCodeColor(color) {
    Instance.EntFireAtName({
        name: CODE_TEXT_ENTITY,
        input: "SetTextColor",
        value: color
    });
}

function GetRollingCodeText() {
    const revealedCode = accessCode.slice(0, revealedDigitCount);
    const rollingDigits = Array.from(
        { length: MAX_DIGITS - revealedDigitCount },
        () => Math.floor(Math.random() * 9) + 1
    ).join("");

    return revealedCode + rollingDigits;
}

function GenerateCode() {
    accessCode = Array.from(
        { length: MAX_DIGITS },
        () => Math.floor(Math.random() * 9) + 1
    ).join("");

    codeRevealStartTime = Instance.GetGameTime();
    revealedDigitCount = 0;
    keypadEntry = "";
    isCodeRevealActive = true;
    isGreenFlashActive = false;
    isColorFadeActive = false;
    Instance.EntFireAtName({
        name: REVEAL_PROGRESS_SOUND,
        input: "StopSound"
    });
    Instance.EntFireAtName({
        name: REVEAL_PROGRESS_SOUND,
        input: "PlaySound"
    });
    SetCodeColor(CODE_COLOR_RED);
    SetCodeText(GetRollingCodeText());
    Instance.SetNextThink(codeRevealStartTime + ROLL_UPDATE_INTERVAL);
}

function CodeRevealThink() {
    const now = Instance.GetGameTime();

    if (!isCodeRevealActive) {
        if (isGreenFlashActive) {
            if (now < greenFlashEndTime) {
                Instance.SetNextThink(greenFlashEndTime);
                return;
            }

            isGreenFlashActive = false;
            isColorFadeActive = true;
            colorFadeStartTime = greenFlashEndTime;
        }

        if (!isColorFadeActive) {
            return;
        }

        const fadeProgress = Math.min(
            1,
            Math.max(0, (now - colorFadeStartTime) / COLOR_FADE_DURATION)
        );
        const easedProgress = fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
        const green = Math.round(255 * (1 - easedProgress));

        SetCodeColor({ r: 0, g: green, b: 0, a: 255 });

        if (fadeProgress >= 1) {
            SetCodeColor(CODE_COLOR_BLACK);
            isColorFadeActive = false;
            return;
        }

        Instance.SetNextThink(now + ROLL_UPDATE_INTERVAL);
        return;
    }

    const elapsed = now - codeRevealStartTime;
    const nextDigitCount = Math.min(
        MAX_DIGITS,
        Math.floor(elapsed / DIGIT_REVEAL_INTERVAL)
    );

    revealedDigitCount = nextDigitCount;

    if (revealedDigitCount >= MAX_DIGITS) {
        SetCodeText(accessCode);
        SetCodeColor(CODE_COLOR_GREEN);
        Instance.EntFireAtName({
            name: REVEAL_PROGRESS_SOUND,
            input: "StopSound"
        });
        Instance.EntFireAtName({
            name: REVEAL_COMPLETE_SOUND,
            input: "PlaySound"
        });
        isCodeRevealActive = false;
        isGreenFlashActive = true;
        greenFlashEndTime = now + GREEN_FLASH_DURATION;
        Instance.SetNextThink(greenFlashEndTime);
        return;
    }

    SetCodeText(GetRollingCodeText());
    Instance.SetNextThink(now + ROLL_UPDATE_INTERVAL);
}

function FireRelay(name) {
    Instance.EntFireAtName({ name, input: "Trigger" });
}

function SubmitKeypad() {
    isKeypadComplete = true;
    FireRelay(KEYPAD_SUCCESS_RELAY);
    keypadEntry = "";
}

function FailKeypad() {
    FireRelay(KEYPAD_FAILURE_RELAY);
    keypadEntry = "";
    GenerateCode();
}

function ResetKeypadForRound() {
    isKeypadComplete = false;
    keypadEntry = "";
}

function PressDigit(digit) {
    if (isKeypadComplete) {
        return;
    }

    FireRelay(KEYPAD_PRESS_RELAY);

    if (isCodeRevealActive) {
        GenerateCode();
        return;
    }

    if (!accessCode) {
        Instance.Msg("ending_keypad.js: generate_code must be called before entering digits");
        return;
    }

    if (keypadEntry.length >= accessCode.length) {
        keypadEntry = "";
    }

    const expectedDigit = accessCode[keypadEntry.length];
    if (digit !== expectedDigit) {
        FailKeypad();
        return;
    }

    keypadEntry += digit;

    if (keypadEntry.length >= accessCode.length) {
        SubmitKeypad();
    }
}

Instance.OnScriptInput("generate_code", GenerateCode);
Instance.OnRoundStart(ResetKeypadForRound);
Instance.SetThink(CodeRevealThink);

for (const digit of KEYPAD_DIGITS) {
    Instance.OnScriptInput(`${KEYPAD_BUTTON_PREFIX}${digit}`, () => PressDigit(digit));
}
