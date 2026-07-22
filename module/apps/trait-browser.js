
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TraitBrowserApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "trait-browser",
    tag: "div",
    classes: ["neuroshima", "trait-browser"],
    window: {
      title: "NEUROSHIMA.Traits.Browser.Title",
      resizable: true
    },
    position: {
      width: 480,
      height: 540
    },
    actions: {
      selectTrait: TraitBrowserApp.prototype._onSelectTrait
    }
  };

  static PARTS = {
    main: {
      template: "systems/neuroshima/templates/apps/trait-browser.hbs",
      scrollable: [".trait-list"]
    }
  };

  constructor(options = {}) {
    super(options);
    this._resolve = null;
    this._filter = "";
    this._allTraits = [];
    this._traitCategory = ["origin", "profession"].includes(options.traitCategory)
      ? options.traitCategory
      : null;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);

    const worldTraits = game.items
      .filter(i => i.type === "trait" && (
        !this._traitCategory || (i.system.traitCategory ?? "origin") === this._traitCategory
      ))
      .map(i => ({
        uuid: i.uuid,
        name: i.name,
        img: i.img || "systems/neuroshima/assets/Brain.svg",
        traitCategory: i.system.traitCategory ?? "origin",
        source: game.i18n.localize("NEUROSHIMA.Traits.Browser.World")
      }));

    const compTraits = [];
    for (const pack of game.packs.filter(p => p.metadata.type === "Item")) {
      try {
        const index = await pack.getIndex({ fields: ["name", "type", "img", "system.traitCategory"] });
        for (const entry of index) {
          if (entry.type !== "trait") continue;
          const traitCategory = entry.system?.traitCategory ?? "origin";
          if (this._traitCategory && traitCategory !== this._traitCategory) continue;
          compTraits.push({
            uuid: `Compendium.${pack.collection}.${entry._id}`,
            name: entry.name,
            img: entry.img || "systems/neuroshima/assets/Brain.svg",
            traitCategory,
            source: pack.metadata.label
          });
        }
      } catch(e) {
        game.neuroshima?.log?.(`TraitBrowser: could not load pack ${pack.collection}`, e);
      }
    }

    this._allTraits = [...worldTraits, ...compTraits];

    const filter = this._filter.toLowerCase();
    ctx.traits = filter
      ? this._allTraits.filter(t => t.name.toLowerCase().includes(filter))
      : this._allTraits;
    ctx.filter = this._filter;
    ctx.hasTraits = this._allTraits.length > 0;

    return ctx;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const filterInput = this.element?.querySelector(".trait-filter-input");
    if (filterInput) {
      filterInput.addEventListener("input", (ev) => {
        this._filter = ev.target.value;
        this.render({ parts: ["main"] });
      });
    }
  }

  async _onSelectTrait(event, target) {
    const uuid = target.closest("[data-trait-uuid]")?.dataset.traitUuid;
    if (!uuid) return;
    if (this._resolve) {
      this._resolve(uuid);
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

  static async pick({ traitCategory = null } = {}) {
    return new Promise((resolve) => {
      const browser = new TraitBrowserApp({ traitCategory });
      browser._resolve = resolve;
      browser.render(true);
    });
  }
}
