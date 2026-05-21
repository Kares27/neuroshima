import { getConditions } from "../apps/condition-config.js";
import { NeuroshimaBaseActorSheet } from "./actor-sheet-base.js";

export class NeuroshimaHomeBaseSheet extends NeuroshimaBaseActorSheet {
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "sheet", "actor", "actor-home-base"],
    position: { width: 680, height: 700 },
    window: { title: "NEUROSHIMA.Sheet.ActorHomeBase", resizable: true },
    form: { submitOnChange: true, submitOnClose: true, submitOnUnfocus: true },
    actions: {
      editImage: async function(event, target) {
        const fp = new FilePicker({ type: "image", callback: src => this.document.update({ img: src }) });
        fp.browse(this.document.img);
      },
      editResident: async function(event, target) {
        const actor = game.actors.get(target.dataset.actorId);
        if (actor) actor.sheet.render(true);
      },
      removeResident: async function(event, target) {
        const actorId = target.dataset.actorId;
        const residentMembers = this.document.system.residentMembers.filter(m => m.actorId !== actorId);
        await this.document.update({ "system.residentMembers": residentMembers });
      },
      createItem: async function(event, target) {
        const type = target.dataset.type || "gear";
        const typeKey = type.charAt(0).toUpperCase() + type.slice(1);
        const name = game.i18n.localize(`NEUROSHIMA.Items.Type.${typeKey}`) || game.i18n.localize("NEUROSHIMA.NewItem");
        await this.document.createEmbeddedDocuments("Item", [{ name, type }]);
      },
      editItem: async function(event, target) {
        const id = target.dataset.itemId || target.closest("[data-item-id]")?.dataset.itemId;
        this.document.items.get(id)?.sheet.render(true);
      },
      deleteItem: async function(event, target) {
        const id = target.dataset.itemId || target.closest("[data-item-id]")?.dataset.itemId;
        await this.document.items.get(id)?.delete();
      },
      createEffect: async function(event, target) {
        const [effect] = await this.document.createEmbeddedDocuments("ActiveEffect", [{
          name: game.i18n.localize("NEUROSHIMA.Effects.NewEffect"),
          icon: "icons/svg/aura.svg",
          origin: this.document.uuid
        }]);
        effect?.sheet.render(true);
      },
      editEffect: async function(event, target) {
        const row = target.closest(".effect-row");
        const id = row?.dataset.effectId;
        const itemId = row?.dataset.itemId;
        const effect = itemId
          ? this.document.items.get(itemId)?.effects.get(id)
          : this.document.effects.get(id);
        effect?.sheet.render(true);
      },
      deleteEffect: async function(event, target) {
        const row = target.closest(".effect-row");
        if (row?.dataset.itemId) return;
        const id = row?.dataset.effectId;
        await this.document.effects.get(id)?.delete();
      },
      toggleEffect: async function(event, target) {
        const row = target.closest(".effect-row");
        const id = row?.dataset.effectId;
        const itemId = row?.dataset.itemId;
        const effect = itemId
          ? this.document.items.get(itemId)?.effects.get(id)
          : this.document.effects.get(id);
        if (effect) await effect.update({ disabled: !effect.disabled });
      },
      openSource: async function(event, target) {
        const itemId = target.dataset.itemId;
        this.document.items.get(itemId)?.sheet.render(true);
      },
      toggleSummary: function(event, target) {
        const wrap = target.closest(".item-wrap");
        const summary = wrap?.querySelector(".item-summary");
        if (!summary) return;
        summary.classList.toggle("collapsed");
      },
      itemContextMenu: function(event, target) {
        const wrap = target.closest(".item-wrap");
        if (!wrap?.dataset.itemId) return;
        this._showItemContextMenu(event, wrap.dataset.itemId);
      },
      adjustLevel: async function(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        const newLevel = Math.max(0, (item.system.level ?? 0) + 1);
        await item.update({ "system.level": newLevel });
      },
      toggleIsBuilt: async function(event, target) {
        const item = this.document.items.get(target.dataset.itemId);
        if (!item) return;
        await item.update({ "system.isBuilt": !item.system.isBuilt });
      },
      adjustQuantity: async function(event, target) {
        const direction = event.button === 2 ? -1 : 1;
        const el = target.closest("[data-item-id]");
        const item = this.document.items.get(el?.dataset.itemId);
        if (!item || !("quantity" in item.system)) return;
        let amount = 1;
        if ((event.shiftKey) && (event.ctrlKey || event.metaKey)) amount = 1000;
        else if (event.ctrlKey || event.metaKey) amount = 100;
        else if (event.shiftKey) amount = 10;
        const newQuantity = Math.max(0, item.system.quantity + (amount * direction));
        await item.update({ "system.quantity": newQuantity });
      },
      invokeItemScript: async function(event, target) {
        const { itemId, effectId, scriptIndex } = target.dataset;
        const item = this.document.items.get(itemId);
        if (!item) return ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Scripts.NoActor"));
        const effect = item.effects.get(effectId);
        if (!effect) return;
        const { NeuroshimaScriptRunner } = await import("../apps/neuroshima-script-engine.js");
        await NeuroshimaScriptRunner.executeManual(this.document, effect, Number(scriptIndex));
      },

      takeFromContainer: async function(event, target) {
        const actor = this.document;
        const childItemId = target.dataset.itemId ?? target.closest("[data-item-id]")?.dataset.itemId;
        if (!childItemId) return;
        const childItem = actor.items.get(childItemId);
        if (!childItem || !childItem.getFlag("neuroshima", "containerId")) return;
        await childItem.unsetFlag("neuroshima", "containerId");
      }
    },
    dragDrop: [{ dragSelector: ".item[data-item-id]", dropSelector: "form" }]
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "residents",  group: "primary", label: "NEUROSHIMA.HomeBase.Tabs.Residents" },
        { id: "facilities", group: "primary", label: "NEUROSHIMA.HomeBase.Tabs.Facilities" },
        { id: "cargo",      group: "primary", label: "NEUROSHIMA.HomeBase.Tabs.Cargo" },
        { id: "effects",    group: "primary", label: "NEUROSHIMA.Tabs.Effects" },
        { id: "notes",      group: "primary", label: "NEUROSHIMA.Tabs.Notes" }
      ],
      initial: "residents"
    }
  };

  /** @override */
  static PARTS = {
    header:    { template: "systems/neuroshima/templates/actors/home-base/parts/home-base-header.hbs" },
    tabs:      { template: "templates/generic/tab-navigation.hbs" },
    residents: { template: "systems/neuroshima/templates/actors/home-base/parts/home-base-residents.hbs", scrollable: [""] },
    facilities:{ template: "systems/neuroshima/templates/actors/home-base/parts/home-base-facilities.hbs", scrollable: [""] },
    cargo:     { template: "systems/neuroshima/templates/actors/home-base/parts/home-base-cargo.hbs", scrollable: [""] },
    effects:   { template: "systems/neuroshima/templates/actors/home-base/parts/home-base-effects.hbs", scrollable: [""] },
    notes:     { template: "systems/neuroshima/templates/actors/actor/parts/actor-notes.hbs" }
  };

  /** @override */
  async _prepareContext(options) {
    if (!this.tabGroups.primary) {
      this.tabGroups.primary = this.constructor.TABS.primary.initial;
    }

    const context = await super._prepareContext(options);
    const actor   = this.document;
    const system  = actor.system;

    context.actor    = actor;
    context.system   = system;
    context.tabs     = this._getTabs();
    context.owner    = actor.isOwner;
    context.editable = this.isEditable;
    context.isGM     = game.user.isGM;
    this._applyPermissionRestrictions(context);

    context.residentMembers = (system.residentMembers ?? []).map((m) => {
      const raw = m.toObject?.() ?? m;
      const residentActor = game.actors.get(raw.actorId);
      return {
        actorId: raw.actorId,
        name:    residentActor?.name ?? game.i18n.localize("NEUROSHIMA.Unknown"),
        img:     residentActor?.img  ?? "icons/svg/mystery-man.svg"
      };
    });
    context.residentCount = context.residentMembers.length;
    context.residentMax   = system.residents?.max ?? 0;

    const items = actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.facilitiesItems = items.filter(i => i.type === "facilities");
    context.itemManualScripts = this._prepareItemManualScripts(actor);

    const containerChildIds = new Set(
      items.filter(i => i.getFlag("neuroshima", "containerId")).map(i => i.id)
    );
    const topItems = items.filter(i => !containerChildIds.has(i.id));
    const moneyItems = topItems.filter(i => i.type === "money").sort((a, b) => b.system.coinValue - a.system.coinValue);
    context.inventory = {
      containers: items.filter(i => i.type === "container").map(c => {
        const cnt = items.filter(i => i.getFlag("neuroshima", "containerId") === c.id).length;
        const max = c.system.maxItems || 0;
        c.fillPct = max > 0 ? Math.min(100, Math.round(cnt / max * 100)) : 0;
        c.itemCount = cnt;
        return c;
      }),
      weaponsMelee:   topItems.filter(i => i.type === "weapon" && i.system.weaponType === "melee"),
      weaponsRanged:  topItems.filter(i => i.type === "weapon" && i.system.weaponType === "ranged"),
      weaponsThrown:  topItems.filter(i => i.type === "weapon" && (i.system.weaponType === "thrown" || i.system.weaponType === "grenade")),
      armor:          topItems.filter(i => i.type === "armor"),
      gear:           topItems.filter(i => i.type === "gear"),
      ammo:           topItems.filter(i => i.type === "ammo"),
      magazines:      topItems.filter(i => i.type === "magazine").map(m => {
        m.contentsReversed = [...(m.system.contents || [])].reverse();
        return m;
      }),
      money:          moneyItems,
      weaponMods:     topItems.filter(i => i.type === "weapon-mod"),
      armorMods:      topItems.filter(i => i.type === "armor-mod")
    };

    const totalBaseUnits = moneyItems.reduce((sum, i) => sum + (i.system.quantity * i.system.coinValue), 0);
    context.moneyData = {
      totalBaseUnits,
      totalBaseUnitsFormatted: totalBaseUnits.toLocaleString("pl-PL"),
      hasAny: moneyItems.length > 0
    };
    context.currencyDisplayName = game.settings.get("neuroshima", "currencyNameLabel") || "Gamble";

    const encValue = parseFloat(actor.items.reduce((t, i) => t + (parseFloat(i.system?.totalWeight) || 0), 0).toFixed(2));
    const encMax   = Number(system.maxLoad) || 0;
    const encPct   = encMax > 0 ? Math.min(100, (encValue / encMax) * 100) : 0;
    let encColor = "#3a8c3a";
    if (encValue >= encMax) encColor = "#9c2a2a";
    else if (encPct >= 75)  encColor = "#a05800";
    else if (encPct >= 50)  encColor = "#8c8000";
    context.homeBaseEncumbrance = { value: encValue, max: encMax, pct: encPct, color: encColor };

    context.notes = {
      enriched: await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.notes || "", {
        secrets: actor.isOwner,
        async: true,
        relativeTo: actor
      })
    };

    const effectDurationLabel = (e) => e.duration?.rounds ? `${e.duration.rounds}r` : (e.duration?.seconds ? `${e.duration.seconds}s` : "—");
    const isTemporary = (e) => !!(
      e.duration?.rounds || e.duration?.seconds || e.duration?.turns ||
      e.getFlag("neuroshima", "fromAura") || e.getFlag("neuroshima", "fromArea")
    );
    const isConditionEffect = (e) => e.statuses?.size > 0;

    const temporary = [];
    const passive   = [];
    const disabled  = [];

    const pushEffect = (e, itemId, sourceName, sourceIcon, isItemEffect) => {
      const entry = {
        id: e.id,
        itemId: itemId ?? null,
        name: e.name,
        icon: e.img || "icons/svg/aura.svg",
        disabled: e.disabled,
        sourceName,
        sourceIcon,
        durationLabel: effectDurationLabel(e),
        isItemEffect: !!isItemEffect
      };
      if (isConditionEffect(e)) return;
      if (e.disabled) {
        disabled.push(entry);
      } else if (isTemporary(e)) {
        temporary.push(entry);
      } else {
        passive.push(entry);
      }
    };

    for (const e of actor.effects) {
      const fromAura = e.getFlag("neuroshima", "fromAura");
      const fromArea = e.getFlag("neuroshima", "fromArea");
      const sourceActorId = fromAura?.sourceActorId ?? fromArea?.sourceActorId ?? null;
      const sourceActor = sourceActorId ? game.actors.get(sourceActorId) : null;
      pushEffect(e, null, sourceActor?.name ?? actor.name, sourceActor?.img ?? actor.img ?? "icons/svg/mystery-man.svg", false);
    }

    for (const item of actor.items) {
      for (const e of item.effects) {
        const docType      = e.getFlag?.("neuroshima", "documentType")  ?? "actor";
        const transferType = e.getFlag?.("neuroshima", "transferType")  ?? "owningDocument";
        const equipTransfer = e.getFlag?.("neuroshima", "equipTransfer") ?? false;
        if (docType !== "actor" || transferType !== "owningDocument") continue;
        if (equipTransfer) continue;
        pushEffect(e, item.id, item.name, item.img || "icons/svg/item-bag.svg", true);
      }
    }

    context.effects = { temporary, passive, disabled };

    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    const html = this.element;
    html.querySelectorAll('[data-action="adjustQuantity"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const item = this.document.items.get(el.closest("[data-item-id]")?.dataset.itemId);
        if (!item || !("quantity" in item.system)) return;
        let amount = 1;
        if ((event.shiftKey) && (event.ctrlKey || event.metaKey)) amount = 1000;
        else if (event.ctrlKey || event.metaKey) amount = 100;
        else if (event.shiftKey) amount = 10;
        item.update({ "system.quantity": Math.max(0, item.system.quantity - amount) });
      });
    });

    html.querySelectorAll('[data-action="adjustLevel"]').forEach(el => {
      el.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const item = this.document.items.get(el.dataset.itemId);
        if (!item) return;
        item.update({ "system.level": Math.max(0, (item.system.level ?? 0) - 1) });
      });
    });

    html.querySelectorAll('.item-wrap[data-item-id]').forEach(wrap => {
      wrap.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._showItemContextMenu(event, wrap.dataset.itemId);
      });
    });

    html.querySelectorAll('.container-grid-cell[data-item-id]').forEach(cell => {
      cell.addEventListener('dragover', (event) => {
        event.preventDefault();
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => {
        cell.classList.remove('drag-over');
      });
      cell.addEventListener('drop', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        cell.classList.remove('drag-over');
        const containerId = cell.dataset.itemId;
        const container = this.document.items.get(containerId);
        if (!container || container.type !== "container") return;
        if (container.system.locked && !game.user.isGM) return;
        let dragData;
        try { dragData = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (dragData.type !== "Item") return;
        const sourceItem = await fromUuid(dragData.uuid);
        if (!sourceItem || sourceItem.uuid === container.uuid) return;
        const actor = this.document;
        const maxItems = container.system.maxItems;
        if (maxItems > 0) {
          const cnt = actor.items.filter(i => i.getFlag("neuroshima", "containerId") === containerId).length;
          if (cnt >= maxItems) { ui.notifications.warn(game.i18n.localize("NEUROSHIMA.Container.FullWarning")); return; }
        }
        if (sourceItem.actor?.id === actor.id) {
          await sourceItem.setFlag("neuroshima", "containerId", containerId);
        } else {
          const itemData = sourceItem.toObject();
          foundry.utils.setProperty(itemData, "flags.neuroshima.containerId", containerId);
          await actor.createEmbeddedDocuments("Item", [itemData]);
        }
      });
    });
  }

  _showItemContextMenu(event, itemId) {
    event.preventDefault();
    const item = this.document.items.get(itemId);
    if (!item) return;

    document.querySelectorAll('.ns-item-ctx-menu').forEach(el => el.remove());

    const isContainer = item.type === 'container';
    const menuItems = [
      { action: 'edit',      icon: 'fas fa-edit',   label: game.i18n.localize('Edit') },
      { action: 'post',      icon: 'fas fa-comment', label: game.i18n.localize('NEUROSHIMA.ContextMenu.PostToChat') },
      { action: 'duplicate', icon: 'fas fa-copy',    label: game.i18n.localize('NEUROSHIMA.ContextMenu.Duplicate') },
    ];
    if (isContainer && game.user.isGM) {
      const locked = item.system.locked;
      menuItems.push({ action: 'toggleLock', icon: locked ? 'fas fa-lock-open' : 'fas fa-lock', label: game.i18n.localize(locked ? 'NEUROSHIMA.Container.Unlock' : 'NEUROSHIMA.Container.Lock') });
    }
    menuItems.push({ action: 'delete', icon: 'fas fa-trash', label: game.i18n.localize('Delete') });

    const menu = document.createElement('nav');
    menu.className = 'ns-item-ctx-menu context-menu themed theme-dark';
    menu.style.cssText = 'position:fixed;z-index:99999;';
    menu.innerHTML = `<menu class="context-items">${
      menuItems.map(m => `<li class="context-item" data-action="${m.action}"><i class="${m.icon} fa-fw"></i><span>${m.label}</span></li>`).join('')
    }</menu>`;
    document.body.appendChild(menu);

    const x = event.clientX;
    const y = event.clientY;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth)  menu.style.left = `${x - rect.width}px`;
      if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
    });

    menu.querySelectorAll('.context-item').forEach(li => {
      li.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = li.dataset.action;
        if (action === 'edit') item.sheet.render(true);
        else if (action === 'post') {
          const { NeuroshimaChatMessage } = await import("../documents/chat-message.js");
          await NeuroshimaChatMessage.postItemToChat(item, { actor: this.document });
        }
        else if (action === 'duplicate') item.clone({}, { save: true, parent: this.document });
        else if (action === 'toggleLock') item.update({ "system.locked": !item.system.locked });
        else if (action === 'delete') item.deleteDialog();
        menu.remove();
      });
    });

    const sheetEl = this.element;
    const cleanup = () => {
      menu.remove();
      document.removeEventListener('click', onDocClick, { capture: true });
      document.removeEventListener('contextmenu', onDocContext, { capture: true });
      document.removeEventListener('keydown', onEscape);
    };
    const onDocClick = (e) => {
      if (menu.contains(e.target)) return;
      if (sheetEl && sheetEl.contains(e.target)) return;
      cleanup();
    };
    const onDocContext = (e) => {
      if (menu.contains(e.target)) return;
      if (sheetEl && sheetEl.contains(e.target)) return;
      cleanup();
    };
    const onEscape = (e) => { if (e.key === 'Escape') cleanup(); };
    setTimeout(() => {
      document.addEventListener('click', onDocClick, { capture: true });
      document.addEventListener('contextmenu', onDocContext, { capture: true });
      document.addEventListener('keydown', onEscape);
    }, 0);
  }

  /** @override */
  async _onDropItem(event, data) {
    const item = await fromUuid(data.uuid);
    if (!item) return;
    const cargoTypes = ["weapon", "armor", "gear", "ammo", "magazine", "money", "trick", "trait", "facilities", "weapon-mod", "armor-mod", "container"];
    if (cargoTypes.includes(item.type)) {
      return super._onDropItem(event, data);
    }
  }

  /** @override */
  async _onDropActor(event, data) {
    const dropped = await fromUuid(data.uuid);
    if (!dropped) return;
    const existing = this.document.system.residentMembers ?? [];
    if (existing.some(m => (m.toObject?.() ?? m).actorId === dropped.id)) return;
    const residentMembers = existing.map(m => m.toObject?.() ?? m);
    residentMembers.push({ actorId: dropped.id });
    await this.document.update({ "system.residentMembers": residentMembers });
  }

  _prepareItemManualScripts(actor) {
    const map = {};
    for (const item of (actor.items ?? [])) {
      const scripts = [];
      for (const eff of (item.effects ?? [])) {
        if (eff.disabled) continue;
        const flags = eff.system?.scriptData ?? [];
        flags.forEach((s, idx) => {
          if (s.trigger === "manual") {
            scripts.push({
              itemId: item.id,
              effectId: eff.id,
              effectName: eff.name,
              scriptIndex: idx,
              label: s.label || eff.name
            });
          }
        });
      }
      if (scripts.length) map[item.id] = scripts;
    }
    return map;
  }
}
