import { migrateBeastActionItem } from "./beast-actions.js";
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

import { collectTraitSnapshots } from "./trait-snapshot.js";
import { normalizeEffectPenaltyChanges } from "./effect-penalty.js";
import { GEAR_TYPE_KEYS, normalizeGearType } from "./gear-types.js";

const CURRENT_SCHEMA_VERSION = "2.2";

export function registerMigrationHook() {
    const migrateImported = async item => {
        if (!game.user.isGM || (game.users.activeGM && game.users.activeGM.id !== game.user.id)) return;
        try { await migrateBeastActionItem(item); }
        catch (error) { console.error("Neuroshima | Beast action migration failed", error); }
    };
    Hooks.on("createItem", migrateImported);
    Hooks.on("updateItem", migrateImported);
    Hooks.on("createActor", async actor => {
        for (const item of actor.items) await migrateImported(item);
    });
    Hooks.once("ready", async () => {
        if (!game.user.isGM || (game.users.activeGM && game.users.activeGM.id !== game.user.id)) return;

        let stored;
        try {
            stored = game.settings.get("neuroshima", "schemaVersion") || "0.0";
        } catch (_) {
            stored = "0.0";
        }

        if (_versionGte(stored, CURRENT_SCHEMA_VERSION)) {
            try { await _migrate_2_1_to_2_2(); }
            catch (error) {
                console.error("Neuroshima | Beast action migration failed", error);
                ui.notifications.error(game.i18n.localize("NEUROSHIMA.Migration.Failed"));
            }
            // Legacy Item JSON can be imported after the versioned migration
            // has already completed. Keep a cheap live-document guard so such
            // imports cannot remain weaponType=grenade until the next release.
            try {
                const converted = await _sweepLiveLegacyGrenades();
                if (converted > 0) {
                    console.log(`Neuroshima | Converted ${converted} late-imported legacy grenade document(s).`);
                }
            } catch (err) {
                console.error("Neuroshima | Late legacy grenade sweep failed:", err);
                ui.notifications.error(game.i18n.localize("NEUROSHIMA.Migration.Failed"), { permanent: true });
            }
            return;
        }

        ui.notifications.info(
            game.i18n.format("NEUROSHIMA.Migration.Starting", { version: CURRENT_SCHEMA_VERSION }),
            { permanent: false }
        );

        try {
            if (!_versionGte(stored, "1.1")) await _migrate_1_0_to_1_1();
            if (!_versionGte(stored, "1.2")) await _migrate_1_1_to_1_2();
            if (!_versionGte(stored, "1.3")) await _migrate_1_2_to_1_3();
            if (!_versionGte(stored, "1.4")) await _migrate_1_3_to_1_4();
            if (!_versionGte(stored, "1.5")) await _migrate_1_4_to_1_5();
            if (!_versionGte(stored, "1.6")) await _migrate_1_5_to_1_6();
            if (!_versionGte(stored, "1.7")) await _migrate_1_6_to_1_7();
            if (!_versionGte(stored, "1.8")) await _migrate_1_7_to_1_8();
            if (!_versionGte(stored, "1.9")) await _migrate_1_8_to_1_9();
            // Dedicated post-refactor pass. This deliberately repeats legacy
            // grenade discovery so worlds which saved schema 1.9 while the
            // refactor was being developed cannot retain weapon-type grenades.
            if (!_versionGte(stored, "2.0")) await _migrate_1_9_to_2_0();
            if (!_versionGte(stored, "2.1")) await _migrate_2_0_to_2_1();
            await _migrate_2_1_to_2_2();

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
        seen.add(actor.uuid);
        result.push(actor);
    }
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (token.isLinked) continue;
            const a = token.actor;
            if (!a || seen.has(a.uuid)) continue;
            seen.add(a.uuid);
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

// Versions 1.3-1.5 intentionally do not rewrite Active Effect trigger names.
// The test pipeline uses only the canonical lifecycle and does not keep runtime
// adapters or silent data migrations for obsolete trigger contracts.
async function _migrate_1_2_to_1_3() {}
async function _migrate_1_3_to_1_4() {}
async function _migrate_1_4_to_1_5() {}

async function _materializeBackgroundTraitCopies(item) {
    if (!["origin", "profession"].includes(item?.type)) return;
    const legacyCount = item.system.traits?.length ?? 0;
    const snapshots = await collectTraitSnapshots(item);
    if (legacyCount > 0 && snapshots.length === 0) {
        console.warn(`Neuroshima | Could not materialize legacy traits for "${item.name}"; references were preserved.`);
        return;
    }
    if (legacyCount === 0 && snapshots.length === (item.system.traitChoices?.length ?? 0)) return;
    await item.update({
        "system.traitChoices": snapshots,
        "system.traits": []
    });
}

async function _migrate_1_5_to_1_6() {
    console.log("Neuroshima | Running migration 1.5 -> 1.6 (embedded background trait copies)");
    for (const item of _allWorldItems()) await _materializeBackgroundTraitCopies(item);
    for (const actor of _allActors()) {
        for (const item of actor.items) await _materializeBackgroundTraitCopies(item);
    }

    const packs = game.packs?.contents ?? Array.from(game.packs ?? []);
    for (const pack of packs.filter(pack =>
        (pack.metadata?.type ?? pack.documentName) === "Item"
        && (
            pack.metadata?.packageType === "system"
            || pack.metadata?.system === "neuroshima"
            || pack.collection?.startsWith("neuroshima.")
        )
    )) {
        const wasLocked = pack.locked;
        try {
            if (wasLocked) await pack.configure({ locked: false });
            for (const item of await pack.getDocuments()) {
                await _materializeBackgroundTraitCopies(item);
            }
        } finally {
            if (wasLocked) await pack.configure({ locked: true });
        }
    }
}

async function _migrateEffectPenaltyChanges(document) {
    for (const effect of document?.effects ?? []) {
        const normalized = normalizeEffectPenaltyChanges(
            effect._source?.changes ?? effect.changes ?? []
        );
        if (!normalized.changed) continue;
        await effect.update(
            { changes: normalized.changes },
            { neuroshimaEffectPenaltyMigration: true }
        );
    }
}

async function _migrateEffectPenaltyDocument(document) {
    await _migrateEffectPenaltyChanges(document);
    for (const item of document?.items ?? []) {
        await _migrateEffectPenaltyChanges(item);
    }
}

async function _migrate_1_6_to_1_7() {
    console.log("Neuroshima | Running migration 1.6 -> 1.7 (effect penalty key)");

    for (const actor of _allActors()) await _migrateEffectPenaltyDocument(actor);
    for (const item of _allWorldItems()) await _migrateEffectPenaltyChanges(item);

    // World compendia belong to the current world and may contain reusable
    // Actor or Item definitions. System/module packs are left untouched; any
    // legacy document imported from them is normalized in ActiveEffect#_preCreate.
    const packs = game.packs?.contents ?? Array.from(game.packs ?? []);
    for (const pack of packs.filter(pack =>
        pack.metadata?.packageType === "world"
        && ["Actor", "Item"].includes(pack.metadata?.type ?? pack.documentName)
    )) {
        const wasLocked = pack.locked;
        try {
            if (wasLocked) await pack.configure({ locked: false });
            for (const document of await pack.getDocuments()) {
                await _migrateEffectPenaltyDocument(document);
            }
        } finally {
            if (wasLocked) await pack.configure({ locked: true });
        }
    }
}

async function _normalizeGearItem(item) {
    if (item?.type !== "gear") return false;
    const current = item._source?.system?.gearType ?? item.system?.gearType;
    const normalized = normalizeGearType(current);
    if (current === normalized) return false;
    await item.update({ "system.gearType": normalized });
    return true;
}

async function _normalizeGearItems(document) {
    await _normalizeGearItem(document);
    for (const item of document?.items ?? []) await _normalizeGearItem(item);
}

function _readObjectSetting(key) {
    try {
        const value = JSON.parse(game.settings.get("neuroshima", key) || "{}");
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (_) {
        return {};
    }
}

async function _filterGearCategorySettings() {
    const allowed = new Set(GEAR_TYPE_KEYS);
    for (const key of ["gearTypePriceModifiers", "equippableGearTypes"]) {
        const current = _readObjectSetting(key);
        const filtered = Object.fromEntries(
            Object.entries(current).filter(([gearType]) => allowed.has(gearType))
        );
        if (JSON.stringify(filtered) !== JSON.stringify(current)) {
            await game.settings.set("neuroshima", key, JSON.stringify(filtered));
        }
    }
    await game.settings.set("neuroshima", "customGearTypes", "[]");
}

async function _migrate_1_7_to_1_8() {
    console.log("Neuroshima | Running migration 1.7 -> 1.8 (gear categories)");

    for (const actor of _allActors()) await _normalizeGearItems(actor);
    for (const item of _allWorldItems()) await _normalizeGearItem(item);
    await _filterGearCategorySettings();

    const packs = game.packs?.contents ?? Array.from(game.packs ?? []);
    for (const pack of packs.filter(pack => {
        const documentType = pack.metadata?.type ?? pack.documentName;
        const belongsToNeuroshima = pack.metadata?.packageType === "world"
            || pack.metadata?.system === "neuroshima"
            || pack.collection?.startsWith("neuroshima.");
        return belongsToNeuroshima && ["Actor", "Item"].includes(documentType);
    })) {
        const wasLocked = pack.locked;
        try {
            if (wasLocked) await pack.configure({ locked: false });
            for (const document of await pack.getDocuments()) {
                await _normalizeGearItems(document);
            }
        } finally {
            if (wasLocked) await pack.configure({ locked: true });
        }
    }
}

// ─── Migration 1.8 → 1.9: dedicated grenades and launcher ammunition ───────

const GRENADE_BASE_FIELDS = [
    "description", "weight", "cost", "quantity", "availability", "resources", "tests", "equipped"
];

/** Convert the former weaponType=grenade document without carrying weapon-only data forward. */
async function _migrateLegacyGrenade(item) {
    const source = item?._source?.system ?? {};
    if (item?.type !== "weapon" || source.weaponType !== "grenade") return false;

    const system = {};
    for (const key of GRENADE_BASE_FIELDS) {
        if (source[key] !== undefined) system[key] = foundry.utils.deepClone(source[key]);
    }
    system.attribute = source.attribute ?? "dexterity";
    system.skill = source.skill ?? "throwing";
    system.equipped = source.equipped === true;
    system.damageCategory = source.damageCategory ?? "physical";
    system.blastZones = foundry.utils.deepClone(source.blastZones ?? []);

    await item.update(
        { type: "grenade", system },
        { diff: false, recursive: false, neuroshimaGrenadeMigration: true }
    );
    return true;
}

/** Convert legacy grenade Items already loaded in the live world/token collections. */
async function _sweepLiveLegacyGrenades() {
    let converted = 0;
    for (const item of _allWorldItems()) {
        if (await _migrateLegacyGrenade(item)) converted += 1;
    }
    for (const actor of _allActors()) {
        for (const item of actor.items ?? []) {
            if (await _migrateLegacyGrenade(item)) converted += 1;
        }
    }
    return converted;
}

/** Remove legacy launcher configuration and preserve exactly one selected ammunition source. */
async function _migrateLegacyLauncher(item) {
    const source = item?._source?.system ?? {};
    if (item?.type !== "weapon" || source.weaponType !== "launcher") return false;

    const directAmmo = String(source.directAmmo ?? "");
    const magazine = String(source.magazine ?? "");
    const feed = source.ammoFeed ?? "";
    const mode = feed === "either" ? (source.ammoFeedMode ?? "direct") : feed;
    const updates = {
        "system.-=launcherType": null,
        "system.-=ammoFeed": null,
        "system.-=ammoFeedMode": null,
        "system.-=blastZones": null,
        "system.-=freeThrowDistance": null,
        "system.-=useBuildBonus": null
    };

    if (directAmmo && magazine) {
        if (mode === "magazine") updates["system.directAmmo"] = "";
        else updates["system.magazine"] = "";
    }

    await item.update(updates, { neuroshimaLauncherMigration: true });
    return true;
}

/** Launcher ammunition owns its blast data; obsolete payloadType no longer controls resolution. */
async function _migrateLegacyLauncherAmmo(item) {
    const source = item?._source?.system ?? {};
    if (item?.type !== "ammo" || source.ammoCategory !== "launcher") return false;

    const updates = { "system.-=payloadType": null };
    if (source.payloadType && source.payloadType !== "blast") {
        // Area/anti-armour were different mechanics. Never manufacture blast
        // zones for them during migration merely because the field disappeared.
        updates["system.blastZones"] = [];
    }
    await item.update(updates, { neuroshimaLauncherMigration: true });
    return true;
}

/** Infer magazine category from its stored projectile snapshots. */
async function _migrateMagazineCategory(item) {
    if (item?.type !== "magazine") return false;
    const source = item._source?.system ?? {};
    if (["standard", "launcher"].includes(source.ammoCategory)) return false;

    const contents = Array.isArray(source.contents) ? source.contents : [];
    const launcher = contents.some(stack =>
        stack?.ammoSnapshot?.ammoCategory === "launcher"
        || stack?.ammoCategory === "launcher"
    );
    await item.update(
        { "system.ammoCategory": launcher ? "launcher" : "standard" },
        { neuroshimaLauncherMigration: true }
    );
    return true;
}

async function _migrateGrenadeLauncherDocument(document) {
    const items = document?.documentName === "Item"
        ? [document]
        : Array.from(document?.items ?? []);
    for (const item of items) {
        // Changing the document type invalidates the old object instance for
        // subsequent schema operations, so this conversion must run alone.
        if (await _migrateLegacyGrenade(item)) continue;
        await _migrateLegacyLauncher(item);
        await _migrateLegacyLauncherAmmo(item);
        await _migrateMagazineCategory(item);
    }
}

async function _migrate_1_8_to_1_9() {
    console.log("Neuroshima | Running migration 1.8 -> 1.9 (grenades and launchers)");
    for (const item of _allWorldItems()) await _migrateGrenadeLauncherDocument(item);
    for (const actor of _allActors()) await _migrateGrenadeLauncherDocument(actor);

    const packs = game.packs?.contents ?? Array.from(game.packs ?? []);
    for (const pack of packs.filter(pack => {
        const type = pack.metadata?.type ?? pack.documentName;
        const owned = pack.metadata?.packageType === "world"
            || pack.metadata?.system === "neuroshima"
            || pack.collection?.startsWith("neuroshima.");
        return owned && ["Actor", "Item"].includes(type);
    })) {
        const wasLocked = pack.locked;
        try {
            if (wasLocked) await pack.configure({ locked: false });
            for (const document of await pack.getDocuments()) {
                await _migrateGrenadeLauncherDocument(document);
            }
        } finally {
            if (wasLocked) await pack.configure({ locked: true });
        }
    }
}

/**
 * Final post-refactor grenade sweep.
 *
 * Covers every live Item document location supported by Foundry: world Items,
 * embedded Items of world actors, embedded Items of unlinked token actors, and
 * Neuroshima/world Actor and Item compendia. Converted documents keep their
 * IDs, flags, ownership, effects and images; only type and system data change.
 */
async function _migrate_1_9_to_2_0() {
    console.log("Neuroshima | Running migration 1.9 -> 2.0 (final legacy grenade sweep)");
    let converted = 0;

    converted += await _sweepLiveLegacyGrenades();

    const packs = game.packs?.contents ?? Array.from(game.packs ?? []);
    for (const pack of packs.filter(pack => {
        const type = pack.metadata?.type ?? pack.documentName;
        const owned = pack.metadata?.packageType === "world"
            || pack.metadata?.system === "neuroshima"
            || pack.collection?.startsWith("neuroshima.");
        return owned && ["Actor", "Item"].includes(type);
    })) {
        const wasLocked = pack.locked;
        try {
            if (wasLocked) await pack.configure({ locked: false });
            for (const document of await pack.getDocuments()) {
                if (document.documentName === "Item") {
                    if (await _migrateLegacyGrenade(document)) converted += 1;
                    continue;
                }
                for (const item of document.items ?? []) {
                    if (await _migrateLegacyGrenade(item)) converted += 1;
                }
            }
        } finally {
            if (wasLocked) await pack.configure({ locked: true });
        }
    }

    console.log(`Neuroshima | Final legacy grenade sweep converted ${converted} document(s).`);
}

/** Persist the configurable throw fields restored to the dedicated GrenadeData model. */
async function _normalizeGrenadeRollFields(item) {
    if (item?.type !== "grenade") return false;
    const source = item._source?.system ?? {};
    const updates = {};
    if (source.attribute == null) updates["system.attribute"] = "dexterity";
    if (source.skill == null) updates["system.skill"] = "throwing";
    if (!Object.keys(updates).length) return false;
    await item.update(updates, { neuroshimaGrenadeMigration: true });
    return true;
}

async function _migrate_2_0_to_2_1() {
    console.log("Neuroshima | Running migration 2.0 -> 2.1 (grenade throw configuration)");
    for (const item of _allWorldItems()) await _normalizeGrenadeRollFields(item);
    for (const actor of _allActors()) {
        for (const item of actor.items ?? []) await _normalizeGrenadeRollFields(item);
    }

    const packs = game.packs?.contents ?? Array.from(game.packs ?? []);
    for (const pack of packs.filter(pack => {
        const type = pack.metadata?.type ?? pack.documentName;
        const owned = pack.metadata?.packageType === "world"
            || pack.metadata?.system === "neuroshima"
            || pack.collection?.startsWith("neuroshima.");
        return owned && ["Actor", "Item"].includes(type);
    })) {
        const wasLocked = pack.locked;
        try {
            if (wasLocked) await pack.configure({ locked: false });
            for (const document of await pack.getDocuments()) {
                if (document.documentName === "Item") {
                    await _normalizeGrenadeRollFields(document);
                } else {
                    for (const item of document.items ?? []) await _normalizeGrenadeRollFields(item);
                }
            }
        } finally {
            if (wasLocked) await pack.configure({ locked: true });
        }
    }
}

/** Return a read-only inventory of canonical Active Effect triggers in use. */
export function auditEffectTriggers() {
    const report = { documents: 0, effects: 0, scripts: 0, triggers: {} };
    const documents = [];
    for (const actor of _allActors()) documents.push(actor, ...(actor.items ?? []));
    documents.push(..._allWorldItems());

    for (const document of documents) {
        report.documents += 1;
        for (const effect of document.effects ?? []) {
            report.effects += 1;
            for (const script of effect._source?.system?.scriptData ?? []) {
                report.scripts += 1;
                const trigger = script?.trigger ?? "manual";
                report.triggers[trigger] = (report.triggers[trigger] ?? 0) + 1;
            }
        }
    }
    return report;
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
    await _migrateGrenadeLauncherDocument(actor);
    await _repairStoredSystemData(actor);
    for (const item of Array.from(actor.items)) {
        await migrateBeastActionItem(item);
        try { await _normalizeGearItem(item); } catch (_) {}
        try { await _repairStoredSystemData(item); } catch (_) {}
        try { await _materializeBackgroundTraitCopies(item); } catch (_) {}
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
            await _migrateGrenadeLauncherDocument(actor);
            await _repairStoredSystemData(actor);
            for (const item of actor.items) {
                try { await _normalizeGearItem(item); } catch (_) {}
                try { await _repairStoredSystemData(item); } catch (_) {}
                try { await _materializeBackgroundTraitCopies(item); } catch (_) {}
            }
        } catch (err) {
            console.warn(`Neuroshima | Normalization failed for actor "${actor.name}":`, err);
        }
    }

    for (const item of _allWorldItems()) {
        try {
            await _migrateGrenadeLauncherDocument(item);
            await _normalizeGearItem(item);
            await _migrate_1_1_normalizeWorldItemMods(item);
            await _repairStoredSystemData(item);
            await _materializeBackgroundTraitCopies(item);
        } catch (err) {
            console.warn(`Neuroshima | Normalization failed for world item "${item.name}":`, err);
        }
    }

    ui.notifications.info("Neuroshima | Normalizacja zakończona.");
}

async function _migrate_2_1_to_2_2() {
    for (const actor of _allActors()) {
        for (const item of Array.from(actor.items)) await migrateBeastActionItem(item);
    }
    for (const item of _allWorldItems()) await migrateBeastActionItem(item);
}
