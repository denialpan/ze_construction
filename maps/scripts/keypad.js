import { Instance } from "cs_script/point_script";

const TRUE_ENDING_KEYPAD_ID = "keypad_true_ending";
const TRUE_ENDING_CODE_LENGTH = 10;
const TRUE_ENDING_CODE_INPUT = "keypad_true_ending_code";

const KEYPAD_CONFIGS = {
	
    "keypad_original": {
        code: "241536",
        digits: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
        buttonPrefix: "keypad_original_",
        pressRelay: "relay_keypad_original_button_press",
        successRelay: "relay_keypad_original_button_correct",
        failureRelay: "relay_keypad_original_button_incorrect"
    },
	
	"keypad_floor_2_garage": {
        code: "67676767",
        digits: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
        buttonPrefix: "keypad_floor_2_garage_",
        pressRelay: "relay_keypad_floor_2_garage_button_press",
        successRelay: "relay_keypad_floor_2_garage_button_correct",
        failureRelay: "relay_keypad_floor_2_garage_button_incorrect"
    },
	
	"keypad_true_ending": {
        code: "",
        digits: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
        buttonPrefix: "keypad_true_ending_",
        pressRelay: "relay_keypad_true_ending_button_press",
        successRelay: "relay_keypad_true_ending_button_correct",
        failureRelay: "relay_keypad_true_ending_button_incorrect"
    }
	
};

const keypads = new Map();
let pendingTrueEndingCode = "";

function BeginTrueEndingCode() {
    pendingTrueEndingCode = "";
}

function AddTrueEndingCodeDigit(digit) {
    if (pendingTrueEndingCode.length < TRUE_ENDING_CODE_LENGTH) {
        pendingTrueEndingCode += digit;
    }
}

function CommitTrueEndingCode() {
    if (!new RegExp(`^[1-9]{${TRUE_ENDING_CODE_LENGTH}}$`).test(pendingTrueEndingCode)) {
        Instance.Msg("keypad.js: received an invalid true-ending code");
        pendingTrueEndingCode = "";
        return;
    }

    KEYPAD_CONFIGS[TRUE_ENDING_KEYPAD_ID].code = pendingTrueEndingCode;

    const keypad = keypads.get(TRUE_ENDING_KEYPAD_ID);
    if (keypad) {
        keypad.code = pendingTrueEndingCode;
        keypad.entry = "";
    }

    pendingTrueEndingCode = "";
}

function FireRelay(name) {
    if (!name) {
        return;
    }

    Instance.EntFireAtName({ name, input: "Trigger" });
}

function SubmitKeypad(keypad) {
    FireRelay(keypad.successRelay);
    keypad.entry = "";
}

function FailKeypad(keypad) {
    FireRelay(keypad.failureRelay);
    keypad.entry = "";
}

function PressDigit(keypadId, digit) {
    const keypad = keypads.get(keypadId);
    if (!keypad) {
        Instance.Msg(`entity_keypad.js: missing keypad "${keypadId}"`);
        return;
    }

    if (keypad.entry.length >= keypad.code.length) {
        keypad.entry = "";
    }

    FireRelay(keypad.pressRelay);

    const expectedDigit = keypad.code[keypad.entry.length];
    if (digit !== expectedDigit) {
        FailKeypad(keypad);
        return;
    }

    keypad.entry += digit;

    if (keypad.entry.length >= keypad.code.length) {
        SubmitKeypad(keypad);
    }
}

function SetupKeypads() {
    Instance.Msg("entity_keypad.js: initializing keypads");

    for (const [id, config] of Object.entries(KEYPAD_CONFIGS)) {
        keypads.set(id, {
            id,
            entry: "",
            code: config.code,
            pressRelay: config.pressRelay,
            successRelay: config.successRelay,
            failureRelay: config.failureRelay
        });
    }
}

for (const [id, config] of Object.entries(KEYPAD_CONFIGS)) {
    const digits = config.digits || Array.from(new Set(config.code.split("")));

    for (const digit of digits) {
        Instance.OnScriptInput(`${id}_${digit}`, () => PressDigit(id, digit));
    }
}

Instance.OnScriptInput(`${TRUE_ENDING_CODE_INPUT}_begin`, BeginTrueEndingCode);

for (let digit = 1; digit <= 9; digit++) {
    Instance.OnScriptInput(`${TRUE_ENDING_CODE_INPUT}_digit_${digit}`, () => {
        AddTrueEndingCodeDigit(String(digit));
    });
}

Instance.OnScriptInput(`${TRUE_ENDING_CODE_INPUT}_commit`, CommitTrueEndingCode);

Instance.OnActivate(SetupKeypads);
