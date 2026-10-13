/** One beast-action Item is one activity. Segment items retain their activity list. */
export function beastActivities(item) {
  if (!item) return [];
  if (item.type !== "beast-action") return Array.from(item.system?.activities ?? []);
  const legacy = item.system?.legacyActivities?.length ? item.system.legacyActivities
    : item._source?.system?.activities ?? item.system?.activities;
  if (Array.isArray(legacy) && legacy.length) return legacy;
  const system = item.system?.toObject?.(false) ?? item.system ?? {};
  return [{ ...system, id: system.id || item.id, name: item.name, img: item.img }];
}

/** Shared roll profile for the creature's entire action table. */
export function createBeastCombatWeapon(actor) {
  return {
    id: null, uuid: null, isSynthetic: true, isBeastCombat: true, beastItemId: null,
    name: game.i18n.localize("NEUROSHIMA.BeastAction.Label"), img: actor.img, type: "weapon",
    system: {
      weaponType: "melee", attribute: "dexterity", skill: "experience",
      attackBonus: 0, defenseBonus: 0, weaponModifier: 0,
      damageMelee1: "D", damageMelee2: "D", damageMelee3: "D",
      requiredBuild: 0, piercing: 0, magazine: null, jamming: 20
    }
  };
}

/** Older chat cards may still refer to the original package Item ID. */
export function resolveBeastActionItem(actor, itemId, activityId) {
  const original = actor.items.get(itemId);
  if (beastActivities(original).some(activity => activity.id === activityId)) return original;
  return actor.items.find(item => item.type === "beast-action" &&
    item.getFlag("neuroshima", "beastActionOrigin") === `${original?.uuid}#${activityId}`) ?? null;
}

/** Build flat item data without discarding shared resources, tests or embedded effects. */
export function flattenBeastAction(source, activity = {}) {
  const data = structuredClone(source);
  data.name = activity.name || source.name;
  data.img = activity.img || source.img;
  data.system = { ...data.system, ...structuredClone(activity) };
  delete data.system.activities;
  delete data.system.legacyActivities;
  delete data.system.name;
  delete data.system.img;
  data.system.id = activity.id || data.system.id || source._id;
  data.system.description = activity.description || source.system?.description || "";
  data.system.costType = "success";
  return data;
}

const migrating = new WeakSet();

/** Split old packages, keeping the original Item ID for the first activity.
 * Child provenance makes retries safe if a previous run stopped partway through.
 */
export async function migrateBeastActionItem(item) {
  if (item?.type !== "beast-action" || migrating.has(item)) return 0;
  const source = item.toObject();
  const stored = source.system?.activities?.length ? source.system.activities : source.system?.legacyActivities;
  if (!Array.isArray(stored) || !stored.length) return 0;
  const legacy = stored.map((activity, index) => ({ ...activity, id: activity.id || `${item.id}-${index}` }));
  migrating.add(item);
  try {
    const collection = item.parent?.items ?? item.collection;
    for (const activity of legacy.slice(1)) {
      const provenance = `${item.uuid}#${activity.id}`;
      if (collection?.some(existing => existing.getFlag("neuroshima", "beastActionOrigin") === provenance)) continue;
      const data = flattenBeastAction(source, activity);
      delete data._id;
      if (data.flags?.neuroshima) delete data.flags.neuroshima.meleeActivities;
      data.flags ??= {};
      data.flags.neuroshima ??= {};
      data.flags.neuroshima.beastActionOrigin = provenance;
      const created = await item.constructor.create(data, { parent: item.parent, pack: item.pack, keepEmbeddedIds: true });
      if (!created) throw new Error(`Cannot split beast action ${item.uuid}`);
    }
    const first = flattenBeastAction(source, legacy[0]);
    const update = { name: first.name, img: first.img,
      "system.legacyActivities": [], "system.-=activities": null,
      "flags.neuroshima.-=meleeActivities": null };
    for (const [key, value] of Object.entries(first.system)) update[`system.${key}`] = value;
    await item.update(update);
    return legacy.length;
  } finally {
    migrating.delete(item);
  }
}
