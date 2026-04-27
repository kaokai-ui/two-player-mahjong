import { getPlayerClientState } from "./game.js?v=20260427g";
import {
  countTileTypes,
  getRuleset,
  getTileLabel,
  getTileRank,
  getTileSuit,
  getTileType,
  isHonorTile,
  isSuitTile,
} from "./rules.js?v=20260425i";

export const DEFAULT_SOLO_DIFFICULTY = "easy";
export const SOLO_DIFFICULTY_LABELS = {
  easy: "簡單",
  normal: "普通",
  hard: "困難",
};

const ALL_TILE_TYPES = [
  ...Array.from({ length: 9 }, (_, index) => `m${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `p${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `s${index + 1}`),
  "E",
  "S",
  "W",
  "N",
  "R",
  "G",
  "B",
];

export function normalizeSoloDifficulty(value) {
  return Object.prototype.hasOwnProperty.call(SOLO_DIFFICULTY_LABELS, value) ? value : DEFAULT_SOLO_DIFFICULTY;
}

export function decideBotAction(game, playerSeat, difficulty = DEFAULT_SOLO_DIFFICULTY) {
  const normalizedDifficulty = normalizeSoloDifficulty(difficulty);
  const clientState = getPlayerClientState(game, playerSeat);
  const player = game && Array.isArray(game.players) ? game.players[playerSeat] : null;

  if (!player) {
    return null;
  }

  if (clientState.canDraw) {
    return {
      type: "drawTile",
      delayMs: getBotDelay(),
      infoMessage: "電腦摸牌中...",
    };
  }

  if (clientState.canSelfDraw) {
    return {
      type: "declareSelfDraw",
      delayMs: getBotDelay(),
      infoMessage: "電腦正在判斷是否自摸...",
      resultMessage: "電腦自摸。",
    };
  }

  const claimDecision = decideClaimAction(game, playerSeat, clientState, normalizedDifficulty);
  if (claimDecision) {
    return claimDecision;
  }

  const kongDecision = decideKongAction(game, playerSeat, player, clientState, normalizedDifficulty);
  if (kongDecision) {
    return kongDecision;
  }

  if (clientState.canDiscard) {
    const tileId = chooseDiscardTile(game, playerSeat, player, normalizedDifficulty);
    return {
      type: "discardTile",
      payload: { tileId },
      delayMs: getBotDelay(),
      infoMessage: "電腦思考出牌中...",
      resultMessage: `電腦打出 ${getTileLabel(tileId)}。`,
    };
  }

  return null;
}

function decideClaimAction(game, playerSeat, clientState, difficulty) {
  const options = Array.isArray(clientState.claimOptions) ? clientState.claimOptions : [];
  const pendingClaim = clientState.pendingClaim || null;
  if (!options.length || !pendingClaim) {
    return null;
  }

  const winningOption = options.find((option) => option.type === "claimWin");
  if (winningOption) {
    return {
      type: "claimWin",
      delayMs: getBotDelay(),
      infoMessage: "電腦正在判斷胡牌...",
      resultMessage: pendingClaim.kind === "robKong" ? "電腦搶槓胡。" : "電腦胡牌。",
    };
  }

  if (difficulty === "hard") {
    return decideProbabilisticClaimAction(game, playerSeat, clientState, options, pendingClaim);
  }

  if (difficulty === "normal") {
    return decideStructuredClaimAction(game, playerSeat, clientState, options, pendingClaim);
  }

  const tileType = getTileType(pendingClaim.tileId || pendingClaim.tileType || "");
  const handCounts = countTileTypes(game.players[playerSeat].hand || []);

  const kongOption = options.find((option) => option.type === "claimDiscardKong");
  if (kongOption && shouldTakeSet(tileType, handCounts, difficulty, true)) {
    return {
      type: "claimDiscardKong",
      delayMs: getBotDelay(),
      infoMessage: "電腦正在考慮是否槓牌...",
      resultMessage: `電腦槓了 ${getTileLabel(tileType)}。`,
    };
  }

  const pungOption = options.find((option) => option.type === "claimPung");
  if (pungOption && shouldTakeSet(tileType, handCounts, difficulty, false)) {
    return {
      type: "claimPung",
      delayMs: getBotDelay(),
      infoMessage: "電腦正在考慮是否碰牌...",
      resultMessage: `電腦碰了 ${getTileLabel(tileType)}。`,
    };
  }

  const chowOptions = options.filter((option) => option.type === "claimChow");
  const chosenChow = chowOptions.find((option) => shouldTakeChow(option.neededTypes || [], handCounts));
  if (chosenChow) {
    return {
      type: "claimChow",
      payload: { neededTypes: chosenChow.neededTypes },
      delayMs: getBotDelay(),
      infoMessage: "電腦正在考慮是否吃牌...",
      resultMessage: `電腦吃了 ${chosenChow.label.replace(/^吃\s*/, "")}。`,
    };
  }

  return {
    type: "passClaim",
    delayMs: getBotDelay(600, 1100),
    infoMessage: "電腦正在考慮是否過牌...",
    resultMessage: "電腦選擇過牌。",
  };
}

function decideKongAction(game, playerSeat, player, clientState, difficulty) {
  if (difficulty === "hard") {
    return decideProbabilisticKongAction(game, playerSeat, player, clientState);
  }

  if (difficulty === "normal") {
    return decideStructuredKongAction(player, clientState);
  }

  const concealedKong = (clientState.concealedKongs || []).find((tileType) =>
    shouldDeclareOwnKong(tileType, player.hand || [], difficulty),
  );
  if (concealedKong) {
    return {
      type: "concealedKong",
      payload: { tileType: concealedKong },
      delayMs: getBotDelay(),
      infoMessage: "電腦正在考慮是否暗槓...",
      resultMessage: `電腦暗槓 ${getTileLabel(concealedKong)}。`,
    };
  }

  const addedKong = (clientState.addedKongs || []).find((option) =>
    shouldDeclareOwnKong(option.tileType, player.hand || [], difficulty),
  );
  if (addedKong) {
    return {
      type: "addedKong",
      payload: {
        meldId: addedKong.meldId,
        tileId: addedKong.tileId,
      },
      delayMs: getBotDelay(),
      infoMessage: "電腦正在考慮是否補槓...",
      resultMessage: `電腦補槓 ${getTileLabel(addedKong.tileType)}。`,
    };
  }

  return null;
}

function decideProbabilisticClaimAction(game, playerSeat, clientState, options, pendingClaim) {
  const player = game && Array.isArray(game.players) ? game.players[playerSeat] : null;
  if (!player) {
    return null;
  }

  const analysisCache = createAnalysisCache();
  const baseline = evaluateProbabilisticHand(
    game,
    playerSeat,
    player.hand || [],
    Array.isArray(player.melds) ? player.melds.length : 0,
    [],
    analysisCache,
  );
  const candidates = [];
  const claimTileId = pendingClaim.tileId || pendingClaim.tileType || "";
  const claimTileType = getTileType(claimTileId);

  const kongOption = options.find((option) => option.type === "claimDiscardKong");
  if (kongOption) {
    const usedTileIds = getTilesOfTypeFromHand(player.hand || [], claimTileType, 3);
    if (usedTileIds.length === 3) {
      candidates.push(
        createProbabilisticActionCandidate({
          game,
          playerSeat,
          remainingHand: removeTileIdsFromHand(player.hand || [], usedTileIds),
          lockedMeldsAfter: (player.melds || []).length + 1,
          baseline,
          option: kongOption,
          infoMessage: "電腦正在考慮是否槓牌...",
          resultMessage: `電腦槓了 ${getTileLabel(claimTileType)}。`,
          actionBonus: 32,
          extraVisibleTileTypes: usedTileIds.map((tileId) => getTileType(tileId)),
          analysisCache,
        }),
      );
    }
  }

  const pungOption = options.find((option) => option.type === "claimPung");
  if (pungOption) {
    const usedTileIds = getTilesOfTypeFromHand(player.hand || [], claimTileType, 2);
    if (usedTileIds.length === 2) {
      candidates.push(
        createProbabilisticActionCandidate({
          game,
          playerSeat,
          remainingHand: removeTileIdsFromHand(player.hand || [], usedTileIds),
          lockedMeldsAfter: (player.melds || []).length + 1,
          baseline,
          option: pungOption,
          infoMessage: "電腦正在考慮是否碰牌...",
          resultMessage: `電腦碰了 ${getTileLabel(claimTileType)}。`,
          actionBonus: isHonorTile(claimTileType) ? 18 : 10,
          extraVisibleTileTypes: usedTileIds.map((tileId) => getTileType(tileId)),
          analysisCache,
        }),
      );
    }
  }

  for (const chowOption of options.filter((option) => option.type === "claimChow")) {
    const usedTileIds = getTilesForNeededTypes(player.hand || [], chowOption.neededTypes || []);
    if (usedTileIds.length === 2) {
      candidates.push(
        createProbabilisticActionCandidate({
          game,
          playerSeat,
          remainingHand: removeTileIdsFromHand(player.hand || [], usedTileIds),
          lockedMeldsAfter: (player.melds || []).length + 1,
          baseline,
          option: chowOption,
          infoMessage: "電腦正在考慮是否吃牌...",
          resultMessage: `電腦吃了 ${chowOption.label.replace(/^吃\s*/, "")}。`,
          actionBonus: 8,
          extraVisibleTileTypes: usedTileIds.map((tileId) => getTileType(tileId)),
          analysisCache,
        }),
      );
    }
  }

  const bestCandidate = pickBestActionCandidate(candidates);
  if (bestCandidate && shouldTakeProbabilisticAction(baseline, bestCandidate.progress, bestCandidate.actionValue)) {
    return {
      type: bestCandidate.option.type,
      payload: bestCandidate.option.neededTypes ? { neededTypes: bestCandidate.option.neededTypes } : undefined,
      delayMs: getBotDelay(),
      infoMessage: bestCandidate.infoMessage,
      resultMessage: bestCandidate.resultMessage,
    };
  }

  return {
    type: "passClaim",
    delayMs: getBotDelay(600, 1100),
    infoMessage: "電腦正在考慮是否過牌...",
    resultMessage: "電腦選擇過牌。",
  };
}

function decideProbabilisticKongAction(game, playerSeat, player, clientState) {
  const handTileIds = player.hand || [];
  const lockedMelds = Array.isArray(player.melds) ? player.melds.length : 0;
  const analysisCache = createAnalysisCache();
  const baseline = evaluateProbabilisticHand(game, playerSeat, handTileIds, lockedMelds, [], analysisCache);

  for (const tileType of clientState.concealedKongs || []) {
    const usedTileIds = getTilesOfTypeFromHand(handTileIds, tileType, 4);
    if (usedTileIds.length !== 4) {
      continue;
    }

    const remainingHand = removeTileIdsFromHand(handTileIds, usedTileIds);
    const progress = evaluateProbabilisticHand(
      game,
      playerSeat,
      remainingHand,
      lockedMelds + 1,
      usedTileIds.map((tileId) => getTileType(tileId)),
      analysisCache,
    );
    const actionValue = scoreProbabilisticOutcome(baseline, progress, 26);
    if (shouldTakeProbabilisticAction(baseline, progress, actionValue)) {
      return {
        type: "concealedKong",
        payload: { tileType },
        delayMs: getBotDelay(),
        infoMessage: "電腦正在考慮是否暗槓...",
        resultMessage: `電腦暗槓 ${getTileLabel(tileType)}。`,
      };
    }
  }

  for (const option of clientState.addedKongs || []) {
    const remainingHand = removeTileIdsFromHand(handTileIds, [option.tileId]);
    const progress = evaluateProbabilisticHand(
      game,
      playerSeat,
      remainingHand,
      lockedMelds,
      [option.tileType],
      analysisCache,
    );
    const actionValue = scoreProbabilisticOutcome(baseline, progress, 20);
    if (shouldTakeProbabilisticAction(baseline, progress, actionValue)) {
      return {
        type: "addedKong",
        payload: {
          meldId: option.meldId,
          tileId: option.tileId,
        },
        delayMs: getBotDelay(),
        infoMessage: "電腦正在考慮是否補槓...",
        resultMessage: `電腦補槓 ${getTileLabel(option.tileType)}。`,
      };
    }
  }

  return null;
}

function decideStructuredClaimAction(game, playerSeat, clientState, options, pendingClaim) {
  const player = game && Array.isArray(game.players) ? game.players[playerSeat] : null;
  if (!player) {
    return null;
  }

  const baseline = evaluateHandProgress(player.hand || [], Array.isArray(player.melds) ? player.melds.length : 0);
  const candidates = [];
  const claimTileId = pendingClaim.tileId || pendingClaim.tileType || "";
  const claimTileType = getTileType(claimTileId);

  const kongOption = options.find((option) => option.type === "claimDiscardKong");
  if (kongOption) {
    const usedTileIds = getTilesOfTypeFromHand(player.hand || [], claimTileType, 3);
    if (usedTileIds.length === 3) {
      candidates.push(
        createClaimCandidate({
          player,
          usedTileIds,
          lockedMeldsAfter: (player.melds || []).length + 1,
          baseline,
          option: kongOption,
          infoMessage: "電腦正在考慮是否槓牌...",
          resultMessage: `電腦槓了 ${getTileLabel(claimTileType)}。`,
          actionBonus: 30,
        }),
      );
    }
  }

  const pungOption = options.find((option) => option.type === "claimPung");
  if (pungOption) {
    const usedTileIds = getTilesOfTypeFromHand(player.hand || [], claimTileType, 2);
    if (usedTileIds.length === 2) {
      candidates.push(
        createClaimCandidate({
          player,
          usedTileIds,
          lockedMeldsAfter: (player.melds || []).length + 1,
          baseline,
          option: pungOption,
          infoMessage: "電腦正在考慮是否碰牌...",
          resultMessage: `電腦碰了 ${getTileLabel(claimTileType)}。`,
          actionBonus: isHonorTile(claimTileType) ? 16 : 10,
        }),
      );
    }
  }

  for (const chowOption of options.filter((option) => option.type === "claimChow")) {
    const usedTileIds = getTilesForNeededTypes(player.hand || [], chowOption.neededTypes || []);
    if (usedTileIds.length === 2) {
      candidates.push(
        createClaimCandidate({
          player,
          usedTileIds,
          lockedMeldsAfter: (player.melds || []).length + 1,
          baseline,
          option: chowOption,
          infoMessage: "電腦正在考慮是否吃牌...",
          resultMessage: `電腦吃了 ${chowOption.label.replace(/^吃\s*/, "")}。`,
          actionBonus: 8,
        }),
      );
    }
  }

  const bestCandidate = pickBestActionCandidate(candidates);
  if (bestCandidate && shouldTakeStructuredAction(baseline, bestCandidate.progress, bestCandidate.actionValue)) {
    return {
      type: bestCandidate.option.type,
      payload: bestCandidate.option.neededTypes ? { neededTypes: bestCandidate.option.neededTypes } : undefined,
      delayMs: getBotDelay(),
      infoMessage: bestCandidate.infoMessage,
      resultMessage: bestCandidate.resultMessage,
    };
  }

  return {
    type: "passClaim",
    delayMs: getBotDelay(600, 1100),
    infoMessage: "電腦正在考慮是否過牌...",
    resultMessage: "電腦選擇過牌。",
  };
}

function decideStructuredKongAction(player, clientState) {
  const handTileIds = player.hand || [];
  const lockedMelds = Array.isArray(player.melds) ? player.melds.length : 0;
  const baseline = evaluateHandProgress(handTileIds, lockedMelds);

  for (const tileType of clientState.concealedKongs || []) {
    const usedTileIds = getTilesOfTypeFromHand(handTileIds, tileType, 4);
    if (usedTileIds.length !== 4) {
      continue;
    }
    const remainingHand = removeTileIdsFromHand(handTileIds, usedTileIds);
    const progress = evaluateHandProgress(remainingHand, lockedMelds + 1);
    const actionValue = scoreActionOutcome(baseline, progress, 22);
    if (shouldTakeStructuredAction(baseline, progress, actionValue)) {
      return {
        type: "concealedKong",
        payload: { tileType },
        delayMs: getBotDelay(),
        infoMessage: "電腦正在考慮是否暗槓...",
        resultMessage: `電腦暗槓 ${getTileLabel(tileType)}。`,
      };
    }
  }

  for (const option of clientState.addedKongs || []) {
    const remainingHand = removeTileIdsFromHand(handTileIds, [option.tileId]);
    const progress = evaluateHandProgress(remainingHand, lockedMelds);
    const actionValue = scoreActionOutcome(baseline, progress, 18);
    if (shouldTakeStructuredAction(baseline, progress, actionValue)) {
      return {
        type: "addedKong",
        payload: {
          meldId: option.meldId,
          tileId: option.tileId,
        },
        delayMs: getBotDelay(),
        infoMessage: "電腦正在考慮是否補槓...",
        resultMessage: `電腦補槓 ${getTileLabel(option.tileType)}。`,
      };
    }
  }

  return null;
}

function createClaimCandidate({ player, usedTileIds, lockedMeldsAfter, baseline, option, infoMessage, resultMessage, actionBonus }) {
  const remainingHand = removeTileIdsFromHand(player.hand || [], usedTileIds);
  const progress = evaluateHandProgress(remainingHand, lockedMeldsAfter);
  return {
    option,
    progress,
    infoMessage,
    resultMessage,
    actionValue: scoreActionOutcome(baseline, progress, actionBonus),
  };
}

function pickBestActionCandidate(candidates) {
  return candidates.reduce((best, candidate) => {
    if (!candidate) {
      return best;
    }
    if (!best) {
      return candidate;
    }
    if (candidate.progress.shanten < best.progress.shanten) {
      return candidate;
    }
    if (candidate.progress.shanten > best.progress.shanten) {
      return best;
    }
    if (candidate.actionValue > best.actionValue) {
      return candidate;
    }
    if (candidate.actionValue < best.actionValue) {
      return best;
    }
    return candidate.progress.score > best.progress.score ? candidate : best;
  }, null);
}

function shouldTakeStructuredAction(baseline, progress, actionValue) {
  if (progress.shanten < baseline.shanten) {
    return true;
  }

  if (progress.shanten > baseline.shanten) {
    return false;
  }

  return actionValue >= 12;
}

function scoreActionOutcome(baseline, progress, actionBonus = 0) {
  return (baseline.shanten - progress.shanten) * 220 + (progress.score - baseline.score) + actionBonus;
}

function shouldTakeSet(tileType, handCounts, difficulty, isKong) {
  if (!tileType) {
    return false;
  }

  if (isHonorTile(tileType)) {
    return true;
  }

  const rank = getTileRank(tileType);
  const suit = getTileSuit(tileType);
  const leftCount = handCounts[`${suit}${rank - 1}`] || 0;
  const rightCount = handCounts[`${suit}${rank + 1}`] || 0;
  const isolated = leftCount === 0 && rightCount === 0;

  if (isKong) {
    return isolated || rank === 1 || rank === 9;
  }

  return isolated || difficulty !== DEFAULT_SOLO_DIFFICULTY;
}

function shouldTakeChow(neededTypes, handCounts) {
  if (!Array.isArray(neededTypes) || neededTypes.length !== 2) {
    return false;
  }

  return neededTypes.every((tileType) => (handCounts[tileType] || 0) === 1);
}

function shouldDeclareOwnKong(tileType, handTileIds, difficulty) {
  const counts = countTileTypes(handTileIds || []);
  if (!tileType || (counts[tileType] || 0) <= 0) {
    return false;
  }

  if (isHonorTile(tileType)) {
    return true;
  }

  if (difficulty !== DEFAULT_SOLO_DIFFICULTY) {
    return true;
  }

  const rank = getTileRank(tileType);
  return rank === 1 || rank === 9;
}

function chooseDiscardTile(game, playerSeat, player, difficulty = DEFAULT_SOLO_DIFFICULTY) {
  const tileIds = Array.isArray(player && player.hand) ? [...player.hand] : [];
  if (difficulty === "hard") {
    return chooseProbabilisticDiscardTile(game, playerSeat, player);
  }
  if (difficulty === "normal") {
    return chooseStructuredDiscardTile(player);
  }

  return chooseSimpleDiscardTile(tileIds);
}

function chooseSimpleDiscardTile(handTileIds) {
  const tileIds = Array.isArray(handTileIds) ? [...handTileIds] : [];
  const counts = countTileTypes(tileIds);

  let bestTileId = tileIds[0] || "";
  let bestScore = -Infinity;

  for (const tileId of tileIds) {
    const score = scoreDiscardTile(tileId, counts);
    if (score > bestScore || (score === bestScore && tileId.localeCompare(bestTileId) > 0)) {
      bestTileId = tileId;
      bestScore = score;
    }
  }

  return bestTileId;
}

function chooseProbabilisticDiscardTile(game, playerSeat, player) {
  const tileIds = Array.isArray(player && player.hand) ? [...player.hand] : [];
  const counts = countTileTypes(tileIds);
  const lockedMelds = Array.isArray(player && player.melds) ? player.melds.length : 0;
  const analysisCache = createAnalysisCache();

  let bestTileId = tileIds[0] || "";
  let bestProgress = null;
  let bestValue = -Infinity;

  for (const tileId of tileIds) {
    const remainingHand = removeTileIdsFromHand(tileIds, [tileId]);
    const progress = evaluateProbabilisticHand(
      game,
      playerSeat,
      remainingHand,
      lockedMelds,
      [getTileType(tileId)],
      analysisCache,
    );
    const discardBias = scoreDiscardTile(tileId, counts);
    const candidateValue = progress.totalScore + discardBias * 3;

    if (!bestProgress) {
      bestTileId = tileId;
      bestProgress = progress;
      bestValue = candidateValue;
      continue;
    }

    if (progress.shanten < bestProgress.shanten) {
      bestTileId = tileId;
      bestProgress = progress;
      bestValue = candidateValue;
      continue;
    }

    if (progress.shanten > bestProgress.shanten) {
      continue;
    }

    if (candidateValue > bestValue || (candidateValue === bestValue && tileId.localeCompare(bestTileId) > 0)) {
      bestTileId = tileId;
      bestProgress = progress;
      bestValue = candidateValue;
    }
  }

  return bestTileId;
}

function chooseStructuredDiscardTile(player) {
  const tileIds = Array.isArray(player && player.hand) ? [...player.hand] : [];
  const counts = countTileTypes(tileIds);
  const lockedMelds = Array.isArray(player && player.melds) ? player.melds.length : 0;

  let bestTileId = tileIds[0] || "";
  let bestProgress = null;
  let bestTieScore = -Infinity;

  for (const tileId of tileIds) {
    const remainingHand = removeTileIdsFromHand(tileIds, [tileId]);
    const progress = evaluateHandProgress(remainingHand, lockedMelds);
    const discardBias = scoreDiscardTile(tileId, counts);
    const tieScore = progress.score + discardBias;

    if (!bestProgress) {
      bestTileId = tileId;
      bestProgress = progress;
      bestTieScore = tieScore;
      continue;
    }

    if (progress.shanten < bestProgress.shanten) {
      bestTileId = tileId;
      bestProgress = progress;
      bestTieScore = tieScore;
      continue;
    }

    if (progress.shanten > bestProgress.shanten) {
      continue;
    }

    if (progress.score > bestProgress.score) {
      bestTileId = tileId;
      bestProgress = progress;
      bestTieScore = tieScore;
      continue;
    }

    if (progress.score < bestProgress.score) {
      continue;
    }

    if (tieScore > bestTieScore || (tieScore === bestTieScore && tileId.localeCompare(bestTileId) > 0)) {
      bestTileId = tileId;
      bestProgress = progress;
      bestTieScore = tieScore;
    }
  }

  return bestTileId;
}

function scoreDiscardTile(tileId, counts) {
  const tileType = getTileType(tileId);
  const duplicates = counts[tileType] || 0;

  if (isHonorTile(tileType)) {
    let score = 12;
    if (duplicates >= 2) {
      score -= 8;
    }
    if (duplicates >= 3) {
      score -= 2;
    }
    return score;
  }

  const suit = getTileSuit(tileType);
  const rank = getTileRank(tileType);
  const leftOne = counts[`${suit}${rank - 1}`] || 0;
  const rightOne = counts[`${suit}${rank + 1}`] || 0;
  const leftTwo = counts[`${suit}${rank - 2}`] || 0;
  const rightTwo = counts[`${suit}${rank + 2}`] || 0;

  let score = 0;

  if (duplicates === 1) {
    score += 4;
  } else if (duplicates === 2) {
    score -= 4;
  } else if (duplicates >= 3) {
    score -= 7;
  }

  if (rank === 1 || rank === 9) {
    score += 4;
  } else if (rank === 2 || rank === 8) {
    score += 2;
  }

  if (leftOne > 0) {
    score -= 3;
  }
  if (rightOne > 0) {
    score -= 3;
  }
  if (leftTwo > 0) {
    score -= 1;
  }
  if (rightTwo > 0) {
    score -= 1;
  }

  if (leftOne === 0 && rightOne === 0 && leftTwo === 0 && rightTwo === 0) {
    score += 3;
  }

  if (rank >= 3 && rank <= 7 && leftOne > 0 && rightOne > 0) {
    score -= 2;
  }

  return score;
}

function getBotDelay(min = 800, max = 1500) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function evaluateHandProgress(handTileIds, lockedMelds = 0, cache = null) {
  const counts = countTileTypes(handTileIds || []);
  const cacheKey = cache ? `${lockedMelds}|${ALL_TILE_TYPES.map((tileType) => counts[tileType] || 0).join(",")}` : "";
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const vector = ALL_TILE_TYPES.map((tileType) => counts[tileType] || 0);
  const memo = new Map();
  const structure = searchBestStructure(vector, Boolean(false), lockedMelds, memo);
  const melds = Math.min(4, lockedMelds + structure.melds);
  const usefulTaatsu = Math.min(structure.taatsu, Math.max(0, 4 - melds));
  const pair = structure.pair ? 1 : 0;
  const shanten = Math.max(0, 8 - melds * 2 - usefulTaatsu - pair);
  const floating = Math.max(0, (handTileIds || []).length - melds * 3 - usefulTaatsu * 2 - pair * 2);
  const connectionBonus = scoreConnections(counts);
  const score =
    melds * 120 +
    usefulTaatsu * 34 +
    pair * 20 -
    shanten * 180 -
    floating * 7 -
    structure.isolated * 4 +
    connectionBonus;

  const result = {
    shanten,
    melds,
    taatsu: usefulTaatsu,
    pair,
    floating,
    isolated: structure.isolated,
    score,
  };

  if (cache) {
    cache.set(cacheKey, result);
  }

  return result;
}

function searchBestStructure(vector, pairUsed, lockedMelds, memo) {
  const key = `${pairUsed ? 1 : 0}:${vector.join("")}`;
  if (memo.has(key)) {
    return memo.get(key);
  }

  const index = vector.findIndex((count) => count > 0);
  if (index === -1) {
    const result = { melds: 0, taatsu: 0, pair: pairUsed ? 1 : 0, isolated: 0 };
    memo.set(key, result);
    return result;
  }

  let best = null;
  const count = vector[index];

  if (count >= 3) {
    best = pickBetterStructure(
      best,
      addStructureDelta(searchBestStructure(removeVectorTiles(vector, [index, index, index]), pairUsed, lockedMelds, memo), {
        melds: 1,
      }),
      lockedMelds,
    );
  }

  if (canFormSequence(vector, index)) {
    best = pickBetterStructure(
      best,
      addStructureDelta(searchBestStructure(removeVectorTiles(vector, [index, index + 1, index + 2]), pairUsed, lockedMelds, memo), {
        melds: 1,
      }),
      lockedMelds,
    );
  }

  if (count >= 2) {
    if (!pairUsed) {
      best = pickBetterStructure(best, searchBestStructure(removeVectorTiles(vector, [index, index]), true, lockedMelds, memo), lockedMelds);
    }

    best = pickBetterStructure(
      best,
      addStructureDelta(searchBestStructure(removeVectorTiles(vector, [index, index]), pairUsed, lockedMelds, memo), {
        taatsu: 1,
      }),
      lockedMelds,
    );
  }

  if (canFormAdjacentTaatsu(vector, index)) {
    best = pickBetterStructure(
      best,
      addStructureDelta(searchBestStructure(removeVectorTiles(vector, [index, index + 1]), pairUsed, lockedMelds, memo), {
        taatsu: 1,
      }),
      lockedMelds,
    );
  }

  if (canFormGappedTaatsu(vector, index)) {
    best = pickBetterStructure(
      best,
      addStructureDelta(searchBestStructure(removeVectorTiles(vector, [index, index + 2]), pairUsed, lockedMelds, memo), {
        taatsu: 1,
      }),
      lockedMelds,
    );
  }

  best = pickBetterStructure(
    best,
    addStructureDelta(searchBestStructure(removeVectorTiles(vector, [index]), pairUsed, lockedMelds, memo), {
      isolated: 1,
    }),
    lockedMelds,
  );

  memo.set(key, best);
  return best;
}

function addStructureDelta(base, delta) {
  return {
    melds: base.melds + (delta.melds || 0),
    taatsu: base.taatsu + (delta.taatsu || 0),
    pair: base.pair,
    isolated: base.isolated + (delta.isolated || 0),
  };
}

function pickBetterStructure(currentBest, candidate, lockedMelds) {
  if (!candidate) {
    return currentBest;
  }
  if (!currentBest) {
    return candidate;
  }

  const currentSummary = summarizeStructure(currentBest, lockedMelds);
  const candidateSummary = summarizeStructure(candidate, lockedMelds);

  if (candidateSummary.shanten < currentSummary.shanten) {
    return candidate;
  }
  if (candidateSummary.shanten > currentSummary.shanten) {
    return currentBest;
  }
  if (candidateSummary.melds > currentSummary.melds) {
    return candidate;
  }
  if (candidateSummary.melds < currentSummary.melds) {
    return currentBest;
  }
  if (candidateSummary.taatsu > currentSummary.taatsu) {
    return candidate;
  }
  if (candidateSummary.taatsu < currentSummary.taatsu) {
    return currentBest;
  }
  if (candidateSummary.pair > currentSummary.pair) {
    return candidate;
  }
  if (candidateSummary.pair < currentSummary.pair) {
    return currentBest;
  }
  if (candidateSummary.isolated < currentSummary.isolated) {
    return candidate;
  }
  if (candidateSummary.isolated > currentSummary.isolated) {
    return currentBest;
  }
  return candidate;
}

function summarizeStructure(structure, lockedMelds) {
  const melds = Math.min(4, lockedMelds + structure.melds);
  const taatsu = Math.min(structure.taatsu, Math.max(0, 4 - melds));
  const pair = structure.pair ? 1 : 0;
  const shanten = Math.max(0, 8 - melds * 2 - taatsu - pair);
  return {
    shanten,
    melds,
    taatsu,
    pair,
    isolated: structure.isolated,
  };
}

function removeVectorTiles(vector, indexes) {
  const next = [...vector];
  for (const index of indexes) {
    next[index] -= 1;
  }
  return next;
}

function canFormSequence(vector, index) {
  if (!isSuitVectorIndex(index)) {
    return false;
  }
  const rank = (index % 9) + 1;
  return rank <= 7 && vector[index + 1] > 0 && vector[index + 2] > 0;
}

function canFormAdjacentTaatsu(vector, index) {
  if (!isSuitVectorIndex(index)) {
    return false;
  }
  const rank = (index % 9) + 1;
  return rank <= 8 && vector[index + 1] > 0;
}

function canFormGappedTaatsu(vector, index) {
  if (!isSuitVectorIndex(index)) {
    return false;
  }
  const rank = (index % 9) + 1;
  return rank <= 7 && vector[index + 2] > 0;
}

function isSuitVectorIndex(index) {
  return index >= 0 && index < 27;
}

function getTilesOfTypeFromHand(handTileIds, tileType, neededCount) {
  const matches = [];
  for (const tileId of handTileIds || []) {
    if (getTileType(tileId) === tileType) {
      matches.push(tileId);
      if (matches.length === neededCount) {
        return matches;
      }
    }
  }
  return matches;
}

function getTilesForNeededTypes(handTileIds, neededTypes) {
  const remaining = [...(handTileIds || [])];
  const selected = [];
  for (const neededType of neededTypes || []) {
    const matchIndex = remaining.findIndex((tileId) => getTileType(tileId) === neededType);
    if (matchIndex === -1) {
      return [];
    }
    selected.push(remaining[matchIndex]);
    remaining.splice(matchIndex, 1);
  }
  return selected;
}

function removeTileIdsFromHand(handTileIds, tileIdsToRemove) {
  const remaining = [...(handTileIds || [])];
  for (const tileId of tileIdsToRemove || []) {
    const removeIndex = remaining.indexOf(tileId);
    if (removeIndex !== -1) {
      remaining.splice(removeIndex, 1);
    }
  }
  return remaining;
}

function scoreConnections(counts) {
  let score = 0;

  for (const tileType of Object.keys(counts)) {
    const count = counts[tileType] || 0;
    if (!count) {
      continue;
    }

    if (isHonorTile(tileType)) {
      if (count >= 2) {
        score += 8;
      }
      continue;
    }

    const suit = getTileSuit(tileType);
    const rank = getTileRank(tileType);
    const leftOne = counts[`${suit}${rank - 1}`] || 0;
    const rightOne = counts[`${suit}${rank + 1}`] || 0;
    const leftTwo = counts[`${suit}${rank - 2}`] || 0;
    const rightTwo = counts[`${suit}${rank + 2}`] || 0;

    score += Math.min(count, 2) * 2;
    score += (leftOne + rightOne) * 4;
    score += (leftTwo + rightTwo) * 2;

    if (rank >= 3 && rank <= 7 && leftOne > 0 && rightOne > 0) {
      score += 6;
    }
  }

  return score;
}

function createProbabilisticActionCandidate({
  game,
  playerSeat,
  remainingHand,
  lockedMeldsAfter,
  baseline,
  option,
  infoMessage,
  resultMessage,
  actionBonus,
  extraVisibleTileTypes,
  analysisCache,
}) {
  const progress = evaluateProbabilisticHand(
    game,
    playerSeat,
    remainingHand,
    lockedMeldsAfter,
    extraVisibleTileTypes,
    analysisCache,
  );
  return {
    option,
    progress,
    infoMessage,
    resultMessage,
    actionValue: scoreProbabilisticOutcome(baseline, progress, actionBonus),
  };
}

function shouldTakeProbabilisticAction(baseline, progress, actionValue) {
  if (progress.shanten < baseline.shanten) {
    return true;
  }

  if (progress.shanten > baseline.shanten) {
    return false;
  }

  if (progress.effectiveTileCount > baseline.effectiveTileCount + 2) {
    return true;
  }

  return actionValue >= 18;
}

function scoreProbabilisticOutcome(baseline, progress, actionBonus = 0) {
  return progress.totalScore - baseline.totalScore + actionBonus;
}

function evaluateProbabilisticHand(game, playerSeat, handTileIds, lockedMelds = 0, extraVisibleTileTypes = [], analysisCache = createAnalysisCache()) {
  const base = evaluateHandProgress(handTileIds, lockedMelds, analysisCache.progressCache);
  const future = evaluateFutureDrawPotential(
    game,
    playerSeat,
    handTileIds,
    lockedMelds,
    extraVisibleTileTypes,
    base,
    analysisCache,
  );
  const totalScore = base.score * 2 + future.expectedImprovement * 1.35 + future.effectiveTileCount * 8 + future.improvementTypeCount * 4;

  return {
    ...base,
    ...future,
    totalScore,
  };
}

function evaluateFutureDrawPotential(
  game,
  playerSeat,
  handTileIds,
  lockedMelds,
  extraVisibleTileTypes,
  baseProgress,
  analysisCache,
) {
  const availability = buildAvailabilityMap(game, playerSeat, handTileIds, extraVisibleTileTypes);
  const totalAvailable = Object.values(availability).reduce((sum, count) => sum + count, 0);

  if (!totalAvailable) {
    return {
      expectedImprovement: -24,
      effectiveTileCount: 0,
      improvementTypeCount: 0,
      bestDrawType: null,
      bestImprovement: -24,
    };
  }

  let weightedImprovement = 0;
  let effectiveTileCount = 0;
  let improvementTypeCount = 0;
  let bestDrawType = null;
  let bestImprovement = -Infinity;

  for (const [tileType, availableCount] of Object.entries(availability)) {
    if (availableCount <= 0) {
      continue;
    }

    const progress = evaluateHandProgress([...handTileIds, tileType], lockedMelds, analysisCache.progressCache);
    const improvement = (baseProgress.shanten - progress.shanten) * 240 + (progress.score - baseProgress.score);
    weightedImprovement += improvement * availableCount;

    if (improvement > 0) {
      effectiveTileCount += availableCount;
      improvementTypeCount += 1;
    }

    if (improvement > bestImprovement) {
      bestImprovement = improvement;
      bestDrawType = tileType;
    }
  }

  return {
    expectedImprovement: weightedImprovement / totalAvailable,
    effectiveTileCount,
    improvementTypeCount,
    bestDrawType,
    bestImprovement,
  };
}

function buildAvailabilityMap(game, playerSeat, handTileIds, extraVisibleTileTypes = []) {
  const ruleset = getRuleset((game && game.rulesetId) || undefined);
  const visibleCounts = {};

  for (const player of game && Array.isArray(game.players) ? game.players : []) {
    for (const discard of player.discards || []) {
      incrementTileTypeCount(visibleCounts, getTileType(discard.tileId || discard));
    }
    for (const meld of player.melds || []) {
      for (const tileId of meld.tiles || []) {
        incrementTileTypeCount(visibleCounts, getTileType(tileId));
      }
    }
  }

  for (const tileId of handTileIds || []) {
    incrementTileTypeCount(visibleCounts, getTileType(tileId));
  }

  for (const tileType of extraVisibleTileTypes || []) {
    incrementTileTypeCount(visibleCounts, tileType);
  }

  const availability = {};
  for (const tileType of ruleset.tileTypes) {
    availability[tileType] = Math.max(0, 4 - (visibleCounts[tileType] || 0));
  }
  return availability;
}

function incrementTileTypeCount(counts, tileType) {
  if (!tileType) {
    return;
  }
  counts[tileType] = (counts[tileType] || 0) + 1;
}

function createAnalysisCache() {
  return {
    progressCache: new Map(),
  };
}
