import { AttackTest } from "./attack-test.js";

export class GrenadeTest extends AttackTest {
  static classId = "grenade";
  constructor(data = {}) { super({ ...data, type: "grenade" }); }

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
}
