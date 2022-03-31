import { trafficCop } from "../router/traffic-cop.js";
import systemData from "../system-handlers/system-data.js";
import { aaDebugger } from "../constants/constants.js";
import { flagMigrations } from "../system-handlers/flagMerge.js";

var killAllAnimations;
export function disableAnimations() {
    socket.off('module.sequencer')
    killAllAnimations = true;
}

/**
 * 
 * @param {*} // The Active Effect being applied 
 * 
 */
export async function createActiveEffects5e(effect) {
    const aaDebug = game.settings.get("autoanimations", "debug")

    if (killAllAnimations) { return; }

    // Sets data for the System Handler
    const flagData = {
        aaAeStatus: "on",
    }

    // Gets the Token that the Active Effect is applied to
    const aeToken = canvas.tokens.placeables.find(token => token.actor?.effects?.get(effect.id))
    if (!aeToken) {
        if (aaDebug) { aaDebugger("Failed to find the Token for the Active Effect") }
        return;
    }

    // If A-A flags are preset on the AE, ensure they are up-to-date
    if (effect.data?.flags?.autoanimations) {
        await flagMigrations.handle(effect);
    }
    // If no A-A flags are present, grab current Flag version and apply it to the effect (bypasses flag merge issues)
    if (!effect.data?.flags?.autoanimation?.version) {
        flagData.version = Object.keys(flagMigrations.migrations).map(n => Number(n)).reverse()[0];
    }
    await effect.update({ 'flags.autoanimations': flagData })

    // Initilizes the A-A System Handler
    const data = {
        token: aeToken,
        targets: [],
        item: effect,
    }
    let handler = await systemData.make(null, null, data);

    // Exits early if Item or Source Token returns null. Total Failure
    if (!handler.item || !handler.sourceToken) {
        if (aaDebug) { aaDebugger("Failed to find the Item or Source Token", handler) }
        return;
    }

    // Sends the data to begin the animation Sequence
    trafficCop(handler);
}

/**
 * 
 * @param {*} effect // The Active Effect being removed
 * 
 */
export async function deleteActiveEffects5e(effect) {
    const aaDebug = game.settings.get("autoanimations", "debug")

    // Finds all active Animations on the scene that match .origin(effect.uuid)
    let aaEffects = Sequencer.EffectManager.getEffects({ origin: effect.uuid })

    // If no animations, exit early, Else continue with gathering data
    if (aaEffects.length < 1) { return; }
    else {
        const itemData = aaEffects[0].data?.flags?.autoanimations ?? {};
        const data = {
            token: undefined,
            targets: [],
            item: effect,
        };
        // Compile data for the system handler
        const handler = await systemData.make(null, null, data);

        // If a Macro is enabled on the Item, compile that data
        const macroData = {};
        if (itemData.macro?.enable && itemData.macro?.name && (itemData.override || itemData.killAnim)) {
            //Sets macro data if it is defined on the Item and is active
            macroData.shouldRun = true;
            macroData.name = itemData.macro?.name ?? "";
            macroData.args = itemData.macro?.args ? macroData.args.split(',').map(s => s.trim()) : "";
        } else if (handler.autorecObject && handler.autorecObject?.macro?.enable && handler.autorecObject?.macro?.name) {
            //Sets macro data if none is defined/active on the item and it is present in the Automatic Recognition Menu
            macroData.shouldRun = true;
            macroData.name = handler.autorecObject?.macro?.name ?? "";
            macroData.args = handler.autorecObject?.macro?.args ? macroData.args.split(',').map(s => s.trim()) : "";
        }

        // Filters the active Animations to isolate the ones active on the Token
        let currentEffect = aaEffects.filter(i => effect.uuid.includes(i.source?.actor?.id));
        currentEffect = currentEffect.length < 1 ? aaEffects.filter(i => effect.uuid.includes(i.source?.id)) : currentEffect;
        if (currentEffect.length < 0) { return; }

        // Sets the Source Token on the Handler document
        handler.sourceToken = currentEffect[0].source;
        // If no Item or Source Token was found, exit early with Debug
        if (!handler.item || !handler.sourceToken) {
            if (aaDebug) { aaDebugger("Failed to find the Item or Source Token", handler) }
            return;
        }

        // If a Macro was defined, it will run here with "off" as args[0]
        if (macroData.shouldRun) {
            let userData = macroData.args;
            new Sequence()
                .macro(macroData.name, "off", handler, ...userData)
                .play()
        }

        // End all Animations on the token with .origin(effect.uuid)
        Sequencer.EffectManager.endEffects({ origin: effect.uuid, object: handler.sourceToken })
    }
}

/**
 * 
 * @param {Active Effect being updated} effect 
 * @param {Toggle Check On/Off for Effect} toggle 
 */
export async function toggleActiveEffects5e(effect, toggle) {
    if (toggle.disabled === true) {
        deleteActiveEffects5e(effect)
    } else if (toggle.disabled === false) {
        createActiveEffects5e(effect);
    }
}