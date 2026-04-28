import {
  countTileTypes,
  evaluateWinningHand,
  getTileRank,
  getTileSuit,
  getTileType,
  isHonorTile,
  isSuitTile,
} from "./rules.js?v=20260425i";

export const SCORING_VERSION = "tai-v1";
export const DEFAULT_SCORING_ENABLED = true;
const SCORE_CAP = 640;
const BASE_SCORE_UNIT = 20;
const DRAGON_TILE_TYPES = ["R", "G", "B"];
const DRAGON_LABELS = {
  R: "紅中刻",
  G: "發財刻",
  B: "白板刻",
};

export function normalizeScoringEnabled(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
  }

  return Boolean(value);
}

export function scoreFromTai(totalTai) {
  const normalizedTai = Math.max(0, Math.floor(Number(totalTai) || 0));
  if (normalizedTai <= 0) {
    return 0;
  }

  return Math.min(SCORE_CAP, BASE_SCORE_UNIT * (2 ** Math.max(0, normalizedTai - 1)));
}

export function evaluateWinningScore({
  handTileIds,
  melds = [],
  winKind,
  winningTileId = "",
  additionalTileId = "",
  additionalTileType = "",
  lastDrawSource = "",
}) {
  const evaluation = evaluateWinningHand({
    handTileIds,
    melds,
    additionalTileId,
    additionalTileType,
  });

  if (!evaluation.canWin) {
    return createEmptyScoringResult(evaluation);
  }

  const concealedTileTypes = (handTileIds || []).map(getTileType);
  if (additionalTileId) {
    concealedTileTypes.push(getTileType(additionalTileId));
  } else if (additionalTileType) {
    concealedTileTypes.push(additionalTileType);
  }

  const allTileTypes = [
    ...concealedTileTypes,
    ...collectMeldTileTypes(melds),
  ];
  const tileCounts = countTileTypes(allTileTypes);
  const groupSummary = buildGroupSummary(melds, evaluation.decomposition);
  const breakdown = [];

  pushTai(breakdown, "baseWin", "基本胡", 1);

  if (winKind === "selfDraw") {
    pushTai(breakdown, "selfDraw", "自摸", 1);
  }

  if (hasConcealedHand(melds)) {
    pushTai(breakdown, "concealed", "門清", 1);
  }

  if (isAllSimples(allTileTypes)) {
    pushTai(breakdown, "allSimples", "斷么九", 1);
  }

  for (const dragonType of DRAGON_TILE_TYPES) {
    if (groupSummary.tripletTileTypes.has(dragonType)) {
      pushTai(breakdown, `dragon-${dragonType}`, DRAGON_LABELS[dragonType], 1);
    }
  }

  if (isAllPungs(groupSummary)) {
    pushTai(breakdown, "allPungs", "對對胡", 2);
  }

  if (isSevenPairs(concealedTileTypes, melds)) {
    pushTai(breakdown, "sevenPairs", "七對子", 2);
  }

  if (hasFullStraight(groupSummary)) {
    pushTai(breakdown, "fullStraight", "一條龍", 2);
  }

  if (hasMixedTripleChow(groupSummary)) {
    pushTai(breakdown, "mixedTripleChow", "三色同順", 2);
  }

  if (isHalfFlush(allTileTypes)) {
    pushTai(breakdown, "halfFlush", "混一色", 3);
  }

  if (hasSmallThreeDragons(groupSummary)) {
    pushTai(breakdown, "smallThreeDragons", "小三元", 4);
  }

  if (isFullFlush(allTileTypes)) {
    pushTai(breakdown, "fullFlush", "清一色", 5);
  }

  if (winKind === "selfDraw" && lastDrawSource === "supplement") {
    pushTai(breakdown, "kongDraw", "槓上開花", 1);
  }

  if (winKind === "robKong") {
    pushTai(breakdown, "robKong", "搶槓胡", 1);
  }

  const totalTai = breakdown.reduce((sum, item) => sum + item.tai, 0);
  const totalScore = scoreFromTai(totalTai);
  const patterns = Array.isArray(evaluation.patterns) ? evaluation.patterns : [];
  const winningTileType = additionalTileId ? getTileType(additionalTileId) : additionalTileType || getTileType(winningTileId);

  return {
    canScore: true,
    evaluation,
    patterns,
    breakdown,
    totalTai,
    totalScore,
    winningTileId,
    winningTileType,
  };
}

export function estimateScoringPotential({
  handTileIds,
  melds = [],
  visibleCounts = {},
  profile = "hard",
}) {
  const tileIds = Array.isArray(handTileIds) ? handTileIds : [];
  const tileTypes = tileIds.map(getTileType);
  const meldTileTypes = collectMeldTileTypes(melds);
  const allTileTypes = [...tileTypes, ...meldTileTypes];
  const counts = countTileTypes(allTileTypes);
  const suitStats = summarizeSuitPressure(allTileTypes);
  const openMelds = (melds || []).filter((meld) => meld && !meld.concealed).length;
  const pairCount = countPairs(counts);
  const tripletCount = countTriplets(counts);
  const dragonPressure = estimateDragonPressure(counts, visibleCounts);
  const dominantSuit = getDominantSuit(suitStats);
  const flushPotential = estimateFlushPotential(suitStats, dominantSuit, visibleCounts, profile);
  const sequencePotential = estimateSequencePotential(counts, visibleCounts, profile);

  let projectedTai = 1;
  let score = 0;

  if (openMelds === 0) {
    projectedTai += profile === "god" ? 1.15 : 1;
    score += profile === "god" ? 24 : 20;
  } else {
    score -= openMelds * (profile === "god" ? 10 : 6);
  }

  const terminalHonorCount = allTileTypes.filter((tileType) => isHonorTile(tileType) || isTerminal(tileType)).length;
  if (terminalHonorCount === 0) {
    projectedTai += 1.2;
    score += 18;
  } else {
    score += Math.max(-18, 8 - terminalHonorCount * 3);
  }

  projectedTai += dragonPressure.tai;
  score += dragonPressure.score;

  if (tripletCount >= 3 && pairCount >= 1) {
    projectedTai += 1.4 + (tripletCount - 3) * 0.35;
    score += 18 + (tripletCount - 3) * 5;
  }

  if (pairCount >= 4 && openMelds === 0) {
    projectedTai += Math.min(2, pairCount * 0.32);
    score += 14 + pairCount * 2;
  }

  projectedTai += flushPotential.tai;
  score += flushPotential.score;
  projectedTai += sequencePotential.tai;
  score += sequencePotential.score;

  if (profile === "god") {
    projectedTai += estimateGodLookaheadBonus(counts, visibleCounts);
    score += estimateImprovementPressure(counts, visibleCounts, dominantSuit) * 0.65;
  }

  const roundedProjectedTai = Math.max(1, Math.round(projectedTai));
  const evScore = score + scoreFromTai(roundedProjectedTai) * (profile === "god" ? 0.5 : 0.34);

  return {
    projectedTai,
    roundedProjectedTai,
    evScore,
    dominantSuit,
    openMelds,
    pairCount,
    tripletCount,
  };
}

function createEmptyScoringResult(evaluation = null) {
  return {
    canScore: false,
    evaluation,
    patterns: evaluation && Array.isArray(evaluation.patterns) ? evaluation.patterns : [],
    breakdown: [],
    totalTai: 0,
    totalScore: 0,
    winningTileId: "",
    winningTileType: "",
  };
}

function pushTai(breakdown, key, label, tai) {
  breakdown.push({ key, label, tai });
}

function collectMeldTileTypes(melds = []) {
  const tileTypes = [];
  for (const meld of melds || []) {
    for (const tileId of meld.tiles || []) {
      tileTypes.push(getTileType(tileId));
    }
  }
  return tileTypes;
}

function buildGroupSummary(melds = [], decomposition = null) {
  const summary = {
    tripletTileTypes: new Set(),
    chowStartsBySuit: {
      m: new Set(),
      p: new Set(),
      s: new Set(),
    },
    pairTileType: decomposition && decomposition.pair ? decomposition.pair : "",
    groupKinds: [],
  };

  for (const meld of melds || []) {
    if (!meld) {
      continue;
    }

    if (meld.type === "chow") {
      const startType = getTileType((meld.tiles || [])[0] || meld.tileType || "");
      if (isSuitTile(startType)) {
        summary.chowStartsBySuit[getTileSuit(startType)].add(getTileRank(startType));
      }
      summary.groupKinds.push("chow");
      continue;
    }

    const tileType = meld.tileType || getTileType((meld.tiles || [])[0] || "");
    summary.tripletTileTypes.add(tileType);
    summary.groupKinds.push("triplet");
  }

  for (const set of decomposition && Array.isArray(decomposition.sets) ? decomposition.sets : []) {
    if (!set) {
      continue;
    }

    if (set.kind === "chow") {
      const startType = set.tileType || (set.tiles || [])[0];
      if (isSuitTile(startType)) {
        summary.chowStartsBySuit[getTileSuit(startType)].add(getTileRank(startType));
      }
      summary.groupKinds.push("chow");
      continue;
    }

    const tileType = set.tileType || (set.tiles || [])[0];
    summary.tripletTileTypes.add(tileType);
    summary.groupKinds.push("triplet");
  }

  return summary;
}

function hasConcealedHand(melds = []) {
  return !(melds || []).some((meld) => meld && !meld.concealed);
}

function isAllSimples(tileTypes = []) {
  return tileTypes.length > 0 && tileTypes.every((tileType) => isSuitTile(tileType) && !isTerminal(tileType));
}

function isTerminal(tileType) {
  if (!isSuitTile(tileType)) {
    return false;
  }

  const rank = getTileRank(tileType);
  return rank === 1 || rank === 9;
}

function isAllPungs(groupSummary) {
  return groupSummary.groupKinds.length === 4 && groupSummary.groupKinds.every((kind) => kind === "triplet");
}

function isSevenPairs(tileTypes, melds) {
  if ((melds || []).length > 0 || (tileTypes || []).length !== 14) {
    return false;
  }

  const counts = Object.values(countTileTypes(tileTypes));
  return counts.length === 7 && counts.every((count) => count === 2);
}

function hasFullStraight(groupSummary) {
  return ["m", "p", "s"].some((suit) => {
    const starts = groupSummary.chowStartsBySuit[suit];
    return starts.has(1) && starts.has(4) && starts.has(7);
  });
}

function hasMixedTripleChow(groupSummary) {
  for (let start = 1; start <= 7; start += 1) {
    if (
      groupSummary.chowStartsBySuit.m.has(start) &&
      groupSummary.chowStartsBySuit.p.has(start) &&
      groupSummary.chowStartsBySuit.s.has(start)
    ) {
      return true;
    }
  }

  return false;
}

function isHalfFlush(tileTypes) {
  const suitTiles = tileTypes.filter(isSuitTile);
  if (!suitTiles.length || suitTiles.length === tileTypes.length) {
    return false;
  }

  return new Set(suitTiles.map(getTileSuit)).size === 1;
}

function isFullFlush(tileTypes) {
  const suitTiles = tileTypes.filter(isSuitTile);
  return tileTypes.length > 0 && suitTiles.length === tileTypes.length && new Set(suitTiles.map(getTileSuit)).size === 1;
}

function hasSmallThreeDragons(groupSummary) {
  const dragonTriplets = DRAGON_TILE_TYPES.filter((tileType) => groupSummary.tripletTileTypes.has(tileType)).length;
  return dragonTriplets >= 2 && DRAGON_TILE_TYPES.includes(groupSummary.pairTileType);
}

function summarizeSuitPressure(tileTypes) {
  return tileTypes.reduce(
    (summary, tileType) => {
      if (isHonorTile(tileType)) {
        summary.honorCount += 1;
      } else {
        summary[getTileSuit(tileType)] += 1;
      }
      return summary;
    },
    { m: 0, p: 0, s: 0, honorCount: 0 },
  );
}

function getDominantSuit(suitStats) {
  const suits = ["m", "p", "s"];
  return suits.reduce((best, suit) => (suitStats[suit] > suitStats[best] ? suit : best), "m");
}

function estimateFlushPotential(suitStats, dominantSuit, visibleCounts, profile) {
  const dominantCount = suitStats[dominantSuit] || 0;
  const otherSuitCount = ["m", "p", "s"]
    .filter((suit) => suit !== dominantSuit)
    .reduce((sum, suit) => sum + (suitStats[suit] || 0), 0);
  const honors = suitStats.honorCount || 0;
  const hiddenHelp = Array.from({ length: 9 }, (_, index) => `${dominantSuit}${index + 1}`)
    .reduce((sum, tileType) => sum + Math.max(0, 4 - (visibleCounts[tileType] || 0)), 0);

  if (dominantCount < 6) {
    return { tai: 0, score: 0 };
  }

  const scarcityPenalty = profile === "god" ? 0.18 : 0.1;
  const tai = otherSuitCount === 0
    ? 2.2 + Math.min(2.6, dominantCount * 0.18)
    : Math.max(0, 0.9 + dominantCount * 0.12 - otherSuitCount * 0.25);
  const score = dominantCount * 7 + hiddenHelp * scarcityPenalty - otherSuitCount * 6 - honors * 2;
  return { tai, score };
}

function estimateSequencePotential(counts, visibleCounts, profile) {
  let tai = 0;
  let score = 0;

  for (const suit of ["m", "p", "s"]) {
    const has123 = hasSequenceCoverage(counts, visibleCounts, suit, 1);
    const has456 = hasSequenceCoverage(counts, visibleCounts, suit, 4);
    const has789 = hasSequenceCoverage(counts, visibleCounts, suit, 7);
    if (has123 && has456 && has789) {
      tai += profile === "god" ? 1.4 : 0.9;
      score += 18;
    }
  }

  for (let start = 1; start <= 7; start += 1) {
    const coverage = ["m", "p", "s"].filter((suit) => hasSequenceCoverage(counts, visibleCounts, suit, start)).length;
    if (coverage >= 2) {
      tai += profile === "god" ? 0.45 : 0.28;
      score += coverage * 4;
    }
  }

  return { tai, score };
}

function hasSequenceCoverage(counts, visibleCounts, suit, start) {
  return [start, start + 1, start + 2].every((rank) => {
    const tileType = `${suit}${rank}`;
    return (counts[tileType] || 0) > 0 || Math.max(0, 4 - (visibleCounts[tileType] || 0)) > 0;
  });
}

function estimateDragonPressure(counts, visibleCounts) {
  let tai = 0;
  let score = 0;

  for (const tileType of DRAGON_TILE_TYPES) {
    const ownCount = counts[tileType] || 0;
    const available = Math.max(0, 4 - (visibleCounts[tileType] || 0));

    if (ownCount >= 3) {
      tai += 1;
      score += 16;
      continue;
    }

    if (ownCount === 2 && available > 0) {
      tai += 0.45;
      score += 8 + available * 2;
      continue;
    }

    if (ownCount === 1 && available >= 2) {
      score += 3 + available;
    }
  }

  return { tai, score };
}

function estimateGodLookaheadBonus(counts, visibleCounts) {
  let bonus = 0;
  for (const [tileType, count] of Object.entries(counts)) {
    if (!count || !isSuitTile(tileType)) {
      continue;
    }

    const rank = getTileRank(tileType);
    const suit = getTileSuit(tileType);
    const left = `${suit}${rank - 1}`;
    const right = `${suit}${rank + 1}`;
    const waits =
      Math.max(0, 4 - (visibleCounts[left] || 0)) +
      Math.max(0, 4 - (visibleCounts[right] || 0));
    bonus += waits * (count >= 2 ? 0.45 : 0.25);
  }
  return bonus;
}

function estimateImprovementPressure(counts, visibleCounts, dominantSuit) {
  let score = 0;
  for (const [tileType, count] of Object.entries(counts)) {
    if (!count) {
      continue;
    }

    if (isHonorTile(tileType)) {
      score += count >= 2 ? 5 : -2;
      continue;
    }

    const suit = getTileSuit(tileType);
    const rank = getTileRank(tileType);
    const scarcity = Math.max(0, 4 - (visibleCounts[tileType] || 0));
    if (suit === dominantSuit) {
      score += scarcity * 1.4;
    }
    if (rank >= 3 && rank <= 7) {
      score += scarcity * 0.9;
    }
  }
  return score;
}

function countPairs(counts) {
  return Object.values(counts).filter((count) => count >= 2).length;
}

function countTriplets(counts) {
  return Object.values(counts).filter((count) => count >= 3).length;
}
