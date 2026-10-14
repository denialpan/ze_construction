import { CSInputs, Entity, Instance } from "cs_script/point_script";

const NOTE_LAYOUT_NAME = "hud_note";
const NOTE_PANEL_ID = "note";
const NOTE_CLOSE_DELAY = 0.2;
const NOTE_CLOSE_RADIUS = 64;

const NOTES = {
    note_1: "This is the first readable note.\\nThis line starts below it.",
    note_2: "This is the second readable note."
};

let noteLayout = null;
const openNotes = new Map();

function GetNoteLayout() {
    if (!(noteLayout instanceof Entity) || !noteLayout.IsValid()) {
        noteLayout = Instance.FindEntitiesByName(NOTE_LAYOUT_NAME)[0];
    }

    return noteLayout;
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

function Distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function GetNoteOrigin(noteEntity) {
    if (!noteEntity || !noteEntity.IsValid() || typeof noteEntity.GetAbsOrigin !== "function") {
        return undefined;
    }

    return noteEntity.GetAbsOrigin();
}

function ShowNote(player, noteName, noteEntity) {
    const layout = GetNoteLayout();
    if (!layout) {
        Instance.Msg("note.js: missing custom_hud_layout named hud_note");
        return;
    }

    const text = NOTES[noteName];
    if (!text) {
        Instance.Msg(`note.js: no note configured for ${noteName || "unknown note"}`);
        return;
    }

    const playerSlot = player.GetPlayerSlot();
    layout.SetDialogVariableStringForPlayer(playerSlot, NOTE_PANEL_ID, "body", FormatNoteText(text));
    layout.SetHasClassForPlayer(playerSlot, NOTE_PANEL_ID, "Dismissed", false);
    layout.SetInputCaptureEnabled(playerSlot, true);
    openNotes.set(playerSlot, {
        player,
        noteOrigin: GetNoteOrigin(noteEntity),
        openedAt: Instance.GetGameTime()
    });
    Instance.SetNextThink(Instance.GetGameTime());
}

function FormatNoteText(text) {
    return text.replace(/\\n/g, "\n");
}

function HideNote(playerSlot) {
    const layout = GetNoteLayout();
    if (!layout) {
        return;
    }

    layout.SetHasClassForPlayer(playerSlot, NOTE_PANEL_ID, "Dismissed", true);
    layout.SetInputCaptureEnabled(playerSlot, false);
    openNotes.delete(playerSlot);
}

function UpdateOpenNotes() {
    const now = Instance.GetGameTime();

    for (const [playerSlot, state] of openNotes) {
        const pawn = GetPlayerPawn(state.player);
        if (!pawn) {
            HideNote(playerSlot);
            continue;
        }

        if (state.noteOrigin && Distance(pawn.GetAbsOrigin(), state.noteOrigin) > NOTE_CLOSE_RADIUS) {
            HideNote(playerSlot);
            continue;
        }

        if (now - state.openedAt >= NOTE_CLOSE_DELAY && pawn.WasInputJustPressed(CSInputs.USE)) {
            HideNote(playerSlot);
        }
    }

    if (openNotes.size > 0) {
        Instance.SetNextThink(Instance.GetGameTime());
    }
}

for (const noteName in NOTES) {
    Instance.OnScriptInput(noteName, ({ activator, caller }) => {
        const player = GetPlayerController(activator) || GetPlayerController(caller);
        if (!player) {
            Instance.Msg(`note.js: ${noteName} needs a player activator or caller`);
            return;
        }

        ShowNote(player, noteName, caller);
    });
}

Instance.SetThink(UpdateOpenNotes);

Instance.OnPlayerDisconnect((event) => {
    HideNote(event.playerSlot);
});
