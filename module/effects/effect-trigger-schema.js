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
    rollClass: args.test?.rollClass ?? null,
    type: metadata.type ?? args.test?.preData?.type ?? null,
    subtype: metadata.subtype ?? args.test?.preData?.subtype ?? null,
    edited: metadata.edited === true || args.test?.context?.edited === true,
    reroll: metadata.reroll === true || args.test?.context?.reroll === true,
    tags: Array.isArray(metadata.tags) ? [...metadata.tags] : [],
    actor: args.actor ?? null,
    item: metadata.item ?? args.item ?? null,
    test: metadata.test ?? args.test ?? null,
    roll: metadata.roll ?? args.test?.diceRoll ?? null,
    result: metadata.result ?? args.test?.result ?? null,
    damage: metadata.damage ?? args.attackData ?? args.damageResult ?? null,
    duel: metadata.duel ?? args.duel ?? null,
    segment: metadata.segment ?? args.segment ?? null,
    context: args.context ?? args.test?.context ?? null,
    eventContext: args.eventContext ?? null,
    phase: metadata.phase ?? null
  };
}
