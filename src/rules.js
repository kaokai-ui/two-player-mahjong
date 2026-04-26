const SUITS = ["m", "p", "s"];
const HONORS = ["E", "S", "W", "N", "R", "G", "B"];
const NUMBER_LABELS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

const FULL_TILE_TYPES = [];
for (const suit of SUITS) {
  for (let index = 0; index < 9; index += 1) {
    FULL_TILE_TYPES.push(`${suit}${index + 1}`);
  }
}
FULL_TILE_TYPES.push(...HONORS);

const CLASSIC_TILE_TYPES = [
  ...Array.from({ length: 9 }, (_, index) => `m${index + 1}`),
  ...HONORS,
];

export const RULE_PRESETS = {
  full136: {
    id: "full136",
    name: "雙人全牌 136 張",
    description: "使用萬、筒、索與字牌各四張，保留一般 13 張麻將的吃碰槓胡流程。",
    tileTypes: FULL_TILE_TYPES,
    copies: 4,
  },
  classic64: {
    id: "classic64",
    name: "雙人經典 64 張",
    description: "參考香港二人麻雀，只使用萬子與字牌各四張，共 64 張。",
    tileTypes: CLASSIC_TILE_TYPES,
    copies: 4,
  },
};

export const DEFAULT_RULESET = "full136";

const THIRTEEN_ORPHANS_TYPES = [
  "m1",
  "m9",
  "p1",
  "p9",
  "s1",
  "s9",
  "E",
  "S",
  "W",
  "N",
  "R",
  "G",
  "B",
];

export function getRuleset(rulesetId = DEFAULT_RULESET) {
  return RULE_PRESETS[rulesetId] || RULE_PRESETS[DEFAULT_RULESET];
}

export function shuffle(list, rng = Math.random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function buildDeck(rulesetId = DEFAULT_RULESET, rng = Math.random) {
  const ruleset = getRuleset(rulesetId);
  const deck = [];
  for (const tileType of ruleset.tileTypes) {
    for (let copyIndex = 1; copyIndex <= ruleset.copies; copyIndex += 1) {
      deck.push(`${tileType}-${copyIndex}`);
    }
  }
  return shuffle(deck, rng);
}

export function getTileType(tileId = "") {
  const splitIndex = tileId.lastIndexOf("-");
  return splitIndex === -1 ? tileId : tileId.slice(0, splitIndex);
}

export function isSuitTile(tileType) {
  return /^[mps][1-9]$/.test(tileType);
}

export function getTileSuit(tileType) {
  return isSuitTile(tileType) ? tileType[0] : "z";
}

export function getTileRank(tileType) {
  return isSuitTile(tileType) ? Number(tileType[1]) : null;
}

export function isHonorTile(tileType) {
  return !isSuitTile(tileType);
}

export function tileTypeSortKey(tileType) {
  if (isSuitTile(tileType)) {
    return SUITS.indexOf(tileType[0]) * 10 + Number(tileType[1]);
  }
  return 100 + HONORS.indexOf(tileType);
}

export function compareTileTypes(left, right) {
  return tileTypeSortKey(left) - tileTypeSortKey(right) || left.localeCompare(right);
}

export function sortTileIds(tileIds) {
  return [...tileIds].sort((left, right) => {
    const typeCompare = compareTileTypes(getTileType(left), getTileType(right));
    return typeCompare || left.localeCompare(right);
  });
}

export function getTileLabel(tileTypeOrId) {
  const tileType = tileTypeOrId.includes("-") ? getTileType(tileTypeOrId) : tileTypeOrId;
  if (isSuitTile(tileType)) {
    const rank = Number(tileType[1]);
    const suitLabel = tileType[0] === "m" ? "萬" : tileType[0] === "p" ? "筒" : "索";
    return `${NUMBER_LABELS[rank]}${suitLabel}`;
  }

  const honorLabels = {
    E: "東",
    S: "南",
    W: "西",
    N: "北",
    R: "中",
    G: "發",
    B: "白",
  };

  return honorLabels[tileType] || tileType;
}

export function countTileTypes(values) {
  const counts = {};
  for (const value of values || []) {
    const tileType = value.includes("-") ? getTileType(value) : value;
    counts[tileType] = (counts[tileType] || 0) + 1;
  }
  return counts;
}

export function getTilesByType(tileIds, tileType, count = 1) {
  const matches = (tileIds || []).filter((tileId) => getTileType(tileId) === tileType);
  return matches.slice(0, count);
}

export function getChowCombos(handTileIds, discardTileId) {
  const discardTileType = getTileType(discardTileId);
  if (!isSuitTile(discardTileType)) {
    return [];
  }

  const suit = getTileSuit(discardTileType);
  const rank = getTileRank(discardTileType);
  const counts = countTileTypes(handTileIds);
  const combos = [];

  for (const start of [rank - 2, rank - 1, rank]) {
    if (start < 1 || start + 2 > 9) {
      continue;
    }

    const sequence = [start, start + 1, start + 2].map((value) => `${suit}${value}`);
    const neededTypes = sequence.filter((tileType) => tileType !== discardTileType);
    if (neededTypes.every((tileType) => (counts[tileType] || 0) >= 1)) {
      combos.push({
        sequence,
        neededTypes,
        key: neededTypes.join("|"),
        label: sequence.map(getTileLabel).join(" "),
      });
    }
  }

  return combos.filter(
    (combo, index, list) => list.findIndex((candidate) => candidate.key === combo.key) === index,
  );
}

export function canClaimPung(handTileIds, discardTileId) {
  const tileType = getTileType(discardTileId);
  return (countTileTypes(handTileIds)[tileType] || 0) >= 2;
}

export function canClaimDiscardKong(handTileIds, discardTileId) {
  const tileType = getTileType(discardTileId);
  return (countTileTypes(handTileIds)[tileType] || 0) >= 3;
}

export function getConcealedKongTypes(handTileIds) {
  return Object.entries(countTileTypes(handTileIds))
    .filter(([, count]) => count >= 4)
    .map(([tileType]) => tileType)
    .sort(compareTileTypes);
}

export function getAddedKongOptions(player) {
  const hand = player && player.hand ? player.hand : [];
  const melds = player && player.melds ? player.melds : [];
  const counts = countTileTypes(hand);
  return melds
    .filter((meld) => meld.type === "pung" && !meld.concealed && (counts[meld.tileType] || 0) >= 1)
    .map((meld) => ({
      meldId: meld.id,
      tileType: meld.tileType,
      tileId: hand.find((tileId) => getTileType(tileId) === meld.tileType),
    }))
    .sort((left, right) => compareTileTypes(left.tileType, right.tileType));
}

export function evaluateWinningHand({ handTileIds, melds = [], additionalTileId, additionalTileType }) {
  const concealedTileTypes = (handTileIds || []).map(getTileType);
  melds = Array.isArray(melds) ? melds : [];

  if (additionalTileId) {
    concealedTileTypes.push(getTileType(additionalTileId));
  }

  if (additionalTileType) {
    concealedTileTypes.push(additionalTileType);
  }

  concealedTileTypes.sort(compareTileTypes);

  const fixedMeldCount = melds.length;
  const basePatterns = [];
  let decomposition = null;

  if (fixedMeldCount === 0 && isSevenPairs(concealedTileTypes)) {
    basePatterns.push("七對子");
  }

  if (fixedMeldCount === 0 && isThirteenOrphans(concealedTileTypes)) {
    basePatterns.push("十三么");
  }

  decomposition = findStandardWinningShape(concealedTileTypes, fixedMeldCount);

  if (!decomposition && basePatterns.length === 0) {
    return {
      canWin: false,
      patterns: [],
      decomposition: null,
    };
  }

  const patterns = detectPatterns({
    concealedTileTypes,
    melds,
    decomposition,
    basePatterns,
  });

  return {
    canWin: true,
    patterns,
    decomposition,
  };
}

function detectPatterns({ concealedTileTypes, melds, decomposition, basePatterns }) {
  const patterns = new Set(basePatterns);
  const allTileTypes = [...concealedTileTypes];
  for (const meld of melds) {
    for (const tileId of meld.tiles) {
      allTileTypes.push(getTileType(tileId));
    }
  }

  const openMelds = melds.filter((meld) => !meld.concealed);
  if (openMelds.length === 0) {
    patterns.add("門清");
  }

  if (decomposition) {
    const allGroups = [
      ...melds.map((meld) => (meld.type === "chow" ? "chow" : "triplet")),
      ...decomposition.sets.map((set) => (set.kind === "chow" ? "chow" : "triplet")),
    ];
    if (allGroups.length === 4 && allGroups.every((group) => group === "triplet")) {
      patterns.add("對對胡");
    }
  }

  const suitTypes = allTileTypes.filter(isSuitTile);
  const suits = new Set(suitTypes.map(getTileSuit));
  const hasHonors = allTileTypes.some(isHonorTile);

  if (suits.size === 1 && suitTypes.length === allTileTypes.length && allTileTypes.length > 0) {
    patterns.add("清一色");
  } else if (suits.size === 1 && hasHonors) {
    patterns.add("混一色");
  } else if (suits.size === 0 && hasHonors) {
    patterns.add("字一色");
  }

  return [...patterns];
}

function isSevenPairs(tileTypes) {
  if (tileTypes.length !== 14) {
    return false;
  }

  const counts = Object.values(countTileTypes(tileTypes));
  return counts.every((count) => count === 2 || count === 4) && counts.reduce((sum, count) => sum + count / 2, 0) === 7;
}

function isThirteenOrphans(tileTypes) {
  if (tileTypes.length !== 14) {
    return false;
  }

  const counts = countTileTypes(tileTypes);
  let pairCount = 0;

  for (const requiredType of THIRTEEN_ORPHANS_TYPES) {
    const count = counts[requiredType] || 0;
    if (count === 0) {
      return false;
    }
    if (count >= 2) {
      pairCount += 1;
    }
  }

  const onlyRequiredTiles = Object.keys(counts).every((tileType) => THIRTEEN_ORPHANS_TYPES.includes(tileType));
  return onlyRequiredTiles && pairCount === 1;
}

function findStandardWinningShape(concealedTileTypes, fixedMeldCount) {
  const neededTileCount = 14 - fixedMeldCount * 3;
  if (concealedTileTypes.length !== neededTileCount) {
    return null;
  }

  const counts = countTileTypes(concealedTileTypes);
  const candidatePairs = Object.keys(counts)
    .filter((tileType) => counts[tileType] >= 2)
    .sort(compareTileTypes);

  for (const pairType of candidatePairs) {
    counts[pairType] -= 2;
    const sets = extractSets(counts, 4 - fixedMeldCount);
    counts[pairType] += 2;

    if (sets) {
      return {
        pair: pairType,
        sets,
      };
    }
  }

  return null;
}

function extractSets(counts, setsNeeded) {
  if (setsNeeded === 0) {
    return Object.values(counts).every((count) => count === 0) ? [] : null;
  }

  const nextTileType = Object.keys(counts)
    .filter((tileType) => counts[tileType] > 0)
    .sort(compareTileTypes)[0];

  if (!nextTileType) {
    return null;
  }

  if (counts[nextTileType] >= 3) {
    counts[nextTileType] -= 3;
    const tripletRemainder = extractSets(counts, setsNeeded - 1);
    counts[nextTileType] += 3;
    if (tripletRemainder) {
      return [
        {
          kind: "triplet",
          tiles: [nextTileType, nextTileType, nextTileType],
          tileType: nextTileType,
        },
        ...tripletRemainder,
      ];
    }
  }

  if (isSuitTile(nextTileType)) {
    const suit = getTileSuit(nextTileType);
    const rank = getTileRank(nextTileType);
    if (rank <= 7) {
      const secondTile = `${suit}${rank + 1}`;
      const thirdTile = `${suit}${rank + 2}`;
      if ((counts[secondTile] || 0) > 0 && (counts[thirdTile] || 0) > 0) {
        counts[nextTileType] -= 1;
        counts[secondTile] -= 1;
        counts[thirdTile] -= 1;
        const chowRemainder = extractSets(counts, setsNeeded - 1);
        counts[nextTileType] += 1;
        counts[secondTile] += 1;
        counts[thirdTile] += 1;

        if (chowRemainder) {
          return [
            {
              kind: "chow",
              tiles: [nextTileType, secondTile, thirdTile],
              tileType: nextTileType,
            },
            ...chowRemainder,
          ];
        }
      }
    }
  }

  return null;
}
