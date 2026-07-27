import { SkillTest } from "./skill-test.js";
import { TestRules } from "../test-rules.js";
import { NEUROSHIMA } from "../../config.js";

export class HealingTest extends SkillTest {
  static classId = "healing";

  constructor(data = {}) {
    super({ ...data, type: "healing" });
    this.patient = data.patient ?? data.context?.patientActor ?? null;
    this.wound = data.wound ?? data.context?.wound ?? null;
  }

  static forWound({
    medicActor,
    patientActor,
    healingMethod,
    woundConfig,
    stat = null,
    skillBonus = 0,
    attributeBonus = 0,
    autoSuccess = false,
    annotations = [],
    dieManualBonus = 0,
    dieReductionBonus = 0,
    reroll = false
  }) {
    const skillName = healingMethod === "firstAid" ? "firstAid" : "woundTreatment";
    const baseStat = stat ?? (
      Number(medicActor.system.attributes?.dexterity ?? 0)
      + Number(medicActor.system.modifiers?.dexterity ?? 0)
    );
    const skillValue = Number(medicActor.system.skills?.[skillName]?.value ?? 0);
    const difficulty = NEUROSHIMA.difficulties?.[woundConfig.difficulty || "average"]
      ?? NEUROSHIMA.difficulties?.average
      ?? { min: 0 };
    const wound = patientActor.items?.get(woundConfig.woundId) ?? null;

    return new this({
      actor: medicActor,
      patient: patientActor,
      wound,
      attribute: { key: "dexterity", value: baseStat },
      skill: { key: skillName, value: skillValue },
      preData: {
        label: woundConfig.woundName,
        penalties: {
          mod: Number(difficulty.min ?? 0) + Number(woundConfig.modifier ?? 0)
        },
        skillBonus,
        attributeBonus,
        finalDifficultyShift: Number(woundConfig.failedAttempts ?? 0)
          + Number(woundConfig.difficultyShift ?? 0),
        autoSuccess,
        annotations,
        dieManualBonus,
        dieReductionBonus
      },
      context: {
        reroll,
        isOpen: false,
        rollType: "healing",
        healingMethod,
        patientActor,
        wound,
        woundConfig,
        eventArgs: { patientActor, wound }
      }
    });
  }

  async resolveDomain() {
    const config = this.context.woundConfig ?? {};
    const data = this.result.data;
    const wound = this.wound ?? this.patient?.items?.get(config.woundId);
    const calculated = wound ? [this.computeHealingResult(wound, data.successCount, config)] : [];

    Object.assign(data, {
      woundId: config.woundId,
      woundName: config.woundName,
      damageType: config.damageType,
      difficulty: config.difficulty,
      testTarget: data.target,
      isSuccess: data.success === true,
      finalStat: data.stat,
      skillShift: -TestRules.skillShift(data.skill),
      diceShift: TestRules.diceShift(data.rawResults),
      healingEffect: calculated[0] ?? null
    });
    return this.result;
  }

  computeHealingResult(wound, successCount, config = this.context.woundConfig ?? {}) {
    const success = Number(successCount) >= 2;
    const firstAid = this.context.healingMethod === "firstAid";
    let penaltyChange = success
      ? (firstAid ? -5 : (config.hadFirstAid ? -10 : -15))
      : 5;
    penaltyChange += Number(config.healingModifier ?? 0);
    const modifierOnFailure = globalThis.game?.settings?.get(
      "neuroshima", "healingScriptModifierOnFailure"
    ) ?? false;
    if (success || modifierOnFailure) {
      penaltyChange += Number(config.scriptHealingModifier ?? 0);
    }
    const oldPenalty = Number(wound.system?.penalty ?? 0);
    let newPenalty = Math.max(0, oldPenalty + penaltyChange);
    if (success && !(globalThis.game?.settings?.get("neuroshima", "allowRepeatedHealing") ?? false)) {
      const originalPenalty = Number(wound.system?.originalPenalty ?? oldPenalty);
      if (firstAid) {
        const remaining = Math.max(0, 5 - Number(wound.system?.firstAidHealingApplied ?? 0));
        newPenalty = Math.max(oldPenalty - remaining, newPenalty);
      }
      newPenalty = Math.max(originalPenalty - 15, newPenalty);
    }
    newPenalty = Math.max(0, newPenalty);
    return {
      woundId: wound.id,
      woundName: wound.name,
      damageType: wound.system?.damageType ?? "D",
      oldPenalty,
      newPenalty,
      penaltyChange: newPenalty - oldPenalty,
      wasFullyHealed: newPenalty === 0,
      isSuccess: success
    };
  }

  async recalculate() {
    await super.recalculate();
    await this.resolveDomain();
    return this.result;
  }
}
