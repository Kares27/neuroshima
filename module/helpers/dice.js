import { NEUROSHIMA } from "../config.js";
import { NeuroshimaChatMessage } from "../documents/chat-message.js";
import { NeuroshimaScriptRunner } from "../apps/neuroshima-script-engine.js";
import { attachRollContract } from "../dice/roll-contract.js";
import { NeuroshimaTestFactory } from "../tests/test-factory.js";
import { Closed3d20Evaluator, Defense3d20Evaluator, Open3d20Evaluator } from "../tests/evaluators.js";
import { TestRules } from "../tests/test-rules.js";
import { HealingTest } from "../tests/standard/healing-test.js";

/**
 * Helper class for Neuroshima 1.5 dice rolling logic.
 */
export class NeuroshimaDice {
  /**
   * Rolls initiative (Dexterity, Open Test).
   * @param {Object} params 
   * @returns {Promise<Object>} Roll data and SP result
   */
  static async rollInitiative(params) {
    const { 
        actor, 
        attribute = "dexterity", 
        skill = "", 
        useSkill = true, 
        difficulty = "average", 
        modifier = 0, 
        useArmorPenalty = false, 
        useWoundPenalty = true, 
        useDiseasePenalty = true,
        diseasePenalty: rawInitDiseasePenalty = 0,
        attributeBonus = 0, 
        skillBonus = 0, 
        isMeleeInitiative = false, 
        maneuver = "none",
        chargeLevel = 0,
        dieManualBonus = 0,
        dieReductionBonus = 0,
        maximumDifficulty = null,
        autoSuccess = false,
        annotations = [],
        rollMode = game.settings.get("core", "rollMode") 
    } = params;
    
    game.neuroshima.group(`Initiative Roll: ${actor.name}`);
    
    // Check for Charge maneuver bonus
    let chargeBonus = 0;
    if (maneuver === "charge") {
        chargeBonus = chargeLevel || 2;
    } else if (isMeleeInitiative) {
        // Fallback to active encounter if not provided in params
        const { NeuroshimaMeleeCombat } = await import("../combat/combat.js");
        const encounter = NeuroshimaMeleeCombat.findActiveEncounterForActor(actor);
        if (encounter) {
            const p = encounter.participants[actor.uuid] || encounter.participants[actor.id];
            if (p && p.maneuver === "charge") {
                chargeBonus = p.chargeLevel || 2; 
            }
        }
    }

    // 1. Read attribute and skill values
    const attrValue = Number(actor.system.attributeTotals?.[attribute]) || 10;
    const isCreatureActor = actor?.type === "creature";
    const skillValue = useSkill
        ? (skill === "experience" && isCreatureActor
            ? (actor.system.experience ?? 0)
            : (Number(actor.system.skills[skill]?.value) || 0))
        : 0;
    
    // 2. Compute penalty modifiers (%)
    const basePenalty = NEUROSHIMA.difficulties[difficulty]?.min || 0;
    const armorPenalty = useArmorPenalty ? (actor.system.combat?.totalArmorPenalty || 0) : 0;
    const woundPenalty = useWoundPenalty ? (actor.system.combat?.totalWoundPenalty || 0) : 0;
    const initDiseasePenalty = useDiseasePenalty ? (rawInitDiseasePenalty || 0) : 0;
    const totalPenalty = basePenalty + modifier + armorPenalty + woundPenalty + initDiseasePenalty;
    
    const baseDiffObj = NEUROSHIMA.difficulties[difficulty] || NEUROSHIMA.difficulties.average;
    
    // 3. Execute the initiative test (Open Test)
    const rollResult = await this.rollTest({
        stat: attrValue + chargeBonus,
        skill: skillValue,
        penalties: {
            mod: modifier,
            base: basePenalty,
            armor: armorPenalty,
            wounds: woundPenalty,
            disease: initDiseasePenalty
        },
        isOpen: true,
        isInitiative: true,
        label: game.i18n.localize("NEUROSHIMA.MeleeOpposed.InitiativeTest"),
        actor: actor,
        attributeBonus: attributeBonus,
        skillBonus: skillBonus,
        dieManualBonus: dieManualBonus || 0,
        dieReductionBonus: dieReductionBonus || 0,
        maximumDifficulty,
        autoSuccess,
        annotations,
        rollMode: rollMode,
        chatMessage: false,
        attributeKey: attribute,
        skillKey: skill,
        options: {
            rollType: "initiative",
            subtype: isMeleeInitiative ? "melee" : "standard",
            combatant: params.combatant ?? null,
            eventArgs: { combatant: params.combatant ?? null }
        }
    });

    // Add tooltip to rollResult for reuse in duels
    rollResult.tooltip = this._buildOpenTestTooltip(rollResult, "NEUROSHIMA.MeleeOpposed.InitiativeTest");
    
    // 4. Post the roll result to chat (unless disabled)
    if (params.chatMessage !== false) {
        const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
        const rollMessage = await NeuroshimaChatMessage.renderInitiativeRoll(rollResult, actor, rollResult.roll);
        
        // Dice So Nice integration: wait for the animation before returning the result
        if (game.dice3d) {
            await new Promise((resolve) => {
                const timeout = setTimeout(resolve, 5000); // Fail-safe timeout
                Hooks.once("diceSoNiceRollComplete", (messageId) => {
                    if (messageId === rollMessage.id) {
                        clearTimeout(timeout);
                        resolve();
                    }
                });
            });
        }
    } else if (game.dice3d) {
        // No chat message (e.g. background roll), but still show 3D dice animation
        await game.dice3d.showForRoll(rollResult.roll, game.user, true);
    }

    game.neuroshima.log("Wynik inicjatywy:", rollResult.successPoints);
    game.neuroshima.groupEnd();
    
    return rollResult;
  }

  /**
   * @deprecated Compatibility entry point used by existing dialogs and macros.
   * Concrete weapon classes own the public operation; this adapter only
   * selects the class and forwards the legacy parameter object.
   */
  static async rollWeaponTest(params) {
    const subtype = params.weapon?.system?.weaponType === "melee"
      ? "melee"
      : (params.weapon?.system?.weaponType === "thrown" ? "thrown" : "ranged");
    const TestClass = NeuroshimaTestFactory.create({
      type: "weapon",
      subtype
    }).constructor;
    const test = await TestClass.rollFromLegacy(params);
    return this.renderWeaponTestResult(test, params);
  }

  /**
   * Presentation adapter for an already completed concrete WeaponTest.
   * It performs no dice or domain calculations.
   */
  static async renderWeaponTestResult(test, params) {
    const subtype = test.subtype;
    const rollData = test.toLegacyData();
    if (test.result.cancelled) return rollData;
    rollData.tooltip = rollData.isOpen
      ? this._buildOpenTestTooltip(rollData, params.weapon?.name)
      : this._buildClosedTestTooltip(rollData, params.weapon?.name);
    this._groupHitsData(rollData);
    attachRollContract(rollData, {
      type: "weapon",
      subtype,
      actor: params.actor,
      item: params.weapon,
      roll: test.result.roll,
      auxiliary: rollData.auxiliaryRolls ?? [],
      tags: [...test.result.tags]
    });
    if (params.chatMessage === false) return { ...rollData, roll: test.result.roll };
    return NeuroshimaChatMessage.renderWeaponRoll(rollData, params.actor, test.result.roll);
  }

  /**
   * Re-evaluate an old, unserialized roll card. New cards restore their
   * concrete test class instead; this is compatibility-only.
   * @deprecated
   */
  static recalculateRollTestAfterScripts(test) {
    const data = test?.result?.rollData;
    if (!data || (!data.diceChanges?.length && !data.forceRecalculate)) return;
    delete data.forceRecalculate;

    const results = [...data.rawResults];
    let totalShift = Number(data.finalDifficultyShift ?? 0);
    if (!data.isCombat || game.settings.get("neuroshima", "allowCombatShift")) {
      totalShift -= this.getSkillShift(Number(data.skill) || 0);
      totalShift += this.getDiceShift(results);
    }

    const difficulty = this.clampMaximumDifficulty(
      this._getShiftedDifficulty(data.baseDifficulty, totalShift),
      data.maximumDifficulty
    );
    const target = Number(data.stat || 0) + Number(difficulty.mod || 0);
    const dice = results.map((value, index) => ({
      original: value, modified: value, index, isSuccess: false, ignored: false
    }));
    const evaluated = {
      target,
      skill: Number(data.skill) || 0,
      dieReductionBonus: Number(data.dieReductionBonus) || 0
    };

    if (data.isOpen) {
      this._evaluateOpenTest(evaluated, dice);
    } else if (data.isDefending) {
      evaluated.modifiedResults = dice.map(die => ({
        ...die,
        modified: die.original,
        isSuccess: die.original <= target && die.original !== 20,
        isNat1: die.original === 1,
        isNat20: die.original === 20
      }));
      evaluated.successCount = evaluated.modifiedResults.filter(die => die.isSuccess).length;
      evaluated.success = evaluated.successCount >= 2;
    } else {
      this._evaluateClosedTest(evaluated, dice);
    }

    data.modifiedResults = evaluated.modifiedResults;
    this.applyDiceChangePresentation(data);

    data.ptMod = difficulty.mod;
    data.difficultyLabel = difficulty.label;
    data.target = target;
    data.success = data.autoSuccess === true || !!evaluated.success;
    data.successCount = Number(evaluated.successCount ?? 0);
    data.successPoints = data.isOpen ? Number(evaluated.successPoints ?? 0) : data.successCount;
    data.skillUsed = evaluated.skillUsed;
    data.remainingSkill = evaluated.remainingSkill;
    data.isCritSuccess = !!evaluated.isCritSuccess;
    data.isCritFailure = !!evaluated.isCritFailure;

    test.result.isSuccess = data.success;
    test.result.successCount = data.successCount;
    game.neuroshima.log("Roll Test dice changes applied", {
      rolledResults: data.rolledResults,
      effectiveResults: data.rawResults,
      diceChanges: data.diceChanges,
      target: data.target,
      success: data.success,
      successCount: data.successCount
    });
  }

  static synchronizeRollTestResult(test, before = {}) {
    const result = test?.result;
    const data = result?.rollData;
    if (!data) return;
    if (typeof result.isSuccess === "boolean" && result.isSuccess !== before.isSuccess) {
      data.success = result.isSuccess;
    } else {
      result.isSuccess = !!data.success;
    }
    if (Number.isFinite(Number(result.successCount)) && result.successCount !== before.successCount) {
      data.successCount = Number(result.successCount);
      if (!data.isOpen) data.successPoints = data.successCount;
    } else {
      result.successCount = Number(data.successCount ?? 0);
    }
  }

  static async runStoredRollResultEffects(actor, rollData, {
    item = null,
    edited = false,
    reroll = false
  } = {}) {
    if (!actor || !rollData) return rollData;
    if (rollData.success === undefined && rollData.isSuccess !== undefined) {
      rollData.success = !!rollData.isSuccess;
    }
    const test = NeuroshimaTestFactory.create({
      type: rollData.testType ?? rollData.contract?.type ?? (rollData.isWeapon ? "weapon" : "skill"),
      subtype: rollData.testSubtype ?? rollData.contract?.subtype ?? null,
      actor,
      item,
      preData: { annotations: rollData.annotations ?? [] },
      context: {
        eventArgs: { item, weapon: rollData.isWeapon ? item : null },
        edited,
        reroll
      }
    });
    test.result.data = rollData;
    test.result.annotations = rollData.annotations ?? [];
    const dataIsSuccess = rollData.isSuccess;
    test.markDirty(edited ? "gm-roll-edit" : (reroll ? "reroll" : "stored-result"));
    await test.recalculate();
    await test.finish({
      synchronize: (current, before) => {
        const data = current.result.data;
        if (data.isWeapon && data.isSuccess !== dataIsSuccess) {
          data.success = data.isSuccess === true;
        }
        this.synchronizeRollTestResult(current, before);
        data.isSuccess = data.success === true;
      },
      commit: false
    });
    attachRollContract(rollData, {
      type: test.rollType,
      subtype: test.subtype,
      actor,
      item,
      roll: null,
      tags: [
        rollData.success ? "success" : "failure",
        rollData.isOpen ? "open" : "closed",
        ...(rollData.isJamming ? ["jam"] : [])
      ],
      edited,
      reroll
    });
    return rollData;
  }

  /** Attach visual change metadata to evaluated dice without recalculating them. */
  static applyDiceChangePresentation(data) {
    if (!Array.isArray(data?.modifiedResults)) return;
    const changesByDie = new Map();
    for (const change of (data.diceChanges ?? [])) {
      const changes = changesByDie.get(change.targetIndex) ?? [];
      changes.push(change);
      changesByDie.set(change.targetIndex, changes);
    }

    data.modifiedResults = data.modifiedResults.map((die, index) => {
      const changes = changesByDie.get(index) ?? [];
      const rolled = Number(data.rolledResults?.[index] ?? die.original);
      const lastChange = changes[changes.length - 1];
      return {
        ...die,
        rolled,
        rolledNat1: rolled === 1,
        rolledNat20: rolled === 20,
        changed: changes.length > 0,
        changes,
        changeIcon: lastChange?.icon ?? "fas fa-exchange-alt",
        changeTooltip: this.buildDieChangeTooltip(changes, index)
      };
    });
  }

  /** Build user-facing text from declarative die-change data. */
  static buildDieChangeTooltip(changes, targetIndex) {
    const entries = Array.isArray(changes) ? changes : [];
    if (!entries.length) return "";

    const loc = key => game.i18n.localize(key);
    const escape = value => Handlebars.escapeExpression(String(value ?? ""));

    return entries.map(change => {
      const label = escape(change.label || loc("NEUROSHIMA.Scripts.DieChangeEffect"));
      const reason = change.type === "copy" && Number.isInteger(change.sourceIndex)
        ? game.i18n.format("NEUROSHIMA.Scripts.DieCopied", { source: change.sourceIndex + 1 })
        : loc("NEUROSHIMA.Scripts.DieReplaced");

      return `
        <div class="ns-die-change-tooltip">
          <strong class="ns-die-change-title">${label}</strong>
          <div class="ns-die-change-line">
            <span>${loc("NEUROSHIMA.Scripts.DieOriginalResult")}:</span>
            <strong>${change.oldValue}</strong>
          </div>
          <div class="ns-die-change-line">
            <span>${loc("NEUROSHIMA.Scripts.DieEffectiveResult")}:</span>
            <strong>${change.newValue}</strong>
          </div>
          <div class="ns-die-change-reason">D${targetIndex + 1}: ${escape(reason)}</div>
        </div>`;
    }).join('<hr class="ns-die-change-separator">');
  }

  /**
   * Groups hits with identical damage and piercing for more readable card display.
   * @private
   */
  static _groupHitsData(rollData) {
    if (!rollData.hitBulletsData || rollData.hitBulletsData.length === 0) return;
    
    const hits = rollData.hitBulletsData;
    
    // Group damage — count pellet successPoints as individual wounds
    const counts = hits.reduce((acc, h) => {
        const amount = h.isPellet ? (h.successPoints || 1) : 1;
        acc[h.damage] = (acc[h.damage] || 0) + amount;
        return acc;
    }, {});
    
    // Omit the "1x" prefix when there is only a single wound
    const totalWounds = Object.values(counts).reduce((a, b) => a + b, 0);
    
    rollData.damage = Object.entries(counts)
        .map(([damage, count]) => totalWounds > 1 ? `${count}x${damage}` : damage)
        .join(", ");

    // Group piercing values
    const pCounts = hits.reduce((acc, h) => {
        acc[h.piercing] = (acc[h.piercing] || 0) + 1;
        return acc;
    }, {});
    
    rollData.piercing = Object.entries(pCounts)
        .map(([piercing, count]) => hits.length > 1 ? `${count}x${piercing}` : piercing)
        .join(", ");
    
    // Mark the card as pellet if at least one hit is a pellet
    rollData.isPellet = hits.some(h => h.isPellet);
  }

  /**
   * Determine pellet damage based on distance.
   * @param {Object} ranges 
   * @param {Number} distance 
   * @returns {String}
   */
  static getPelletDamageAtDistance(ranges, distance) {
    if (!ranges) return "D";
    
    const r1 = ranges.range1;
    const r2 = ranges.range2;
    const r3 = ranges.range3;
    const r4 = ranges.range4;

    if (distance <= r1.distance) return r1.damage;
    if (distance <= r2.distance) return r2.damage;
    if (distance <= r3.distance) return r3.damage;
    if (distance <= r4.distance) return r4.damage;
    
    return "D"; // Default if beyond all ranges
  }



  static getDifficultyFromPercent(percent) {
    return TestRules.difficultyFromPercent(percent);
  }

  /**
   * Main entry point for performing a Neuroshima roll.
   * @param {Object} params
   * @param {number} params.stat - Base attribute value
   * @param {number} params.skill - Skill level (points to subtract from dice)
   * @param {Object} [params.penalties] - Detailed percentage penalties
   * @param {number} [params.penalties.mod=0] - General modifier penalty
   * @param {number} [params.penalties.wounds=0] - Wounds penalty
   * @param {number} [params.penalties.armor=0] - Armor penalty
   * @param {boolean} [params.isOpen=false] - Whether this is an Open Test
   * @param {boolean} [params.isCombat=false] - Whether this is a combat action (shooting, hitting, etc.)
   * @param {boolean} [params.isDebug=false] - Whether this is a debug roll
   * @param {number[]} [params.fixedDice] - Fixed dice results for debugging
   * @param {string} [params.label] - Label for the roll
   * @param {Object} [params.actor] - The actor performing the roll
   * @param {number} [params.skillBonus=0] - Additional bonus to skill
   * @param {number} [params.attributeBonus=0] - Additional bonus to attribute
   * @param {number} [params.finalDifficultyShift=0] - Difficulty levels applied after percentage penalties
   * @param {string|null} [params.maximumDifficulty=null] - Final difficulty ceiling; harder bands are clamped to this key
   * @param {boolean} [params.autoSuccess=false] - Roll normally, then force the final result to success
   * @param {string} [params.rollMode] - The roll mode to use (default: core setting)
   */
  static async rollTest({
    stat,
    skill = 0,
    penalties = { mod: 0, wounds: 0, armor: 0 },
    isOpen = false,
    isCombat = false,
    isDebug = false,
    isReroll = false,
    fixedDice = null,
    label = "",
    actor = null,
    skillBonus = 0,
    attributeBonus = 0,
    finalDifficultyShift = 0,
    maximumDifficulty = null,
    autoSuccess = false,
    forceSuccessMode = null,
    annotations = [],
    meleeAction = "attack",
    rollMode = game.settings.get("core", "rollMode"),
    chatMessage = true,
    isInitiative = false,
    attributeKey = null,
    skillKey = null,
    options = {},
    resultCallback = null,
    dieManualBonus = 0,
    dieReductionBonus = 0
  } = {}) {
    const type = options.rollType ?? (isInitiative ? "initiative" : (skillKey ? "skill" : "attribute"));
    const test = NeuroshimaTestFactory.create({
      type,
      subtype: options.subtype ?? null,
      actor,
      item: options.item ?? null,
      attribute: attributeKey ? {
        key: attributeKey,
        value: Number(stat ?? 0),
        name: game.i18n.localize(`NEUROSHIMA.attributes.${attributeKey}`) || attributeKey
      } : { key: null, value: Number(stat ?? 0), name: null },
      skill: skillKey ? {
        key: skillKey,
        value: Number(skill ?? 0),
        name: game.i18n.localize(`NEUROSHIMA.skills.${skillKey}`) || skillKey
      } : { key: null, value: Number(skill ?? 0), name: null },
      preData: {
        penalties: { ...penalties },
        skillBonus: Number(skillBonus ?? 0),
        attributeBonus: Number(attributeBonus ?? 0),
        dieManualBonus: Number(dieManualBonus ?? 0),
        dieReductionBonus: Number(dieReductionBonus ?? 0),
        finalDifficultyShift: Number(finalDifficultyShift ?? 0),
        maximumDifficulty,
        label,
        annotations: [...(Array.isArray(annotations) ? annotations : [])].filter(Boolean)
      },
      context: {
        attributeKey,
        skillKey,
        options,
        reroll: isReroll,
        isDebug,
        isCombat,
        isOpen,
        isInitiative,
        meleeAction,
        fixedDice,
        rollMode,
        combatant: options.combatant ?? null,
        eventArgs: options.eventArgs ?? {},
        applySkillDifficultyShift: options.applySkillDifficultyShift,
        applyDiceDifficultyShift: options.applyDiceDifficultyShift
      }
    });

    // Dialog/argument auto-success keeps the roll. Legacy preRollTest scripts
    // setting preData.autoSuccess are interpreted by the test lifecycle as skipRoll.
    if (forceSuccessMode) test.forceSuccess({ mode: forceSuccessMode });
    else if (autoSuccess === true) test.forceSuccess({ mode: "keepRoll" });

    await test.roll({
      synchronize: (current, before) => this.synchronizeRollTestResult(current, before),
      legacyAfter: ["postRollTest"]
    });

    const rollData = test.toLegacyData();
    attachRollContract(rollData, {
      type: test.rollType,
      subtype: test.subtype,
      actor,
      item: test.item,
      roll: test.result.roll,
      tags: [...test.result.tags]
    });

    if (resultCallback && !test.result.cancelled) {
      await resultCallback({
        isSuccess: test.result.isSuccess,
        successes: test.result.successCount,
        rollData,
        actor,
        test
      });
    }

    if (!chatMessage || test.result.cancelled) return rollData;
    return NeuroshimaChatMessage.renderRoll(rollData, actor, test.result.roll);
  }

  static _getShiftedDifficulty(base, shift) {
    return TestRules.shiftDifficulty(base, shift);
  }

  static clampMaximumDifficulty(difficulty, maximumDifficulty) {
    return TestRules.clampMaximumDifficulty(difficulty, maximumDifficulty);
  }

  static _evaluateClosedTest(data, diceObjects) {
    return new Closed3d20Evaluator().evaluate(
      data,
      diceObjects.map(die => Number(die.original))
    );
  }

  static _evaluateOpenTest(data, diceObjects) {
    return new Open3d20Evaluator().evaluate(
      data,
      diceObjects.map(die => Number(die.original))
    );
  }

  static getSkillShift(skill) {
    return TestRules.skillShift(skill);
  }

  static getDiceShift(results) {
    return TestRules.diceShift(results);
  }

  /**
   * Check if user can see damage application section on weapon card.
   */
  static canShowDamageApplication(actor) {
    const minRole = game.settings.get("neuroshima", "damageApplicationMinRole");
    if (game.user.role >= minRole) return true;
    if (actor?.isOwner || game.user.isGM) return true;
    return false;
  }

  /**
   * Calculate number of bullets fired based on weapon ROF and burst level.
   */
  static getBulletsFired(weapon, burstLevel) {
    const rof = weapon.system.fireRate || 1;
    switch (parseInt(burstLevel)) {
        case 1: return rof; // Short
        case 2: return rof * 3; // Long
        case 3: return rof * 6; // Full
        default: return 1; // Single
    }
  }

  /**
   * Calculate location penalty based on weapon type and location key.
   */
  static getLocationPenalty(weaponType, locationKey) {
    if (locationKey === "random" || locationKey === "torso") return 0;
    const locData = NEUROSHIMA.bodyLocations[locationKey];
    if (!locData) return 0;
    
    return locData.modifiers[weaponType] || 0;
  }

  /**
   * Re-evaluate a roll message (e.g. switching between Open/Closed test).
   */
  static async updateRollMessage(message, isOpen) {
    const stored = foundry.utils.deepClone(message.getFlag("neuroshima", "rollData"));
    if (!stored) return;
    const actor = game.actors.get(stored.actorId);
    if (!actor) return;

    const serialized = foundry.utils.deepClone(message.getFlag("neuroshima", "test"));
    const test = serialized?.classId
      ? await NeuroshimaTestFactory.fromData({ ...serialized, actor, rollData: stored })
      : NeuroshimaTestFactory.create({
          type: stored.testType ?? (stored.isWeapon ? "weapon" : "skill"),
          subtype: stored.testSubtype ?? (stored.isMelee ? "melee" : null),
          actor,
          item: actor.items.get(stored.weaponId ?? stored.itemId) ?? null,
          rollData: stored,
          context: { isOpen }
        });
    test._scriptRunner = NeuroshimaScriptRunner;
    test.context.isOpen = isOpen;
    test.result.data.isOpen = isOpen;
    test.markDirty("chat-open-mode");
    await test.recalculate();
    await test.applyResultOverrides();

    const updatedData = test.toLegacyData();
    updatedData.debugMode = game.settings.get("neuroshima", "debugMode");
    const messageType = message.getFlag("neuroshima", "messageType");
    const template = messageType === "initiative"
      ? "systems/neuroshima/templates/chat/initiative-roll-card.hbs"
      : messageType === "grenade"
        ? "systems/neuroshima/templates/chat/grenade-roll-card.hbs"
        : updatedData.isMelee
          ? "systems/neuroshima/templates/chat/melee-roll-card.hbs"
          : updatedData.isWeapon
            ? "systems/neuroshima/templates/chat/weapon-roll-card.hbs"
            : "systems/neuroshima/templates/chat/roll-card.hbs";
    const showTooltip = NeuroshimaChatMessage._canShowTooltip(actor);
    const content = await foundry.applications.handlebars.renderTemplate(template, {
      ...updatedData,
      config: NEUROSHIMA,
      showTooltip,
      damageTooltipLabel: updatedData.isWeapon
        ? NeuroshimaChatMessage._getDamageTooltip(updatedData.damage)
        : "",
      isGM: game.user.isGM
    });
    await message.update({
      content,
      flags: { neuroshima: { rollData: updatedData, test: test.serialize() } }
    });
    return updatedData;
  }

  /**
   * Rerolls only the selected dice indices on an existing roll message,
   * keeping the other dice values unchanged and re-evaluating the test.
   * @param {ChatMessage} message - The original chat message.
   * @param {number[]} selectedIndices - Indices into rawResults to reroll.
   */
  static async partialRerollTest(message, selectedIndices) {
    const flags = message.getFlag("neuroshima", "rollData");
    if (!flags || !selectedIndices?.length) return;

    const rawResultsRaw = [...(flags.rawResults || flags.results || [])];
    if (!rawResultsRaw.length) return;

    // rawResults may be stored as plain numbers OR as objects {value, isNat1, isNat20} — normalize to numbers
    const rawResults = rawResultsRaw.map(v => (typeof v === "object" && v !== null ? (v.value ?? v) : v));
    const rolledResults = [...(flags.rolledResults ?? rawResults)]
      .map(v => (typeof v === "object" && v !== null ? (v.value ?? v) : v));
    const selectedSet = new Set(selectedIndices);

    const actor = game.actors.get(flags.actorId);
    if (!actor) return;

    const roll = await new Roll(`${selectedIndices.length}d20`).evaluate();
    const newValues = roll.dice[0].results.map(r => r.result);
    selectedIndices.forEach((idx, i) => {
      if (idx < 0 || idx >= rawResults.length) return;
      rawResults[idx] = newValues[i];
      rolledResults[idx] = newValues[i];
    });
    const diceChanges = (flags.diceChanges ?? []).filter(
      change => !selectedSet.has(change.targetIndex)
    );

    const messageType = message.getFlag("neuroshima", "messageType");
    const rerolledItem = actor.items.get(flags.weaponId ?? flags.itemId) ?? null;
    const stored = foundry.utils.mergeObject(foundry.utils.deepClone(flags), {
      rawResults, rolledResults, diceChanges, isReroll: true
    }, { inplace: false });
    const serialized = foundry.utils.deepClone(message.getFlag("neuroshima", "test"));
    const test = serialized?.classId
      ? await NeuroshimaTestFactory.fromData({ ...serialized, actor, item: rerolledItem, rollData: stored })
      : NeuroshimaTestFactory.create({
          type: stored.testType ?? (stored.isWeapon ? "weapon" : "skill"),
          subtype: stored.testSubtype ?? (stored.isMelee ? "melee" : null),
          actor, item: rerolledItem, rollData: stored, context: { reroll: true }
        });
    test._scriptRunner = NeuroshimaScriptRunner;
    test.context.reroll = true;
    test.result.roll = roll;
    test.markDirty("partial-reroll");
    await test.recalculate();
    await test.finish({ commit: false });
    const updatedData = test.toLegacyData();
    updatedData.isReroll = true;
    updatedData.debugMode = game.settings.get("neuroshima", "debugMode");
    this.applyDiceChangePresentation(updatedData);
    const isInitiative = messageType === "initiative";
    const isMelee = updatedData.isMelee === true;
    const isWeapon = updatedData.isWeapon === true;

    const template = isInitiative
      ? "systems/neuroshima/templates/chat/initiative-roll-card.hbs"
      : isMelee
        ? "systems/neuroshima/templates/chat/melee-roll-card.hbs"
        : (isWeapon ? "systems/neuroshima/templates/chat/weapon-roll-card.hbs" : "systems/neuroshima/templates/chat/roll-card.hbs");

    const showTooltip = NeuroshimaChatMessage._canShowTooltip(actor);
    const content = await foundry.applications.handlebars.renderTemplate(template, {
      ...updatedData,
      meleeTargets: [],
      config: NEUROSHIMA,
      showTooltip,
      damageTooltipLabel: isWeapon ? NeuroshimaChatMessage._getDamageTooltip(updatedData.damage) : "",
      isGM: game.user.isGM
    });

    const rollMode = updatedData.rollMode || game.settings.get("core", "rollMode");
    const chatData = {
      user: message.author?.id ?? game.user.id,
      speaker: message.speaker,
      content,
      rolls: [roll],
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        neuroshima: {
          messageType,
          test: test.serialize(),
          rollData: updatedData
        }
      }
    };
    ChatMessage.applyRollMode(chatData, rollMode);
    await ChatMessage.create(chatData);
    await message.update({
      flags: { neuroshima: { rerolled: true, rerolledIndices: selectedIndices } }
    });
  }

  /**
   * Apply trick die bonus reductions: reduce chosen dice's modified values,
   * then recalculate results and create a new chat message.
   * @param {ChatMessage} message
   * @param {Object}      reductions  - Map of dieIndex → reduction amount, e.g. { 0: 1, 2: 1 }
   */
  static async applyTrickDieBonus(message, reductions) {
    if (!Object.values(reductions ?? {}).some(value => Number(value) > 0)) return;
    return this._setTrickDieReductions(message, reductions, true);
  }

  /** Reset a previously applied trick die bonus through class recalculation. */
  static async resetTrickDieBonus(message) {
    const reductions = message.getFlag("neuroshima", "trickBonusReductions") ?? {};
    if (!Object.values(reductions).some(value => Number(value) > 0)) return;
    return this._setTrickDieReductions(message, {}, false, reductions);
  }

  static async _setTrickDieReductions(message, reductions, enabled, previous = reductions) {
    const stored = foundry.utils.deepClone(message.getFlag("neuroshima", "rollData"));
    if (!stored) return;
    const actor = game.actors.get(stored.actorId);
    if (!actor) return;
    stored.manualDieReductions = { ...reductions };
    stored.isTrickBonus = enabled;
    stored.dieManualBonus = enabled
      ? 0
      : Object.values(previous).reduce((sum, value) => sum + Number(value || 0), 0);
    const serialized = foundry.utils.deepClone(message.getFlag("neuroshima", "test"));
    const test = serialized?.classId
      ? await NeuroshimaTestFactory.fromData({ ...serialized, actor, rollData: stored })
      : NeuroshimaTestFactory.create({ type: "skill", actor, rollData: stored });
    test._scriptRunner = NeuroshimaScriptRunner;
    test.markDirty(enabled ? "trick-die-bonus" : "reset-trick-die-bonus");
    await test.recalculate();
    await test.applyResultOverrides();
    const updatedData = test.toLegacyData();
    updatedData.debugMode = game.settings.get("neuroshima", "debugMode");
    const showTooltip = NeuroshimaChatMessage._canShowTooltip(actor);
    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/roll-card.hbs",
      { ...updatedData, config: NEUROSHIMA, showTooltip, isGM: game.user.isGM }
    );
    await message.update({
      content,
      flags: {
        neuroshima: {
          messageType: message.getFlag("neuroshima", "messageType") || "roll",
          rollData: updatedData,
          test: test.serialize(),
          trickBonusUsed: enabled,
          trickBonusReductions: enabled ? reductions : null
        }
      }
    });
    return updatedData;
  }

  /**
   * Measures distance between two points/tokens in world units (meters).
   */
  static measureDistance(p1, p2) {
    if (!p1 || !p2) return 0;
    
    let pos1 = p1.center || p1;
    let pos2 = p2.center || p2;

    // Handle array format [x, y] (common in V13 canvas.grid)
    if (Array.isArray(pos1)) pos1 = { x: pos1[0], y: pos1[1] };
    if (Array.isArray(pos2)) pos2 = { x: pos2[0], y: pos2[1] };
    
    // In Foundry V13, the most ruler-accurate measurement method is canvas.grid.measurePath
    const path = [{x: pos1.x, y: pos1.y}, {x: pos2.x, y: pos2.y}];
    let distance = 0;
    
    try {
        const measureResult = canvas.grid.measurePath(path);
        distance = measureResult.distance;

        if (game.settings.get("neuroshima", "debugMode")) {
            console.group("Neuroshima 1.5 | measureDistance Debug (V13)");
            console.log("Position 1:", pos1);
            console.log("Position 2:", pos2);
            console.log("measurePath result:", measureResult);
            console.log("Scene scale (grid):", canvas.grid.size, "px =", canvas.grid.distance, "m");
            console.groupEnd();
        }
    } catch (e) {
        console.error("Neuroshima 1.5 | Error measuring distance:", e);
        // Fallback to simple Euclidean measurement
        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const pixelDist = Math.sqrt(dx*dx + dy*dy);
        const gridSize = canvas.grid.size || 100;
        const gridDist = canvas.grid.distance || 2;
        distance = (pixelDist / gridSize) * gridDist;
    }
    
    return Math.round(distance * 10) / 10;
  }

  /**
   * Calculate healing effects WITHOUT updating wounds (preview only).
   * @param {Actor} patientActor - The patient actor
   * @param {Array} woundIds - IDs of wounds to heal
   * @param {string} healingMethod - "firstAid" or "woundTreatment"
   * @param {number} successCount - Number of successes from the test
   * @param {boolean} hadFirstAid - Whether the wound already had First Aid applied
   * @param {number} healingModifier - Additional % modifier per wound type
   * @returns {Object} Calculated changes (no updates applied)
   */
  static calculateHealingEffects(patientActor, woundIds, healingMethod, successCount, hadFirstAid = false, healingModifier = 0, scriptHealingModifier = 0) {
    game.neuroshima?.group("NeuroshimaDice | calculateHealingEffects");
    game.neuroshima?.log("Calculating healing effects", {
      patient: patientActor.name,
      method: healingMethod,
      successCount: successCount,
      woundIds: woundIds,
      hadFirstAid: hadFirstAid
    });

    const isFirstAid = healingMethod === "firstAid";
    const isSuccess = successCount >= 2;
    
    // Determine penalty change based on result and method
    // Negative = reduces penalty (healing), positive = increases penalty (failure)
    let penaltyChange = 0;
    if (isSuccess) {
      if (isFirstAid) {
        penaltyChange = -5;
      } else {
        // Treat Wounds: 15% if fresh wound, 10% if had First Aid
        penaltyChange = hadFirstAid ? -10 : -15;
      }
    } else {
      // Failure always increases penalty by 5%
      penaltyChange = 5;
    }
    
    penaltyChange += healingModifier;

    const _applyScriptOnFailure1 = game.settings.get("neuroshima", "healingScriptModifierOnFailure") ?? false;
    if (isSuccess || _applyScriptOnFailure1) {
      penaltyChange += scriptHealingModifier;
    }

    game.neuroshima?.log("Penalty change determined", {
      penaltyChange: penaltyChange,
      baseChange: isSuccess ? (isFirstAid ? -5 : (hadFirstAid ? -10 : -15)) : 5,
      healingModifier: healingModifier,
      isSuccess: isSuccess,
      hadFirstAid: hadFirstAid
    });

    const healingResults = [];

    // Calculate effects for each wound (no updates applied)
    for (const woundId of woundIds) {
      const wound = patientActor.items.get(woundId);
      if (!wound || wound.type !== "wound") continue;

      const oldPenalty = wound.system.penalty || 0;
      let newPenalty = Math.max(0, oldPenalty + penaltyChange);

      if (isSuccess) {
        const allowRepeated = game.settings.get("neuroshima", "allowRepeatedHealing") ?? false;
        if (!allowRepeated) {
          const origPenalty = wound.system.originalPenalty ?? oldPenalty;
          if (isFirstAid) {
            const faRemaining = Math.max(0, 5 - (wound.system.firstAidHealingApplied || 0));
            newPenalty = Math.max(oldPenalty - faRemaining, newPenalty);
          }
          newPenalty = Math.max(origPenalty - 15, newPenalty);
        }
        newPenalty = Math.max(0, newPenalty);
      }

      game.neuroshima?.log("Penalty calculation for wound", {
        woundName: wound.name,
        oldPenalty: oldPenalty,
        newPenalty: newPenalty,
        penaltyChange: penaltyChange
      });

      healingResults.push({
        woundId: woundId,
        woundName: wound.name,
        damageType: wound.system.damageType || "D",
        oldPenalty: oldPenalty,
        newPenalty: newPenalty,
        penaltyChange: newPenalty - oldPenalty,
        hadFirstAid: hadFirstAid
      });
    }

    game.neuroshima?.log("Healing effects calculated", {
      resultsCount: healingResults.length
    });

    game.neuroshima?.groupEnd();

    return {
      isSuccess: isSuccess,
      healingMethod: healingMethod,
      penaltyChange: penaltyChange,
      results: healingResults
    };
  }

  /**
   * Apply healing effects to selected wounds.
   * @param {Actor} patientActor - The patient actor
   * @param {Array} woundIds - IDs of wounds to heal
   * @param {string} healingMethod - "firstAid" or "woundTreatment"
   * @param {number} successCount - Number of successes from the test
   * @param {boolean} hadFirstAid - Whether the wound already had First Aid applied
   * @param {number} healingModifier - Additional % modifier per wound type
   * @returns {Promise<Object>} Information about the applied changes
   */
  static async applyHealingEffects(patientActor, woundIds, healingMethod, successCount, hadFirstAid = false, healingModifier = 0, scriptHealingModifier = 0) {
    game.neuroshima?.group("NeuroshimaDice | applyHealingEffects");
    game.neuroshima?.log("Applying healing effects", {
      patient: patientActor.name,
      method: healingMethod,
      successCount: successCount,
      woundIds: woundIds,
      hadFirstAid: hadFirstAid
    });

    const isFirstAid = healingMethod === "firstAid";
    const isSuccess = successCount >= 2;
    
    // Negative = reduces penalty (healing), positive = increases penalty (failure)
    // First Aid: -5% (success) / +5% (failure)
    // Treat Wounds: -15% fresh / -10% (had first aid) on success, +5% on failure
    let penaltyChange = 0;
    if (isSuccess) {
      if (isFirstAid) {
        penaltyChange = -5;
      } else {
        // Treat Wounds: 15% if fresh wound, 10% if had First Aid
        penaltyChange = hadFirstAid ? -10 : -15;
      }
    } else {
      // Failure always increases penalty by 5%
      penaltyChange = 5;
    }
    
    penaltyChange += healingModifier;

    const _applyScriptOnFailure2 = game.settings.get("neuroshima", "healingScriptModifierOnFailure") ?? false;
    if (isSuccess || _applyScriptOnFailure2) {
      penaltyChange += scriptHealingModifier;
    }

    game.neuroshima?.log("Penalty change determined", {
      penaltyChange: penaltyChange,
      baseChange: isSuccess ? (isFirstAid ? -5 : (hadFirstAid ? -10 : -15)) : 5,
      healingModifier: healingModifier,
      isSuccess: isSuccess,
      hadFirstAid: hadFirstAid
    });

    const healingResults = [];
    const woundsToUpdate = [];

    // Apply healing effects to each wound
    for (const woundId of woundIds) {
      const wound = patientActor.items.get(woundId);
      if (!wound || wound.type !== "wound") continue;

      // Penalty cannot go below 0%
      const oldPenalty = wound.system.penalty || 0;
      const newPenalty = Math.max(0, oldPenalty + penaltyChange);

      game.neuroshima?.log("Penalty change for wound", {
        woundName: wound.name,
        oldPenalty: oldPenalty,
        newPenalty: newPenalty,
        penaltyChange: penaltyChange
      });

      // Update: penalty + system.isHealing = true + hadFirstAid if First Aid was successful
      const updateData = {
        _id: woundId,
        "system.penalty": newPenalty,
        "system.isHealing": true
      };
      if (isFirstAid && isSuccess) {
        updateData["system.hadFirstAid"] = true;
      }

      woundsToUpdate.push(updateData);

      healingResults.push({
        woundId: woundId,
        woundName: wound.name,
        damageType: wound.system.damageType || "D",
        oldPenalty: oldPenalty,
        newPenalty: newPenalty,
        penaltyChange: penaltyChange
      });
    }

    // Update all wounds at once (batch update)
    if (woundsToUpdate.length > 0) {
      await patientActor.updateEmbeddedDocuments("Item", woundsToUpdate);
    }

    game.neuroshima?.log("Healing effects applied", {
      resultsCount: healingResults.length
    });

    game.neuroshima?.groupEnd();

    return {
      isSuccess: isSuccess,
      healingMethod: healingMethod,
      penaltyChange: penaltyChange,
      results: healingResults
    };
  }

  /**
   * Perform a healing test (First Aid or Treat Wounds)
   */
  static async rollHealingTest(params) {
    const {
      medicActor,
      patientActor,
      healingMethod,
      skillValue,
      stat,
      penalties = {},
      baseDifficulty = "average",
      wounds = [],
      skillBonus = 0,
      attributeBonus = 0,
      dieManualBonus = 0,
      dieReductionBonus = 0,
      autoSuccess = false,
      annotations = [],
      rollMode = game.settings.get("core", "rollMode"),
      chatMessage = true
    } = params;

    const basePenalty = Number(NEUROSHIMA.difficulties[baseDifficulty]?.min ?? 0);
    const healingMethodLabel = healingMethod === "firstAid"
      ? game.i18n.localize("NEUROSHIMA.Items.Fields.Skills.firstAid")
      : game.i18n.localize("NEUROSHIMA.Items.Fields.Skills.woundTreatment");

    const rollData = await this.rollTest({
      stat,
      skill: skillValue,
      penalties: {
        ...penalties,
        mod: basePenalty + Number(penalties.mod ?? 0)
      },
      isOpen: false,
      actor: medicActor,
      label: `${healingMethodLabel} - ${patientActor.name}`,
      skillBonus,
      attributeBonus,
      dieManualBonus,
      dieReductionBonus,
      autoSuccess,
      annotations,
      rollMode,
      chatMessage: false,
      skillKey: healingMethod,
      options: {
        rollType: "healing",
        subtype: healingMethod,
        eventArgs: { patientActor }
      }
    });

    Object.assign(rollData, {
      medicActor,
      patientActor,
      healingMethod,
      wounds,
      testTarget: rollData.target
    });

    if (!rollData.cancelled) {
      const woundIds = wounds.map(wound => wound.id).filter(Boolean);
      if (woundIds.length > 0) {
        rollData.healingEffects = await this.applyHealingEffects(
          patientActor,
          woundIds,
          healingMethod,
          rollData.successCount
        );
      }
      if (chatMessage) await NeuroshimaChatMessage.renderHealingRoll(medicActor, rollData);
    }
    return rollData;
  }

  /**
   * Batch healing rolls — one closed test (3d20) per wound.
   */
  static async rollBatchHealingTests({
    medicActor,
    patientActor,
    healingMethod,
    woundConfigs,
    stat = null,
    skillBonus = 0,
    attributeBonus = 0,
    autoSuccess = false,
    annotations = [],
    dieManualBonus = 0,
    dieReductionBonus = 0
  }) {
    const baseStat = stat ?? (
      Number(medicActor.system.attributes.dexterity ?? 0)
      + Number(medicActor.system.modifiers.dexterity ?? 0)
    );
    const results = [];

    for (const config of woundConfigs) {
      const test = HealingTest.forWound({
        medicActor,
        patientActor,
        healingMethod,
        woundConfig: config,
        stat: baseStat,
        skillBonus,
        attributeBonus,
        autoSuccess,
        annotations,
        dieManualBonus,
        dieReductionBonus
      });
      const result = await test.roll();
      if (result.cancelled) continue;
      const rollData = test.toLegacyData();
      results.push({
        ...rollData,
        tooltip: this._buildClosedTestTooltip(rollData, healingMethod),
        tooltipHtml: this.buildDiceTooltipHtml(rollData)
      });
    }

    await NeuroshimaChatMessage.renderHealingBatchResults(
      medicActor,
      patientActor,
      results,
      healingMethod,
      {
        woundConfigs,
        stat: baseStat,
        skillBonus,
        attributeBonus,
        autoSuccess: autoSuccess === true,
        annotations: [...annotations]
      }
    );
    return results;
  }

  /**
   * Re-roll a healing test for a specific wound (without creating a new chat message).
   */
  static async rerollHealingTest(medicActor, patientActor, healingMethod, woundConfig, baseStat, skillBonus, attributeBonus, autoSuccess = false) {
    const test = HealingTest.forWound({
      medicActor,
      patientActor,
      healingMethod,
      woundConfig,
      stat: baseStat,
      skillBonus,
      attributeBonus,
      autoSuccess,
      reroll: true
    });
    const result = await test.roll();
    const rollData = test.toLegacyData();
    return {
      ...rollData,
      tooltip: this._buildClosedTestTooltip(rollData, healingMethod)
    };
  }

  /**
   * Universal method to build a calculation detail tooltip for any Neuroshima roll.
   * Can be used as a static JS method or a Handlebars helper.
   * @param {Object} rollData 
   * @returns {string} HTML string for the tooltip
   */
  static buildRollTooltip(rollData) {
    if (!rollData) return "";

    if (rollData.isGrenade) {
      const loc = (k) => game.i18n.localize(k);
      const distance     = rollData.distance ?? 0;
      const distPenalty  = rollData.distancePenalty ?? 0;
      const totalPenalty = rollData.totalPenalty ?? 0;
      const target       = rollData.target ?? 0;
      const diffLabel    = rollData.difficultyLabel ? loc(rollData.difficultyLabel) : "";
      let tooltip = `<strong>${loc('NEUROSHIMA.Grenade.Distance')}:</strong> ${distance}m<br>`;
      if (distPenalty !== 0) tooltip += `<strong>${loc('NEUROSHIMA.Roll.DistancePenalty')}:</strong> ${distPenalty}%<br>`;
      if (totalPenalty !== 0) tooltip += `<strong>${loc('NEUROSHIMA.Roll.TotalModifier')}:</strong> ${totalPenalty}%<br>`;
      if (diffLabel) tooltip += `<strong>${loc('NEUROSHIMA.Roll.BaseDifficulty')}:</strong> ${diffLabel}<br>`;
      tooltip += `<strong>${loc('NEUROSHIMA.Roll.Target')}:</strong> ${target}`;
      return tooltip.trim();
    }

    if (rollData.isReputationRoll) {
      const repValue = rollData.repRepValue ?? 0;
      const fame = rollData.repFame ?? 0;
      const repBonus = rollData.repBonus ?? 0;
      const totalPenalty = rollData.totalPenalty || rollData.penalty || 0;
      const baseDifficultyLabel = rollData.baseDifficultyLabel || rollData.difficultyLabel || "";
      const target = rollData.testTarget || rollData.target || 0;

      let tooltip = `<strong>${game.i18n.localize('NEUROSHIMA.Reputation.Value')}:</strong> ${repValue}<br>`;
      tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Reputation.Fame')}:</strong> ${fame}<br>`;
      if (repBonus !== 0) {
        tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Reputation.RepBonus')}:</strong> ${repBonus >= 0 ? "+" : ""}${repBonus}<br>`;
      }
      tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.PenaltyLabel')}:</strong> ${totalPenalty}%<br>`;
      tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.BaseDifficulty')}:</strong> ${game.i18n.localize(baseDifficultyLabel || 'NEUROSHIMA.Difficulty.Average')}<br>`;
      tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.Target')}:</strong> ${target}`;
      return tooltip.trim();
    }
    
    const penalties = rollData.penalties || {};
    const baseStat = rollData.baseStat || rollData.stat || 0;
    const attributeBonus = rollData.attributeBonus || 0;
    const baseSkill = rollData.baseSkill || rollData.skill || 0;
    const skillBonus = rollData.skillBonus || 0;
    const totalPenalty = rollData.totalPenalty || rollData.penalty || 0;
    const baseDifficultyLabel = rollData.baseDifficultyLabel || rollData.difficultyLabel || "";
    const target = rollData.testTarget || rollData.target || 0;

    let tooltip = `<strong>${game.i18n.localize('NEUROSHIMA.Attributes.Attributes')}:</strong> ${baseStat}<br>`;
    if (attributeBonus !== 0) {
        tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.AttributeBonusAbbr')}:</strong> ${attributeBonus}<br>`;
    }
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Items.Fields.Skill')}:</strong> ${baseSkill}<br>`;
    if (skillBonus !== 0) {
        tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.SkillBonusAbbr')}:</strong> ${skillBonus}<br>`;
    }
    
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.Penalties')}:</strong><br>`;
    tooltip += `&nbsp;&nbsp;&bull; ${game.i18n.localize('NEUROSHIMA.Roll.PenaltyMod')}: ${penalties.mod || 0}%<br>`;
    tooltip += `&nbsp;&nbsp;&bull; ${game.i18n.localize('NEUROSHIMA.Roll.PenaltyWounds')}: ${penalties.wounds || 0}%<br>`;
    tooltip += `&nbsp;&nbsp;&bull; ${game.i18n.localize('NEUROSHIMA.Roll.PenaltyArmor')}: ${penalties.armor || 0}%<br>`;
    
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.TotalModifier')}:</strong> ${totalPenalty}%<br>`;
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.BaseDifficulty')}:</strong> ${game.i18n.localize(baseDifficultyLabel)}<br>`;
    tooltip += `<strong>${game.i18n.localize('NEUROSHIMA.Roll.Target')}:</strong> ${target}`;

    return tooltip.trim();
  }

  /**
   * Builds a compact dice-roll tooltip HTML — a mini version of roll-card.hbs.
   * Includes: test type, dice grid (D1/D2/D3 with colors), threshold, skill, penalties, success count.
   * Returns a plain string (not SafeString) so Handlebars escapes it correctly for data-tooltip attributes.
   * @param {Object} data
   * @param {Array}  data.modifiedResults  - dice objects { original, modified, isSuccess, ignored, isNat1, isNat20 }
   * @param {number} data.target           - roll threshold
   * @param {number} [data.skill]          - skill points used (0 = pure attribute)
   * @param {number} [data.successCount]   - number of successes
   * @param {string} [data.difficultyLabel]- i18n key for difficulty label
   * @param {boolean}[data.isOpen]         - open vs closed test
   * @param {Object} [data.penalties]      - { mod, wounds, armor }
   * @returns {string}
   */
  static buildDiceTooltipHtml(data) {
    if (!data?.modifiedResults?.length) return "";
    const { modifiedResults, target = 0, skill = 0, successCount, difficultyLabel, isOpen, penalties } = data;

    const successes = successCount ?? modifiedResults.filter(d => d.isSuccess).length;
    const loc = (k) => game.i18n.localize(k);

    // Dice grid — mirror roll-card.hbs structure with die-square-container
    const diceHtml = modifiedResults.map((d, i) => {
      const ignored = d.ignored ? " ignored" : "";
      const nat1 = d.isNat1 ? " nat-1" : "";
      const nat20 = d.isNat20 ? " nat-20" : "";
      const modCls = d.isSuccess ? "success" : "failure";
      let h = `<div class="die-result${ignored}">`;
      h += `<span class="die-label">D${i + 1} = </span>`;
      h += `<div class="die-square-container">`;
      h += `<span class="die-square original${nat1}${nat20}">${d.original}</span>`;
      if (skill > 0) {
        h += `<i class="fas fa-long-arrow-alt-right"></i>`;
        h += `<span class="die-square modified ${modCls}">${d.modified}</span>`;
      }
      h += `</div></div>`;
      return h;
    }).join("");

    // Header
    const testTypeLabel = isOpen ? loc("NEUROSHIMA.Roll.OpenTest") : loc("NEUROSHIMA.Roll.ClosedTest");
    const diffLabel = difficultyLabel ? loc(difficultyLabel) : "";
    const headerText = diffLabel ? `${diffLabel} ${testTypeLabel}` : testTypeLabel;

    // Footer — match roll-card.hbs .roll-outcome style
    let footerItems = `<div class="outcome-item"><span class="label">${loc("NEUROSHIMA.Roll.Target")}:</span><span class="value"><strong>${target}</strong></span></div>`;
    if (skill > 0) footerItems += `<div class="outcome-item"><span class="label">${loc("NEUROSHIMA.Items.Fields.Skill")}:</span><span class="value"><strong>${skill}</strong></span></div>`;
    if (penalties) {
      const totalPenalty = (penalties.mod || 0) + (penalties.wounds || 0) + (penalties.armor || 0);
      if (totalPenalty !== 0) footerItems += `<div class="outcome-item"><span class="label">${loc("NEUROSHIMA.Roll.TotalModifier")}:</span><span class="value"><strong>${totalPenalty}%</strong></span></div>`;
    }
    footerItems += `<div class="outcome-item"><span class="label">${loc("NEUROSHIMA.Roll.SuccessPointsAbbr")}:</span><span class="value"><strong>${successes}</strong></span></div>`;

    return [
      `<div class="neuroshima roll-card tooltip-inline">`,
      `<header class="roll-header"><div class="header-details"><div class="test-info">${headerText}</div></div></header>`,
      `<hr class="dotted-hr">`,
      `<div class="dice-results-grid">${diceHtml}</div>`,
      `<hr class="dotted-hr">`,
      `<footer class="roll-outcome">${footerItems}</footer>`,
      `</div>`
    ].join("");
  }

  static _buildOpenTestTooltip(testRollData, headerLabel) {
    return this.buildRollTooltip(testRollData);
  }

  static _buildClosedTestTooltip(testRollData, headerLabel) {
    return this.buildRollTooltip(testRollData);
  }

  static _buildHealingTooltip(testRollData, healingMethod) {
    const label = healingMethod === "firstAid" ? "NEUROSHIMA.Skills.firstAid" : "NEUROSHIMA.Skills.woundTreatment";
    return this._buildClosedTestTooltip(testRollData, label);
  }

  /**
   * Calculate the throw penalty for a grenade at a given distance.
   * @param {number} distance   - Distance in metres.
   * @param {number} build      - Thrower's Constitution attribute.
   * @param {number} [freeRange=10] - Distance (m) with no penalty.
   * @returns {number} Penalty percentage (positive = harder).
   */
  static getGrenadePenalty(distance, build = 0, freeRange = null, useBuildBonus = true) {
    const cfg = game.neuroshima?.config ?? {};
    const baseRange = freeRange ?? cfg.grenadeBaseRange ?? 10;
    const multiplier = cfg.grenadeDistanceMultiplier ?? 3;
    if (distance <= baseRange) return 0;
    const rawPenalty = Math.round((distance - baseRange) * multiplier);
    let buildBonus = 0;
    if (useBuildBonus) {
      const { grenadeConstitutionBonuses } = cfg;
      if (grenadeConstitutionBonuses) {
        for (const tier of grenadeConstitutionBonuses) {
          if (build >= tier.minBuild && build <= tier.maxBuild) {
            buildBonus = tier.bonus;
            break;
          }
        }
      }
    }
    return Math.max(0, rawPenalty - buildBonus);
  }

  /**
   * Perform a grenade throw roll.
   * @param {Object} params
   * @returns {Promise<Object>} Roll result data
   */
  static async rollGrenade(params) {
    const normalized = { ...params };
    if (normalized.distancePenalty == null) {
      const build = Number(normalized.actor?.system?.attributes?.constitution ?? 0);
      normalized.distancePenalty = this.getGrenadePenalty(
        normalized.distance ?? 0,
        build,
        null,
        normalized.weapon?.system?.useBuildBonus !== false
      );
    }
    normalized.rollMode ??= game.settings.get("core", "rollMode");
    const test = NeuroshimaTestFactory.create({
      type: "grenade",
      subtype: "throw"
    }).constructor.fromLegacyParameters(normalized);
    await test.roll();
    return this.renderGrenadeTestResult(test, normalized);
  }

  /** Presentation-only adapter for a completed GrenadeTest. */
  static async renderGrenadeTestResult(test, params = {}) {
    const chatData = test.toLegacyData();
    if (test.result.cancelled || params.chatMessage === false) {
      return { ...chatData, roll: test.result.roll };
    }
    const serializedTest = chatData.testData ?? null;
    const html = await foundry.applications.handlebars.renderTemplate(
      "systems/neuroshima/templates/chat/grenade-roll-card.hbs",
      chatData
    );
    const message = await ChatMessage.create({
      content: html,
      speaker: ChatMessage.getSpeaker({ actor: test.actor }),
      rollMode: params.rollMode ?? test.context.rollMode,
      flags: {
        neuroshima: {
          messageType: "grenade",
          grenadeRoll: chatData,
          rollData: chatData,
          test: serializedTest
        }
      }
    });
    return { ...chatData, message };
  }

  /**
   * Runs pain resistance rolls and prepares wound item data.
   * Moved from CombatHelper; all callers should use this version.
   *
   * @param {Actor}  actor
   * @param {Array}  rawWounds   - Array of `{ name, damageType, forcePassed?, annotation? }`
   * @param {string} location    - Hit location key
   * @param {string} sourceInfo  - Source description placed in wound's description field
   * @returns {Promise<{ processedWounds: Array, results: Array }>}
   */
  static async processPainResistance(actor, rawWounds, location, sourceInfo) {
    game.neuroshima.group(`Processing pain resistance: ${actor.name}`);

    const NEUROSHIMA = game.neuroshima?.config ?? {};
    const skillKey = "painResistance";
    const skillValue = actor.system.skills?.[skillKey]?.value || 0;
    const statKey = "charisma";
    const statValue = actor.system.attributeTotals?.[statKey] ?? actor.system.attributes?.[statKey] ?? 10;

    const results = [];
    const processedWounds = [];

    for (const wound of rawWounds) {
      const damageType = wound.damageType;
      const config = NEUROSHIMA.woundConfiguration?.[damageType];

      if (!config?.difficulty) {
        const critPenalty = config?.penalties?.[0] ?? 160;
        results.push({
          name: wound.name,
          damageType,
          baseDifficulty: null,
          totalShift: 0,
          difficulty: null,
          isPassed: false,
          forcePassed: false,
          penalty: critPenalty,
          dice: null,
          modifiedResults: [],
          successPoints: 0,
          target: null,
          skill: skillValue,
          isCritical: true,
          isCritSuccess: false,
          isCritFailure: false,
          annotation: wound.annotation || null,
          tooltip: game.i18n.localize("NEUROSHIMA.PainResistance.CriticalAutomatic"),
          tooltipHtml: ""
        });
        processedWounds.push({
          name: wound.name,
          type: "wound",
          system: { location, damageType, damageCategory: wound.damageCategory ?? "physical", penalty: critPenalty, description: sourceInfo }
        });
        continue;
      }

      const baseDifficulty = config.difficulty;
      const allowShift = game.settings.get("neuroshima", "allowPainResistanceShift");
      const evalData = await NeuroshimaDice.rollTest({
        stat: statValue,
        skill: skillValue,
        penalties: { base: Number(baseDifficulty.min ?? 0) },
        isOpen: false,
        actor,
        attributeKey: statKey,
        skillKey,
        label: game.i18n.localize("NEUROSHIMA.Skills.painResistance"),
        annotations: [wound.annotation].filter(Boolean),
        forceSuccessMode: wound.forcePassed === true ? "skipRoll" : null,
        chatMessage: false,
        options: {
          rollType: "painResistance",
          subtype: damageType,
          applySkillDifficultyShift: allowShift,
          applyDiceDifficultyShift: true,
          eventArgs: { wound, damageType, location, sourceInfo }
        }
      });
      const isPassed = evalData.success === true;
      const diceResults = evalData.rawResults ?? [];
      const totalShift = Number(evalData.finalDifficultyShift ?? 0)
        + (allowShift ? -TestRules.skillShift(skillValue) : 0)
        + TestRules.diceShift(diceResults);
      const shiftedDiff = {
        label: evalData.difficultyLabel,
        mod: evalData.ptMod
      };
      const target = evalData.target;

      const appliedPenalty = isPassed ? (config?.penalties[0] || 0) : (config?.penalties[1] || 0);

      results.push({
        name: wound.name,
        damageType,
        baseDifficulty: baseDifficulty.label,
        totalShift,
        difficulty: shiftedDiff?.label ?? baseDifficulty.label,
        isPassed,
        forcePassed: wound.forcePassed === true,
        penalty: appliedPenalty,
        dice: diceResults.join(", "),
        modifiedResults: evalData?.modifiedResults ?? [],
        successPoints: evalData?.successCount ?? 3,
        target,
        skill: skillValue,
        isCritSuccess: evalData?.isCritSuccess ?? false,
        isCritFailure: evalData?.isCritFailure ?? false,
        annotation: wound.annotation || null,
        tooltip: wound.forcePassed
          ? (wound.annotation || wound.effectName || game.i18n.localize("NEUROSHIMA.Scripts.ForcePassed"))
          : NeuroshimaDice._buildClosedTestTooltip(evalData, "NEUROSHIMA.Skills.painResistance"),
        tooltipHtml: wound.forcePassed ? "" : NeuroshimaDice.buildDiceTooltipHtml({
          modifiedResults: evalData?.modifiedResults ?? [],
          target,
          skill: skillValue,
          successCount: evalData?.successCount ?? 0,
          difficultyLabel: shiftedDiff?.label ?? baseDifficulty.label,
          isOpen: false
        })
      });

      processedWounds.push({
        name: wound.name,
        type: "wound",
        system: { location, damageType, damageCategory: wound.damageCategory ?? "physical", penalty: appliedPenalty, description: sourceInfo }
      });
    }

    game.neuroshima.groupEnd();
    return { processedWounds, results };
  }

  /**
   * Unified entry point for all wound application — scripted effects, conditions, full combat pipeline.
   *
   * Modes (controlled by flags):
   *   - Default (no flags): bypass — direct wound creation, no armor, no hooks, no pain test.
   *   - withPainResistance: runs 3d20 Odporność na Ból test, chat report (unless suppressChat).
   *   - withHooks: fires the "takeDamage" script hook before wound creation (can set forceSkip).
   *   - penaltyOverride: forces an exact penalty value, skips pain resistance regardless of flag.
   *   - wounds[]: batch input for multiple pre-built wounds (used by the combat pipeline).
   *
   * @param {Actor}  actor
   * @param {Object} opts
   * @param {string}   [opts.damageType="L"]         - Single wound type when `wounds` is not provided.
   * @param {Array}    [opts.wounds]                  - Pre-built array: [{name?, damageType, forcePassed?, annotation?}]
   * @param {string}   [opts.location="torso"]        - Hit location key.
   * @param {string}   [opts.source=""]               - Source description placed in wound description field.
   * @param {string}   [opts.nameOverride]            - Override auto-generated wound name (single wound only).
   * @param {number}   [opts.penaltyOverride]         - Exact penalty %; skips pain resistance.
   * @param {Object}   [opts.additionalSystem={}]     - Extra system fields merged into every wound document.
   * @param {boolean}  [opts.withPainResistance=false]- Run 3d20 pain resistance test.
   * @param {boolean}  [opts.withHooks=false]         - Fire "takeDamage" script hook (wounds can be skipped).
   * @param {boolean}  [opts.forcePassed=false]       - Auto-pass pain resistance (no roll, min penalty).
   * @param {string}   [opts.annotation=null]         - Annotation shown in the pain resistance chat report.
   * @param {boolean}  [opts.suppressChat=false]      - Suppress the pain resistance chat report.
   * @returns {Promise<{wounds: Item[], results: Array, woundIds: string[]}>}
   */
  static async applyDamage(actor, {
    damageType = "L",
    wounds,
    location = "torso",
    source = "",
    nameOverride,
    penaltyOverride,
    additionalSystem = {},
    withPainResistance = false,
    withHooks = false,
    forcePassed = false,
    annotation = null,
    suppressChat = false
  } = {}) {
    const NEUROSHIMA = game.neuroshima?.config ?? {};

    let rawWounds = wounds
      ? [...wounds]
      : [{ name: nameOverride ?? (game.i18n.localize(`NEUROSHIMA.DamageType.${damageType}`) || damageType), damageType, forcePassed, annotation }];

    if (withHooks) {
      const scriptArgs = { actor, wounds: rawWounds, location };
      // takeDamage (DEFENDER side) — can forceSkip or forcePassed on individual wounds
      scriptArgs.role = "target";
      await NeuroshimaScriptRunner.executeEvent("takeDamage", scriptArgs, {
        metadata: { role: "target", damage: scriptArgs }
      });
      rawWounds = rawWounds.filter(w => !w.forceSkip);
    }

    if (!rawWounds.length) return { wounds: [], results: [], woundIds: [] };

    let processedWounds;
    let results = [];

    if (penaltyOverride !== undefined && penaltyOverride !== null) {
      const penalty = Number(penaltyOverride);
      processedWounds = rawWounds.map(w => ({
        name: w.name ?? nameOverride ?? (game.i18n.localize(`NEUROSHIMA.DamageType.${w.damageType}`) || w.damageType),
        type: "wound",
        system: { location, damageType: w.damageType, damageCategory: w.damageCategory ?? "physical", penalty, isActive: true, isHealing: false, description: source, ...additionalSystem }
      }));
    } else if (withPainResistance) {
      const painData = await NeuroshimaDice.processPainResistance(actor, rawWounds, location, source);
      processedWounds = painData.processedWounds.map(w => ({
        ...w,
        system: { damageCategory: w.system?.damageCategory ?? "physical", isActive: true, isHealing: false, ...w.system, ...additionalSystem }
      }));
      results = painData.results;
    } else {
      processedWounds = rawWounds.map(w => {
        const woundConfig = NEUROSHIMA.woundConfiguration?.[w.damageType] ?? {};
        const penalty = woundConfig?.penalties?.[0] ?? 20;
        return {
          name: w.name ?? nameOverride ?? (game.i18n.localize(`NEUROSHIMA.DamageType.${w.damageType}`) || w.damageType),
          type: "wound",
          system: { location, damageType: w.damageType, damageCategory: w.damageCategory ?? "physical", penalty, isActive: true, isHealing: false, description: source, ...additionalSystem }
        };
      });
    }

    const createdWounds = await actor.createEmbeddedDocuments("Item", processedWounds);
    const woundIds = createdWounds.map(w => w.id);
    const damageResult = { wounds: createdWounds, results, woundIds, location };

    if (!suppressChat && withPainResistance && results.length > 0) {
      await NeuroshimaChatMessage.renderPainResistance(actor, results, woundIds, 0, []);
    }

    return damageResult;
  }
}
