import { NeuroshimaTestBase } from "./base/neuroshima-test-base.js";
import { Closed3d20Evaluator, Defense3d20Evaluator, Open3d20Evaluator } from "./evaluators.js";
import { TestRules } from "./test-rules.js";

export class NeuroshimaTest extends NeuroshimaTestBase {
  static classId = "test";

  constructor({
    type = "attribute",
    subtype = null,
    actor = null,
    item = null,
    targets = [],
    attribute = null,
    skill = null,
    preData = {},
    rollData = null,
    result = null,
    context = {}
  } = {}) {
    super({ type, subtype, actor, item, targets, attribute, skill, preData, rollData, result, context });
  }

  async prepare() {
    if (this._lifecycleOptions.prepare) return super.prepare();
    const data = this.result.data;
    const currentStat = Number(this.attribute?.value ?? 0);
    const currentSkill = Number(this.skill?.value ?? 0);
    const penalties = this.preData.penalties ?? {};
    const finalSkill = currentSkill + Number(this.preData.skillBonus ?? 0);
    const finalStat = currentStat + Number(this.preData.attributeBonus ?? 0);
    const totalPenalty = Object.values(penalties)
      .reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
    const baseDifficulty = TestRules.difficultyFromPercent(totalPenalty);
    const defending = this.context.meleeAction === "defense";
    const finalIsOpen = defending && !this.context.isInitiative ? false : this.context.isOpen === true;
    Object.assign(data, {
      label: this.preData.label ?? "",
      stat: finalStat,
      skill: finalSkill,
      skillBonus: Number(this.preData.skillBonus ?? 0),
      attributeBonus: Number(this.preData.attributeBonus ?? 0),
      finalDifficultyShift: Number(this.preData.finalDifficultyShift ?? 0),
      maximumDifficulty: this.preData.maximumDifficulty ?? null,
      autoSuccess: this._forcedSuccess !== null,
      baseStat: currentStat,
      baseSkill: currentSkill,
      baseDifficulty,
      penalties,
      penalty: totalPenalty,
      totalPenalty,
      baseDifficultyLabel: baseDifficulty.label,
      isOpen: finalIsOpen,
      isCombat: this.context.isCombat === true,
      isDefending: defending,
      isReroll: this.context.reroll === true,
      isDebug: this.context.isDebug === true,
      rollMode: this.context.rollMode,
      rawResults: [], rolledResults: [], diceChanges: [], modifiedResults: [],
      success: false, successCount: 0, successPoints: 0,
      isCritSuccess: false, isCritFailure: false,
      isGM: globalThis.game?.user?.isGM === true,
      actorId: this.actor?.id, actorImg: this.actor?.img,
      attributeKey: this.attribute?.key ?? null,
      skillKey: this.skill?.key ?? null,
      dieManualBonus: Number(this.preData.dieManualBonus ?? 0),
      dieReductionBonus: Number(this.preData.dieReductionBonus ?? 0),
      annotations: this.result.annotations
    });
  }

  async rollDice() {
    if (this._lifecycleOptions.roll) return super.rollDice();
    const roll = new Roll("3d20");
    await roll.evaluate();
    const fixed = this.context.fixedDice;
    if (Array.isArray(fixed) && fixed.length === 3) {
      roll.terms[0].results.forEach((result, index) => { result.result = Number(fixed[index]); });
      roll._total = roll.terms[0].results.reduce((sum, result) => sum + result.result, 0);
    }
    const rawResults = roll.terms[0].results.map(result => Number(result.result));
    this.result.roll = roll;
    this.result.data.rawResults = rawResults;
    this.result.data.rolledResults = [...rawResults];
    return { roll, rawResults };
  }

  async computeResult(rolled = null) {
    if (this._lifecycleOptions.evaluate) return super.computeResult(rolled);
    const data = this.result.data;
    let shift = Number(data.finalDifficultyShift ?? 0);
    const allowCombatShift = globalThis.game?.settings?.get("neuroshima", "allowCombatShift") ?? true;
    if ((!data.isCombat || allowCombatShift) && this.context.applySkillDifficultyShift !== false) {
      shift -= TestRules.skillShift(data.skill);
    }
    if ((!data.isCombat || allowCombatShift) && this.context.applyDiceDifficultyShift !== false) {
      shift += TestRules.diceShift(data.rawResults);
    }
    const difficulty = TestRules.clampMaximumDifficulty(
      TestRules.shiftDifficulty(data.baseDifficulty, shift),
      data.maximumDifficulty
    );
    data.difficultyLabel = difficulty.label;
    data.ptMod = difficulty.mod;
    data.target = Number(data.stat ?? 0) + Number(data.ptMod ?? 0);
    if (data.isOpen) new Open3d20Evaluator().evaluate(data, data.rawResults);
    else if (data.isDefending) new Defense3d20Evaluator().evaluate(data, data.rawResults);
    else new Closed3d20Evaluator().evaluate(data, data.rawResults);
    this.applyManualDieReductions();
    this.result.tags.add(data.isOpen ? "open" : "closed");
    this.result.tags.add(data.success ? "success" : "failure");
    return this.result;
  }

  /**
   * Persistent per-die reductions used by result actions and legacy tricks.
   * Keeping them in rollData lets every rerender/reload use the same class
   * recalculation instead of a second evaluator in the chat helper.
   */
  applyManualDieReductions() {
    const data = this.result.data;
    const reductions = data.manualDieReductions ?? {};
    if (!Object.values(reductions).some(value => Number(value) > 0)) return;
    for (const die of data.modifiedResults ?? []) {
      const reduction = Math.max(0, Number(reductions[die.index] ?? 0));
      if (!reduction || die.ignored) continue;
      die.modified = Math.max(1, Number(die.modified) - reduction);
      die.isSuccess = die.original !== 20 && die.modified <= data.target;
      die.showModified = true;
    }
    const active = (data.modifiedResults ?? []).filter(die => !die.ignored);
    data.successCount = active.filter(die => die.isSuccess).length;
    if (data.isOpen) {
      const highest = active.length ? Math.max(...active.map(die => die.modified)) : 0;
      data.success = active.length > 0 && active.every(die => die.isSuccess);
      data.successPoints = data.success ? Math.max(0, Number(data.target) - highest) : 0;
      data.isCritSuccess = false;
      data.isCritFailure = false;
    } else {
      data.success = data.successCount >= 2;
      data.successPoints = data.successCount;
      data.isCritSuccess = data.successCount === 3;
      data.isCritFailure = data.successCount === 0
        && active.some(die => die.original === 20);
    }
  }

  async recalculate() {
    if (this._lifecycleOptions.recalculate) return super.recalculate();
    if (!this.result.data.rawResults?.length) return this.result;
    await this.computeResult();
    if (this._forcedSuccess || this.result.data.autoSuccess) {
      this.result.forceSuccess(this._forcedSuccess ?? "keepRoll");
    }
    this.dirty = false;
    return this.result;
  }

  needsRecalculation() {
    return super.needsRecalculation()
      || Boolean(this.result.data.forceRecalculate)
      || Boolean(this.result.data.diceChanges?.length);
  }

  async runPreEffects() {
    await super.runPreEffects();
    // Compatibility for code which still directly constructs the old generic
    // class with type:"weapon". Concrete WeaponTest uses inheritance instead.
    if (this.constructor === NeuroshimaTest && this.rollType === "weapon" && !this.preData.cancelled) {
      await this.runTrigger("preRollWeaponTest", { phase: "pre", legacyTriggers: ["preWeaponTest"] });
    }
  }

  async runPostEffects() {
    await super.runPostEffects();
    if (this.constructor === NeuroshimaTest && this.rollType === "weapon") {
      await this.runTrigger("rollWeaponTest", { phase: "result", legacyTriggers: ["weaponTest"] });
    }
  }
}
