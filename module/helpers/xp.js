
import { NEUROSHIMA } from "../config.js";

export const SKILL_COST_NORMAL = [200, 60, 90, 200, 250, 300, 350, 800, 1000, 1100, 2400, 2600, 2800, 3000, 3200, 3400, 3600, 3000, 3800, 4000];
export const SKILL_COST_SPEC   = [200, 48, 72, 160, 200, 240, 280, 640, 720, 800, 880, 1920, 2080, 2240, 2400, 2560, 2720, 2880, 3040, 3200];

export const ATTR_COST = {
  6: 600, 7: 700, 8: 800, 9: 900, 10: 1000,
  11: 1100, 12: 1200, 13: 1300, 14: 1400, 15: 1500,
  16: 3200, 17: 3400, 18: 3600, 19: 3800, 20: 6000
};

export const TRICK_COST = 200;

/**
 * Get the XP cost to raise a skill from (newLevel-1) to newLevel.
 * Applies discounted costs if the skill's group is a specialization on this actor.
 * @param {string} skillKey
 * @param {number} newLevel  - target level (1-20)
 * @param {Actor}  actor
 * @returns {number}
 */
export function getSkillCost(skillKey, newLevel, actor) {
  const idx = newLevel - 1;
  if (idx < 0 || idx >= SKILL_COST_NORMAL.length) return 0;
  const isSpec = _isSkillSpecialized(skillKey, actor);
  return isSpec ? SKILL_COST_SPEC[idx] : SKILL_COST_NORMAL[idx];
}

/**
 * Get the XP cost to raise an attribute to the given level.
 * @param {number} newLevel
 * @returns {number}
 */
export function getAttrCost(newLevel) {
  return ATTR_COST[newLevel] ?? 0;
}

export function getAttrTotalCost(fromLevel, toLevel) {
  let total = 0;
  for (let lvl = fromLevel + 1; lvl <= toLevel; lvl++) {
    total += ATTR_COST[lvl] ?? 0;
  }
  return total;
}

export function getSkillTotalCost(skillKey, fromLevel, toLevel, actor) {
  let total = 0;
  for (let lvl = fromLevel + 1; lvl <= toLevel; lvl++) {
    total += getSkillCost(skillKey, lvl, actor);
  }
  return total;
}

function _isSkillSpecialized(skillKey, actor) {
  const cfg = NEUROSHIMA?.skillConfiguration ?? {};
  for (const specs of Object.values(cfg)) {
    for (const [specKey, skills] of Object.entries(specs)) {
      if (skills.includes(skillKey)) {
        return !!actor?.system?.specializations?.[specKey];
      }
    }
  }
  return false;
}

/**
 * Show a dialog asking the user to spend XP or mark it free.
 * Returns { free: boolean } or null if cancelled.
 * @param {number} costXp
 * @param {string} description
 * @param {number} currentXp  - current available XP
 * @returns {Promise<{free: boolean}|null>}
 */
export async function showXpDialog(costXp, description, currentXp) {
  const i18n = game.i18n;
  const hasEnough = currentXp >= costXp;
  const content = `
    <div class="neuroshima xp-dialog" style="padding: 8px;">
      <p><strong>${description}</strong></p>
      <p style="margin-bottom:6px;">${i18n.localize("NEUROSHIMA.XP.Dialog.Available")}: <strong>${currentXp}</strong> PD</p>
      ${!hasEnough ? `<p style="color:var(--color-level-warning);margin-bottom:6px;">${i18n.localize("NEUROSHIMA.XP.Dialog.NotEnough")}</p>` : ""}
      <div style="display:flex;align-items:center;gap:8px;">
        <label for="xp-cost-input" style="white-space:nowrap;"><strong>${i18n.localize("NEUROSHIMA.XP.Dialog.CostLabel")}</strong></label>
        <input id="xp-cost-input" type="number" min="0" value="${costXp}" style="width:90px;text-align:center;"/>
        <span>PD</span>
      </div>
    </div>
  `;
  return foundry.applications.api.DialogV2.wait({
    window: { title: i18n.localize("NEUROSHIMA.XP.Dialog.Title") },
    content,
    buttons: [
      {
        action: "spend",
        label: i18n.localize("NEUROSHIMA.XP.Dialog.Spend"),
        default: hasEnough,
        callback: (event, button, dialog) => {
          const val = Number(dialog.element.querySelector("#xp-cost-input")?.value) || 0;
          return { free: false, cost: val };
        }
      },
      {
        action: "free",
        label: i18n.localize("NEUROSHIMA.XP.Dialog.Free"),
        default: !hasEnough,
        callback: () => ({ free: true, cost: 0 })
      }
    ],
    classes: ["neuroshima", "dialog-vertical"],
    rejectClose: false
  });
}

/**
 * Show a dialog asking for a reason when XP total is increased (XP grant).
 * Returns { reason: string } or null if cancelled.
 * @param {number} amount  - amount of XP being granted
 * @returns {Promise<{reason: string}|null>}
 */
export async function showXpGrantDialog(amount) {
  const i18n = game.i18n;
  const content = `
    <div class="neuroshima xp-dialog" style="padding: 8px;">
      <p>${i18n.format("NEUROSHIMA.XP.Grant.Amount", { amount })}</p>
      <div style="margin-top: 8px;">
        <label for="xp-grant-reason"><strong>${i18n.localize("NEUROSHIMA.XP.Grant.Reason")}</strong></label>
        <input id="xp-grant-reason" type="text" style="width: 100%; margin-top: 4px;"
          placeholder="${i18n.localize("NEUROSHIMA.XP.Grant.ReasonPlaceholder")}"/>
      </div>
    </div>
  `;
  return foundry.applications.api.DialogV2.wait({
    window: { title: i18n.localize("NEUROSHIMA.XP.Grant.Title") },
    content,
    buttons: [
      {
        action: "confirm",
        label: i18n.localize("NEUROSHIMA.XP.Grant.Confirm"),
        default: true,
        callback: (event, button, dialog) => {
          const reason = dialog.element.querySelector("#xp-grant-reason")?.value?.trim()
            || i18n.localize("NEUROSHIMA.XP.Grant.DefaultReason");
          return { reason };
        }
      }
    ],
    classes: ["neuroshima", "dialog-vertical"],
    rejectClose: false
  });
}

/**
 * Show a dialog asking for a reason when xp.spent is increased manually (manual XP deduction).
 * Returns { reason: string } or null if cancelled.
 * @param {number} amount  - amount of XP being deducted
 * @returns {Promise<{reason: string}|null>}
 */
export async function showXpDeductDialog(amount) {
  const i18n = game.i18n;
  const content = `
    <div class="neuroshima xp-dialog" style="padding: 8px;">
      <p>${i18n.format("NEUROSHIMA.XP.Deduct.Amount", { amount })}</p>
      <div style="margin-top: 8px;">
        <label for="xp-deduct-reason"><strong>${i18n.localize("NEUROSHIMA.XP.Deduct.Reason")}</strong></label>
        <input id="xp-deduct-reason" type="text" style="width: 100%; margin-top: 4px;"
          placeholder="${i18n.localize("NEUROSHIMA.XP.Deduct.ReasonPlaceholder")}"/>
      </div>
    </div>
  `;
  return foundry.applications.api.DialogV2.wait({
    window: { title: i18n.localize("NEUROSHIMA.XP.Deduct.Title") },
    content,
    buttons: [
      {
        action: "confirm",
        label: i18n.localize("NEUROSHIMA.XP.Deduct.Confirm"),
        default: true,
        callback: (event, button, dialog) => {
          const reason = dialog.element.querySelector("#xp-deduct-reason")?.value?.trim()
            || i18n.localize("NEUROSHIMA.XP.Deduct.DefaultReason");
          return { reason };
        }
      }
    ],
    classes: ["neuroshima", "dialog-vertical"],
    rejectClose: false
  });
}

/**
 * Mutate the `changed` update object in-place to include the XP log entry
 * and (if not free) the XP deduction via system.xp.spent.
 * NOTE: system.xp.current is computed as (total - spent) in prepareDerivedData — do NOT set it here.
 *
 * @param {Actor}  actor
 * @param {Object} changed       - The update data object (from _preUpdate or direct update)
 * @param {number} costXp        - XP to deduct (0 if free)
 * @param {string} description
 * @param {*}      previousValue - The old field value (for revert)
 * @param {string} fieldPath     - dot-notation path e.g. "system.attributes.dexterity"
 */
export function applyXpEntry(actor, changed, costXp, description, previousValue, fieldPath) {
  const sys     = actor.system;
  const total   = foundry.utils.getProperty(changed, "system.xp.total")  ?? sys.xp?.total  ?? 0;
  const spent   = foundry.utils.getProperty(changed, "system.xp.spent")  ?? sys.xp?.spent  ?? 0;
  const current = total - spent;

  const entry = {
    id:            foundry.utils.randomID(),
    date:          new Date().toLocaleDateString("pl-PL"),
    description,
    cost:          costXp,
    xpBefore:      current,
    xpAfter:       current - costXp,
    previousValue,
    fieldPath
  };

  const log = foundry.utils.deepClone(sys.xpLog ?? []);
  log.push(entry);
  foundry.utils.setProperty(changed, "system.xpLog", log);

  if (costXp > 0) {
    foundry.utils.setProperty(changed, "system.xp.spent", spent + costXp);
  }
}

/**
 * Add an XP grant log entry when xp.total is increased.
 * Does NOT change xp.spent; the increase in total flows through to current automatically.
 *
 * @param {Actor}  actor
 * @param {Object} changed   - The update data object
 * @param {number} amount    - Amount of XP granted (newTotal - oldTotal)
 * @param {string} reason    - Description/reason for the grant
 */
export function applyXpGrantEntry(actor, changed, amount, reason) {
  const sys      = actor.system;
  const oldTotal = Number(sys.xp?.total) || 0;
  const spent    = Number(sys.xp?.spent) || 0;

  const entry = {
    id:            foundry.utils.randomID(),
    date:          new Date().toLocaleDateString("pl-PL"),
    description:   reason,
    cost:          -amount,
    xpBefore:      oldTotal - spent,
    xpAfter:       oldTotal - spent + amount,
    previousValue: oldTotal,
    fieldPath:     "system.xp.total"
  };

  const log = foundry.utils.deepClone(sys.xpLog ?? []);
  log.push(entry);
  foundry.utils.setProperty(changed, "system.xpLog", log);
}

/**
 * Revert a specific XP log entry by ID.
 * Restores the previous field value and refunds/reverses the XP change.
 *
 * @param {Actor}  actor
 * @param {string} entryId
 */
export async function revertXpEntry(actor, entryId) {
  const sys     = actor.system;
  const log     = foundry.utils.deepClone(sys.xpLog ?? []);
  const idx     = log.findIndex(e => e.id === entryId);
  if (idx < 0) return;

  const entry      = log[idx];
  const updateData = {};

  if (entry.fieldPath && entry.previousValue !== undefined && entry.previousValue !== null) {
    let storedValue = entry.previousValue;
    const isSkillPath = /^system\.skills\.\w+\.value$/.test(entry.fieldPath);
    const isAttrPath  = /^system\.attributes\.\w+$/.test(entry.fieldPath);
    if (isSkillPath || isAttrPath) {
      let aeBonus = 0;
      for (const effect of (actor.appliedEffects ?? [])) {
        for (const change of (effect.changes ?? [])) {
          if (change.key === entry.fieldPath && Number(change.mode) === CONST.ACTIVE_EFFECT_MODES.ADD) {
            aeBonus += Number(change.value) || 0;
          }
        }
      }
      storedValue = Math.max(0, entry.previousValue - aeBonus);
    }
    foundry.utils.setProperty(updateData, entry.fieldPath, storedValue);
  }

  const cost = entry.cost ?? 0;
  if (cost > 0) {
    const spentXp = sys.xp?.spent ?? 0;
    updateData["system.xp.spent"] = Math.max(0, spentXp - cost);
  }

  log.splice(idx, 1);
  updateData["system.xpLog"] = log;

  await actor.update(updateData);
  game.neuroshima?.log(`XP reverted: ${entry.description}`);
}
