import { trafficCop } from "../router/traffic-cop.js";
import systemData from "../system-handlers/system-data.js";
import { aaDebugger } from "../constants/constants.js";
import { flagMigrations } from "../system-handlers/flagMerge.js";
import { socketlibSocket } from "../socketset.js";

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
    if (effect.data?.disabled) {
        if (aaDebug) { aaDebugger("This AE is Disabled")};
        return;
    }

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
    const aeNameField = effect.data?.label + `${aeToken.id}`
    const checkAnim = Sequencer.EffectManager.getEffects({ object: aeToken, name: aeNameField }).length > 0
    if (checkAnim) { 
        if (aaDebug) { aaDebugger("Animation is already present on the Token, returning.") }
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
    if (handler.isCustomized || (!handler.isCustomized && handler.autorecObject)) {
        const aeDelay = handler.isCustomized ? handler.flags?.options?.aeDelay || "noDelay" : handler.autorecObject.aeDelay || "noDelay";
        const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
        if (aeDelay === "noDelay") { } else {await wait(aeDelay)}
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
        deleteEffectsAllScenes5e(effect)
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

export async function checkConcentration(effect) {
    const aaDebug = game.settings.get("autoanimations", "debug")

    // Check effect label and return if it is not equal to "concentrating"
    const label = effect.data?.label || "";
    if (label.toLowerCase() !== "concentrating") { return; }

    // Get Originating Item. If no Origin, return
    const origin = effect.data?.origin
    if (!origin) {
        if (aaDebug) { aaDebugger("Failed to find an Origin for Concentration") }
        return;
    }

    // Get arrays of Background and Foreground Tiles with the A-A Origin flag UUID matching the Effect Origin
    const bgTiles = canvas.background.placeables.filter(i => i.data?.flags?.autoanimations?.origin === origin)
    const fgTiles = canvas.foreground.placeables.filter(i => i.data?.flags?.autoanimations?.origin === origin);
    if (bgTiles.length < 1 && fgTiles.length < 1) {
        if (aaDebug) { aaDebugger("Failed to find any Tiles tied to Concentration") }
        return;
    }
    let tileIdArray = []
    if (bgTiles.length || fgTiles.length) {
        //if (bgTiles.length) {
        for (let tile of bgTiles) {
            tileIdArray.push(tile.id)
        }
        //}
        //if (fgTiles.length) {
        for (let tile of fgTiles) {
            tileIdArray.push(tile.id)
        }
        //}
        socketlibSocket.executeAsGM("removeTile", tileIdArray)
    }

    //Sequencer.EffectManager.endEffects({ origin: origin })
}

export async function readTokenDrop5e (tokenDocument) {
    // Get the Token on the canvas and read any Active Effects currently applied to the Actor data
    const aeToken = canvas.tokens.get(tokenDocument.id)
    let effects = aeToken.actor?.data?.effects?.contents;
    if (!effects) { return; }

    // Loop thru all Active Effects, and determine if any A-A data should start playing an Animation
    for (let effect of effects) {
        if (effect.data?.disabled) { continue; }
        const data = {
            token: aeToken,
            targets: [],
            item: effect,
        }
        let handler = await systemData.make(null, null, data);

        // Exits early if Item or Source Token returns null. Total Failure
        if (!handler.item || !handler.sourceToken) {
            if (aaDebug) { aaDebugger("Failed to find the Item or Source Token", handler) }
            continue;
        }
        if (handler.isCustomized || (!handler.isCustomized && handler.autorecObject)) {
            const aeDelay = handler.isCustomized ? handler.flags?.options?.aeDelay || "noDelay" : handler.autorecObject.aeDelay || "noDelay";
            const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
            if (aeDelay === "noDelay") { } else {await wait(aeDelay)}
        }
        // Sends the data to begin the animation Sequence
        trafficCop(handler);
    }
}

export async function renderScene5e (tokens) {
    for (var i = 0; i < tokens.length; i++) {
        let aeToken = tokens[i];
        let effects = aeToken.actor?.data?.effects?.contents;
        if (!effects) { return; }
        for (let effect of effects) {
            //let label = effect.data?.label;
            //let aaFlags = effect.data?.flags?.autoanimations
            if (effect.data?.disabled) { continue; }
            const data = {
                token: aeToken,
                targets: [],
                item: effect,
            }
            let handler = await systemData.make(null, null, data);
    
            // Exits early if Item or Source Token returns null. Total Failure
            if (!handler.item || !handler.sourceToken) {
                if (aaDebug) { aaDebugger("Failed to find the Item or Source Token", handler) }
                continue;
            }
            if (handler.isCustomized || (!handler.isCustomized && handler.autorecObject)) {
                const aeDelay = handler.isCustomized ? handler.flags?.options?.aeDelay || "noDelay" : handler.autorecObject.aeDelay || "noDelay";
                const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
                if (aeDelay === "noDelay") { } else {await wait(aeDelay)}
            }
            // Sends the data to begin the animation Sequence
            trafficCop(handler);
        }
    }
}

async function deleteEffectsAllScenes5e (effect) {
    let allScenes = game.scenes.contents;

    for (var i = 0; i < allScenes.length; i++) {
        let currentScene = allScenes[i];
        let currentSceneId = currentScene.id;

        let checkAnim = Sequencer.EffectManager.getEffects({ sceneID: currentSceneId, origin: effect.uuid})
        console.log(checkAnim)
        //let tokens = currentScene;
        await Sequencer.EffectManager.endEffects({ sceneID: currentSceneId, origin: effect.uuid})
        //let currentEffect = aaEffects.filter(i => effect.uuid.includes(i.source?.actor?.id));

    }
}