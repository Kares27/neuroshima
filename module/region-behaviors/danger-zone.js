import { NEUROSHIMA } from "../config.js";

/**
 * Derives wound damage type from a numeric radiation level.
 * level 1-10  → "D" (draśnięcie / grazing, -5% penalty)
 * level 11-20 → "L" (lekka / light, -15% penalty)
 */
function _damageTypeFromLevel(level) {
    return level > 10 ? "L" : "D";
}

function _penaltyFromDamageType(damageType) {
    const cfg = NEUROSHIMA.woundConfiguration?.[damageType];
    if (cfg?.penalties?.length) return cfg.penalties[0];
    return damageType === "L" ? 15 : 5;
}

/**
 * Reads the highest radiation protection value across all equipped items,
 * checking every resource whose key appears in the protectionKeys array.
 * @param {Actor}    actor
 * @param {string[]} protectionKeys  e.g. ["RadiationProt", "NuclearArmor"]
 * @returns {number}
 */
function _getActorRadiationProtection(actor, protectionKeys) {
    const keys = Array.isArray(protectionKeys)
        ? protectionKeys
        : (protectionKeys ? [protectionKeys] : []);
    if (!keys.length) return 0;
    let maxProt = 0;
    for (const item of actor.items) {
        if (item.system.equipped === false) continue;
        for (const res of (item.system.resources ?? [])) {
            if (keys.includes(res.key)) {
                const v = Number(res.value) || 0;
                if (v > maxProt) maxProt = v;
            }
        }
    }
    return maxProt;
}

/**
 * Applies one radiation wound to the actor.
 * @param {Actor}  actor
 * @param {object} config  { level, woundDamageType?, penaltyOverride? }
 */
async function _applyRadiationWound(actor, config) {
    const damageType   = config.woundDamageType ?? _damageTypeFromLevel(config.level ?? 1);
    const penalty      = config.penaltyOverride  ?? _penaltyFromDamageType(damageType);
    const nameKey      = damageType === "L"
        ? "NEUROSHIMA.RadiationWound.Heavy"
        : "NEUROSHIMA.RadiationWound.Light";
    const name = game.i18n.localize(nameKey);

    await actor.createEmbeddedDocuments("Item", [{
        name,
        type: "wound",
        system: {
            location: "inne",
            damageType,
            penalty,
            originalPenalty: penalty,
            isActive: true,
            isHealing: false,
            hadFirstAid: false,
            healingAttempts: 0,
            failedFirstAidAttempts: 0,
            failedTreatmentAttempts: 0,
            firstAidHealingApplied: 0
        }
    }]);

    game.neuroshima?.log(`Radiation | Wound (${damageType}, -${penalty}%) applied to ${actor.name} [level ${config.level ?? "?"}]`);

    await ChatMessage.create({
        content: game.i18n.format("NEUROSHIMA.DangerZone.WoundApplied", {
            actor: actor.name,
            type:  game.i18n.localize(`NEUROSHIMA.Damage.Full.${damageType}`),
            penalty
        }),
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
    });
}

/**
 * Accumulates or escalates radiation sickness disease on the actor.
 */
async function _applyRadiationDisease(actor) {
    let disease = actor.items.find(i =>
        i.type === "disease" && i.getFlag("neuroshima", "isRadiationSickness")
    );

    if (!disease) {
        await actor.createEmbeddedDocuments("Item", [{
            name: game.i18n.localize("NEUROSHIMA.RadiationSickness.Name"),
            type: "disease",
            flags: { neuroshima: { isRadiationSickness: true } },
            system: {
                diseaseType: "transient",
                transientPenalty: 5,
                currentState: "firstSymptoms"
            }
        }]);
        game.neuroshima?.log(`Radiation | Sickness created on ${actor.name}`);
    } else {
        const newPenalty = (disease.system.transientPenalty || 0) + 5;
        await disease.update({ "system.transientPenalty": newPenalty });
        game.neuroshima?.log(`Radiation | Sickness penalty → ${newPenalty}% on ${actor.name}`);
    }
}

/**
 * Public radiation API — intended for use from Execute Script region behaviors.
 *
 * Token flag layout (neuroshima.dangerZones.<regionId>):
 * {
 *   enteredAt:     number,   // world-time seconds when token entered
 *   lastProcessed: number,   // world-time seconds of last tick
 *   config: {
 *     level:           number,    // numeric radiation level 1-20 (default: 1)
 *     intervalHours:   number,    // hours between wound ticks (default: 1)
 *     woundDamageType: string|null,   // "D"|"L" override; null = auto from level
 *     penaltyOverride: number|null,   // % override; null = auto from damage type
 *     protectionKeys:  string[],      // resource keys on armor, e.g. ["RadiationProt","NuclearArmor"]
 *     createDisease:   boolean,       // also apply radiation sickness (default: false)
 *   }
 * }
 *
 * Usage from Execute Script (TOKEN_ENTER):
 *   await game.neuroshima.radiation.enter(token, region.id, {
 *     level: 15,
 *     protectionKeys: ["RadiationProt", "NuclearArmor"]
 *   });
 *
 * Usage from Execute Script (TOKEN_EXIT):
 *   await game.neuroshima.radiation.exit(token, region.id);
 */
const radiationAPI = {
    /**
     * Start tracking a token in a radiation zone.
     * @param {TokenDocument} token
     * @param {string}        regionId
     * @param {object}        [config={}]
     */
    async enter(token, regionId, config = {}) {
        const zones = foundry.utils.deepClone(token.flags?.neuroshima?.dangerZones ?? {});
        zones[regionId] = {
            enteredAt:     game.time.worldTime,
            lastProcessed: game.time.worldTime,
            config: {
                level:           config.level           ?? 1,
                intervalHours:   config.intervalHours   ?? 1,
                woundDamageType: config.woundDamageType ?? null,
                penaltyOverride: config.penaltyOverride ?? null,
                protectionKeys:  Array.isArray(config.protectionKeys)
                    ? config.protectionKeys
                    : (config.protectionKey ? [config.protectionKey] : []),
                createDisease:   config.createDisease   ?? false
            }
        };
        await token.setFlag("neuroshima", "dangerZones", zones);
        game.neuroshima?.log(`Radiation | Token "${token.name}" entered zone ${regionId}`, zones[regionId].config);
    },

    /**
     * Stop tracking a token in a radiation zone.
     * @param {TokenDocument} token
     * @param {string}        regionId
     */
    async exit(token, regionId) {
        const zones = foundry.utils.deepClone(token.flags?.neuroshima?.dangerZones ?? {});
        delete zones[regionId];
        if (Object.keys(zones).length > 0) {
            await token.setFlag("neuroshima", "dangerZones", zones);
        } else {
            await token.unsetFlag("neuroshima", "dangerZones");
        }
        game.neuroshima?.log(`Radiation | Token "${token.name}" exited zone ${regionId}`);
    },

    /**
     * Directly apply a radiation wound to an actor (bypasses tracking).
     * @param {Actor}  actor
     * @param {object} [config={}]
     */
    async applyWound(actor, config = {}) {
        await _applyRadiationWound(actor, config);
        if (config.createDisease) await _applyRadiationDisease(actor);
    },

    /**
     * Returns the highest radiation protection value across all equipped items,
     * matching any key in the provided array.
     * @param {Actor}           actor
     * @param {string|string[]} protectionKeys
     * @returns {number}
     */
    getProtection(actor, protectionKeys) {
        return _getActorRadiationProtection(actor, protectionKeys);
    }
};

/**
 * Registers the updateWorldTime hook that processes periodic radiation wounds.
 * Also exposes game.neuroshima.radiation (merged after game.neuroshima is set up
 * in the init hook, so we defer to "ready").
 */
export function registerRadiationHooks() {
    Hooks.once("ready", () => {
        game.neuroshima = Object.assign(game.neuroshima ?? {}, { radiation: radiationAPI });
        game.neuroshima?.log("Radiation | API registered on game.neuroshima.radiation");
    });

    Hooks.on("updateWorldTime", async (worldTime, dt) => {
        if (!game.user.isGM) return;
        if (!dt || dt <= 0) return;

        const scCalTime = globalThis.SimpleCalendar?.api?.currentDateTime?.();
        const timeLabel = scCalTime
            ? `${scCalTime.year}-${String(scCalTime.month + 1).padStart(2, "0")}-${String(scCalTime.day).padStart(2, "0")} ${String(scCalTime.hour).padStart(2, "0")}:${String(scCalTime.minute).padStart(2, "0")}`
            : `${worldTime}s`;
        game.neuroshima?.log(`Radiation | updateWorldTime — time: ${timeLabel}, dt: ${dt}s`);

        for (const scene of game.scenes) {
            for (const token of scene.tokens) {
                const zones = token.flags?.neuroshima?.dangerZones;
                if (!zones || typeof zones !== "object" || foundry.utils.isEmpty(zones)) continue;

                game.neuroshima?.log(`Radiation | Checking token "${token.name}" (scene: ${scene.name}) — ${Object.keys(zones).length} tracked zone(s)`);

                const updatedZones = foundry.utils.deepClone(zones);
                let changed = false;

                for (const [regionId, zoneData] of Object.entries(updatedZones)) {
                    const cfg = zoneData.config ?? {};
                    const intervalSeconds = (cfg.intervalHours ?? 1) * 3600;
                    const lastProcessed   = zoneData.lastProcessed ?? zoneData.enteredAt ?? worldTime;
                    const elapsed         = worldTime - lastProcessed;
                    const ticks           = Math.floor(elapsed / intervalSeconds);

                    game.neuroshima?.log(
                        `Radiation | Zone ${regionId} | token "${token.name}" | ` +
                        `level: ${cfg.level ?? "?"} | interval: ${intervalSeconds}s | ` +
                        `elapsed: ${elapsed}s | ticks due: ${ticks}`
                    );

                    if (ticks <= 0) continue;

                    const actor = token.actor;
                    if (!actor) {
                        game.neuroshima?.log(`Radiation | Token "${token.name}" has no linked actor — skipping`);
                        continue;
                    }

                    const protectionKeys = cfg.protectionKeys?.length ? cfg.protectionKeys
                        : (cfg.protectionKey ? [cfg.protectionKey] : []);
                    if (protectionKeys.length) {
                        const protection = _getActorRadiationProtection(actor, protectionKeys);
                        game.neuroshima?.log(`Radiation | Actor "${actor.name}" protection [${protectionKeys.join(", ")}]: ${protection} vs level ${cfg.level ?? 1}`);
                        if (protection >= (cfg.level ?? 1)) {
                            game.neuroshima?.log(`Radiation | Actor "${actor.name}" is fully protected — no wound applied`);
                            updatedZones[regionId].lastProcessed = lastProcessed + ticks * intervalSeconds;
                            changed = true;
                            continue;
                        }
                    }

                    game.neuroshima?.log(`Radiation | Applying ${ticks} wound(s) [level ${cfg.level ?? 1}] to "${actor.name}"`);

                    for (let t = 0; t < ticks; t++) {
                        await _applyRadiationWound(actor, cfg);
                        if (cfg.createDisease) await _applyRadiationDisease(actor);
                    }

                    updatedZones[regionId].lastProcessed = lastProcessed + ticks * intervalSeconds;
                    game.neuroshima?.log(`Radiation | Updated lastProcessed for zone ${regionId} → ${updatedZones[regionId].lastProcessed}s`);
                    changed = true;
                }

                if (!changed) continue;

                if (Object.keys(updatedZones).length > 0) {
                    await token.setFlag("neuroshima", "dangerZones", updatedZones);
                } else {
                    await token.unsetFlag("neuroshima", "dangerZones");
                    game.neuroshima?.log(`Radiation | All zones cleared for token "${token.name}"`);
                }
            }
        }
    });
}
