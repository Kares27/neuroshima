import { isElement } from "./foundry-compat.js";
/**
 * Build the HTML shown by Foundry when hovering an item image.
 *
 * The description is expected to have already been enriched by TextEditor.
 * Names and image paths are escaped here; the completed tooltip is escaped by
 * Handlebars when it is placed in a data-tooltip-html attribute.
 */
export function buildItemPreviewTooltip(img, name, weight, cost, enrichedDescription = "") {
  if (!img) return "";

  const safeName = Handlebars.escapeExpression(name ?? "");
  const safeImg = Handlebars.escapeExpression(img);
  const wNum = typeof weight === "number" ? weight : parseFloat(weight);
  const cNum = typeof cost === "number" ? cost : parseFloat(cost);
  const hasW = !Number.isNaN(wNum);
  const hasC = !Number.isNaN(cNum);

  let statsHtml = "";
  if (hasW || hasC) {
    const wChip = hasW
      ? `<span class="ns-tip-stat"><i class="fas fa-weight-hanging"></i> ${wNum} kg</span>`
      : "";
    const cFormatted = hasC
      ? (Number.isInteger(cNum)
        ? cNum.toLocaleString("pl-PL")
        : cNum.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      : "";
    const cChip = hasC
      ? `<span class="ns-tip-stat"><i class="fas fa-coins"></i> ${cFormatted}</span>`
      : "";
    statsHtml = `<div class="ns-item-preview-stats">${wChip}${cChip}</div>`;
  }

  const description = String(enrichedDescription ?? "");
  const plainDescription = description
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, "")
    .trim();
  const hasDescription = Boolean(plainDescription)
    || /<(?:img|video|audio|table|ul|ol|blockquote|a)\b/i.test(description);
  const descriptionHtml = hasDescription
    ? `<div class="ns-item-preview-description">${description}</div>`
    : "";

  return `<div class="ns-item-preview"><div class="ns-item-preview-name">${safeName}</div><div class="ns-item-preview-body"><div class="ns-item-preview-image"><img src="${safeImg}" /></div><div class="ns-item-preview-details">${statsHtml}${descriptionHtml}</div></div></div>`;
}

/**
 * Interactive, scrollable rich-tooltip controller.
 *
 * Foundry's transient data-tooltip closes when the pointer leaves its trigger.
 * This controller keeps the preview alive while the pointer moves between the
 * trigger and tooltip, allowing long enriched descriptions to be scrolled.
 *
 * Supported triggers:
 * - data-item-preview-html: inventory item preview;
 * - data-interactive-tooltip-html: generic rich tooltip, including trait choices.
 */
export class InteractiveItemTooltip {
  static #documents = new WeakSet();
  static #element = null;
  static #trigger = null;
  static #closeTimer = null;

  static initialize(document = globalThis.document) {
    if (!document || this.#documents.has(document)) return;
    this.#documents.add(document);
    const window = document.defaultView;
    document.addEventListener("pointerover", this.#onPointerOver.bind(this));
    document.addEventListener("pointerout", this.#onPointerOut.bind(this));
    document.addEventListener("click", this.#onClick.bind(this));
    document.addEventListener("keydown", this.#onKeyDown.bind(this));
    document.addEventListener("scroll", this.#onScroll.bind(this), true);
    window.addEventListener("resize", this.#onResize.bind(this));
    window.visualViewport?.addEventListener("resize", this.#onResize.bind(this));
  }

  static #getElement() {
    const document = this.#trigger?.ownerDocument ?? globalThis.document;
    if (this.#element?.isConnected && this.#element.ownerDocument === document) return this.#element;
    this.#element?.remove();
    const element = document.createElement("aside");
    element.id = "ns-interactive-item-tooltip";
    element.className = "ns-interactive-item-tooltip";
    element.setAttribute("role", "tooltip");
    element.setAttribute("aria-hidden", "true");
    document.body.append(element);
    return (this.#element = element);
  }

  static #onPointerOver(event) {
    const trigger = isElement(event.target)
      ? event.target.closest("[data-item-preview-html], [data-interactive-tooltip-html]")
      : null;
    if (trigger) {
      this.#cancelClose();
      if (trigger !== this.#trigger) this.#show(trigger);
    } else if (this.#element?.contains(event.target)) this.#cancelClose();
  }

  static #onPointerOut(event) {
    const fromTrigger = isElement(event.target)
      ? event.target.closest("[data-item-preview-html], [data-interactive-tooltip-html]")
      : null;
    const fromTooltip = this.#element?.contains(event.target);
    if (!fromTrigger && !fromTooltip) return;
    const destination = event.relatedTarget;
    if (destination?.nodeType != null
      && (this.#element?.contains(destination) || this.#trigger?.contains(destination))) return;
    this.#scheduleClose();
  }

  static #onKeyDown(event) {
    if (event.key === "Escape") this.#hide();
  }

  static #onClick(event) {
    if (
      isElement(event.target)
      && event.target.closest("[data-item-preview-html], [data-interactive-tooltip-html]")
    ) {
      this.#hide();
    }
  }

  static #onScroll(event) {
    if (!this.#trigger || this.#element?.contains(event.target)) return;
    this.#hide();
  }

  static #onResize() {
    this.#hide();
  }

  static #show(trigger) {
    const isGeneric = trigger.hasAttribute("data-interactive-tooltip-html");
    const html = isGeneric
      ? trigger.dataset.interactiveTooltipHtml
      : trigger.dataset.itemPreviewHtml;
    if (!html) return this.#hide();
    this.#cancelClose();
    this.#trigger = trigger;
    const tooltip = this.#getElement();
    tooltip.innerHTML = html;
    tooltip.classList.toggle("is-choice-tooltip", isGeneric);
    tooltip.classList.add("active");
    tooltip.setAttribute("aria-hidden", "false");
    this.#position(
      trigger,
      trigger.dataset.interactiveTooltipDirection
        ?? trigger.dataset.itemPreviewDirection
        ?? "RIGHT"
    );
  }

  static #position(trigger, preferredDirection) {
    const tooltip = this.#getElement();
    const anchor = trigger.getBoundingClientRect();
    const gap = 8;
    const margin = 12;
    const document = trigger.ownerDocument;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const preferLeft = preferredDirection.toUpperCase() === "LEFT";

    tooltip.classList.remove("is-vertically-constrained");
    tooltip.style.removeProperty("max-height");
    tooltip.querySelector(
      ".ns-item-preview-description, .trait-choice-tooltip-description"
    )?.style.removeProperty("max-height");
    let panel = tooltip.getBoundingClientRect();

    const right = anchor.right + gap;
    const leftSide = anchor.left - panel.width - gap;
    const fitsRight = right + panel.width <= viewportWidth - margin;
    const fitsLeft = leftSide >= margin;
    const preferredFits = preferLeft ? fitsLeft : fitsRight;
    const alternateFits = preferLeft ? fitsRight : fitsLeft;
    let left;
    let top;

    if (preferredFits || alternateFits) {
      left = preferredFits ? (preferLeft ? leftSide : right) : (preferLeft ? right : leftSide);
      top = anchor.top + (anchor.height - panel.height) / 2;
      top = Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - panel.height - margin));
    } else {
      // On narrow viewports a clamped horizontal panel would cover its trigger.
      // Prefer the roomier vertical side and shrink only the description region.
      const roomAbove = Math.max(0, anchor.top - gap - margin);
      const roomBelow = Math.max(0, viewportHeight - margin - anchor.bottom - gap);
      const placeBelow = roomBelow >= panel.height || (roomAbove < panel.height && roomBelow >= roomAbove);
      const availableHeight = placeBelow ? roomBelow : roomAbove;
      this.#constrainHeight(availableHeight);
      panel = tooltip.getBoundingClientRect();
      left = anchor.left + (anchor.width - panel.width) / 2;
      left = Math.min(Math.max(left, margin), Math.max(margin, viewportWidth - panel.width - margin));
      top = placeBelow ? anchor.bottom + gap : anchor.top - panel.height - gap;
    }
    Object.assign(tooltip.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
  }

  static #constrainHeight(availableHeight) {
    const tooltip = this.#getElement();
    const description = tooltip.querySelector(
      ".ns-item-preview-description, .trait-choice-tooltip-description"
    );
    const panelHeight = tooltip.getBoundingClientRect().height;
    // This is strictly a shrink operation. Keeping the natural CSS sizing when
    // it already fits preserves the established 260px description maximum.
    if (availableHeight >= panelHeight) return;
    const descriptionHeight = description?.getBoundingClientRect().height ?? 0;
    const fixedHeight = panelHeight - descriptionHeight;
    tooltip.classList.add("is-vertically-constrained");
    tooltip.style.maxHeight = `${Math.max(0, Math.floor(availableHeight))}px`;
    if (!description) return;
    const reducedDescriptionHeight = Math.min(descriptionHeight, Math.floor(availableHeight - fixedHeight));
    description.style.maxHeight = `${Math.max(48, reducedDescriptionHeight)}px`;
  }

  static #scheduleClose() {
    this.#cancelClose();
    this.#closeTimer = window.setTimeout(() => this.#hide(), 180);
  }

  static #cancelClose() {
    if (this.#closeTimer === null) return;
    window.clearTimeout(this.#closeTimer);
    this.#closeTimer = null;
  }

  static #hide() {
    this.#cancelClose();
    this.#trigger = null;
    if (!this.#element) return;
    this.#element.classList.remove("active");
    this.#element.setAttribute("aria-hidden", "true");
    this.#element.replaceChildren();
  }
}
