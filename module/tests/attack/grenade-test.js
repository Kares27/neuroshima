import { AttackTest } from "./attack-test.js";

export class GrenadeTest extends AttackTest {
  static classId = "grenade";
  constructor(data = {}) { super({ ...data, type: "grenade" }); }

  /**
   * Compatibility boundary for the former flat NeuroshimaDice.rollGrenade
   * payload. New callers should construct GrenadeTest directly.
   */
  static fromLegacyParameters(params = {}) {
    const actor = params.actor ?? null;
    const item = params.weapon ?? params.item ?? null;
    const system = item?.system ?? {};
    const attributeKey = system.attribute || "dexterity";
    const skillKey = system.skill || "throwing";
    const useWounds = params.useWoundPenalty !== false;
    const useDisease = params.useDiseasePenalty !== false;
    return new this({
      actor,
      item,
      attribute: {
        key: attributeKey,
        value: Number(actor?.system?.attributeTotals?.[attributeKey]
          ?? actor?.system?.attributes?.[attributeKey]
          ?? 0)
      },
      skill: {
        key: skillKey,
        value: Number(actor?.system?.skills?.[skillKey]?.value ?? 0)
      },
      preData: {
        label: item?.name ?? "",
        attributeBonus: Number(params.attributeBonus ?? 0),
        skillBonus: Number(params.skillBonus ?? 0),
        autoSuccess: params.autoSuccess === true,
        annotations: [...(params.annotations ?? [])],
        penalties: {
          mod: Number(params.modifier ?? 0) + Number(params.scriptModifier ?? 0),
          armor: Number(params.armorPenalty ?? 0),
          wounds: useWounds ? Number(actor?.system?.combat?.totalWoundPenalty ?? 0) : 0,
          disease: useDisease ? Number(params.diseasePenalty ?? 0) : 0,
          distance: Number(params.distancePenalty ?? 0)
        }
      },
      context: {
        isOpen: false,
        isCombat: true,
        rollMode: params.rollMode,
        applySkillDifficultyShift: false,
        applyDiceDifficultyShift: false,
        grenadeData: {
          distance: Number(params.distance ?? 0),
          distancePenalty: Number(params.distancePenalty ?? 0),
          blastZones: [...(system.blastZones ?? [])]
        },
        eventArgs: { weapon: item }
      }
    });
  }

  async computeResult(rolled = null) {
    await super.computeResult(rolled);
    this.computeGrenadeResult();
    return this.result;
  }

  async recalculate() {
    await super.recalculate();
    return this.result;
  }

  computeGrenadeResult() {
    const data = this.result.data;
    const domain = this.context.options?.grenadeData ?? this.context.grenadeData ?? {};
    const distance = Number(domain.distance ?? data.distance ?? 0);
    const successCount = Number(data.successCount ?? 0);
    const success = data.success === true;
    const failureMargin = success ? 0 : Math.max(0, 3 - successCount);
    const distanceFactor = distance <= 10 ? 1 : Math.ceil(distance / 10);
    const blastZones = [...(domain.blastZones ?? data.blastZones ?? [])]
      .sort((a, b) => Number(a.radius) - Number(b.radius));
    Object.assign(data, {
      isGrenade: true,
      isSuccess: success,
      actorId: this.actor?.id,
      weaponId: this.item?.id,
      actorImg: this.actor?.prototypeToken?.texture?.src ?? this.actor?.img,
      failureMargin,
      deviationMetres: success ? 0 : failureMargin * distanceFactor,
      distance,
      distancePenalty: Number(domain.distancePenalty ?? data.distancePenalty ?? 0),
      blastZones,
      templateRadius: blastZones.length
        ? Math.max(...blastZones.map(zone => Number(zone.radius) || 0))
        : 0
    });
  }

  /**
   * Consuming the thrown Item is a commit-time side effect. Recalculation,
   * preview and result actions can therefore never consume extra grenades.
   */
  async postTest() {
    await super.postTest();
    if (!this.item?.actor || this.result.cancelled
      || this.context.reroll === true || this.context.edited === true) return;
    const current = Number(this.item.system?.quantity ?? 1);
    const quantity = Math.max(0, current - 1);
    this.queueSideEffect(
      () => this.item.update({ "system.quantity": quantity }),
      { id: `consume-grenade:${this.item.uuid ?? this.item.id}`, document: this.item }
    );
    this.result.data.remainingQuantity = quantity;
  }
}
