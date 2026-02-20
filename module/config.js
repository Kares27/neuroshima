const difficulties = {
    easy: { label: "NEUROSHIMA.Difficulty.Easy", mod: 2, min: -20, max: -1 },
    average: { label: "NEUROSHIMA.Difficulty.Average", mod: 0, min: 0, max: 10 },
    problematic: { label: "NEUROSHIMA.Difficulty.Problematic", mod: -2, min: 11, max: 30 },
    hard: { label: "NEUROSHIMA.Difficulty.Hard", mod: -5, min: 31, max: 60 },
    veryHard: { label: "NEUROSHIMA.Difficulty.VeryHard", mod: -8, min: 61, max: 90 },
    damnHard: { label: "NEUROSHIMA.Difficulty.DamnHard", mod: -11, min: 91, max: 120 },
    luck: { label: "NEUROSHIMA.Difficulty.Luck", mod: -15, min: 121, max: 160 },
    masterfull: { label: "NEUROSHIMA.Difficulty.Masterfull", mod: -20, min: 161, max: 200 },
    grandmasterfull: { label: "NEUROSHIMA.Difficulty.Grandmasterfull", mod: -24, min: 201, max: 240 }
};

const bodyLocations = {
    head: { 
        label: "NEUROSHIMA.Location.Head", 
        roll: [1, 2], 
        modifiers: { ranged: 80, melee: 80 } 
    },
    rightArm: { 
        label: "NEUROSHIMA.Location.RightArm", 
        roll: [3, 4], 
        modifiers: { ranged: 60, melee: 40 } 
    },
    leftArm: { 
        label: "NEUROSHIMA.Location.LeftArm", 
        roll: [5, 6], 
        modifiers: { ranged: 60, melee: 40 } 
    },
    torso: { 
        label: "NEUROSHIMA.Location.Torso", 
        roll: [7, 16], 
        modifiers: { ranged: 20, melee: 60 } 
    },
    rightLeg: { 
        label: "NEUROSHIMA.Location.RightLeg", 
        roll: [17, 18], 
        modifiers: { ranged: 40, melee: 40 } 
    },
    leftLeg: { 
        label: "NEUROSHIMA.Location.LeftLeg", 
        roll: [19, 20], 
        modifiers: { ranged: 40, melee: 40 } 
    }
};

export const NEUROSHIMA = {
    difficulties: difficulties,
    attributes: {
        
        dexterity: { label: "NEUROSHIMA.Attributes.Dexterity", abbr: "NEUROSHIMA.Attributes.Abbr.Dexterity" },
        perception: { label: "NEUROSHIMA.Attributes.Perception", abbr: "NEUROSHIMA.Attributes.Abbr.Perception" },
        charisma: { label: "NEUROSHIMA.Attributes.Charisma", abbr: "NEUROSHIMA.Attributes.Abbr.Charisma" },
        cleverness: { label: "NEUROSHIMA.Attributes.Cleverness", abbr: "NEUROSHIMA.Attributes.Abbr.Cleverness" },
        constitution: { label: "NEUROSHIMA.Attributes.Constitution", abbr: "NEUROSHIMA.Attributes.Abbr.Constitution" }
    },
    bodyLocations: bodyLocations,
    // Helper accessors for backward compatibility or ease of use
    get locations() {
        return Object.entries(bodyLocations).reduce((obj, [key, data]) => {
            obj[key] = data.label;
            return obj;
        }, {});
    },
    skillConfiguration: {
        dexterity: {
            melee: ["brawl", "handWeapon", "throwing"],
            firearms: ["pistols", "rifles", "machineGuns"],
            ranged: ["bow", "crossbow", "sling"],
            driving: ["car", "truck", "motorcycle"],
            manual: ["pickpocketing", "sleightOfHand", "lockpicking"]
        },
        perception: {
            tracking: ["directionSense", "tracking", "traps"],
            alertness: ["listening", "spotting", "vigilance"],
            stealth: ["sneaking", "hiding", "camouflage"],
            survival: ["hunting", "waterGathering", "terrainKnowledge"]
        },
        charisma: {
            negotiation: ["persuasion", "intimidation", "leadership"],
            empathy: ["emotionPerception", "bluff", "animalCare"],
            willpower: ["painResistance", "steadfastness", "morale"]
        },
        cleverness: {
            medicine: ["woundTreatment", "diseaseTreatment", "firstAid"],
            technology: ["mechanics", "electronics", "computers"],
            equipment: ["heavyMachinery", "combatVehicles", "boats"],
            pyrotechnics: ["gunsmithing", "launchers", "explosives"],
            generalKnowledge1: ["knowledge1", "knowledge2", "knowledge3"],
            generalKnowledge2: ["knowledge4", "knowledge5", "knowledge6"]
        },
        constitution: {
            fitness: ["swimming", "climbing", "stamina"],
            riding: ["horseRiding", "drivingCarriage", "taming"]
        }
    },
    damageTypes: {
        "D": "NEUROSHIMA.Damage.D",
        "L": "NEUROSHIMA.Damage.L",
        "C": "NEUROSHIMA.Damage.C",
        "K": "NEUROSHIMA.Damage.K",
        "sD": "NEUROSHIMA.Damage.sD",
        "sL": "NEUROSHIMA.Damage.sL",
        "sC": "NEUROSHIMA.Damage.sC",
        "sK": "NEUROSHIMA.Damage.sK"
    },
    woundConfiguration: {
        "D": {
            label: "NEUROSHIMA.Damage.D",
            fullLabel: "NEUROSHIMA.Damage.Full.D",
            difficulty: difficulties.average,
            penalties: [5, 10],
            damagePoints: 1,
            isBruise: false
        },
        "L": {
            label: "NEUROSHIMA.Damage.L",
            fullLabel: "NEUROSHIMA.Damage.Full.L",
            difficulty: difficulties.problematic,
            penalties: [15, 30],
            damagePoints: 3,
            isBruise: false
        },
        "C": {
            label: "NEUROSHIMA.Damage.C",
            fullLabel: "NEUROSHIMA.Damage.Full.C",
            difficulty: difficulties.hard,
            penalties: [30, 60],
            damagePoints: 9,
            isBruise: false
        },
        "K": {
            label: "NEUROSHIMA.Damage.K",
            fullLabel: "NEUROSHIMA.Damage.Full.K",
            difficulty: null,
            penalties: [160],
            damagePoints: 27,
            isBruise: false
        },
        "sD": {
            label: "NEUROSHIMA.Damage.sD",
            fullLabel: "NEUROSHIMA.Damage.Full.sD",
            difficulty: difficulties.average,
            penalties: [5, 10],
            damagePoints: 1,
            isBruise: true
        },
        "sL": {
            label: "NEUROSHIMA.Damage.sL",
            fullLabel: "NEUROSHIMA.Damage.Full.sL",
            difficulty: difficulties.problematic,
            penalties: [15, 30],
            damagePoints: 3,
            isBruise: true
        },
        "sC": {
            label: "NEUROSHIMA.Damage.sC",
            fullLabel: "NEUROSHIMA.Damage.Full.sC",
            difficulty: difficulties.hard,
            penalties: [30, 60],
            damagePoints: 9,
            isBruise: true
        },
        "sK": {
            label: "NEUROSHIMA.Damage.sK",
            fullLabel: "NEUROSHIMA.Damage.Full.sK",
            difficulty: null,
            penalties: [160],
            damagePoints: 27,
            isBruise: true
        }
    },
    weaponSubtypes: {
        ranged: {
            pistols: "NEUROSHIMA.WeaponSubtype.pistols",
            submachineRifles: "NEUROSHIMA.WeaponSubtype.submachineRifles",
            rifles: "NEUROSHIMA.WeaponSubtype.rifles",
            sniperRifles: "NEUROSHIMA.WeaponSubtype.sniperRifles",
            shotguns: "NEUROSHIMA.WeaponSubtype.shotguns"
        }
    },
    burstLabels: [
        "NEUROSHIMA.Roll.BurstSingle",
        "NEUROSHIMA.Roll.BurstShort",
        "NEUROSHIMA.Roll.BurstLong",
        "NEUROSHIMA.Roll.BurstFull"
    ]
};
