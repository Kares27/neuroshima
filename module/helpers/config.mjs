export const NEUROSHIMA = {};

/**
 * Atrybuty systemu
 */
NEUROSHIMA.attributes = {
  "zr": "Zręczność",
  "pc": "Percepcja", 
  "ch": "Charyzma",
  "sp": "Spryt",
  "bd": "Budowa"
};

/**
 * Kategorie umiejętności
 */
NEUROSHIMA.skillCategories = {
  "zr": {
    "walka_wrecz": "Walka Wręcz",
    "bron_strzelecka": "Broń Strzelecka", 
    "bron_dystansowa": "Broń Dystansowa",
    "prowadzenie_pojazdow": "Prowadzenie Pojazdów",
    "zdolnosci_manualne": "Zdolności Manualne"
  },
  "pc": {
    "orientacja_w_terenie": "Orientacja w terenie",
    "spostrzegawczosc": "Spostrzegawczość",
    "kamuflaz": "Kamuflaż", 
    "przetrwanie": "Przetrwanie"
  },
  "ch": {
    "negocjacje": "Negocjacje",
    "empatia": "Empatia",
    "sila_woli": "Siła woli"
  },
  "sp": {
    "medycyna": "Medycyna",
    "technika": "Technika",
    "sprzet": "Sprzęt",
    "pirotechnika": "Pirotechnika",
    "wiedza1": "Wiedza ogólna",
    "wiedza2": "Wiedza ogólna"
  },
  "bd": {
    "sprawnosc": "Sprawność",
    "jezdictwo": "Jeździectwo"
  }
};

/**
 * Umiejętności podzielone według atrybutów i kategorii
 */
NEUROSHIMA.skills = {
  "zr": {
    "walka_wrecz": {
      "bijatyka": "Bijatyka",
      "bron_reczna": "Broń Ręczna", 
      "rzucanie": "Rzucanie"
    },
    "bron_strzelecka": {
      "pistolety": "Pistolety",
      "karabiny": "Karabiny",
      "bron_maszynowa": "Broń Maszynowa"
    },
    "bron_dystansowa": {
      "luk": "Łuk",
      "kusza": "Kusza",
      "proca": "Proca"
    },
    "prowadzenie_pojazdow": {
      "samochod": "Samochód",
      "ciezarowka": "Ciężarówka",
      "motocykl": "Motocykl"
    },
    "zdolnosci_manualne": {
      "kradziez_kieszonkowa": "Kradzież k-sznk.",
      "zwinne_dlonie": "Zwinne Dłonie",
      "otwieranie_zamkow": "Otwn. zamków"
    }
  },
  "pc": {
    "orientacja_w_terenie": {
      "wyczucie_kierunku": "Wyczucie kierunku",
      "tropienie": "Tropienie",
      "przygotowanie_pulapki": "Przygotowanie pułapki"
    },
    "spostrzegawczosc": {
      "nasluchiwanie": "Nasłuchiwanie",
      "wypatrywanie": "Wypatrywanie",
      "czujnosc": "Czujność"
    },
    "kamuflaz": {
      "skradanie_sie": "Skradanie się",
      "ukrywanie_sie": "Ukrywanie się",
      "maskowanie": "Maskowanie"
    },
    "przetrwanie": {
      "lowiectwo": "Łowiectwo",
      "zdobywanie_wody": "Zdobywanie wody",
      "znajomosc_terenu": "Znajomość terenu"
    }
  },
  "ch": {
    "negocjacje": {
      "perswazja": "Perswazja",
      "zastraszanie": "Zastraszanie",
      "zdolnosci_przywodcze": "Zdolności przywódcze"
    },
    "empatia": {
      "postrzeganie_emocji": "Postrzeganie emocji",
      "blef": "Blef",
      "opieka_nad_zwierzetami": "Opieka nad zwierzętami"
    },
    "sila_woli": {
      "odpornosc_na_bol": "Odporność na ból",
      "niezlomnosc": "Niezłomność",
      "morale": "Morale"
    }
  },
  "sp": {
    "medycyna": {
      "leczenie_ran": "Leczenie ran",
      "leczenie_chorob": "Leczenie chorób",
      "pierwsza_pomoc": "Pierwsza pomoc"
    },
    "technika": {
      "mechanika": "Mechanika",
      "elektronika": "Elektronika",
      "komputery": "Komputery"
    },
    "sprzet": {
      "maszyny_ciezkie": "Maszyny ciężkie",
      "wozy_bojowe": "Wozy bojowe",
      "kutry": "Kutry"
    },
    "pirotechnika": {
      "rusznikarstwo": "Rusznikarstwo",
      "wyrzutnie": "Wyrzutnie",
      "materialy_wybuchowe": "Materiały wybuchowe"
    },
    "wiedza1": {
      "poziom1": "Test wiedzy#1",
      "poziom2": "Test wiedzy#2", 
      "poziom3": "Test wiedzy#3"
    },
    "wiedza2": {
      "poziom4": "Test wiedzy#4",
      "poziom5": "Test wiedzy#5",
      "poziom6": "Test wiedzy#6"
    }
  },
  "bd": {
    "sprawnosc": {
      "plywanie": "Pływanie",
      "wspinaczka": "Wspinaczka",
      "kondycja": "Kondycja"
    },
    "jezdictwo": {
      "jazda_konna": "Jazda konna",
      "powodzenie": "Powodzenie",
      "ujezdzanie": "Ujeżdżanie"
    }
  }
};

/**
 * Poziomy trudności
 */
NEUROSHIMA.difficultyLevels = {
  "latwy": {
    "name": "Łatwy",
    "percentage": "< 0%",
    "modifier": 2
  },
  "przecietny": {
    "name": "Przeciętny", 
    "percentage": "0 - 10%",
    "modifier": 0
  },
  "problematyczny": {
    "name": "Problematyczny",
    "percentage": "11 - 30%",
    "modifier": -2
  },
  "trudny": {
    "name": "Trudny",
    "percentage": "31 - 60%", 
    "modifier": -5
  },
  "bardzo_trudny": {
    "name": "Bardzo Trudny",
    "percentage": "61 - 90%",
    "modifier": -8
  },
  "cholernie_trudny": {
    "name": "Cholernie Trudny",
    "percentage": "91 - 120%",
    "modifier": -11
  },
  "fart": {
    "name": "Fart",
    "percentage": "121 - ...%",
    "modifier": -15
  }
};

/**
 * Lokacje trafienia dla ataków
 */
NEUROSHIMA.hitLocations = {
  "random": {
    "name": "Losuj lokację",
    "meleeModifier": 0,
    "rangedModifier": 0
  },
  "head": {
    "name": "Głowa",
    "meleeModifier": 80,
    "rangedModifier": 80,
    "diceRange": [1, 2]
  },
  "rightArm": {
    "name": "Prawa Ręka",
    "meleeModifier": 40,
    "rangedModifier": 60,
    "diceRange": [3, 4]
  },
  "leftArm": {
    "name": "Lewa Ręka",
    "meleeModifier": 40,
    "rangedModifier": 60,
    "diceRange": [5, 6]
  },
  "torso": {
    "name": "Tułów",
    "meleeModifier": 60,
    "rangedModifier": 20,
    "diceRange": [7, 16]
  },
  "rightLeg": {
    "name": "Prawa Noga",
    "meleeModifier": 40,
    "rangedModifier": 40,
    "diceRange": [17, 18]
  },
  "leftLeg": {
    "name": "Lewa Noga",
    "meleeModifier": 40,
    "rangedModifier": 40,
    "diceRange": [19, 20]
  }
};

/**
 * Typy obrażeń (damage types)
 * Każdy typ ma nazwę, wartość punktów obrażeń i czy jest siniakiem
 */
NEUROSHIMA.damageTypes = {
  "D": {
    "name": "Draśnięcie",
    "label": "D - Draśnięcie",
    "points": 1,
    "isBruise": false
  },
  "sD": {
    "name": "Draśnięcie (Siniak)",
    "label": "sD - Draśnięcie (Siniak)",
    "points": 1,
    "isBruise": true
  },
  "L": {
    "name": "Lekkie",
    "label": "L - Lekkie",
    "points": 3,
    "isBruise": false
  },
  "sL": {
    "name": "Lekkie (Siniak)",
    "label": "sL - Lekkie (Siniak)",
    "points": 3,
    "isBruise": true
  },
  "C": {
    "name": "Ciężkie",
    "label": "C - Ciężkie",
    "points": 9,
    "isBruise": false
  },
  "sC": {
    "name": "Ciężkie (Siniak)",
    "label": "sC - Ciężkie (Siniak)",
    "points": 9,
    "isBruise": true
  },
  "K": {
    "name": "Krytyczne",
    "label": "K - Krytyczne",
    "points": 27,
    "isBruise": false
  },
  "sK": {
    "name": "Krytyczne (Siniak)",
    "label": "sK - Krytyczne (Siniak)",
    "points": 27,
    "isBruise": true
  },
  "none": {
    "name": "Brak",
    "label": "Brak",
    "points": 0,
    "isBruise": false,
    "skipResistanceTest": true
  }
};

/**
 * Mapowanie poziomów obrażeń na wartości numeryczne i odwrotnie
 * Używane do redukcji obrażeń przez pancerz
 * 0 = brak obrażeń, 1 = Draśnięcie, 2 = Lekkie, 3 = Ciężkie, 4 = Krytyczne
 */
NEUROSHIMA.damageTypeValues = {
  'D': 1,
  'sD': 1,
  'L': 2,
  'sL': 2,
  'C': 3,
  'sC': 3,
  'K': 4,
  'sK': 4
};

NEUROSHIMA.valueToDamageType = {
  0: null,
  1: 'D',
  2: 'L',
  3: 'C',
  4: 'K'
};

/**
 * Mapowanie lokalizacji między różnymi formatami
 * Używane do konwersji między hitLocations a armor/wounds locations
 */
NEUROSHIMA.locationMapping = {
  "head": "head",
  "torso": "torso",
  "leftArm": "leftHand",
  "rightArm": "rightHand",
  "leftLeg": "leftLeg",
  "rightLeg": "rightLeg"
};

/**
 * Lokalizacje dla wounds (używane w dialogu tworzenia ran)
 */
NEUROSHIMA.woundLocations = {
  "head": "Głowa",
  "torso": "Tułów",
  "leftArm": "Lewa ręka",
  "rightArm": "Prawa ręka",
  "leftLeg": "Lewa noga",
  "rightLeg": "Prawa noga",
  "other": "Inne"
};

/**
 * Skutki Ran - tabela kar za obrażenia
 * Zawiera: trudność testu, karę za zdane testy, karę za niezdane
 * Test jest zamknięty i wymaga minimum 2 sukcesów z 3 kości
 */
NEUROSHIMA.woundConsequences = {
  "D": {
    name: "Draśnięcie",
    testDifficulty: "average",
    passedPenalty: 5,
    failedPenalty: 10
  },
  "sD": {
    name: "Draśnięcie (Siniak)",
    testDifficulty: "average",
    passedPenalty: 5,
    failedPenalty: 10
  },
  "L": {
    name: "Lekkie",
    testDifficulty: "problematic",
    passedPenalty: 15,
    failedPenalty: 30
  },
  "sL": {
    name: "Lekkie (Siniak)",
    testDifficulty: "problematic",
    passedPenalty: 15,
    failedPenalty: 30
  },
  "C": {
    name: "Ciężkie",
    testDifficulty: "hard",
    passedPenalty: 30,
    failedPenalty: 60
  },
  "sC": {
    name: "Ciężkie (Siniak)",
    testDifficulty: "hard",
    passedPenalty: 30,
    failedPenalty: 60
  },
  "K": {
    name: "Krytyczne",
    testDifficulty: null,
    passedPenalty: 0,
    failedPenalty: 0
  },
  "sK": {
    name: "Krytyczne (Siniak)",
    testDifficulty: null,
    passedPenalty: 0,
    failedPenalty: 0
  }
};

/**
 * Modyfikatory trudności dla testów
 * Używane w testach zamkniętych (Skutki Ran)
 */
NEUROSHIMA.difficultyModifiers = {
  "easy": -20,
  "average": 0,
  "problematic": 11,
  "hard": 31,
  "veryHard": 61,
  "damnHard": 91,
  "luck": 121
};