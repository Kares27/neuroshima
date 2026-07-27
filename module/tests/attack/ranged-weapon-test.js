import { WeaponTest } from "./weapon-test.js";

export class RangedWeaponTest extends WeaponTest {
  static classId = "rangedWeapon";
  constructor(data = {}) { super({ ...data, subtype: data.subtype ?? "ranged" }); }

  static bulletsForBurst(weapon, burstLevel = 0) {
    if (weapon?.system?.weaponType === "thrown") return 1;
    const fireRate = Math.max(1, Number(weapon?.system?.fireRate ?? 1));
    if (Number(burstLevel) <= 0) return 1;
    if (Number(burstLevel) === 1) return Math.min(3, fireRate);
    return fireRate;
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

  async computeResult(rolled = null) {
    await super.computeResult(rolled);
    await this.recalculate();
    return this.result;
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
    const modifiedBest = Math.max(1, bestResult - skill);
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
      const shotLimit = data.firedDespiteJam && Number(data.despiteJamBullets) > 0
        ? Math.min(bulletsFired, Number(data.despiteJamBullets))
        : bulletsFired;
      for (let index = 0; index < shotLimit && pp > index; index++) {
        const bullet = sequence[index] ?? sequence[0];
        if (!bullet) break;
        if (bullet.isPellet) {
          const count = pelletLimit
            ? Math.clamp(pp - index, 0, Number(bullet.pelletCount ?? 1))
            : pp - index;
          if (count > 0) {
            pelletHits += count;
            hitSequence.push({ ...bullet, successPoints: count, shellIndex: index + 1 });
          }
        } else {
          hitSequence.push({ ...bullet, successPoints: 1, shellIndex: index + 1 });
        }
      }
    }

    data.bestResult = bestResult;
    data.modifiedResults = results.map((value, index) => ({
      original: value,
      modified: Math.max(1, value - skill),
      isSuccess: isOpen
        ? target - Math.max(1, value - skill) >= 0
        : Math.max(1, value - skill) <= target && value !== 20,
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
