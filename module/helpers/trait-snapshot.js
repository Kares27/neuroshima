import { resolveItemReferences } from "./item-reference.js";

const SNAPSHOT_VERSION = 1;

function randomId() {
  return foundry.utils.randomID?.() ?? crypto.randomUUID();
}

function stableLegacyId(value) {
  let hash = 2166136261;
  for (const char of String(value ?? "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(36)}`;
}

function cleanItemData(data) {
  const copy = foundry.utils.deepClone(data ?? {});
  delete copy._id;
  delete copy.folder;
  delete copy.sort;
  delete copy.ownership;
  delete copy._stats;
  copy.type = "trait";
  copy.system ??= {};
  copy.effects ??= [];
  copy.flags ??= {};
  return copy;
}

export function createTraitSnapshot(item, { id = null } = {}) {
  if (!item || item.type !== "trait") return null;
  return {
    id: id || randomId(),
    version: SNAPSHOT_VERSION,
    item: cleanItemData(item.toObject())
  };
}

export function normalizeTraitSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const itemData = snapshot.item ?? snapshot.data;
  if (!itemData || itemData.type !== "trait") return null;
  return {
    id: String(snapshot.id || randomId()),
    version: Number(snapshot.version) || SNAPSHOT_VERSION,
    item: cleanItemData(itemData)
  };
}

/**
 * Return independent trait copies stored by an Origin/Profession. Legacy UUID
 * entries are materialized once so old world and compendium content still works.
 */
export async function collectTraitSnapshots(backgroundItem) {
  const snapshots = [];
  const seen = new Set();

  for (const raw of backgroundItem?.system?.traitChoices ?? []) {
    const snapshot = normalizeTraitSnapshot(raw);
    if (!snapshot) continue;
    const key = String(snapshot.item.name ?? "").trim().toLocaleLowerCase() || snapshot.id;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(snapshot);
  }

  const legacy = await resolveItemReferences(backgroundItem?.system?.traits, { relativeTo: backgroundItem });
  for (const { item, storedUuid } of legacy) {
    const snapshot = createTraitSnapshot(item, {
      id: stableLegacyId(storedUuid)
    });
    if (!snapshot) continue;
    const key = String(snapshot.item.name ?? "").trim().toLocaleLowerCase() || snapshot.id;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(snapshot);
  }

  return snapshots;
}

export function itemDataFromTraitSnapshot(snapshot) {
  const normalized = normalizeTraitSnapshot(snapshot);
  return normalized ? cleanItemData(normalized.item) : null;
}

export function traitSnapshotPreview(snapshot) {
  const normalized = normalizeTraitSnapshot(snapshot);
  if (!normalized) return null;
  const data = normalized.item;
  return {
    id: normalized.id,
    name: data.name,
    img: data.img || "systems/neuroshima/assets/Brain.svg",
    description: data.system?.description || ""
  };
}
