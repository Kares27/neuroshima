const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Dialog wyboru typu obrony w walce wręcz (ApplicationV2)
 */
export class NeuroshimaMeleeDefenseDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["neuroshima", "dialog", "melee-defense"],
    position: {
      width: 400,
      height: "auto"
    },
    window: {
      title: "NEUROSHIMA.MeleeDefense.Title",
      resizable: false,
      icon: "fas fa-shield-alt"
    },
    form: {
      handler: NeuroshimaMeleeDefenseDialog._onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      close: this.prototype.close
    }
  };

  static PARTS = {
    form: {
      template: "systems/neuroshima/templates/dialog/melee-defense.hbs"
    }
  };

  /**
   * @param {Actor} defender - Broniący się aktor
   * @param {ChatMessage} message - Wiadomość z atakiem lub handlerem
   * @param {Object} options - Opcje dialogu
   */
  constructor(defender, message, options = {}) {
    super(options);
    this.defender = defender;
    this.message = message;
    
    const isHandler = message.getFlag("neuroshima", "messageType") === "opposedHandler";
    const opposedData = isHandler ? message.getFlag("neuroshima", "opposedData") : null;
    this.attackMessage = isHandler ? game.messages.get(opposedData.attackMessageId) : message;
    
    this.window.title = game.i18n.format('NEUROSHIMA.Dialog.MeleeDefenseTitle', {
      name: defender.name
    });
  }

  /** @override */
  async _prepareContext(options) {
    const defenseOptions = NeuroshimaMeleeDefenseDialog._prepareDefenseOptions(this.defender);
    return {
      options: defenseOptions,
      preferredDefense: defenseOptions.preferredDefense
    };
  }

  /**
   * Przygotowuje dostępne opcje obrony dla aktora
   */
  static _prepareDefenseOptions(defender) {
    const system = defender.system;
    const dex = system.attributes.dexterity + (system.modifiers?.dexterity ?? 0);
    
    const options = {
      brawl: {
        available: true,
        stat: dex,
        skill: system.skills?.brawl?.value ?? 0,
        total: dex + (system.skills?.brawl?.value ?? 0),
        label: game.i18n.localize('NEUROSHIMA.Skills.brawl'),
        type: 'brawl'
      },
      melee: {
        available: false,
        stat: dex,
        skill: system.skills?.handWeapon?.value ?? 0,
        total: dex + (system.skills?.handWeapon?.value ?? 0),
        label: game.i18n.localize('NEUROSHIMA.Skills.handWeapon'),
        type: 'melee',
        weapon: null
      },
      dodge: {
        available: true,
        stat: dex,
        skill: system.skills?.dodge?.value ?? 0,
        total: dex + (system.skills?.dodge?.value ?? 0),
        label: game.i18n.localize('NEUROSHIMA.Skills.dodge'),
        type: 'dodge'
      }
    };

    const meleeWeapons = defender.items.filter(i => 
      i.type === 'weapon' && 
      i.system.weaponType === 'melee' &&
      i.system.equipped === true
    );

    if (meleeWeapons.length > 0) {
      options.melee.available = true;
      options.melee.weapon = meleeWeapons[0];
    }

    const sorted = Object.entries(options)
      .filter(([_, opt]) => opt.available)
      .sort((a, b) => b[1].total - a[1].total);
    
    options.preferredDefense = sorted[0]?.[0] ?? 'brawl';

    return options;
  }

  /**
   * Obsługa zatwierdzenia formularza
   */
  static async _onSubmit(event, form, formData) {
    const dialog = this;
    const defenseType = formData.object.defenseType;
    const options = NeuroshimaMeleeDefenseDialog._prepareDefenseOptions(dialog.defender);
    const selectedOpt = options[defenseType];
    
    await NeuroshimaMeleeDefenseDialog._executeDefense(
      dialog.defender,
      dialog.message,
      selectedOpt
    );
  }

  /**
   * Wykonuje rzut obronny
   */
  static async _executeDefense(defender, message, defenseOption) {
    const isHandler = message.getFlag("neuroshima", "messageType") === "opposedHandler";
    const opposedData = isHandler ? message.getFlag("neuroshima", "opposedData") : null;
    const attackMessage = isHandler ? game.messages.get(opposedData.attackMessageId) : message;
    
    const label = game.i18n.format('NEUROSHIMA.Defense.Label', {
      type: defenseOption.label,
      attacker: attackMessage?.getFlag('neuroshima', 'rollData')?.label ?? 'Unknown'
    });

    const mode = opposedData?.mode || game.settings.get("neuroshima", "opposedMeleeMode") || "sp";
    const isOpen = (mode === "sp");

    const defenseMessage = await game.neuroshima.NeuroshimaDice.rollTest({
      stat: defenseOption.stat,
      skill: defenseOption.skill,
      penalties: {
        mod: 0,
        wounds: defender.system.combat?.totalWoundPenalty ?? 0,
        armor: 0
      },
      isOpen,
      isCombat: true,
      label,
      actor: defender
    });

    if (!defenseMessage) return;

    const defenseFlags = defenseMessage.getFlag('neuroshima', 'rollData') ?? {};
    defenseFlags.isDefense = true;
    defenseFlags.defenseType = defenseOption.type;
    defenseFlags.defendingAgainst = attackMessage?.id;
    defenseFlags.messageId = defenseMessage.id;
    
    await defenseMessage.setFlag('neuroshima', 'rollData', defenseFlags);

    if (isHandler) {
      const updatedData = foundry.utils.mergeObject(opposedData, {
          status: "ready",
          defenseMessageId: defenseMessage.id
      });
      
      const attacker = game.actors.get(opposedData.attackerId);
      const template = "systems/neuroshima/templates/chat/opposed-handler.hbs";
      const content = await game.neuroshima.NeuroshimaChatMessage._renderTemplate(template, {
          requestId: opposedData.requestId,
          status: "ready",
          attacker: { name: attacker?.name, img: attacker?.img },
          defender: { name: defender.name, img: defender.img },
          isGM: game.user.isGM
      });

      await message.update({
          content,
          flags: { neuroshima: { opposedData: updatedData } }
      });
    } else {
      await game.neuroshima.NeuroshimaChatMessage.resolveOpposedMelee(attackMessage, defenseMessage);
    }
  }

  static async show(defender, message) {
    const dialog = new NeuroshimaMeleeDefenseDialog(defender, message);
    return dialog.render(true);
  }
}
