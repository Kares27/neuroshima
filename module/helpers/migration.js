/**
 * Schema migration system for Neuroshima 1.5.
 *
 * HOW IT WORKS
 * ─────────────
 * Each time the system schema changes in a way that stored world data may be
 * stale or structurally wrong, bump CURRENT_SCHEMA_VERSION and add a migration
 * function for the new version step.
 *
 * On every "ready" hook the GM's client checks the stored schemaVersion world
 * setting.  If it is behind the current version, all pending migration steps
 * are executed in order and the stored version is updated.
 *
 * Foundry's TypeDataModel already fills in default values at runtime for any
 * fields that are simply absent from the stored data — so we only need to
 * migrate here when:
 *   1. A field was renamed or restructured (old data must be transformed).
 *   2. Stored objects inside free-form ObjectFields (like system.mods) contain
 *      stale data that runtime helpers can no longer handle correctly.
 *   3. Flags or relations between documents need to be re-established.
 *   4. Schema repair: fields added after document creation whose stored value is
 *      null/undefined (Foundry provides defaults at runtime but does not persist
 *      them — this migration writes them into the database so exports are clean).
 *
 * For pure additions (new field with a default value) no migration entry is
 * strictly needed, but running _repairStoredSystemData() on all documents as
 * part of normalizeAll() keeps the database tidy.
 *
 * HOW TO ADD A NEW MIGRATION
 * ──────────────────────────
 *   1. Bump CURRENT_SCHEMA_VERSION (e.g. "1.1" → "1.2").
 *   2. Write an async function _migrate_X_Y_to_X_Z() that transforms data.
 *   3. Add  if (!_versionGte(stored, "1.2")) await _migrate_1_1_to_1_2();
 *      inside the try-block in registerMigrationHook().
 *   4. Update normalizeAll() / normalizeActor() if applicable.
 */

const CURRENT_SCHEMA_VERSION = "1.2";

export function registerMigrationHook() {
    Hooks.once("ready", async () => {
        if (!game.user.isGM) return;

        let stored;
        try {
            stored = game.settings.get("neuroshima", "schemaVersion") || "0.0";
        } catch (_) {
            stored = "0.0";
        }

        if (_versionGte(stored, CURRENT_SCHEMA_VERSION)) return;

        ui.notifications.info(
            game.i18n.format("NEUROSHIMA.Migration.Starting", { version: CURRENT_SCHEMA_VERSION }),
            { permanent: false }
        );

        try {
            if (!_versionGte(stored, "1.1")) await _migrate_1_0_to_1_1();
            if (!_versionGte(stored, "1.2")) await _migrate_1_1_to_1_2();

            await game.settings.set("neuroshima", "schemaVersion", CURRENT_SCHEMA_VERSION);
            ui.notifications.info(game.i18n.localize("NEUROSHIMA.Migration.Done"));
        } catch (err) {
            console.error("Neuroshima | Migration failed:", err);
            ui.notifications.error(game.i18n.localize("NEUROSHIMA.Migration.Failed"), { permanent: true });
        }
    });
}

// ─── Document collectors ───────────────────────────────────────────────────────

/**
 * Collect every actor in the world — world actors of all types, plus synthetic
 * (unlinked) token actors from every scene.
 * @returns {Actor[]}
 */
function _allActors() {
    const seen = new Set();
    const result = [];
    for (const actor of game.actors) {
        seen.add(actor.id);
        result.push(actor);
    }
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (token.isLinked) continue;
            const a = token.actor;
            if (!a || seen.has(a.id)) continue;
            seen.add(a.id);
            result.push(a);
        }
    }
    return result;
}

/**
 * Collect every item stored at world level (i.e. not embedded in an actor).
 * @returns {Item[]}
 */
function _allWorldItems() {
    return Array.from(game.items);
}

// ─── Generic schema-based repair ──────────────────────────────────────────────

/**
 * Build an update payload that fills in fields which are missing (null /
 * undefined) in the document's stored _source.system but have a non-null
 * default value according to the TypeDataModel schema.
 *
 * Only SchemaField subtrees are recursed into.  ObjectFields (free-form, like
 * system.mods) are detected by their empty-object default ({}) and skipped.
 * ArrayFields whose stored value is already an array are left untouched; if
 * stored is null/undefined, the default array is written.
 *
 * Returns null when no repairs are needed.
 *
 * @param {Document} doc  Any Foundry document that has a TypeDataModel system.
 * @returns {Object|null}
 */
async function _repairStoredSystemData(doc) {
    const ModelClass = doc.system?.constructor;
    if (typeof ModelClass?.cleanData !== "function") return null;

    let defaults;
    try {
        defaults = ModelClass.cleanData({});
    } catch (err) {
        console.warn(`Neuroshima | Could not get cleanData for "${doc.name}":`, err);
        return null;
    }

    const stored = doc._source?.system ?? {};
    const updates = {};
    _collectRepairs(defaults, stored, "system", updates);

    if (Object.keys(updates).length === 0) return null;

    console.log(`Neuroshima | Schema repair for ${doc.documentName} "${doc.name}":`, Object.keys(updates));
    await doc.update(updates);
    return updates;
}

/**
 * Recursively diff defaults vs stored data and collect dotted-path repairs.
 * Skips ObjectFields (detected as empty plain objects in defaults).
 */
function _collectRepairs(defaults, stored, prefix, out) {
    for (const [key, defVal] of Object.entries(defaults)) {
        const curVal = stored?.[key];
        const path   = `${prefix}.${key}`;

        if (curVal === undefined || curVal === null) {
            if (defVal !== null && defVal !== undefined) {
                out[path] = defVal;
            }
        } else if (
            defVal !== null &&
            typeof defVal === "object" &&
            !Array.isArray(defVal) &&
            typeof curVal === "object" &&
            curVal !== null &&
            !Array.isArray(curVal) &&
            Object.keys(defVal).length > 0
        ) {
            _collectRepairs(defVal, curVal, path, out);
        }
    }
}

// ─── Migration 1.0 → 1.1 ─────────────────────────────────────────────────────
/**
 * Synchronise mod-parent relationships for all actor-owned weapons and armors.
 *
 * Before this version the mod system stored full snapshots inside system.mods
 * on the parent weapon/armor.  A later refactor changed actor-owned items to
 * use a lightweight entry { attached: bool } instead, relying on
 * flags.neuroshima.modParentId on the mod item itself.
 *
 * This migration:
 *   a) Lightweight entries (no .name) — ensure modParentId flag is set on the
 *      mod item.
 *   b) Old full-snapshot entries where the mod item still exists in the same
 *      actor — migrate to lightweight, set modParentId.
 *   c) Old full-snapshot entries where the mod item does NOT exist — leave as-is
 *      (world-item snapshot path).
 *   d) Reverse — for any mod item that already has modParentId, ensure its
 *      parent has a mods entry (adds { attached: false } if missing).
 */
async function _migrate_1_1_normalizeActorMods(actor) {
    const items = Array.from(actor.items);

    for (const item of items) {
        if (item.type !== "weapon" && item.type !== "armor") continue;
        const mods = item.system.mods ?? {};
        if (_isEmpty(mods)) continue;

        const modsUpdate = {};

        for (const [modId, entry] of Object.entries(mods)) {
            if (modId.startsWith("__")) continue;

            const modItem = actor.items.get(modId);

            if (!entry.name) {
                if (modItem && !modItem.getFlag("neuroshima", "modParentId")) {
                    await modItem.setFlag("neuroshima", "modParentId", item.id);
                }
            } else if (modItem) {
                await modItem.setFlag("neuroshima", "modParentId", item.id);
                modsUpdate[modId] = { attached: entry.attached ?? false };
            }
        }

        if (!_isEmpty(modsUpdate)) {
            const payload = {};
            for (const [k, v] of Object.entries(modsUpdate)) {
                payload[`system.mods.${k}`] = v;
            }
            await item.update(payload);
        }
    }

    for (const modItem of items) {
        const parentId = modItem.getFlag("neuroshima", "modParentId");
        if (!parentId) continue;
        const parent = actor.items.get(parentId);
        if (!parent) {
            await modItem.unsetFlag("neuroshima", "modParentId");
            continue;
        }
        const mods = parent.system.mods ?? {};
        if (!mods[modItem.id]) {
            await parent.update({ [`system.mods.${modItem.id}`]: { attached: false } });
        }
    }
}

/**
 * For world-level weapons/armors (not actor-owned): remove entries in
 * system.mods that use the lightweight format { attached: bool } but whose
 * modId no longer exists anywhere in game.items.  Full snapshots (entries that
 * have a .name) are kept — they are intentional templates.
 */
async function _migrate_1_1_normalizeWorldItemMods(item) {
    if (item.type !== "weapon" && item.type !== "armor") return;
    const mods = item.system.mods ?? {};
    if (_isEmpty(mods)) return;

    const removals = {};
    for (const [modId, entry] of Object.entries(mods)) {
        if (modId.startsWith("__")) continue;
        if (!entry.name && !game.items.get(modId)) {
            removals[`system.mods.-=${modId}`] = null;
        }
    }

    if (!_isEmpty(removals)) {
        console.log(`Neuroshima | Removing orphaned world-item mod refs on "${item.name}":`, Object.keys(removals));
        await item.update(removals);
    }
}

async function _migrate_1_0_to_1_1() {
    console.log("Neuroshima | Running migration 1.0 → 1.1 (mod parent synchronisation)");

    for (const actor of _allActors()) {
        try {
            await _migrate_1_1_normalizeActorMods(actor);
        } catch (err) {
            console.warn(`Neuroshima | Migration 1.1 failed for actor "${actor.name}":`, err);
        }
    }

    for (const item of _allWorldItems()) {
        try {
            await _migrate_1_1_normalizeWorldItemMods(item);
        } catch (err) {
            console.warn(`Neuroshima | Migration 1.1 failed for world item "${item.name}":`, err);
        }
    }
}

// Migration 1.1 -> 1.2: classify traits used by Origins and Professions.
function _hasStoredTraitCategory(trait) {
    return ["origin", "profession"].includes(trait._source?.system?.traitCategory);
}

async function _migrate_1_1_to_1_2() {
    console.log("Neuroshima | Running migration 1.1 -> 1.2 (trait categories)");

    const originTraits = new Set();
    const professionTraits = new Set();

    for (const item of _allWorldItems()) {
        const target = item.type === "origin"
            ? originTraits
            : item.type === "profession"
                ? professionTraits
                : null;
        if (!target) continue;
        for (const uuid of item.system.traits ?? []) target.add(uuid);
    }

    for (const trait of _allWorldItems()) {
        if (trait.type !== "trait" || _hasStoredTraitCategory(trait)) continue;
        try {
            const usedByOrigin = originTraits.has(trait.uuid);
            const usedByProfession = professionTraits.has(trait.uuid);
            if (usedByOrigin && usedByProfession) {
                console.warn(
                    `Neuroshima | Trait "${trait.name}" is used by both an Origin and a Profession. Classified as origin.`
                );
            }
            const traitCategory = !usedByOrigin && usedByProfession ? "profession" : "origin";
            await trait.update({ "system.traitCategory": traitCategory });
        } catch (err) {
            console.warn(`Neuroshima | Migration 1.2 failed for world trait "${trait.name}":`, err);
        }
    }

    for (const actor of _allActors()) {
        for (const trait of actor.items) {
            if (trait.type !== "trait" || _hasStoredTraitCategory(trait)) continue;
            try {
                const sourceType = trait._source?.flags?.neuroshima?.traitSource?.type;
                const traitCategory = sourceType === "profession" ? "profession" : "origin";
                await trait.update({ "system.traitCategory": traitCategory });
            } catch (err) {
                console.warn(`Neuroshima | Migration 1.2 failed for trait "${trait.name}" on actor "${actor.name}":`, err);
            }
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _versionGte(a, b) {
    const [amaj, amin = 0] = String(a).split(".").map(Number);
    const [bmaj, bmin = 0] = String(b).split(".").map(Number);
    if (amaj !== bmaj) return amaj > bmaj;
    return amin >= bmin;
}

function _isEmpty(obj) {
    return !obj || Object.keys(obj).length === 0;
}

// ─── Public utilities ─────────────────────────────────────────────────────────

/**
 * Re-run all normalizations for a single actor (useful after importing actors
 * from a compendium or after manual data edits).  Also repairs stored schema
 * fields on the actor and all its owned items.
 * @param {Actor} actor
 */
export async function normalizeActor(actor) {
    if (!game.user.isGM) return;
    await _migrate_1_1_normalizeActorMods(actor);
    await _repairStoredSystemData(actor);
    for (const item of actor.items) {
        try { await _repairStoredSystemData(item); } catch (_) {}
    }
}

/**
 * Re-run all normalizations for ALL documents in the world.
 *
 * Covers:
 *   • All world actors of every type (character, npc, creature, vehicle,
 *     homeBase) and their owned items.
 *   • All synthetic (unlinked) token actors from every scene.
 *   • All world-level (non-actor-owned) items of every type.
 *
 * Can be called from the browser console:
 *   game.neuroshima.migration.normalizeAll()
 */
export async function normalizeAll() {
    if (!game.user.isGM) return;
    ui.notifications.info("Neuroshima | Normalizacja dokumentów...");

    for (const actor of _allActors()) {
        try {
            await _migrate_1_1_normalizeActorMods(actor);
            await _repairStoredSystemData(actor);
            for (const item of actor.items) {
                try { await _repairStoredSystemData(item); } catch (_) {}
            }
        } catch (err) {
            console.warn(`Neuroshima | Normalization failed for actor "${actor.name}":`, err);
        }
    }

    for (const item of _allWorldItems()) {
        try {
            await _migrate_1_1_normalizeWorldItemMods(item);
            await _repairStoredSystemData(item);
        } catch (err) {
            console.warn(`Neuroshima | Normalization failed for world item "${item.name}":`, err);
        }
    }

    ui.notifications.info("Neuroshima | Normalizacja zakończona.");
}
