import { AttackTest } from "./attack-test.js";
import { NEUROSHIMA } from "../../config.js";
import { TestRules } from "../test-rules.js";

export class WeaponTest extends AttackTest {
  static classId = "weapon";
  constructor(data = {}) { super({ ...data, type: "weapon" }); }

  /**
   * Compatibility constructor for the historical flat dialog payload. The
   * concrete subclass is selected before this method is called, so callers no
   * longer branch over weapon types outside TestFactory.
   */
  static fromLegacyParameters(params) {
    const { actor, weapon } = params;
    if (!actor || !weapon) throw new TypeError("A weapon test requires actor and weapon");
    const isMelee = weapon.system.weaponType === "melee";
    const meleeAction = params.meleeAction ?? "attack";
    const maneuver = params.maneuver ?? "none";
    const bonusMode = globalThis.game?.settings?.get("neuroshima", "meleeBonusMode") || "attribute";
    const weaponBonus = isMelee
      ? Number(meleeAction === "defense" ? weapon.system.defenseBonus : weapon.system.attackBonus)
      : 0;
    let attributeBonus = Number(params.attributeBonus ?? 0);
    let skillBonus = Number(params.skillBonus ?? 0);
    if (isMelee && maneuver === "fury" && meleeAction === "attack") attributeBonus += 2;
    if (isMelee && maneuver === "fullDefense" && meleeAction === "defense") attributeBonus += 2;
    if (isMelee && ["attribute", "both"].includes(bonusMode)) attributeBonus += weaponBonus;
    if (isMelee && ["skill", "both"].includes(bonusMode)) skillBonus += weaponBonus;

    let difficulty = NEUROSHIMA.difficulties[params.difficulty] ?? NEUROSHIMA.difficulties.average;
    if (isMelee && maneuver === "increasedTempo") {
      difficulty = TestRules.shiftDifficulty(difficulty, Number(params.tempoLevel ?? 0));
    }
    const location = params.hitLocation ?? "torso";
    const locationPenalty = ["random", "torso"].includes(location)
      ? 0
      : Number(NEUROSHIMA.bodyLocations[location]?.modifiers?.[weapon.system.weaponType] ?? 0);
    const armorPenalty = params.applyArmor ? Number(actor.system.combat?.totalArmorPenalty ?? 0) : 0;
    const woundPenalty = params.applyWounds ? Number(actor.system.combat?.totalWoundPenalty ?? 0) : 0;
    const diseasePenalty = params.applyDisease === false ? 0 : Number(params.diseasePenalty ?? 0);
    const attributeKey = weapon.system.attribute ?? "dexterity";
    let skillKey = params.skillKeyOverride ?? weapon.system.skill ?? null;
    if (skillKey && skillKey !== "experience" && !actor.system.skills?.[skillKey]) {
      skillKey = weapon.system.skill ?? null;
    }
    const skillValue = skillKey === "experience" && actor.type === "creature"
      ? Number(actor.system.experience ?? 0)
      : Number(actor.system.skills?.[skillKey]?.value ?? 0);
    const diceCount = isMelee
      ? Math.min(3, Math.max(1, Number(params.meleeDiceCount ?? 3)))
      : Math.min(3, Math.max(1, Number(params.aimingLevel ?? 0) + 1));

    const test = new this({
      actor,
      item: weapon,
      targets: params.targets ?? [],
      attribute: {
        key: attributeKey,
        value: Number(actor.system.attributeTotals?.[attributeKey]
          ?? actor.system.attributes?.[attributeKey]
          ?? 10)
      },
      skill: { key: skillKey, value: skillValue },
      preData: {
        label: weapon.name,
        diceCount,
        penalties: {
          base: Number(difficulty.min ?? 0),
          mod: Number(params.modifier ?? 0),
          armor: armorPenalty,
          wounds: woundPenalty,
          disease: diseasePenalty,
          location: locationPenalty,
          distance: Number(params.distancePenalty ?? 0)
        },
        skillBonus,
        attributeBonus,
        dieManualBonus: Number(params.dieManualBonus ?? 0),
        dieReductionBonus: Number(params.dieReductionBonus ?? 0),
        maximumDifficulty: params.maximumDifficulty ?? null,
        bulletsFired: isMelee ? 0 : this.bulletsForBurst?.(weapon, params.burstLevel),
        annotations: [...(params.annotations ?? [])]
      },
      context: {
        isCombat: true,
        isMelee,
        isOpen: isMelee ? false : params.isOpen === true,
        applySkillDifficultyShift: !isMelee,
        meleeAction,
        maneuver,
        hitLocation: location,
        burstLevel: Number(params.burstLevel ?? 0),
        burstHitStep: Number(params.burstHitStep ?? 1),
        distance: Number(params.distance ?? 0),
        applyArmor: params.applyArmor === true,
        applyWounds: params.applyWounds === true,
        damageShift: Number(params.damageShift ?? 0),
        damageShift1: Number(params.damageShift1 ?? 0),
        damageShift2: Number(params.damageShift2 ?? 0),
        damageShift3: Number(params.damageShift3 ?? 0),
        reroll: params.isReroll === true,
        fixedDice: Array.isArray(params.fixedDice) ? [...params.fixedDice] : null,
        rollMode: params.rollMode,
        options: params.options ?? {},
        eventArgs: { weapon, options: params.options ?? {} }
      }
    });
    if (params.autoSuccess === true) test.forceSuccess({ mode: "keepRoll" });
    return test;
  }

  static async rollFromLegacy(params) {
    const test = this.fromLegacyParameters(params);
    await test.roll();
    return test;
  }

  async prepare() {
    await super.prepare();
    const data = this.result.data;
    data.isWeapon = true;
    data.label = this.preData.label ?? this.item?.name ?? "";
    data.weaponId = this.item?.id ?? null;
    data.actorId = this.actor?.id ?? null;
    data.actorImg = this.actor?.img ?? null;
    data.weaponType = this.item?.system?.weaponType ?? this.subtype;
    data.isMelee = this.context.isMelee === true;
    data.meleeAction = this.context.isMelee ? (this.context.meleeAction ?? "attack") : null;
    data.maneuver = this.context.maneuver ?? "none";
    data.rollMode = this.context.rollMode;
    data.targets = this.context.isMelee ? [...this.targets] : [];
    data.applyArmor = this.context.applyArmor;
    data.applyWounds = this.context.applyWounds;
    data.damageShift = Number(this.context.damageShift ?? 0);
    data.burstLevel = Number(this.context.burstLevel ?? 0);
    data.distance = Number(this.context.distance ?? 0);
    data.isReroll = this.context.reroll === true;
    data.diceCount = Math.min(3, Math.max(
      1,
      Math.floor(Number(this.preData.diceCount ?? 3))
    ));
    data.jammingThreshold = Number(
      this.preData.jammingThreshold
      ?? this.item?.system?.jammingThreshold
      ?? 20
    );
    data.bulletsFired = Math.max(0, Number(this.preData.bulletsFired ?? 0));
    data.bulletSequence = this.preData.bulletSequence ?? [];
  }

  async rollDice() {
    if (this._lifecycleOptions.roll) return super.rollDice();
    const diceCount = Number(this.result.data.diceCount ?? 3);
    const roll = new Roll(`${diceCount}d20`);
    await roll.evaluate();
    const fixed = this.context.fixedDice;
    if (Array.isArray(fixed) && fixed.length === diceCount) {
      roll.terms[0].results.forEach((result, index) => { result.result = Number(fixed[index]); });
      roll._total = roll.terms[0].results.reduce((sum, result) => sum + result.result, 0);
    }
    const rawResults = roll.terms[0].results.map(result => Number(result.result));
    this.result.roll = roll;
    this.result.data.rawResults = rawResults;
    this.result.data.rolledResults = [...rawResults];
    return { roll, rawResults };
  }

  async resolveDomain(rolled = null) {
    await super.resolveDomain(rolled);
    const location = await this.computeHitLocation(
      this.context.hitLocation ?? this.preData.hitLocation ?? "torso"
    );
    this.result.data.hitLocation = this.context.hitLocation ?? location;
    this.result.data.locationLabel = globalThis.game?.i18n?.localize?.(
      NEUROSHIMA.bodyLocations?.[location]?.label ?? location
    ) ?? location;
    return this.result;
  }

  async runPreEffects() {
    await super.runPreEffects();
    if (!this.preData.cancelled) {
      await this.runTrigger("preRollWeaponTest", {
        phase: "pre",
        legacyTriggers: ["preWeaponTest"]
      });
    }
  }

  triggerArgs() {
    const args = super.triggerArgs();
    const data = this.result.data;
    Object.assign(args, {
      weapon: this.item,
      firedDespiteJam: data.firedDespiteJam === true,
      despiteJamBullets: data.despiteJamBullets ?? null,
      annotations: this.result.annotations,
      options: this.context.options ?? {}
    });
    Object.defineProperties(args, {
      isSuccess: {
        enumerable: true,
        get: () => data.success === true,
        set: value => { data.success = data.isSuccess = value === true; }
      },
      isJamming: {
        enumerable: true,
        get: () => data.isJamming === true,
        set: value => { data.isJamming = data.jamming = value === true; }
      },
      hitBullets: {
        enumerable: true,
        get: () => data.hitBullets,
        set: value => { data.hitBullets = Number(value ?? 0); }
      },
      bulletsFired: {
        enumerable: true,
        get: () => data.bulletsFired,
        set: value => { data.bulletsFired = Number(value ?? 0); }
      },
      successPoints: {
        enumerable: true,
        get: () => data.successPoints,
        set: value => { data.successPoints = Number(value ?? 0); }
      }
    });
    return args;
  }

  async runPostEffects() {
    await super.runPostEffects();
    await this.runTrigger("rollWeaponTest", {
      phase: "result",
      legacyTriggers: ["weaponTest"]
    });
  }

  async postTest() {
    await super.postTest();
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
    await this.getScriptRunner().executeLegacy("postWeaponTest", args, {
      type: "weapon", subtype: this.subtype, item: this.item, result: data
    });
    this.synchronizeLegacyResultArgs(args);
  }

  synchronizeLegacyResultArgs(args) {
    const data = this.result.data;
    if (args.isSuccess !== undefined) data.success = data.isSuccess = args.isSuccess === true;
    if (args.isJamming !== undefined) data.isJamming = data.jamming = args.isJamming === true;
    if (args.hitBullets !== undefined) data.hitBullets = Number(args.hitBullets ?? 0);
    if (args.bulletsFired !== undefined) data.bulletsFired = Number(args.bulletsFired ?? 0);
    if (args.successPoints !== undefined) data.successPoints = Number(args.successPoints ?? 0);
    data.successCount = Number(data.successCount ?? data.successPoints ?? 0);
  }
}
