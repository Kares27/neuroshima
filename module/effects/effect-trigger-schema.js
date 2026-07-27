/**
 * Active Effect triggers exposed to users.
 *
 * Naming follows the WFRP-style lifecycle: preX -> X. A trigger is a concrete
 * dropdown choice; scripts do not need separate context filters.
 */
import { TriggerRegistry } from "./trigger-registry.js";

export const EFFECT_TRIGGER_SCHEMA_VERSION = 4;

export const EFFECT_TRIGGERS = TriggerRegistry.publicOptions();

export function createTriggerContext(trigger, args = {}, metadata = {}) {
  return {
    schemaVersion: EFFECT_TRIGGER_SCHEMA_VERSION,
    trigger,
    classId: args.test?.classId ?? null,
    type: metadata.type ?? args.test?.rollType ?? null,
    subtype: metadata.subtype ?? null,
    edited: metadata.edited === true || args.test?.context?.edited === true,
    reroll: metadata.reroll === true || args.test?.context?.reroll === true,
    tags: Array.isArray(metadata.tags) ? [...metadata.tags] : [],
    actor: args.actor ?? null,
    item: metadata.item ?? args.item ?? args.weapon ?? null,
    test: metadata.test ?? args.test ?? null,
    roll: metadata.roll ?? args.roll ?? args.test?.result?.roll ?? null,
    result: metadata.result ?? args.rollData ?? args.test?.result?.rollData ?? null,
    weapon: args.weapon ?? metadata.item ?? null,
    damage: metadata.damage ?? args.attackData ?? args.damageResult ?? null,
    duel: metadata.duel ?? args.duel ?? null,
    segment: metadata.segment ?? args.segment ?? null,
    context: args.context ?? args.test?.context ?? null,
    eventContext: args.eventContext ?? null,
    phase: metadata.phase ?? null
  };
}
