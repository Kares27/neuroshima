import { beastActivities, resolveBeastActionItem } from "../helpers/beast-actions.js";
import { MeleeActionRegistry } from "./melee-action-registry.js";

/** Project the same paid beast actions used by damage application, preserving repetitions. */
export function exchangeDamageHits(state, attacker, defender) {
  const queue = state.allBeastQueue ?? state.pendingBeastQueue ?? [];
  const attackHits = attacker?.type === "creature" && queue.length
    ? queue.map(id => {
      const [itemId, activityId] = id.split("::");
      const item = resolveBeastActionItem(attacker, itemId, activityId);
      const activity = beastActivities(item).find(entry => entry.id === activityId);
      return { damageType: activity?.damage ?? "?", actionName: activity?.name ?? item?.name ?? "?" };
    })
    : (state.hits ?? []);
  return [
    ...attackHits.map(hit => ({ ...hit, sourceName: attacker?.name ?? "?", targetName: defender?.name ?? "?" })),
    ...(state.counterHits ?? []).map(hit => ({ ...hit, isCounter: true, sourceName: defender?.name ?? "?", targetName: attacker?.name ?? "?" }))
  ];
}

/** Group individual wound tokens by recipient side, including repeated and compound damage. */
export function summarizeExchangeDamage(hits) {
  const received = { attacker: new Map(), defender: new Map() };
  for (const hit of hits) {
    const counts = hit.isCounter ? received.attacker : received.defender;
    for (const damageType of MeleeActionRegistry.parseDamageSpec(typeof hit.damageType === "string" ? hit.damageType : "")) {
      counts.set(damageType, (counts.get(damageType) ?? 0) + 1);
    }
  }
  return Object.fromEntries(Object.entries(received).map(([side, counts]) => [
    side, [...counts].map(([damageType, count]) => ({ damageType, count }))
  ]));
}
