/**
 * Presentation and roll-dialog utilities.
 *
 * Test construction, rolling, evaluation, recalculation and side effects live
 * exclusively in `module/tests.mjs`.
 */
export class NeuroshimaDice {
  static measureDistance(first, second) {
    if (!first || !second) return 0;
    let a = first.center || first;
    let b = second.center || second;
    if (Array.isArray(a)) a = { x: a[0], y: a[1] };
    if (Array.isArray(b)) b = { x: b[0], y: b[1] };
    try {
      return canvas.grid.measurePath([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]).distance;
    } catch (_error) {
      const pixels = Math.hypot(b.x - a.x, b.y - a.y);
      return pixels / (canvas.grid.size || 100) * (canvas.grid.distance || 2);
    }
  }

  static _groupHitsData(rollData) {
    const hits = rollData?.hitBulletsData ?? [];
    if (!hits.length) return;
    const damage = new Map();
    const piercing = new Map();
    for (const hit of hits) {
      damage.set(hit.damage, (damage.get(hit.damage) ?? 0) + (hit.isPellet ? hit.successPoints || 1 : 1));
      piercing.set(hit.piercing, (piercing.get(hit.piercing) ?? 0) + 1);
    }
    const woundCount = [...damage.values()].reduce((sum, count) => sum + count, 0);
    rollData.damage = [...damage].map(([type, count]) => woundCount > 1 ? `${count}x${type}` : type).join(", ");
    rollData.piercing = [...piercing].map(([value, count]) => hits.length > 1 ? `${count}x${value}` : value).join(", ");
    rollData.isPellet = hits.some(hit => hit.isPellet);
  }

  static buildDiceTooltipHtml(data) {
    if (!data?.modifiedResults?.length) return "";
    const dice = data.modifiedResults.map((die, index) => {
      const classes = [die.isSuccess ? "success" : "failure", die.ignored ? "ignored" : ""].filter(Boolean).join(" ");
      return `<div class="die-result ${classes}"><span>D${index + 1}</span><strong>${die.original}</strong>${die.modified !== die.original ? ` → <strong>${die.modified}</strong>` : ""}</div>`;
    }).join("");
    return `<div class="neuroshima roll-card tooltip-inline"><div class="dice-results-grid">${dice}</div><footer class="roll-outcome"><strong>${game.i18n.localize("NEUROSHIMA.Roll.Target")}:</strong> ${data.target ?? 0}</footer></div>`;
  }

}
