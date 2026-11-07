import { Instance } from "cs_script/point_script";

const TEXT_UPDATE_INTERVAL = 1 / 100;

const TIMER_CONFIGS = {
    intro_timer: {
        duration: 10,
        textEntity: "text_intro_timer",
        finishTarget: "relay_start_map",
        finishInput: "Trigger"
    },
	
	floor_1_doors: {
        duration: 10,
        textEntity: "text_floor_1_doors_timer",
        finishTarget: "relay_open_floor_1_doors",
        finishInput: "Trigger"
    },
	
	floor_2_doors: {
        duration: 10,
        textEntity: "text_floor_2_doors_timer",
        finishTarget: "relay_open_floor_2_doors",
        finishInput: "Trigger"
    },
	
	ending_kz_restart_round: {
		duration: 33,
        textEntity: "text_ending_kz_restart_round",
        finishTarget: "button_ending_kz_restart_round",
        finishInput: "Press"
	}
	
};

const activeTimers = new Map();

function FormatTime(seconds) {
    return Math.max(0, seconds).toFixed(3);
}

function SetTimerText(timer) {
    Instance.EntFireAtName({
        name: timer.textEntity,
        input: "SetMessage",
        value: FormatTime(timer.remaining)
    });
}

function StartTimer(id) {
    const config = TIMER_CONFIGS[id];
    if (!config) {
        Instance.Msg(`worldtext_timer.js: missing timer config "${id}"`);
        return;
    }

    const now = Instance.GetGameTime();
    const timer = {
        id,
        duration: config.duration,
        textEntity: config.textEntity,
        finishTarget: config.finishTarget,
        finishInput: config.finishInput || "Trigger",
        endTime: now + config.duration,
        nextTextUpdate: 0,
        remaining: config.duration,
        finishTriggered: false
    };

    activeTimers.set(id, timer);
    SetTimerText(timer);
    Instance.SetNextThink(now);
}

function FinishTimer(timer) {
    if (timer.finishTriggered) {
        return;
    }

    timer.finishTriggered = true;
    SetTimerText(timer);

    if (timer.finishTarget) {
        Instance.EntFireAtName({
            name: timer.finishTarget,
            input: timer.finishInput
        });
    }
}

function TimerThink() {
    if (activeTimers.size === 0) {
        return;
    }

    const now = Instance.GetGameTime();

    for (const [id, timer] of activeTimers) {
        timer.remaining = Math.max(0, timer.endTime - now);

        if (now >= timer.nextTextUpdate || timer.remaining <= 0) {
            SetTimerText(timer);
            timer.nextTextUpdate = now + TEXT_UPDATE_INTERVAL;
        }

        if (timer.remaining <= 0) {
            FinishTimer(timer);
            activeTimers.delete(id);
        }
    }

    if (activeTimers.size > 0) {
        Instance.SetNextThink(now);
    }
}

for (const id of Object.keys(TIMER_CONFIGS)) {
    Instance.OnScriptInput(id, () => StartTimer(id));
}

Instance.SetThink(TimerThink);
