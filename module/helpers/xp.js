
import { NEUROSHIMA } from "../config.js";

export const SKILL_COST_NORMAL = [200, 60, 90, 200, 250, 300, 350, 800, 1000, 1100, 2400, 2600, 2800, 3000, 3200, 3400, 3600, 3000, 3800, 4000];
export const SKILL_COST_SPEC   = [200, 48, 72, 160, 200, 240, 280, 640, 720, 800, 880, 1920, 2080, 2240, 2400, 2560, 2720, 2880, 3040, 3200];

export const ATTR_COST = {
  6: 600, 7: 700, 8: 800, 9: 900, 10: 1000,
  11: 1100, 12: 1200, 13: 1300, 14: 1400, 15: 1500,
  16: 3200, 17: 3400, 18: 3600, 19: 3800, 20: 6000
};

export const TRICK_COST = 200;
export const REPUTATION_XP_COST = 25;

/** Clamp a prepared reputation cost to a usable non-negative integer. */
export function normalizeReputationCost(value, fallback = REPUTATION_XP_COST) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.round(Number(fallback) || 0));
  return Math.max(0, Math.round(numeric));
}

/** Read the world-configured base price, falling back safely during initialization. */
export function getBaseReputationCost() {
  try {
    return normalizeReputationCost(
      game.settings?.get?.("neuroshima", "reputationXpCost"),
      REPUTATION_XP_COST
    );
  } catch (_error) {
    return REPUTATION_XP_COST;
  }
}

/**
 * Mutable synchronous API exposed to prepareData Active Effect scripts.
 *
 * @example
 * args.reputation.cost = 15;
 * args.reputation.setCost(10);
 * args.reputation.modifyCost(-5);
 */
export function createReputationCostApi(preparedData) {
  const api = {
    get cost() {
      return normalizeReputationCost(preparedData?.reputationCost);
    },
    set cost(value) {
      if (preparedData) preparedData.reputationCost = normalizeReputationCost(value);
    },
    setCost(value) {
      this.cost = value;
      return this.cost;
    },
    modifyCost(delta) {
      this.cost = this.cost + Number(delta ?? 0);
      return this.cost;
    }
  };
  return api;
}

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

function _escapeDialogText(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function _xpDialogFrame({ icon = "fa-receipt", summary = "", body = "" } = {}) {
  return `
    <div class="xp-dialog xp-transaction">
      <div class="xp-transaction__heading">
        <span class="xp-transaction__icon"><i class="fas ${icon}"></i></span>
        <p class="xp-transaction__summary">${_escapeDialogText(summary)}</p>
      </div>
      ${body}
    </div>
  `;
}

function _xpBalanceStrip({
  currentXp,
  inputId,
  inputLabel,
  inputValue,
  inputMin = null,
  inputMax = null
}) {
  const current = Number(currentXp) || 0;
  const value = Number(inputValue) || 0;
  const projected = current - value;
  const debt = projected < 0;
  const unit = game.i18n.localize("NEUROSHIMA.XP.Unit");
  const constraints = [
    inputMin !== null ? `min="${Number(inputMin)}"` : "",
    inputMax !== null ? `max="${Number(inputMax)}"` : ""
  ].filter(Boolean).join(" ");
  return `
    <div class="xp-ledger${debt ? " is-debt" : ""}" data-xp-ledger>
      <div class="xp-ledger__entry">
        <span class="xp-ledger__label">${game.i18n.localize("NEUROSHIMA.XP.Dialog.Available")}</span>
        <strong class="xp-ledger__value">${current} <small>${unit}</small></strong>
      </div>
      <label class="xp-ledger__entry xp-ledger__entry--editable" for="${inputId}">
        <span class="xp-ledger__label">${inputLabel}</span>
        <span class="xp-ledger__input">
          <input id="${inputId}" type="number" ${constraints} value="${value}">
          <small>${unit}</small>
        </span>
      </label>
      <hr class="xp-ledger__total-separator">
      <div class="xp-ledger__entry xp-ledger__entry--projected">
        <span class="xp-ledger__label">${game.i18n.localize("NEUROSHIMA.XP.Dialog.AfterTransaction")}</span>
        <strong class="xp-ledger__value" data-xp-projected aria-live="polite">${projected} <small>${unit}</small></strong>
      </div>
    </div>
    <div class="xp-debt-warning" data-xp-debt-warning role="status" aria-live="polite"${debt ? "" : " hidden"}>
      <i class="fas fa-triangle-exclamation"></i>
      <span>${game.i18n.localize("NEUROSHIMA.XP.Dialog.DebtWarning")}</span>
    </div>
  `;
}

function _bindXpProjection(inputSelector, currentXp) {
  return (_event, html) => {
    const HTMLElementClass = globalThis.HTMLElement;
    const root = html?.querySelector
      ? html
      : HTMLElementClass && html instanceof HTMLElementClass
        ? html
        : html?.[0] ?? html?.element ?? null;
    const input = root?.querySelector?.(inputSelector);
    const ledger = root?.querySelector?.("[data-xp-ledger]");
    const projectedElement = root?.querySelector?.("[data-xp-projected]");
    const warning = root?.querySelector?.("[data-xp-debt-warning]");
    if (!input || !projectedElement) return;

    const update = () => {
      const cost = Number(input.value) || 0;
      const projected = (Number(currentXp) || 0) - cost;
      const unit = game.i18n.localize("NEUROSHIMA.XP.Unit");
      projectedElement.innerHTML = `${projected} <small>${unit}</small>`;
      ledger?.classList.toggle("is-debt", projected < 0);
      if (warning) warning.hidden = projected >= 0;
    };
    input.addEventListener("input", update);
    update();
  };
}

function _xpReasonField({ id, label, placeholder, required = false }) {
  return `
    <label class="xp-reason-field" for="${id}">
      <span>${_escapeDialogText(label)}</span>
      <input id="${id}" type="text" ${required ? "required" : ""}
        placeholder="${_escapeDialogText(placeholder)}">
    </label>
  `;
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
  const normalizedCost = Math.max(0, Number(costXp) || 0);
  const content = _xpDialogFrame({
    icon: "fa-coins",
    summary: description,
    body: _xpBalanceStrip({
      currentXp,
      inputId: "xp-cost-input",
      inputLabel: i18n.localize("NEUROSHIMA.XP.Dialog.CostLabel"),
      inputValue: normalizedCost,
      inputMin: 0
    })
  });
  return foundry.applications.api.DialogV2.wait({
    window: { title: i18n.localize("NEUROSHIMA.XP.Dialog.Title") },
    content,
    render: _bindXpProjection("#xp-cost-input", currentXp),
    buttons: [
      {
        action: "spend",
        label: i18n.localize("NEUROSHIMA.XP.Dialog.Spend"),
        icon: "fas fa-coins",
        default: true,
        callback: (event, button, dialog) => {
          const val = Number(dialog.element.querySelector("#xp-cost-input")?.value) || 0;
          return { free: false, cost: Math.max(0, val) };
        }
      },
      {
        action: "free",
        label: i18n.localize("NEUROSHIMA.XP.Dialog.FreeButton"),
        icon: "fas fa-gift",
        callback: () => ({ free: true, cost: 0 })
      }
    ],
    classes: ["neuroshima", "dialog-vertical", "xp-spend-dialog"],
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
  const content = _xpDialogFrame({
    icon: "fa-award",
    summary: i18n.format("NEUROSHIMA.XP.Grant.Amount", { amount }),
    body: _xpReasonField({
      id: "xp-grant-reason",
      label: i18n.localize("NEUROSHIMA.XP.Grant.Reason"),
      placeholder: i18n.localize("NEUROSHIMA.XP.Grant.ReasonPlaceholder")
    })
  });
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
  const content = _xpDialogFrame({
    icon: "fa-file-invoice-dollar",
    summary: i18n.format("NEUROSHIMA.XP.Deduct.Amount", { amount }),
    body: _xpReasonField({
      id: "xp-deduct-reason",
      label: i18n.localize("NEUROSHIMA.XP.Deduct.Reason"),
      placeholder: i18n.localize("NEUROSHIMA.XP.Deduct.ReasonPlaceholder")
    })
  });
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
 * Ask for a mandatory reason when system.xp.spent is changed directly.
 * Positive delta spends XP; negative delta restores previously spent XP.
 */
export async function showXpSpentAdjustmentDialog(delta) {
  const i18n = game.i18n;
  const isSpend = delta > 0;
  const amount = Math.abs(delta);
  const content = _xpDialogFrame({
    icon: isSpend ? "fa-receipt" : "fa-rotate-left",
    summary: i18n.format(
        isSpend ? "NEUROSHIMA.XP.Adjustment.SpendAmount" : "NEUROSHIMA.XP.Adjustment.RestoreAmount",
        { amount }
      ),
    body: _xpReasonField({
      id: "xp-adjustment-reason",
      label: i18n.localize("NEUROSHIMA.XP.Adjustment.Reason"),
      placeholder: i18n.localize("NEUROSHIMA.XP.Adjustment.ReasonPlaceholder")
    })
  });
  const result = await foundry.applications.api.DialogV2.wait({
    window: {
      title: i18n.localize(
        isSpend ? "NEUROSHIMA.XP.Adjustment.SpendTitle" : "NEUROSHIMA.XP.Adjustment.RestoreTitle"
      )
    },
    content,
    buttons: [{
      action: "confirm",
      label: i18n.localize("NEUROSHIMA.XP.Adjustment.Confirm"),
      default: true,
      callback: (event, button, dialog) => {
        const reason = dialog.element.querySelector("#xp-adjustment-reason")?.value?.trim();
        return {
          reason: reason || i18n.localize("NEUROSHIMA.XP.Adjustment.ReasonPlaceholder")
        };
      }
    }],
    classes: ["neuroshima", "dialog-vertical"],
    rejectClose: false
  });
  if (result === null) return null;
  return result;
}

/**
 * Show the shared XP refund dialog for a decreased skill, attribute, or reputation.
 * @param {number} refundAmount  - positive amount being refunded
 * @param {string} description
 * @param {number} currentXp    - current available XP (for display)
 * @returns {Promise<{free: boolean, cost: number}|null>}
 */
export async function showXpRefundDialog(refundAmount, description, currentXp) {
  const i18n = game.i18n;
  const normalizedRefund = -Math.max(0, Number(refundAmount) || 0);
  const content = _xpDialogFrame({
    icon: "fa-rotate-left",
    summary: description,
    body: _xpBalanceStrip({
      currentXp,
      inputId: "xp-refund-input",
      inputLabel: i18n.localize("NEUROSHIMA.XP.Refund.Label"),
      inputValue: normalizedRefund,
      inputMax: 0
    })
  });
  return foundry.applications.api.DialogV2.wait({
    window: { title: i18n.localize("NEUROSHIMA.XP.Refund.DialogTitle") },
    content,
    render: _bindXpProjection("#xp-refund-input", currentXp),
    buttons: [
      {
        action: "refund",
        label: i18n.localize("NEUROSHIMA.XP.Refund.Apply"),
        default: true,
        callback: (event, button, dialog) => {
          const val = Number(dialog.element.querySelector("#xp-refund-input")?.value) || 0;
          return { free: false, cost: val };
        }
      },
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
export function applyXpEntry(
  actor,
  changed,
  costXp,
  description,
  previousValue,
  fieldPath,
  { operation = "spend", documentUuid = "" } = {}
) {
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
    fieldPath,
    operation,
    documentUuid
  };

  const log = foundry.utils.deepClone(sys.xpLog ?? []);
  log.push(entry);
  foundry.utils.setProperty(changed, "system.xpLog", log);

  if (costXp > 0) {
    foundry.utils.setProperty(changed, "system.xp.spent", spent + costXp);
  } else if (costXp < 0) {
    foundry.utils.setProperty(changed, "system.xp.spent", Math.max(0, spent + costXp));
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
    fieldPath:     "system.xp.total",
    operation:     "grant",
    documentUuid:  ""
  };

  const log = foundry.utils.deepClone(sys.xpLog ?? []);
  log.push(entry);
  foundry.utils.setProperty(changed, "system.xpLog", log);
}

/** Apply an exact manual change to system.xp.spent and append its reason to the XP log. */
export function applyXpSpentAdjustment(actor, changed, newSpent, reason) {
  const oldSpent = Number(actor.system.xp?.spent) || 0;
  const total = Number(actor.system.xp?.total) || 0;
  const nextSpent = Math.max(0, Math.round(Number(newSpent) || 0));
  const delta = nextSpent - oldSpent;
  if (delta === 0) return null;

  const entry = {
    id: foundry.utils.randomID(),
    date: new Date().toLocaleDateString("pl-PL"),
    description: String(reason ?? "").trim(),
    cost: delta,
    xpBefore: total - oldSpent,
    xpAfter: total - nextSpent,
    previousValue: oldSpent,
    fieldPath: "system.xp.spent",
    operation: "manualSpent",
    documentUuid: ""
  };
  const log = foundry.utils.deepClone(actor.system.xpLog ?? []);
  log.push(entry);
  foundry.utils.setProperty(changed, "system.xp.spent", nextSpent);
  foundry.utils.setProperty(changed, "system.xpLog", log);
  return entry;
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
  let targetDocument = null;
  let targetCurrentValue;

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
    if (entry.documentUuid) {
      targetDocument = await fromUuid(entry.documentUuid);
      if (!targetDocument) {
        ui.notifications?.warn(game.i18n.localize("NEUROSHIMA.XP.Log.SourceMissing"));
        return;
      }
      targetCurrentValue = foundry.utils.getProperty(targetDocument, entry.fieldPath);
      await targetDocument.update({ [entry.fieldPath]: storedValue });
    } else {
      foundry.utils.setProperty(updateData, entry.fieldPath, storedValue);
    }
  }

  const cost = entry.cost ?? 0;
  const spentXp = sys.xp?.spent ?? 0;
  const spentHandledByField = entry.fieldPath === "system.xp.spent" && !entry.documentUuid;
  const isGrant = entry.operation === "grant" || entry.fieldPath === "system.xp.total";
  if (!spentHandledByField && !isGrant) {
    if (cost > 0) {
      updateData["system.xp.spent"] = Math.max(0, spentXp - cost);
    } else if (cost < 0) {
      updateData["system.xp.spent"] = spentXp + (-cost);
    }
  }

  log.splice(idx, 1);
  updateData["system.xpLog"] = log;

  try {
    await actor.update(updateData, { ns_skip_xp: true });
  } catch (error) {
    if (targetDocument && targetCurrentValue !== undefined) {
      await targetDocument.update({ [entry.fieldPath]: targetCurrentValue });
    }
    throw error;
  }
  game.neuroshima?.log(`XP reverted: ${entry.description}`);
}
