
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TraitChoiceDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["neuroshima", "trait-choice-dialog"],
    position: { width: 460, height: "auto" },
    window: {
      resizable: false,
      minimizable: false
    },
    actions: {
      selectTrait:  TraitChoiceDialog.prototype._onSelectTrait,
      confirmTrait: TraitChoiceDialog.prototype._onConfirmTrait,
      cancelTrait:  TraitChoiceDialog.prototype._onCancelTrait
    }
  };

  static PARTS = {
    main: {
      template: "systems/neuroshima/templates/apps/trait-choice-dialog.hbs"
    }
  };

  constructor(options = {}) {
    super(options);
    this._traits       = options.traits  ?? [];
    this._prompt       = options.prompt  ?? "";
    this._actor        = options.actor   ?? null;
    this._selectedIdx  = 0;
    this._resolve      = null;
  }

  get title() {
    return game.i18n.localize("NEUROSHIMA.Traits.ChooseTraitDialog");
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.prompt = this._prompt;
    const actorRollData = this._actor?.getRollData() ?? {};
    ctx.traits = await Promise.all(this._traits.map(async (t, idx) => {
      const traitItem = t.item;
      const name = traitItem.name;
      const img = traitItem.img || "systems/neuroshima/assets/Brain.svg";
      const description = traitItem.system?.description?.trim()
        ? await foundry.applications.ux.TextEditor.enrichHTML(traitItem.system.description, {
            async: true,
            secrets: traitItem.isOwner,
            rollData: {
              ...traitItem.getRollData(),
              actor: actorRollData
            },
            relativeTo: traitItem
          })
        : `<p class="trait-choice-tooltip-empty">${foundry.utils.escapeHTML(game.i18n.localize("NEUROSHIMA.Traits.NoDescription"))}</p>`;

      const safeName = foundry.utils.escapeHTML(name);
      const safeImg = foundry.utils.escapeHTML(img);
      const tooltipHtml = `
        <article class="trait-choice-tooltip">
          <header class="trait-choice-tooltip-header">
            <img src="${safeImg}" alt="">
            <strong>${safeName}</strong>
          </header>
          <div class="trait-choice-tooltip-description">${description}</div>
        </article>`;

      return {
        uuid: t.uuid,
        name,
        img,
        tooltipHtml,
        isSelected: idx === this._selectedIdx
      };
    }));
    return ctx;
  }

  async _onSelectTrait(event, target) {
    const row = target.closest("[data-trait-idx]");
    if (!row) return;
    const idx = parseInt(row.dataset.traitIdx ?? "0");
    this._selectedIdx = idx;

    const rows = this.element.querySelectorAll(".trait-choice-row");
    rows.forEach((r, i) => {
      const isSelected = i === this._selectedIdx;
      r.classList.toggle("selected", isSelected);
      r.querySelector(".trait-choice-cb")?.classList.toggle("checked", isSelected);
    });
  }

  async _onConfirmTrait() {
    const trait = this._traits[this._selectedIdx];
    if (this._resolve) {
      this._resolve(trait?.uuid ?? null);
      this._resolve = null;
    }
    this.close();
  }

  async _onCancelTrait() {
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
    }
    this.close();
  }

  async close(options = {}) {
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
    }
    return super.close(options);
  }

  static async wait(traits, prompt, actor = null) {
    return new Promise(resolve => {
      const dialog = new TraitChoiceDialog({ traits, prompt, actor });
      dialog._resolve = resolve;
      dialog.render(true);
    });
  }
}
