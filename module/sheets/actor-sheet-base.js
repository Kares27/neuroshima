import { NeuroshimaSkillRollDialog } from "../apps/dialogs/skill-roll-dialog.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * Shared base class for Neuroshima actor sheets.
 *
 * Provides utilities that are identical across NeuroshimaActorSheet,
 * NeuroshimaCreatureSheet, and NeuroshimaVehicleSheet:
 *
 *  - `_getTabs()` — build active-tab map from TABS static config
 *  - `static _showRollDialog(opts)` — open a NeuroshimaSkillRollDialog
 */
export class NeuroshimaBaseActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  _scrollState = {};

  static _SCROLL_SELECTORS = [
    "section.window-content",
    ".skill-table",
    ".paper-doll-scrollable",
    ".wounds-list-container",
    ".inventory",
    ".combat"
  ];

  async _preRender(context, options) {
    await super._preRender(context, options);
    this._scrollState = {};
    if (!this.element) return;
    for (const sel of this.constructor._SCROLL_SELECTORS) {
      const el = this.element.querySelector(sel);
      if (el?.scrollTop > 0) this._scrollState[sel] = el.scrollTop;
    }
    for (const part of this.element.querySelectorAll("[data-application-part]")) {
      if (part.scrollTop > 0) {
        this._scrollState[`part:${part.dataset.applicationPart}`] = part.scrollTop;
      }
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    if (context.isObserverView) {
      this.element.querySelectorAll("input, select, textarea").forEach(el => {
        el.disabled = true;
      });
      this.element.querySelectorAll("[data-action]:not([data-action='editImage']):not([data-action='tab'])").forEach(el => {
        el.style.pointerEvents = "none";
        el.style.opacity = "0.5";
      });
    }

    if (!Object.keys(this._scrollState).length) return;
    const savedState = { ...this._scrollState };
    setTimeout(() => {
      for (const [key, top] of Object.entries(savedState)) {
        let el;
        if (key.startsWith("part:")) {
          el = this.element?.querySelector(`[data-application-part="${key.slice(5)}"]`);
        } else {
          el = this.element?.querySelector(key);
        }
        if (el) el.scrollTop = top;
      }
    }, 0);
  }

  /**
   * Apply permission-level restrictions to the render context.
   * Must be called AFTER `context.tabs` is set.
   * - LIMITED: only the "notes" tab is visible; sets context.isLimitedView
   * - OBSERVER: all tabs visible but no editing; sets context.isObserverView
   */
  _applyPermissionRestrictions(context) {
    const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const userLevel = this.document.getUserLevel(game.user);
    context.isLimitedView = !game.user.isGM && userLevel <= LEVELS.LIMITED;
    context.isObserverView = !game.user.isGM && userLevel === LEVELS.OBSERVER;
    if (context.isLimitedView) {
      const notesTab = "notes";
      this.tabGroups.primary = notesTab;
      context.tabs = this._getTabs();
      for (const id of Object.keys(context.tabs)) {
        if (id !== notesTab) delete context.tabs[id];
      }
    }
  }

  /**
   * Build the tab map expected by HBS templates.
   * Reads `this.constructor.TABS.primary.tabs` and marks the active entry.
   * @returns {object} Map of tabId → tab descriptor with `active` and `cssClass` fields.
   */
  _getTabs() {
    const activeTab = this.tabGroups.primary;
    const tabs = foundry.utils.deepClone(this.constructor.TABS.primary.tabs).reduce((obj, t) => {
      obj[t.id] = t;
      return obj;
    }, {});
    for (const v of Object.values(tabs)) {
      v.active   = activeTab === v.id;
      v.cssClass = v.active ? "active" : "";
    }
    return tabs;
  }

  /**
   * Open a NeuroshimaSkillRollDialog for attribute or skill tests.
   * Shared across character, creature, and vehicle sheets.
   *
   * @param {object}  opts
   * @param {number}  opts.stat              - Attribute value.
   * @param {number}  [opts.skill=0]         - Skill value (0 for attribute-only tests).
   * @param {string}  opts.label             - Localised label shown in the dialog title.
   * @param {Actor}   opts.actor             - The rolling actor.
   * @param {boolean} [opts.isSkill=false]   - True when rolling a skill test.
   * @param {string}  [opts.currentAttribute=""] - Attribute key governing the skill.
   * @param {string}  [opts.skillKey=""]     - Skill key for last-roll persistence.
   * @returns {NeuroshimaSkillRollDialog}
   */
  static async _showRollDialog({ stat, skill = 0, label, actor, isSkill = false, currentAttribute = "", skillKey = "" }) {
    const dialog = new NeuroshimaSkillRollDialog({
      actor,
      stat,
      skill,
      label,
      isSkill,
      skillKey,
      currentAttribute,
      lastRoll: actor?.system?.lastRoll || {}
    });
    dialog.render(true);
    return dialog;
  }

  _getSourceToken() {
    if (this.document.token) return this.document.token.object;
    const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === this.document.id);
    if (tokens.length === 0) return null;
    if (tokens.length === 1) return tokens[0];
    const controlled = tokens.filter(t => t.controlled);
    if (controlled.length > 0) return controlled[0];
    return tokens[0];
  }

  async _waitForTarget(options = {}) {
    const { templateRadius = 0 } = options;
    const actorToken = this._getSourceToken();
    if (!actorToken) {
      ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Notifications.NoActorTokenOnCanvas"));
      return null;
    }

    const body = document.body;
    const originalCursor = body.style.cursor;
    body.style.cursor = "crosshair";

    const snapPos = (x, y) => {
      try {
        if (canvas.grid?.getSnappedPoint)
          return canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
        return { x, y };
      } catch (e) { return { x, y }; }
    };

    let previewObj = null;
    let previewDoc = null;

    if (templateRadius > 0 && canvas?.templates?.preview) {
      try {
        const tplData = {
          t: "circle", user: game.user.id, x: 0, y: 0,
          distance: templateRadius, fillColor: game.user.color ?? "#FF0000"
        };
        previewDoc = new CONFIG.MeasuredTemplate.documentClass(tplData, { parent: canvas.scene });
        previewObj = new CONFIG.MeasuredTemplate.objectClass(previewDoc);
        canvas.templates.preview.addChild(previewObj);
        await previewObj.draw();
        canvas.templates.activate();
      } catch (e) {
        console.warn("Neuroshima | Template preview (waitForTarget) failed:", e);
        previewObj = null;
      }
    }

    const destroyPreview = () => {
      if (previewObj) {
        try { canvas.templates.preview.removeChild(previewObj); previewObj.destroy({ children: true }); } catch (e) {}
        previewObj = null;
      }
      for (const t of Array.from(game.user.targets)) {
        t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
      }
    };

    game.neuroshima.log("_waitForTarget: Starting click capture (window capture)");
    ui.notifications.info(game.i18n.localize("NEUROSHIMA.Notifications.SelectTargetOrPoint"));

    return new Promise((resolve) => {
      let cleanupCalled = false;

      const cleanup = (clearPreview = true) => {
        if (cleanupCalled) return;
        cleanupCalled = true;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mousedown', onMouseDown, { capture: true });
        window.removeEventListener('contextmenu', onContextMenu, { capture: true });
        body.style.cursor = originalCursor;
        if (clearPreview) destroyPreview();
      };

      const onMouseMove = () => {
        if (!previewObj || !canvas?.mousePosition) return;
        const pos = snapPos(canvas.mousePosition.x, canvas.mousePosition.y);
        try { previewDoc.updateSource(pos); previewObj.refresh?.(); } catch (e) {}
        if (previewObj?.shape && canvas?.tokens?.placeables) {
          const gs = canvas.grid?.size ?? 100;
          const inIds = canvas.tokens.placeables
            .filter(t => {
              const td = t.document;
              const cx = td.x + (td.width  * gs) / 2;
              const cy = td.y + (td.height * gs) / 2;
              return previewObj.shape.contains(cx - pos.x, cy - pos.y);
            })
            .map(t => t.id);
          const currentIds = new Set(Array.from(game.user.targets).map(t => t.id));
          for (const t of Array.from(game.user.targets)) {
            if (!inIds.includes(t.id))
              t.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: true });
          }
          for (const id of inIds) {
            if (!currentIds.has(id)) {
              const t = canvas.tokens.get(id);
              if (t) t.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: true });
            }
          }
        }
      };

      const onMouseDown = async (event) => {
        if (event.button !== 0 && event.button !== 2) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (event.button === 2) {
          cleanup(true);
          game.neuroshima.log("_waitForTarget: Selection cancelled by user");
          resolve({ cancelled: true });
          return;
        }

        cleanup(false);

        const worldPos = { x: canvas.mousePosition.x, y: canvas.mousePosition.y };

        const clickedToken = canvas.tokens.placeables.find(t => {
          if (!t.visible) return false;
          const b = t.bounds;
          return worldPos.x >= b.x && worldPos.x <= (b.x + b.width) &&
                 worldPos.y >= b.y && worldPos.y <= (b.y + b.height);
        });

        destroyPreview();

        if (clickedToken) {
          clickedToken.setTarget(true, { releaseOthers: true });
          const distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, clickedToken);
          resolve({ distance, token: clickedToken });
        } else {
          const gridPos = canvas.grid.getCenterPoint
            ? canvas.grid.getCenterPoint({ x: worldPos.x, y: worldPos.y })
            : canvas.grid.getCenter(worldPos.x, worldPos.y);
          const distance = game.neuroshima.NeuroshimaDice.measureDistance(actorToken, gridPos);
          resolve({ distance, point: gridPos });
        }
      };

      const onContextMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      if (previewObj) window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mousedown', onMouseDown, { capture: true });
      window.addEventListener('contextmenu', onContextMenu, { capture: true });

      setTimeout(() => {
        if (!cleanupCalled) {
          cleanup(true);
          resolve(null);
        }
      }, 30000);
    });
  }
}
