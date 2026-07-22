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
