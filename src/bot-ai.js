import { getPlayerClientState } from "./game.js?v=20260428c";
import {
  countTileTypes,
  getRuleset,
  getTileLabel,
  getTileRank,
  getTileSuit,
  getTileType,
  getTilesByType,
  isHonorTile,
  isSuitTile,
} from "./rules.js?v=20260425i";
import { estimateScoringPotential, normalizeScoringEnabled, scoreFromTai } from "./scoring.js?v=20260428c";

export const DEFAULT_SOLO_DIFFICULTY = "hard";
export const SOLO_DIFFICULTY_LABELS = {
  easy: "簡單",
  normal: "普通",
  hard: "困難",
  god: "賭神",
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

const DEFAULT_LOOKAHEAD_CANDIDATE_LIMIT = 1;
const DEFAULT_LOOKAHEAD_DRAW_LIMIT = 2;

const DIFFICULTY_PROFILES = {
  easy: {
    id: "easy",
    structured: false,
    advanced: false,
    lookahead: false,
    actionThreshold: 0,
    attackFactor: 1,
    riskMultiplier: 1,
    lookaheadWeight: 0,
    lookaheadCandidateLimit: 0,
    lookaheadDrawLimit: 0,
    lookaheadActivationGap: 0,
    lookaheadMaxShanten: 0,
    guaranteedLookaheadShanten: 0,
    taiWeight: 0,
    projectedScoreWeight: 0,
  },
  normal: {
    id: "normal",
    structured: true,
    advanced: false,
    lookahead: false,
    actionThreshold: 0,
    attackFactor: 1,
    riskMultiplier: 1,
    lookaheadWeight: 0,
    lookaheadCandidateLimit: 0,
    lookaheadDrawLimit: 0,
    lookaheadActivationGap: 0,
    lookaheadMaxShanten: 0,
    guaranteedLookaheadShanten: 0,
    taiWeight: 0,
    projectedScoreWeight: 0,
  },
  hard: {
    id: "hard",
    structured: false,
    advanced: true,
    lookahead: false,
    actionThreshold: 7,
    attackFactor: 1.07,
    riskMultiplier: 0.9,
    lookaheadWeight: 0,
    lookaheadCandidateLimit: 0,
    lookaheadDrawLimit: 0,
    lookaheadActivationGap: 0,
    lookaheadMaxShanten: 0,
    guaranteedLookaheadShanten: 0,
    scoringWeight: 0.28,
    scoreGapWeight: 0.1,
    exposurePenaltyScale: 18,
    taiWeight: 8,
    projectedScoreWeight: 0.08,
  },
  god: {
    id: "god",
    structured: false,
    advanced: true,
    lookahead: true,
    actionThreshold: 6,
    attackFactor: 1.14,
    riskMultiplier: 0.78,
    lookaheadWeight: 1.55,
    lookaheadCandidateLimit: 1,
    lookaheadDrawLimit: 2,
    lookaheadActivationGap: 8,
    lookaheadMaxShanten: 3,
    guaranteedLookaheadShanten: 1,
    scoringWeight: 1.12,
    scoreGapWeight: 0.28,
    exposurePenaltyScale: 30,
    taiWeight: 26,
    projectedScoreWeight: 0.28,
  },
};

export function normalizeSoloDifficulty(value) {
  return Object.prototype.hasOwnProperty.call(SOLO_DIFFICULTY_LABELS, value) ? value : DEFAULT_SOLO_DIFFICULTY;
}

export function decideBotAction(game, playerSeat, difficulty = DEFAULT_SOLO_DIFFICULTY) {
  const normalizedDifficulty = normalizeSoloDifficulty(difficulty);
  const profile = getDifficultyProfile(normalizedDifficulty);
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

  const claimDecision = decideClaimAction(game, playerSeat, clientState, profile);
  if (claimDecision) {
    return claimDecision;
  }

  const kongDecision = decideKongAction(game, playerSeat, player, clientState, profile);
  if (kongDecision) {
    return kongDecision;
  }

  if (clientState.canDiscard) {
    const discardDecision = chooseDiscardDecision(game, playerSeat, player, profile);
    return {
      type: "discardTile",
      payload: { tileId: discardDecision.tileId },
      delayMs: getBotDelay(),
      infoMessage: "電腦思考出牌中...",
      resultMessage: `電腦打出 ${getTileLabel(discardDecision.tileId)}。`,
      debugSummary: discardDecision.debugSummary,
    };
  }

  return null;
}

function getDifficultyProfile(difficulty) {
  return DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES[DEFAULT_SOLO_DIFFICULTY];
}

function isScoringStrategyEnabled(game, profile) {
  return Boolean(profile && profile.advanced && normalizeScoringEnabled(game && game.scoringEnabled));
}

function getScoringProfileId(profile) {
  return profile && profile.id === "god" ? "god" : "hard";
}

function decideClaimAction(game, playerSeat, clientState, profile) {
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

  if (profile.advanced) {
    return decideAdvancedClaimAction(game, playerSeat, clientState, options, pendingClaim, profile);
  }

  if (profile.structured) {
    return decideStructuredClaimAction(game, playerSeat, clientState, options, pendingClaim);
  }

  return decideEasyClaimAction(game, playerSeat, options, pendingClaim);
}

function decideKongAction(game, playerSeat, player, clientState, profile) {
  if (profile.advanced) {
    return decideAdvancedKongAction(game, playerSeat, player, clientState, profile);
  }

  if (profile.structured) {
    return decideStructuredKongAction(player, clientState);
  }

  return decideEasyKongAction(player, clientState, profile.id);
}

function chooseDiscardDecision(game, playerSeat, player, profile) {
  if (profile.advanced) {
    return chooseAdvancedDiscardDecision(game, playerSeat, player, profile);
  }

  if (profile.structured) {
    return chooseStructuredDiscardDecision(player);
  }

  const tileId = chooseSimpleDiscardTile(Array.isArray(player && player.hand) ? [...player.hand] : []);
  return {
    tileId,
    debugSummary: `簡單模式：優先丟孤張、字牌與邊張，選擇 ${getTileLabel(tileId)}。`,
  };
}

function decideEasyClaimAction(game, playerSeat, options, pendingClaim) {
  const tileType = getTileType(pendingClaim.tileId || pendingClaim.tileType || "");
  const handCounts = countTileTypes(game.players[playerSeat].hand || []);

  const kongOption = options.find((option) => option.type === "claimDiscardKong");
  if (kongOption && shouldTakeSet(tileType, handCounts, DEFAULT_SOLO_DIFFICULTY, true)) {
    return {
      type: "claimDiscardKong",
      delayMs: getBotDelay(),
      infoMessage: "電腦正在考慮是否槓牌...",
      resultMessage: `電腦槓了 ${getTileLabel(tileType)}。`,
    };
  }

  const pungOption = options.find((option) => option.type === "claimPung");
  if (pungOption && shouldTakeSet(tileType, handCounts, DEFAULT_SOLO_DIFFICULTY, false)) {
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

function decideAdvancedClaimAction(game, playerSeat, clientState, options, pendingClaim, profile) {
  const player = game && Array.isArray(game.players) ? game.players[playerSeat] : null;
  if (!player) {
    return null;
  }

  const analysisCache = createAnalysisCache();
  const lockedMelds = Array.isArray(player.melds) ? player.melds.length : 0;
  const baseline = evaluateAdvancedHand(game, playerSeat, player.hand || [], lockedMelds, [], analysisCache, profile);
  const battleProfile = deriveBattleProfile(game, playerSeat, baseline);
  const claimTileId = pendingClaim.tileId || pendingClaim.tileType || "";
  const claimTileType = getTileType(claimTileId);
  const candidates = [];

  const kongOption = options.find((option) => option.type === "claimDiscardKong");
  if (kongOption) {
    const usedTileIds = getTilesOfTypeFromHand(player.hand || [], claimTileType, 3);
    if (usedTileIds.length === 3) {
      candidates.push(
        createAdvancedActionCandidate({
          game,
          playerSeat,
          baseline,
          battleProfile,
          remainingHand: removeTileIdsFromHand(player.hand || [], usedTileIds),
          lockedMeldsAfter: lockedMelds + 1,
          option: kongOption,
          infoMessage: "電腦正在評估是否槓牌...",
          resultMessage: `電腦槓了 ${getTileLabel(claimTileType)}。`,
          actionBonus: 36,
          extraVisibleTileTypes: usedTileIds.map((tileId) => getTileType(tileId)),
          analysisCache,
          profile,
          actionName: "槓牌",
          exposureDelta: 1,
        }),
      );
    }
  }

  const pungOption = options.find((option) => option.type === "claimPung");
  if (pungOption) {
    const usedTileIds = getTilesOfTypeFromHand(player.hand || [], claimTileType, 2);
    if (usedTileIds.length === 2) {
      candidates.push(
        createAdvancedActionCandidate({
          game,
          playerSeat,
          baseline,
          battleProfile,
          remainingHand: removeTileIdsFromHand(player.hand || [], usedTileIds),
          lockedMeldsAfter: lockedMelds + 1,
          option: pungOption,
          infoMessage: "電腦正在評估是否碰牌...",
          resultMessage: `電腦碰了 ${getTileLabel(claimTileType)}。`,
          actionBonus: isHonorTile(claimTileType) ? 20 : 12,
          extraVisibleTileTypes: usedTileIds.map((tileId) => getTileType(tileId)),
          analysisCache,
          profile,
          actionName: "碰牌",
          exposureDelta: 1,
        }),
      );
    }
  }

  for (const chowOption of options.filter((option) => option.type === "claimChow")) {
    const usedTileIds = getTilesForNeededTypes(player.hand || [], chowOption.neededTypes || []);
    if (usedTileIds.length === 2) {
      candidates.push(
        createAdvancedActionCandidate({
          game,
          playerSeat,
          baseline,
          battleProfile,
          remainingHand: removeTileIdsFromHand(player.hand || [], usedTileIds),
          lockedMeldsAfter: lockedMelds + 1,
          option: chowOption,
          infoMessage: "電腦正在評估是否吃牌...",
          resultMessage: `電腦吃了 ${chowOption.label.replace(/^吃\s*/, "")}。`,
          actionBonus: 10,
          extraVisibleTileTypes: usedTileIds.map((tileId) => getTileType(tileId)),
          analysisCache,
          profile,
          actionName: "吃牌",
          exposureDelta: 1,
        }),
      );
    }
  }

  const bestCandidate = pickBestActionCandidate(candidates);
  if (bestCandidate && shouldTakeAdvancedAction(baseline, bestCandidate, battleProfile, profile)) {
    return {
      type: bestCandidate.option.type,
      payload: bestCandidate.option.neededTypes ? { neededTypes: bestCandidate.option.neededTypes } : undefined,
      delayMs: getBotDelay(),
      infoMessage: bestCandidate.infoMessage,
      resultMessage: bestCandidate.resultMessage,
      debugSummary: bestCandidate.debugSummary,
    };
  }

  return {
    type: "passClaim",
    delayMs: getBotDelay(600, 1100),
    infoMessage: "電腦正在評估是否過牌...",
    resultMessage: "電腦選擇過牌。",
    debugSummary: buildPassDecisionSummary({
      modeLabel: SOLO_DIFFICULTY_LABELS[profile.id],
      reason: bestCandidate
        ? `最佳候選 ${bestCandidate.actionName} EV ${bestCandidate.actionValue.toFixed(1)}，未達門檻。`
        : "沒有任何吃碰槓候選可提升牌效。",
    }),
  };
}

function decideEasyKongAction(player, clientState, difficulty) {
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

function decideAdvancedKongAction(game, playerSeat, player, clientState, profile) {
  const handTileIds = player.hand || [];
  const lockedMelds = Array.isArray(player.melds) ? player.melds.length : 0;
  const analysisCache = createAnalysisCache();
  const baseline = evaluateAdvancedHand(game, playerSeat, handTileIds, lockedMelds, [], analysisCache, profile);
  const battleProfile = deriveBattleProfile(game, playerSeat, baseline);

  for (const tileType of clientState.concealedKongs || []) {
    const usedTileIds = getTilesOfTypeFromHand(handTileIds, tileType, 4);
    if (usedTileIds.length !== 4) {
      continue;
    }

    const decision = createAdvancedActionCandidate({
      game,
      playerSeat,
      baseline,
      battleProfile,
      remainingHand: removeTileIdsFromHand(handTileIds, usedTileIds),
      lockedMeldsAfter: lockedMelds + 1,
      option: { type: "concealedKong", tileType },
      infoMessage: "電腦正在評估是否暗槓...",
      resultMessage: `電腦暗槓 ${getTileLabel(tileType)}。`,
      actionBonus: 28,
      extraVisibleTileTypes: usedTileIds.map((tileId) => getTileType(tileId)),
      analysisCache,
      profile,
      actionName: "暗槓",
      exposureDelta: 1,
      payload: { tileType },
    });

    if (shouldTakeAdvancedAction(baseline, decision, battleProfile, profile)) {
      return {
        type: "concealedKong",
        payload: { tileType },
        delayMs: getBotDelay(),
        infoMessage: decision.infoMessage,
        resultMessage: decision.resultMessage,
        debugSummary: decision.debugSummary,
      };
    }
  }

  for (const option of clientState.addedKongs || []) {
    const decision = createAdvancedActionCandidate({
      game,
      playerSeat,
      baseline,
      battleProfile,
      remainingHand: removeTileIdsFromHand(handTileIds, [option.tileId]),
      lockedMeldsAfter: lockedMelds,
      option,
      infoMessage: "電腦正在評估是否補槓...",
      resultMessage: `電腦補槓 ${getTileLabel(option.tileType)}。`,
      actionBonus: 18,
      extraVisibleTileTypes: [option.tileType],
      analysisCache,
      profile,
      actionName: "補槓",
      exposureDelta: 0.45,
      payload: {
        meldId: option.meldId,
        tileId: option.tileId,
      },
    });

    if (shouldTakeAdvancedAction(baseline, decision, battleProfile, profile)) {
      return {
        type: "addedKong",
        payload: {
          meldId: option.meldId,
          tileId: option.tileId,
        },
        delayMs: getBotDelay(),
        infoMessage: decision.infoMessage,
        resultMessage: decision.resultMessage,
        debugSummary: decision.debugSummary,
      };
    }
  }

  return null;
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

function chooseStructuredDiscardDecision(player) {
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

  return {
    tileId: bestTileId,
    debugSummary: `普通模式：優先維持搭子、對子與向聽進展，選擇 ${getTileLabel(bestTileId)}。`,
  };
}

function chooseAdvancedDiscardDecision(game, playerSeat, player, profile) {
  const tileIds = Array.isArray(player && player.hand) ? [...player.hand] : [];
  const counts = countTileTypes(tileIds);
  const lockedMelds = Array.isArray(player && player.melds) ? player.melds.length : 0;
  const analysisCache = createAnalysisCache();
  const baseline = evaluateAdvancedHand(game, playerSeat, tileIds, lockedMelds, [], analysisCache, profile);
  const battleProfile = deriveBattleProfile(game, playerSeat, baseline);

  const candidates = evaluateDiscardCandidates({
    game,
    playerSeat,
    tileIds,
    counts,
    lockedMelds,
    baseline,
    battleProfile,
    profile,
    analysisCache,
  });
  const bestCandidate = candidates[0];

  return {
    tileId: bestCandidate.tileId,
    debugSummary: buildDiscardDecisionSummary(profile, battleProfile, candidates),
  };
}

function evaluateDiscardCandidates({
  game,
  playerSeat,
  tileIds,
  counts,
  lockedMelds,
  baseline,
  battleProfile,
  profile,
  analysisCache,
}) {
  const candidates = getCandidateDiscardTileIds(tileIds).map((tileId) => {
    const remainingHand = removeTileIdsFromHand(tileIds, [tileId]);
    const progress = evaluateAdvancedHand(
      game,
      playerSeat,
      remainingHand,
      lockedMelds,
      [getTileType(tileId)],
      analysisCache,
      profile,
    );
    const discardRisk = evaluateDiscardRisk(game, playerSeat, tileId, battleProfile, analysisCache);
    const discardBias = scoreDiscardTile(tileId, counts);
    const actionValue = evaluateActionEV({
      baseline,
      progress,
      battleProfile,
      actionBonus: 0,
      discardRisk,
      discardBias,
      exposureDelta: 0,
      lookaheadBonus: 0,
      profile,
    });

    return {
      tileId,
      progress,
      discardRisk,
      discardBias,
      actionValue,
      lookaheadBonus: 0,
      totalScore: actionValue,
    };
  });

  sortDiscardCandidates(candidates);

  if (profile.lookahead && shouldRunLookahead(baseline, candidates, profile)) {
    const candidateLimit = profile.lookaheadCandidateLimit || DEFAULT_LOOKAHEAD_CANDIDATE_LIMIT;
    for (const candidate of candidates.slice(0, candidateLimit)) {
      candidate.lookaheadBonus = evaluateLookaheadPotential({
        game,
        playerSeat,
        handTileIds: removeTileIdsFromHand(tileIds, [candidate.tileId]),
        lockedMelds,
        battleProfile,
        analysisCache,
        profile,
      });
      candidate.totalScore += candidate.lookaheadBonus;
    }
    sortDiscardCandidates(candidates);
  }

  return candidates;
}

function sortDiscardCandidates(candidates) {
  candidates.sort((left, right) => {
    if (left.progress.shanten !== right.progress.shanten) {
      return left.progress.shanten - right.progress.shanten;
    }
    if (right.totalScore !== left.totalScore) {
      return right.totalScore - left.totalScore;
    }
    if (left.discardRisk !== right.discardRisk) {
      return left.discardRisk - right.discardRisk;
    }
    return left.tileId.localeCompare(right.tileId);
  });
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

function createAdvancedActionCandidate({
  game,
  playerSeat,
  baseline,
  battleProfile,
  remainingHand,
  lockedMeldsAfter,
  option,
  infoMessage,
  resultMessage,
  actionBonus,
  extraVisibleTileTypes,
  analysisCache,
  profile,
  actionName,
  exposureDelta,
  payload,
}) {
  const progress = evaluateAdvancedHand(
    game,
    playerSeat,
    remainingHand,
    lockedMeldsAfter,
    extraVisibleTileTypes,
    analysisCache,
    profile,
  );
  const lookaheadBonus = profile.lookahead && shouldRunActionLookahead(baseline, progress, profile)
    ? evaluateLookaheadPotential({
        game,
        playerSeat,
        handTileIds: remainingHand,
        lockedMelds: lockedMeldsAfter,
        battleProfile,
        analysisCache,
        profile,
      })
    : 0;
  const actionValue = evaluateActionEV({
    baseline,
    progress,
    battleProfile,
      actionBonus,
      discardRisk: 0,
      discardBias: 0,
      exposureDelta,
      lookaheadBonus,
      profile,
    });

  return {
    option,
    payload,
    progress,
    infoMessage,
    resultMessage,
    actionName,
    actionValue,
    lookaheadBonus,
    exposureDelta,
    debugSummary: buildActionDecisionSummary({
      modeLabel: SOLO_DIFFICULTY_LABELS[profile.id],
      actionName,
      progress,
      battleProfile,
      actionValue,
      lookaheadBonus,
    }),
  };
}

function shouldRunActionLookahead(baseline, progress, profile) {
  const guaranteedShanten = profile.guaranteedLookaheadShanten || 0;
  if (progress.shanten <= guaranteedShanten) {
    return true;
  }

  return baseline.shanten <= 1 && progress.shanten <= baseline.shanten;
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
    return candidate.progress.totalScore > best.progress.totalScore ? candidate : best;
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

function shouldTakeAdvancedAction(baseline, candidate, battleProfile, profile) {
  const progress = candidate.progress;
  const threshold = profile.actionThreshold + battleProfile.defenseWeight * 2;
  const scoringMode = Boolean(baseline.scoringPotential || progress.scoringPotential);
  const baselineProjectedTai = baseline.scoringPotential ? baseline.scoringPotential.projectedTai : 0;
  const progressProjectedTai = progress.scoringPotential ? progress.scoringPotential.projectedTai : 0;

  if (progress.shanten < baseline.shanten) {
    return true;
  }

  if (progress.shanten > baseline.shanten && candidate.lookaheadBonus < 24) {
    return false;
  }

  if (scoringMode && progress.shanten === baseline.shanten) {
    const taiLossTolerance = profile.id === "god" ? 0.45 : 1.75;
    const openTaiLossTolerance = profile.id === "god" ? 0.25 : 1.25;
    if (progressProjectedTai + taiLossTolerance < baselineProjectedTai && candidate.lookaheadBonus < 18) {
      return false;
    }
    if (candidate.exposureDelta > 0 && progressProjectedTai + openTaiLossTolerance < baselineProjectedTai && candidate.lookaheadBonus < 24) {
      return false;
    }
  }

  if (progress.effectiveTileCount >= baseline.effectiveTileCount + 3) {
    return true;
  }

  if (candidate.lookaheadBonus >= 28) {
    return true;
  }

  return candidate.actionValue >= threshold;
}

function scoreActionOutcome(baseline, progress, actionBonus = 0) {
  return (baseline.shanten - progress.shanten) * 220 + (progress.score - baseline.score) + actionBonus;
}

function evaluateActionEV({
  baseline,
  progress,
  battleProfile,
  actionBonus = 0,
  discardRisk = 0,
  discardBias = 0,
  exposureDelta = 0,
  lookaheadBonus = 0,
  profile = DIFFICULTY_PROFILES.hard,
}) {
  const attackFactor = profile.attackFactor || 1;
  const riskMultiplier = profile.riskMultiplier || 1;
  const lookaheadWeight = profile.lookaheadWeight || 0;
  const scoreGapWeight = profile.scoreGapWeight || 0;
  const progressDelta = progress.totalScore - baseline.totalScore;
  const scoringDelta = (progress.scoringScore || 0) - (baseline.scoringScore || 0);
  const baselineProjectedTai = baseline.scoringPotential ? baseline.scoringPotential.projectedTai : 0;
  const progressProjectedTai = progress.scoringPotential ? progress.scoringPotential.projectedTai : 0;
  const taiDelta = progressProjectedTai - baselineProjectedTai;
  const baselineProjectedScore = baseline.scoringPotential ? scoreFromTai(baseline.scoringPotential.roundedProjectedTai) : 0;
  const progressProjectedScore = progress.scoringPotential ? scoreFromTai(progress.scoringPotential.roundedProjectedTai) : 0;
  const projectedScoreDelta = progressProjectedScore - baselineProjectedScore;
  const scoringMode = Boolean(baseline.scoringPotential || progress.scoringPotential);
  const exposurePenaltyScale = scoringMode
    ? profile.exposurePenaltyScale || 24
    : 18;
  const taiWeight = scoringMode ? profile.taiWeight ?? 22 : 0;
  const projectedScoreWeight = scoringMode ? profile.projectedScoreWeight ?? 0.22 : 0;

  return (
    progressDelta * attackFactor +
    scoringDelta * scoreGapWeight * battleProfile.attackWeight +
    taiDelta * taiWeight * battleProfile.attackWeight +
    projectedScoreDelta * projectedScoreWeight * battleProfile.attackWeight +
    actionBonus +
    discardBias * 2 -
    discardRisk * battleProfile.defenseWeight * riskMultiplier -
    exposureDelta * exposurePenaltyScale * battleProfile.defenseWeight * riskMultiplier +
    lookaheadBonus * lookaheadWeight
  );
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

function evaluateAdvancedHand(
  game,
  playerSeat,
  handTileIds,
  lockedMelds = 0,
  extraVisibleTileTypes = [],
  analysisCache = createAnalysisCache(),
  profile = DIFFICULTY_PROFILES.hard,
) {
  const cacheKey = createAdvancedHandCacheKey(game, playerSeat, handTileIds, lockedMelds, extraVisibleTileTypes, profile);
  if (analysisCache.advancedCache.has(cacheKey)) {
    return analysisCache.advancedCache.get(cacheKey);
  }

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
  const shapeScore = evaluateShape(base);
  const availabilityScore = evaluateAvailability(future, base);
  const flexibilityScore = evaluateFlexibility(handTileIds);
  const scoringPotential = isScoringStrategyEnabled(game, profile)
    ? getCachedScoringPotential({
        game,
        playerSeat,
        handTileIds,
        extraVisibleTileTypes,
        analysisCache,
        profile,
      })
    : null;
  const scoringScore = scoringPotential ? scoringPotential.evScore * (profile.scoringWeight || 0.5) : 0;
  const totalScore = shapeScore + availabilityScore + flexibilityScore + scoringScore;

  const result = {
    ...base,
    ...future,
    shapeScore,
    availabilityScore,
    flexibilityScore,
    scoringPotential,
    scoringScore,
    totalScore,
  };

  analysisCache.advancedCache.set(cacheKey, result);
  return result;
}

function getCachedScoringPotential({
  game,
  playerSeat,
  handTileIds,
  extraVisibleTileTypes,
  analysisCache,
  profile,
}) {
  const counts = countTileTypes(handTileIds || []);
  const countKey = ALL_TILE_TYPES.map((tileType) => counts[tileType] || 0).join(",");
  const extraKey = [...(extraVisibleTileTypes || [])].map(getTileType).sort().join(",");
  const scoringProfileId = getScoringProfileId(profile);
  const visibleCounts = buildVisibleCounts(game, playerSeat, handTileIds, extraVisibleTileTypes, analysisCache);
  const visibleKey = ALL_TILE_TYPES.map((tileType) => visibleCounts[tileType] || 0).join(",");
  const meldKey = getPlayerMelds(game, playerSeat)
    .map((meld) => `${meld.type}:${meld.tileType || ""}:${meld.concealed ? 1 : 0}`)
    .join("|");
  const cacheKey = `${playerSeat}|${countKey}|${extraKey}|${visibleKey}|${meldKey}|${scoringProfileId}`;

  if (analysisCache.scoringCache.has(cacheKey)) {
    return analysisCache.scoringCache.get(cacheKey);
  }

  const scoringPotential = estimateScoringPotential({
    handTileIds,
    melds: getPlayerMelds(game, playerSeat),
    visibleCounts,
    profile: scoringProfileId,
  });
  analysisCache.scoringCache.set(cacheKey, scoringPotential);
  return scoringPotential;
}

function evaluateShape(progress) {
  return (
    progress.melds * 120 +
    progress.taatsu * 40 +
    progress.pair * 20 -
    progress.shanten * 220 -
    progress.floating * 10 -
    progress.isolated * 12
  );
}

function evaluateAvailability(future, progress) {
  return (
    future.expectedImprovement * 1.35 +
    future.effectiveTileCount * 10 +
    future.improvementTypeCount * 5 +
    (future.bestImprovement > 0 ? Math.min(future.bestImprovement, 220) * 0.25 : 0) -
    progress.shanten * 6
  );
}

function evaluateFlexibility(handTileIds) {
  const counts = countTileTypes(handTileIds || []);
  let score = 0;

  for (const tileType of Object.keys(counts)) {
    const count = counts[tileType] || 0;
    if (!count) {
      continue;
    }

    if (isHonorTile(tileType)) {
      if (count === 1) {
        score -= 4;
      }
      if (count >= 2) {
        score += 6;
      }
      continue;
    }

    const rank = getTileRank(tileType);
    if (rank >= 3 && rank <= 7) {
      score += count * 2;
    }
    if (rank === 1 || rank === 9) {
      score -= count;
    }
  }

  return score;
}

function deriveBattleProfile(game, playerSeat, baseProgress) {
  const opponentSeat = getOpponentSeat(playerSeat);
  const opponent = game && Array.isArray(game.players) ? game.players[opponentSeat] : null;
  const openMelds = opponent && Array.isArray(opponent.melds) ? opponent.melds.filter((meld) => !meld.concealed).length : 0;
  const opponentDiscardCount = opponent && Array.isArray(opponent.discards) ? opponent.discards.length : 0;

  let attackWeight = 1;
  let defenseWeight = 0.9;

  if (baseProgress.shanten <= 1) {
    attackWeight += 0.45;
    defenseWeight -= 0.15;
  } else if (baseProgress.shanten >= 4) {
    attackWeight -= 0.12;
    defenseWeight += 0.2;
  }

  if (openMelds >= 1) {
    defenseWeight += 0.2 + openMelds * 0.1;
  }

  if (opponentDiscardCount >= 8) {
    defenseWeight += 0.08;
  }

  if (normalizeScoringEnabled(game && game.scoringEnabled) && Array.isArray(game && game.scores)) {
    const myScore = Number(game.scores[playerSeat]) || 0;
    const opponentScore = Number(game.scores[opponentSeat]) || 0;
    const scoreGap = myScore - opponentScore;

    if (scoreGap <= -160) {
      attackWeight += 0.2;
      defenseWeight -= 0.08;
    } else if (scoreGap <= -80) {
      attackWeight += 0.12;
      defenseWeight -= 0.04;
    } else if (scoreGap >= 160) {
      attackWeight -= 0.08;
      defenseWeight += 0.18;
    } else if (scoreGap >= 80) {
      attackWeight -= 0.04;
      defenseWeight += 0.1;
    }
  }

  const suitPressure = evaluateSuitPressure(opponent);
  return {
    attackWeight,
    defenseWeight,
    suitPressure,
    opponentOpenMelds: openMelds,
  };
}

function evaluateSuitPressure(opponent) {
  const suitPressure = { m: 0, p: 0, s: 0, z: 0 };
  if (!opponent) {
    return suitPressure;
  }

  for (const meld of opponent.melds || []) {
    for (const tileId of meld.tiles || []) {
      const tileType = getTileType(tileId);
      suitPressure[getTileSuit(tileType)] += meld.concealed ? 0.3 : 1;
    }
  }

  for (const discard of opponent.discards || []) {
    const tileType = getTileType(discard.tileId || discard);
    suitPressure[getTileSuit(tileType)] -= 0.4;
  }

  return suitPressure;
}

function evaluateDiscardRisk(game, playerSeat, tileId, battleProfile, analysisCache) {
  const tileType = getTileType(tileId);
  const cacheKey = `${playerSeat}|${tileType}|${serializeSuitPressure(battleProfile.suitPressure)}`;
  if (analysisCache.riskCache.has(cacheKey)) {
    return analysisCache.riskCache.get(cacheKey);
  }

  const opponentSeat = getOpponentSeat(playerSeat);
  const opponent = game && Array.isArray(game.players) ? game.players[opponentSeat] : null;
  const visibleCounts = buildVisibleCounts(game, playerSeat, [], [], analysisCache);
  const visibleCount = visibleCounts[tileType] || 0;
  const opponentDiscardTypes = new Set(
    (opponent && Array.isArray(opponent.discards) ? opponent.discards : []).map((discard) => getTileType(discard.tileId || discard)),
  );

  let risk = 14;

  if (opponentDiscardTypes.has(tileType)) {
    risk = 0;
  } else if (isHonorTile(tileType)) {
    risk = 24 - visibleCount * 5;
    if ((battleProfile.suitPressure.z || 0) > 0) {
      risk += 4;
    }
  } else {
    const suit = getTileSuit(tileType);
    const rank = getTileRank(tileType);
    risk = rank >= 3 && rank <= 7 ? 18 : 15;
    risk += (battleProfile.suitPressure[suit] || 0) * 4;
    risk += visibleCount <= 1 ? 5 : visibleCount >= 3 ? -4 : 0;

    const opponentDiscards = opponent && Array.isArray(opponent.discards) ? opponent.discards : [];
    const sameSuitDiscards = opponentDiscards.filter((discard) => getTileSuit(getTileType(discard.tileId || discard)) === suit).length;
    if (sameSuitDiscards <= 1) {
      risk += 4;
    }

    const openMelds = opponent && Array.isArray(opponent.melds) ? opponent.melds.filter((meld) => !meld.concealed) : [];
    for (const meld of openMelds) {
      const meldSuit = getTileSuit(meld.tileType || getTileType(meld.tiles && meld.tiles[0] ? meld.tiles[0] : ""));
      if (meldSuit !== suit) {
        continue;
      }
      const meldRank = isSuitTile(meld.tileType) ? getTileRank(meld.tileType) : null;
      if (meldRank && Math.abs(meldRank - rank) <= 2) {
        risk += 6;
      }
    }
  }

  risk = Math.max(0, risk);
  analysisCache.riskCache.set(cacheKey, risk);
  return risk;
}

function serializeSuitPressure(suitPressure) {
  return ["m", "p", "s", "z"].map((suit) => Number(suitPressure[suit] || 0).toFixed(2)).join(",");
}

function evaluateLookaheadPotential({ game, playerSeat, handTileIds, lockedMelds, battleProfile, analysisCache, profile }) {
  const cacheKey = createLookaheadCacheKey(game, playerSeat, handTileIds, lockedMelds, profile);
  if (analysisCache.lookaheadCache.has(cacheKey)) {
    return analysisCache.lookaheadCache.get(cacheKey);
  }

  const availability = buildAvailabilityMap(game, playerSeat, handTileIds, [], analysisCache);
  const useScoringStrategy = isScoringStrategyEnabled(game, profile);
  const baseline = useScoringStrategy
    ? evaluateAdvancedHand(game, playerSeat, handTileIds, lockedMelds, [], analysisCache, profile)
    : evaluateHandProgress(handTileIds, lockedMelds, analysisCache.progressCache);
  const drawLimit = profile.lookaheadDrawLimit || DEFAULT_LOOKAHEAD_DRAW_LIMIT;

  const baselineScore = baseline.totalScore || baseline.score;
  const screenedDraws = Object.entries(availability)
    .filter(([, count]) => count > 0)
    .map(([tileType, count]) => {
      const quickProgress = evaluateHandProgress([...handTileIds, tileType], lockedMelds, analysisCache.progressCache);
      const quickGain = (baseline.shanten - quickProgress.shanten) * 220 + (quickProgress.score - (baseline.score || 0));
      return {
        tileType,
        count,
        quickGain,
        quickScore: quickGain + count * 4,
      };
    })
    .sort((left, right) => {
      if (right.quickScore !== left.quickScore) {
        return right.quickScore - left.quickScore;
      }
      return right.count - left.count;
    })
    .slice(0, Math.max(drawLimit * 2 + 1, 5));

  const drawCandidates = screenedDraws
    .map(({ tileType, count }) => {
      const drawnTileId = `${tileType}-future`;
      const drawnHand = [...handTileIds, drawnTileId];
      const drawProgress = useScoringStrategy
        ? evaluateAdvancedHand(game, playerSeat, drawnHand, lockedMelds, [], analysisCache, profile)
        : evaluateHandProgress(drawnHand, lockedMelds, analysisCache.progressCache);
      const followUp = chooseBestLookaheadDiscard({
        game,
        playerSeat,
        tileIds: drawnHand,
        lockedMelds,
        analysisCache,
        profile,
      });
      const immediateGain = (baseline.shanten - drawProgress.shanten) * 180 + ((drawProgress.totalScore || drawProgress.score) - baselineScore);
      const followUpGain = followUp.totalScore - baselineScore;

      return {
        tileType,
        count,
        followUpValue: immediateGain * 0.55 + followUpGain,
      };
    })
    .sort((left, right) => {
      if (right.followUpValue !== left.followUpValue) {
        return right.followUpValue - left.followUpValue;
      }
      return right.count - left.count;
    })
    .slice(0, drawLimit);

  const totalWeight = drawCandidates.reduce((sum, candidate) => sum + candidate.count, 0);
  if (!totalWeight) {
    analysisCache.lookaheadCache.set(cacheKey, 0);
    return 0;
  }

  const weightedValue = drawCandidates.reduce(
    (sum, candidate) => sum + candidate.followUpValue * candidate.count,
    0,
  );
  const lookaheadValue = Math.max(0, weightedValue / totalWeight);
  analysisCache.lookaheadCache.set(cacheKey, lookaheadValue);
  return lookaheadValue;
}

function shouldRunLookahead(baseline, candidates, profile) {
  if (!candidates.length) {
    return false;
  }

  const guaranteedShanten = profile.guaranteedLookaheadShanten || 0;
  const maxShanten = profile.lookaheadMaxShanten || guaranteedShanten;
  const activationGap = profile.lookaheadActivationGap || 0;

  if (baseline.shanten <= guaranteedShanten) {
    return true;
  }

  if (candidates.length === 1) {
    return false;
  }

  return baseline.shanten <= maxShanten && Math.abs(candidates[0].totalScore - candidates[1].totalScore) <= activationGap;
}

function chooseBestLookaheadDiscard({ game, playerSeat, tileIds, lockedMelds, analysisCache, profile }) {
  const counts = countTileTypes(tileIds);
  const useScoringStrategy = isScoringStrategyEnabled(game, profile);
  const allCandidateTileIds = getCandidateDiscardTileIds(tileIds);
  const shortlistTileIds = useScoringStrategy
    ? allCandidateTileIds
        .map((tileId) => {
          const remainingHand = removeTileIdsFromHand(tileIds, [tileId]);
          const quickProgress = evaluateHandProgress(remainingHand, lockedMelds, analysisCache.progressCache);
          const discardBias = scoreDiscardTile(tileId, counts);
          return {
            tileId,
            quickProgress,
            quickScore: quickProgress.score + discardBias * 2 - quickProgress.shanten * 40,
          };
        })
        .sort((left, right) => {
          if (left.quickProgress.shanten !== right.quickProgress.shanten) {
            return left.quickProgress.shanten - right.quickProgress.shanten;
          }
          return right.quickScore - left.quickScore;
        })
        .slice(0, 5)
        .map((candidate) => candidate.tileId)
    : allCandidateTileIds;
  const candidates = shortlistTileIds.map((tileId) => {
    const remainingHand = removeTileIdsFromHand(tileIds, [tileId]);
    const progress = useScoringStrategy
      ? evaluateAdvancedHand(game, playerSeat, remainingHand, lockedMelds, [getTileType(tileId)], analysisCache, profile)
      : evaluateHandProgress(remainingHand, lockedMelds, analysisCache.progressCache);
    const discardBias = scoreDiscardTile(tileId, counts);
    const totalScore = (progress.totalScore || progress.score) + discardBias * 2;

    return {
      tileId,
      progress,
      totalScore,
    };
  });

  candidates.sort((left, right) => {
    if (left.progress.shanten !== right.progress.shanten) {
      return left.progress.shanten - right.progress.shanten;
    }
    if (right.totalScore !== left.totalScore) {
      return right.totalScore - left.totalScore;
    }
    return left.tileId.localeCompare(right.tileId);
  });
  return candidates[0];
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
  const availability = buildAvailabilityMap(game, playerSeat, handTileIds, extraVisibleTileTypes, analysisCache);
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

function buildAvailabilityMap(game, playerSeat, handTileIds, extraVisibleTileTypes = [], analysisCache = null) {
  const ruleset = getRuleset((game && game.rulesetId) || undefined);
  const visibleCounts = buildVisibleCounts(game, playerSeat, handTileIds, extraVisibleTileTypes, analysisCache);
  const visibleKey = ALL_TILE_TYPES.map((tileType) => visibleCounts[tileType] || 0).join(",");
  const cacheKey = `${playerSeat}|${visibleKey}`;
  if (analysisCache && analysisCache.availabilityCache.has(cacheKey)) {
    return analysisCache.availabilityCache.get(cacheKey);
  }
  const availability = {};
  for (const tileType of ruleset.tileTypes) {
    availability[tileType] = Math.max(0, 4 - (visibleCounts[tileType] || 0));
  }
  if (analysisCache) {
    analysisCache.availabilityCache.set(cacheKey, availability);
  }
  return availability;
}

function buildVisibleCounts(game, playerSeat, handTileIds = [], extraVisibleTileTypes = [], analysisCache = null) {
  const handCounts = countTileTypes(handTileIds || []);
  const handKey = ALL_TILE_TYPES.map((tileType) => handCounts[tileType] || 0).join(",");
  const extraKey = [...(extraVisibleTileTypes || [])].map(getTileType).sort().join(",");
  const round = game && typeof game.roundNumber === "number" ? game.roundNumber : 0;
  const latestDiscardId = game && game.latestDiscard ? game.latestDiscard.id : 0;
  const cacheKey = `${round}|${latestDiscardId}|${playerSeat}|${handKey}|${extraKey}`;
  if (analysisCache && analysisCache.visibleCountsCache.has(cacheKey)) {
    return analysisCache.visibleCountsCache.get(cacheKey);
  }

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

  if (analysisCache) {
    analysisCache.visibleCountsCache.set(cacheKey, visibleCounts);
  }
  return visibleCounts;
}

function getPlayerMelds(game, playerSeat) {
  const player = game && Array.isArray(game.players) ? game.players[playerSeat] : null;
  return player && Array.isArray(player.melds) ? player.melds : [];
}

function incrementTileTypeCount(counts, tileType) {
  if (!tileType) {
    return;
  }
  counts[tileType] = (counts[tileType] || 0) + 1;
}

function createAdvancedHandCacheKey(game, playerSeat, handTileIds, lockedMelds, extraVisibleTileTypes, profile) {
  const counts = countTileTypes(handTileIds || []);
  const countKey = ALL_TILE_TYPES.map((tileType) => counts[tileType] || 0).join(",");
  const extraKey = [...(extraVisibleTileTypes || [])].map(getTileType).sort().join(",");
  const round = game && typeof game.roundNumber === "number" ? game.roundNumber : 0;
  const latestDiscardId = game && game.latestDiscard ? game.latestDiscard.id : 0;
  const scoringKey = isScoringStrategyEnabled(game, profile) ? getScoringProfileId(profile) : "plain";
  return `${round}|${latestDiscardId}|${playerSeat}|${lockedMelds}|${countKey}|${extraKey}|${scoringKey}`;
}

function createLookaheadCacheKey(game, playerSeat, handTileIds, lockedMelds, profile) {
  const counts = countTileTypes(handTileIds || []);
  const countKey = ALL_TILE_TYPES.map((tileType) => counts[tileType] || 0).join(",");
  const round = game && typeof game.roundNumber === "number" ? game.roundNumber : 0;
  const latestDiscardId = game && game.latestDiscard ? game.latestDiscard.id : 0;
  const scoringKey = isScoringStrategyEnabled(game, profile) ? getScoringProfileId(profile) : "plain";
  return `${round}|${latestDiscardId}|${playerSeat}|${lockedMelds}|${countKey}|${scoringKey}`;
}

function buildDiscardDecisionSummary(profile, battleProfile, candidates) {
  const topCandidates = candidates.slice(0, 3).map((candidate) => {
    const parts = [
      `${getTileLabel(candidate.tileId)}`,
      `向聽 ${candidate.progress.shanten}`,
      `進張 ${candidate.progress.effectiveTileCount}`,
      `風險 ${candidate.discardRisk.toFixed(1)}`,
      `總分 ${candidate.totalScore.toFixed(1)}`,
    ];
    if (candidate.lookaheadBonus) {
      parts.push(`預測 ${candidate.lookaheadBonus.toFixed(1)}`);
    }
    return parts.join(" / ");
  });

  return [
    `${SOLO_DIFFICULTY_LABELS[profile.id]}模式：攻擊權重 ${battleProfile.attackWeight.toFixed(2)}，防守權重 ${battleProfile.defenseWeight.toFixed(2)}。`,
    `候選前三：${topCandidates.join("；")}`,
    `最終選擇 ${getTileLabel(candidates[0].tileId)}。`,
  ].join(" ");
}

function buildActionDecisionSummary({ modeLabel, actionName, progress, battleProfile, actionValue, lookaheadBonus }) {
  const parts = [
    `${modeLabel}模式評估${actionName}`,
    `向聽 ${progress.shanten}`,
    `進張 ${progress.effectiveTileCount}`,
    `總分 ${actionValue.toFixed(1)}`,
    `攻擊 ${battleProfile.attackWeight.toFixed(2)}`,
    `防守 ${battleProfile.defenseWeight.toFixed(2)}`,
  ];
  if (lookaheadBonus) {
    parts.push(`預測 ${lookaheadBonus.toFixed(1)}`);
  }
  return parts.join(" / ");
}

function buildPassDecisionSummary({ modeLabel, reason }) {
  return `${modeLabel}模式選擇過牌：${reason}`;
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

function getCandidateDiscardTileIds(tileIds) {
  const seenTypes = new Set();
  const candidates = [];

  for (const tileId of tileIds || []) {
    const tileType = getTileType(tileId);
    if (seenTypes.has(tileType)) {
      continue;
    }
    seenTypes.add(tileType);
    candidates.push(tileId);
  }

  return candidates;
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

function createAnalysisCache() {
  return {
    progressCache: new Map(),
    advancedCache: new Map(),
    riskCache: new Map(),
    visibleCountsCache: new Map(),
    availabilityCache: new Map(),
    scoringCache: new Map(),
    lookaheadCache: new Map(),
  };
}

function getOpponentSeat(seat) {
  return seat === 0 ? 1 : 0;
}
