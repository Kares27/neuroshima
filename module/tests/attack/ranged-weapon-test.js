import { WeaponTest } from "./weapon-test.js";
import { NEUROSHIMA } from "../../config.js";

export class RangedWeaponTest extends WeaponTest {
  static classId = "rangedWeapon";
  constructor(data = {}) { super({ ...data, subtype: data.subtype ?? "ranged" }); }

  static bulletsForBurst(weapon, burstLevel = 0) {
    if (weapon?.system?.weaponType === "thrown") return 1;
    const fireRate = Math.max(1, Number(weapon?.system?.fireRate ?? 1));
    switch (Number(burstLevel)) {
      case 1: return fireRate;
      case 2: return fireRate * 3;
      case 3: return fireRate * 6;
      default: return 1;
    }
  }

  static pelletDamageAtDistance(ranges, distance = 0) {
    if (!ranges) return "D";
    for (const key of ["range1", "range2", "range3", "range4"]) {
      const range = ranges[key];
      if (range && Number(distance) <= Number(range.distance)) return range.damage;
    }
    return "D";
  }

  /**
   * Build an immutable firing plan. Reading inventory is allowed here, but no
   * Item is updated until WeaponTest commits its queued side effects.
   */
  static planAmmunition(actor, weapon, requestedBullets) {
    const isRanged = weapon.system.weaponType === "ranged";
    const isThrown = weapon.system.weaponType === "thrown";
    const magazineId = weapon.system.magazine;
    const magazine = magazineId ? actor.items.get(magazineId) : null;
    const plan = {
      valid: true,
      isRanged,
      isThrown,
      magazine,
      magazineId,
      magazineUpdateData: null,
      ammoItem: null,
      ammoItemQuantity: null,
      bulletsFired: requestedBullets,
      bulletSequence: [],
      damage: weapon.system.damage || "0",
      piercing: weapon.system.piercing || 0,
      jamming: weapon.system.jamming || 20,
      damageCategory: weapon.system.damageCategory ?? "physical",
      exhaustedDuringBurst: false
    };

    if ((isRanged || isThrown) && !magazine && !weapon.system.skipMagazineCheck) {
      plan.valid = false;
      plan.reason = "noMagazine";
      return plan;
    }

    if (magazine?.type === "magazine") {
      const contents = structuredClone(magazine.system.contents || []);
      let remaining = requestedBullets;
      const consumed = [];
      while (remaining > 0 && contents.length) {
        const stack = contents.at(-1);
        const quantity = Math.min(remaining, Number(stack.quantity ?? 0));
        if (quantity > 0) consumed.push({ ...stack, quantity });
        stack.quantity -= quantity;
        remaining -= quantity;
        if (stack.quantity <= 0) contents.pop();
      }
      plan.bulletsFired = requestedBullets - remaining;
      plan.magazineUpdateData = contents;
      plan.exhaustedDuringBurst = remaining > 0;
      for (const stack of consumed) {
        for (let index = 0; index < stack.quantity; index++) {
          const overrides = stack.overrides ?? {};
          plan.bulletSequence.push({
            name: stack.name,
            damage: overrides.enabled && overrides.damage ? overrides.damage : plan.damage,
            piercing: overrides.enabled && overrides.piercing != null ? overrides.piercing : plan.piercing,
            jamming: overrides.enabled && overrides.jamming != null ? overrides.jamming : plan.jamming,
            isPellet: overrides.isPellet === true,
            pelletCount: overrides.isPellet ? Number(overrides.pelletCount ?? 1) : 1,
            pelletRanges: overrides.isPellet ? overrides.pelletRanges : null
          });
        }
      }
    } else if (isThrown && magazineId) {
      const ammo = actor.items.get(magazineId);
      plan.ammoItem = ammo?.type === "ammo" ? ammo : null;
      if (plan.ammoItem && Number(plan.ammoItem.system.quantity) > 0) {
        const system = plan.ammoItem.system;
        const override = system.isOverride === true;
        plan.bulletsFired = 1;
        plan.ammoItemQuantity = Number(system.quantity) - 1;
        plan.bulletSequence = [{
          name: plan.ammoItem.name,
          damage: override && system.overrideDamage ? system.damage : plan.damage,
          piercing: override && system.overridePiercing ? system.piercing : plan.piercing,
          jamming: override && system.overrideJamming ? system.jamming : plan.jamming,
          isPellet: system.isPellet === true,
          pelletCount: system.isPellet ? Number(system.pelletCount ?? 1) : 1,
          pelletRanges: system.isPellet ? system.pelletRanges : null
        }];
        if (override && system.overrideDamageCategory) {
          plan.damageCategory = system.damageCategory ?? "physical";
        }
      } else {
        plan.bulletsFired = 0;
      }
    }

    if (!plan.bulletSequence.length && plan.bulletsFired > 0 && weapon.system.skipMagazineCheck) {
      const bullet = {
        name: weapon.name,
        damage: plan.damage,
        piercing: plan.piercing,
        jamming: plan.jamming,
        isPellet: false,
        pelletCount: 1,
        pelletRanges: null
      };
      plan.bulletSequence = Array.from({ length: plan.bulletsFired }, () => ({ ...bullet }));
    }

    if (plan.bulletSequence.length) {
      plan.damage = plan.bulletSequence[0].damage;
      plan.piercing = plan.bulletSequence[0].piercing;
      plan.jamming = Math.min(...plan.bulletSequence.map(bullet => Number(bullet.jamming ?? 20)));
    }
    return plan;
  }

  async prepare() {
    await super.prepare();
    if (!this.actor || !this.item) return;
    const requested = Number(this.preData.bulletsFired)
      || this.constructor.bulletsForBurst(this.item, this.context.burstLevel);
    const plan = this.constructor.planAmmunition(this.actor, this.item, requested);
    this.context.ammunitionPlan = plan;
    if (!plan.valid) {
      this.cancel(plan.reason);
      return;
    }
    Object.assign(this.result.data, {
      bulletsFired: plan.bulletsFired,
      bulletSequence: plan.bulletSequence,
      damage: plan.damage,
      piercing: plan.piercing,
      damageCategory: plan.damageCategory,
      jammingThreshold: Math.min(
        Number(this.item.system.jamming ?? 20),
        Number(plan.jamming ?? 20)
      ),
      burstHitStep: Number(this.context.burstHitStep ?? 1),
      distance: Number(this.context.distance ?? 0)
    });
    this.result.data.actionLabel = globalThis.game?.i18n?.localize?.(
      NEUROSHIMA.burstLabels[this.context.burstLevel] ?? NEUROSHIMA.burstLabels[0]
    ) ?? "";
    this.result.data.magazineId = plan.magazineId;
    this.result.data.ammoId = plan.isThrown ? plan.magazineId : null;
    this.result.data.fireRate = Number(this.item.system.fireRate ?? 1);

    if (plan.magazine?.type === "magazine" && plan.magazineUpdateData) {
      this.queueSideEffect(current => {
        const data = current.result.data;
        if (data.isJamming && !data.firedDespiteJam) return;
        return plan.magazine.update({ "system.contents": plan.magazineUpdateData });
      }, { id: "consume-magazine" });
    } else if (plan.ammoItem && plan.bulletsFired > 0) {
      this.queueSideEffect(current => {
        const data = current.result.data;
        if (data.isJamming && !data.firedDespiteJam) return;
        return plan.ammoItem.update({ "system.quantity": plan.ammoItemQuantity });
      }, { id: "consume-thrown-ammo" });
    }
    this.queueSideEffect(current => {
      const jammed = current.result.data.isJamming === true;
      if (jammed === (this.item.system.jammed === true)) return;
      return this.item.update({ "system.jammed": jammed });
    }, { id: "update-weapon-jam", priority: 100 });
  }

  async computeResult(rolled = null) {
    await super.computeResult(rolled);
    const data = this.result.data;
    const bestResult = Math.min(...(data.rawResults ?? []));
    const preJamArgs = {
      actor: this.actor,
      weapon: this.item,
      jammingThreshold: data.jammingThreshold,
      ammoJamming: this.context.ammunitionPlan?.jamming ?? data.jammingThreshold,
      bestResult,
      forceNoJam: false,
      forceJam: false,
      annotations: this.result.annotations,
      options: this.context.options ?? {}
    };
    await this.getScriptRunner().executeLegacy("preWeaponShot", preJamArgs, {
      type: "weapon",
      subtype: this.subtype,
      item: this.item,
      result: data
    });
    data.jammingThreshold = Number(preJamArgs.jammingThreshold ?? data.jammingThreshold);
    data.forceNoJam = preJamArgs.forceNoJam === true;
    data.forceJam = preJamArgs.forceJam === true;
    await this.recalculate();
    if (data.isJamming) {
      const jamArgs = {
        actor: this.actor,
        weapon: this.item,
        bestResult,
        jammingThreshold: data.jammingThreshold,
        wouldSucceed: data.success === true,
        canFireDespiteJam: false,
        clearJam: false,
        despiteJamBullets: null,
        annotations: this.result.annotations,
        options: this.context.options ?? {}
      };
      await this.getScriptRunner().executeLegacy("weaponJam", jamArgs, {
        type: "weapon",
        subtype: this.subtype,
        item: this.item,
        result: data,
        tags: ["weapon", "jam"]
      });
      data.firedDespiteJam = jamArgs.canFireDespiteJam === true;
      data.despiteJamBullets = jamArgs.despiteJamBullets;
      data.jamWasCleared = jamArgs.clearJam === true;
      await this.recalculate();
    }
    this.computeFireCorrection();
    return this.result;
  }

  computeFireCorrection() {
    const data = this.result.data;
    const enabled = globalThis.game?.settings?.get("neuroshima", "fireCorrection") === true;
    if (!enabled || data.isJamming || Number(this.context.burstLevel) <= 0 || data.bulletsFired <= 0) {
      data.fireCorrectionData = null;
      return null;
    }
    if (!data.success) {
      const modifiedBest = Math.max(
        1,
        Number(data.bestResult) - Number(data.skill) - Number(data.dieReductionBonus ?? 0)
      );
      const failureMargin = modifiedBest - Number(data.target);
      data.fireCorrectionData = failureMargin > 0 ? {
        failureMargin,
        totalCorrectionCost: failureMargin * 3,
        bulletsFired: data.bulletsFired,
        canCorrect: failureMargin * 3 < data.bulletsFired,
        isSuccessCorrection: false
      } : null;
    } else {
      const remainingForCorrection = data.bulletsFired - data.hitBullets;
      const maxCorrectionHits = Math.floor(remainingForCorrection / 4);
      data.fireCorrectionData = {
        failureMargin: 0,
        totalCorrectionCost: 3,
        bulletsFired: data.bulletsFired,
        hitBullets: data.hitBullets,
        remainingForCorrection,
        maxCorrectionHits,
        canCorrect: maxCorrectionHits > 0,
        isSuccessCorrection: true
      };
    }
    return data.fireCorrectionData;
  }

  async postTest() {
    const data = this.result.data;
    const args = {
      actor: this.actor,
      weapon: this.item,
      isSuccess: data.success === true,
      isJamming: data.isJamming === true,
      firedDespiteJam: data.firedDespiteJam === true,
      despiteJamBullets: data.despiteJamBullets ?? null,
      hitBullets: data.hitBullets,
      bulletsFired: data.bulletsFired,
      successPoints: data.successPoints,
      rollData: data,
      annotations: this.result.annotations,
      options: this.context.options ?? {}
    };
    await this.getScriptRunner().executeLegacy("postWeaponShot", args, {
      type: "weapon", subtype: this.subtype, item: this.item, result: data
    });
    this.synchronizeLegacyResultArgs(args);
    await super.postTest();
  }

  /**
   * Rebuild every value derived from the attack dice. This method is pure with
   * respect to Foundry documents: ammunition and jam updates remain queued
   * side effects of the original roll.
   */
  async recalculate() {
    if (this._lifecycleOptions.recalculate) return super.recalculate();
    const data = this.result.data;
    const results = [...(data.rawResults ?? data.results ?? [])].map(Number);
    if (!results.length) return this.result;

    const target = Number(data.target ?? 0);
    const skill = Number(data.skill ?? 0);
    const bestResult = Math.min(...results);
    const dieReductionBonus = Number(data.dieReductionBonus ?? 0);
    const modifiedBest = Math.max(1, bestResult - skill - dieReductionBonus);
    const overflow = target - modifiedBest;
    const isOpen = data.isOpen === true;
    let success = isOpen ? overflow >= 0 : modifiedBest <= target && bestResult !== 20;
    let successPoints = isOpen ? Math.max(0, overflow) : (success ? 1 : 0);
    if (data.autoSuccess) {
      success = true;
      successPoints = Math.max(1, successPoints);
    }

    const forcedJam = data.forceJam === true;
    const preventedJam = data.forceNoJam === true;
    const threshold = Number(data.jammingThreshold ?? 20);
    let jammed = preventedJam ? false : forcedJam || bestResult >= threshold;
    if (data.jamWasCleared === true) jammed = false;
    const mayFire = !jammed || data.firedDespiteJam === true;
    const pp = success ? Math.max(data.autoSuccess ? 1 : 0, overflow + 1) : 0;
    const sequence = data.bulletSequence ?? data.hitBulletsData ?? [];
    const hitSequence = [];
    let pelletHits = 0;
    const pelletLimit = globalThis.game?.settings?.get("neuroshima", "usePelletCountLimit") ?? true;
    const bulletsFired = Math.max(0, Number(data.bulletsFired ?? 0));

    if (success && mayFire) {
      const shotLimit = data.firedDespiteJam
        ? Math.min(bulletsFired, Number(data.despiteJamBullets) > 0
          ? Number(data.despiteJamBullets)
          : 1)
        : bulletsFired;
      const burstHitStep = Math.max(1, Number(data.burstHitStep ?? 1));
      for (let index = 0; index < shotLimit; index++) {
        if (pp <= Math.floor(index / burstHitStep)) break;
        const bullet = sequence[index] ?? sequence[0];
        if (!bullet) break;
        if (bullet.isPellet) {
          const capacity = Math.max(0, Number(bullet.pelletCount ?? 1) - index);
          let count = Math.max(0, pp - index);
          if (pelletLimit || count > capacity) count = Math.min(count, capacity);
          if (count > 0) {
            pelletHits += count;
            hitSequence.push({
              ...bullet,
              damage: this.constructor.pelletDamageAtDistance(bullet.pelletRanges, data.distance),
              successPoints: count,
              shellIndex: index + 1
            });
          }
        } else {
          hitSequence.push({ ...bullet, successPoints: 1, shellIndex: index + 1 });
        }
      }
    }

    data.bestResult = bestResult;
    data.modifiedResults = results.map((value, index) => ({
      original: value,
      modified: Math.max(1, value - skill - dieReductionBonus),
      isSuccess: isOpen
        ? target - Math.max(1, value - skill - dieReductionBonus) >= 0
        : Math.max(1, value - skill - dieReductionBonus) <= target && value !== 20,
      isBest: value === bestResult,
      isNat1: value === 1,
      isNat20: value === 20,
      index
    }));
    data.success = data.isSuccess = success;
    data.successPoints = successPoints;
    data.successCount = success ? (isOpen ? successPoints : 1) : 0;
    data.isJamming = data.jamming = jammed;
    data.hitBulletsData = hitSequence;
    data.hitBullets = hitSequence.length;
    data.totalPelletSP = pelletHits;
    data.isCritSuccess = bestResult === 1;
    data.isCritFailure = bestResult === 20 || jammed;
    delete data.forceRecalculate;
    this.result.tags.delete("success");
    this.result.tags.delete("failure");
    this.result.tags.delete("jam");
    this.result.tags.add(success ? "success" : "failure");
    if (jammed) this.result.tags.add("jam");
    this.dirty = false;
    return this.result;
  }
}
