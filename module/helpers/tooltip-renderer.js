/**
 * Shared renderer for rich Neuroshima tooltips.
 *
 * Dynamic labels and document names are escaped here so every caller can pass
 * ordinary strings without having to build HTML fragments itself.
 */

const TOOLTIP_STATES = new Set(["penalty", "bonus", "success", "failure", "ignored"]);

export function escapeTooltipHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

export function signedTooltipValue(value) {
  const number = Number(value ?? 0);
  return number >= 0 ? `+${number}` : String(number);
}

function localize(value) {
  if (value === null || value === undefined) return "";
  return globalThis.game?.i18n?.localize?.(value) ?? String(value);
}

/**
 * Render one compact "field dossier" panel.
 *
 * Threshold/summary sections are always moved to the bottom, regardless of
 * the order in which domain test classes append their sections.
 */
export function renderTooltipSections(sections = []) {
  const visibleSections = sections.filter(section => section?.rows?.length);
  const orderedSections = [
    ...visibleSections.filter(section => section.kind !== "threshold"),
    ...visibleSections.filter(section => section.kind === "threshold")
  ];
  const renderedSections = orderedSections.map((section, sectionIndex) => {
    const sectionClasses = ["ns-roll-tooltip__section"];
    if (section.kind === "threshold") sectionClasses.push("ns-roll-tooltip__section--threshold");
    const rows = section.rows.map(row => {
      const rowClasses = ["ns-roll-tooltip__row"];
      if (TOOLTIP_STATES.has(row.state)) rowClasses.push(`is-${row.state}`);
      if (row.emphasis === true) rowClasses.push("is-emphasized");
      if (row.indent === true) rowClasses.push("is-subrow");
      const value = row.signed ? signedTooltipValue(row.value) : row.value;
      const suffix = row.suffix ?? "";
      return [
        `<div class="${rowClasses.join(" ")}">`,
        `<dt class="ns-roll-tooltip__label">${escapeTooltipHtml(localize(row.label))}</dt>`,
        `<dd class="ns-roll-tooltip__value">${escapeTooltipHtml(value)}${escapeTooltipHtml(suffix)}</dd>`,
        "</div>"
      ].join("");
    }).join("");
    const header = section.kind === "threshold" ? "" : [
      '<header class="ns-roll-tooltip__section-header">',
      `<span class="ns-roll-tooltip__section-number">${String(sectionIndex + 1).padStart(2, "0")}</span>`,
      `<h3 class="ns-roll-tooltip__section-title">${escapeTooltipHtml(localize(section.title))}</h3>`,
      "</header>"
    ].join("");
    return [
      `<section class="${sectionClasses.join(" ")}">`,
      header,
      `<dl class="ns-roll-tooltip__rows">${rows}</dl>`,
      "</section>"
    ].join("");
  }).join("");
  return `<div class="ns-roll-tooltip">${renderedSections}</div>`;
}

/**
 * Render a value breakdown with named effect/item/script sources.
 */
export function buildBreakdownTooltip({
  title = "NEUROSHIMA.Tooltip.EffectsSection",
  baseLabel = "NEUROSHIMA.Tooltip.BaseValue",
  baseValue = null,
  sources = [],
  totalLabel = "NEUROSHIMA.Roll.Total",
  totalValue = null,
  suffix = ""
} = {}) {
  const normalizedSources = (sources ?? [])
    .map(source => ({
      label: source?.label ?? source?.name ?? "?",
      value: source?.value,
      suffix: source?.suffix ?? suffix,
      signed: source?.signed,
      state: source?.state
    }))
    .filter(source => source.value !== null && source.value !== undefined && source.value !== "");
  if (!normalizedSources.length) return "";

  const rows = [];
  if (baseValue !== null && baseValue !== undefined) {
    rows.push({ label: baseLabel, value: baseValue, suffix });
  }
  for (const source of normalizedSources) {
    const numericValue = Number(source.value);
    rows.push({
      label: source.label,
      value: Number.isFinite(numericValue) ? numericValue : source.value,
      signed: source.signed ?? Number.isFinite(numericValue),
      suffix: source.suffix,
      indent: true,
      state: source.state ?? (Number.isFinite(numericValue)
        ? (numericValue > 0 ? "bonus" : numericValue < 0 ? "penalty" : null)
        : null)
    });
  }

  const sections = [{ title, rows }];
  if (totalValue !== null && totalValue !== undefined) {
    sections.push({
      kind: "threshold",
      rows: [{ label: totalLabel, value: totalValue, suffix, emphasis: true }]
    });
  }
  return renderTooltipSections(sections);
}

/**
 * Wrap sanitized Foundry HTML (for example an HTMLField description) in the
 * same dossier frame as numeric breakdowns. Callers must only pass content
 * that has already gone through Foundry's document-field sanitization.
 */
export function buildRichTextTooltip({ title, html } = {}) {
  if (!html) return "";
  return [
    '<div class="ns-roll-tooltip">',
    '<section class="ns-roll-tooltip__section">',
    '<header class="ns-roll-tooltip__section-header">',
    '<span class="ns-roll-tooltip__section-number">01</span>',
    `<h3 class="ns-roll-tooltip__section-title">${escapeTooltipHtml(localize(title))}</h3>`,
    "</header>",
    `<div class="ns-roll-tooltip__content">${String(html)}</div>`,
    "</section>",
    "</div>"
  ].join("");
}

/**
 * Resolve tooltip visibility for single-actor and aggregate chat reports.
 * Pain reports store actorId directly, while ordinary tests keep it in the
 * serialized test and grenade reports may reference several actors.
 */
export function canViewRollTooltip({
  message,
  user,
  actors,
  minRole = 0,
  ownerVisibility = false
} = {}) {
  if ((user?.role ?? 0) >= minRole) return true;
  if (!ownerVisibility) return false;
  if (user?.isGM) return true;

  const flags = message?.flags?.neuroshima ?? {};
  const actorIds = [
    flags.test?.result?.actorId,
    flags.actorId,
    ...(flags.actorDamages ?? []).map(entry => entry?.actorId)
  ].filter(Boolean);
  return [...new Set(actorIds)]
    .map(actorId => actors?.get?.(actorId))
    .filter(Boolean)
    .some(actor => actor.isOwner);
}

/**
 * Collect changes from the effects Foundry actually applied to a Document.
 * `appliedEffects` is authoritative for transferred effects; the older
 * embedded collections remain a compatibility fallback.
 */
function getDocumentEffectCandidates(document) {
  const applicable = typeof document?.allApplicableEffects === "function"
    ? Array.from(document.allApplicableEffects())
    : [];
  if (applicable.length) return applicable;

  const applied = Array.from(document?.appliedEffects ?? []);
  if (applied.length) return applied;

  return [
    ...Array.from(document?.effects ?? []),
    ...Array.from(document?.items ?? []).flatMap(item => Array.from(item?.effects ?? []))
  ];
}

function collectEffectSources(document, targetKeys, matchChange) {
  const keys = new Set(targetKeys);
  const result = Object.fromEntries(targetKeys.map(key => [key, []]));
  const candidates = getDocumentEffectCandidates(document);
  const seen = new Set();
  const addMode = globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;

  for (const candidate of candidates) {
    const effect = Array.isArray(candidate) && candidate.length === 2
      ? candidate[1]
      : candidate;
    if (!effect || effect.disabled || effect.isSuppressed) continue;
    const identity = effect.uuid
      ?? `${effect.parent?.uuid ?? effect.origin ?? "effect"}:${effect.id ?? effect.name ?? "?"}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    for (const change of effect.changes ?? []) {
      const key = matchChange(String(change.key ?? ""));
      if (!key || !keys.has(key)) continue;
      const value = Number(change.value);
      if (!Number.isFinite(value)) continue;
      const mode = Number(change.mode);
      result[key].push({
        label: effect.name ?? effect.label ?? effect.parent?.name ?? "?",
        value,
        signed: !Number.isFinite(mode) || mode === addMode,
        mode
      });
    }
  }
  return result;
}

export function collectAttributeEffectSources(actor, attributeKeys = []) {
  return collectEffectSources(actor, attributeKeys, path => path.match(
    /^system\.(?:attributeBonuses|bonuses|attributes|modifiers|attributeTotals)\.(\w+)$/
  )?.[1]);
}

export function collectSkillEffectSources(actor, skillKeys = []) {
  return collectEffectSources(actor, skillKeys, path => (
    path.match(/^system\.skillBonuses\.(\w+)$/)?.[1]
    ?? path.match(/^system\.skills\.(\w+)\.value$/)?.[1]
    ?? path.match(/^system\.skillTotals\.(\w+)$/)?.[1]
  ));
}

/**
 * Collect Active Effect changes for exact document paths. This is used by
 * fields which do not belong to the attribute/skill key families, including
 * Actor fame bonuses and the value of an embedded reputation Item.
 */
export function collectDocumentEffectSources(document, fieldPaths = []) {
  return collectEffectSources(
    document,
    fieldPaths,
    path => fieldPaths.includes(path) ? path : null
  );
}
