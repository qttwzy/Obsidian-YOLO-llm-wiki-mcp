"use strict";

/**
 * 4-Signal base weight constants.
 * Adjust these to tune the relative importance of each signal.
 */
const SIGNAL_WEIGHTS = {
  directLink: 3.0,
  sourceOverlap: 4.0,
  commonNeighbor: 1.5,
  typeAffinity: 1.0,
};

/**
 * Type affinity scores.
 * entity↔concept is the strongest cross-type relationship.
 */
const TYPE_AFFINITY = {
  "concept-entity": 1.0,
  "entity-synthesis": 0.8,
  "concept-synthesis": 0.8,
  "entity-entity": 0.5,
  "concept-concept": 0.5,
  "synthesis-synthesis": 0.5,
};

/**
 * Dynamic weight factor constants.
 */
const HUB_PENALTY_LOG_BASE = Math.E; // natural log
const RARITY_BONUS_DIVISOR = 1;
const REINFORCEMENT_BONUS_PER_SIGNAL = 0.3;

/**
 * Get type affinity score for two node types.
 */
function getTypeAffinity(typeA, typeB) {
  const key = [typeA, typeB].sort().join("-");
  return TYPE_AFFINITY[key] || 0.5;
}

/**
 * Calculate hub penalty factor.
 * Nodes with high degree get penalized (their edges are less meaningful).
 * @param {number} degree - The degree of the neighbor node
 * @returns {number} Penalty factor (0-1)
 */
function hubPenalty(degree) {
  if (degree <= 0) return 1;
  return 1 / Math.log(degree + 1);
}

/**
 * Calculate rarity bonus factor.
 * Pages with fewer outLinks have more meaningful connections.
 * @param {number} outLinksCount - Number of outLinks from the source node
 * @returns {number} Bonus factor (>= 1)
 */
function rarityBonus(outLinksCount) {
  if (outLinksCount <= 0) return 1 + RARITY_BONUS_DIVISOR;
  return 1 + (RARITY_BONUS_DIVISOR / outLinksCount);
}

/**
 * Calculate reinforcement bonus factor.
 * Multiple signals hitting simultaneously → bonus.
 * @param {number} signalCount - Number of active signals
 * @returns {number} Bonus factor (>= 1)
 */
function reinforcementBonus(signalCount) {
  return 1 + REINFORCEMENT_BONUS_PER_SIGNAL * (signalCount - 1);
}

const { resolveLink, getResolvedOutLinks } = require("./graph");

/**
 * Calculate the 4-signal base weight for a pair of nodes.
 * @returns {{ base: number, signals: string[] }}
 */
function calculateBaseWeight(nodeA, nodeB, allNodes) {
  let base = 0;
  const signals = [];

  // Signal 1: directLink — A links to B or B links to A
  const resolvedOutA = getResolvedOutLinks(nodeA.outLinks, allNodes);
  const resolvedOutB = getResolvedOutLinks(nodeB.outLinks, allNodes);
  const aLinksB = resolvedOutA.includes(nodeB.slug);
  const bLinksA = resolvedOutB.includes(nodeA.slug);
  if (aLinksB || bLinksA) {
    base += SIGNAL_WEIGHTS.directLink;
    signals.push("directLink");
  }

  // Signal 2: sourceOverlap — shared sources
  const sourcesA = new Set(nodeA.sources);
  const overlap = nodeB.sources.filter((s) => sourcesA.has(s));
  if (overlap.length > 0) {
    base += SIGNAL_WEIGHTS.sourceOverlap;
    signals.push("sourceOverlap");
  }

  // Signal 3: commonNeighbor (Adamic-Adar)
  const neighborsA = new Set([...resolvedOutA, ...nodeA.inLinks]);
  const neighborsB = new Set([...resolvedOutB, ...nodeB.inLinks]);
  const common = [...neighborsA].filter((n) => neighborsB.has(n) && n !== nodeA.slug && n !== nodeB.slug);
  if (common.length > 0) {
    let adamicAdar = 0;
    for (const neighbor of common) {
      const nNode = allNodes.get(neighbor);
      if (nNode && nNode.degree > 1) {
        adamicAdar += 1 / Math.log(nNode.degree);
      }
    }
    if (adamicAdar > 0) {
      base += SIGNAL_WEIGHTS.commonNeighbor * adamicAdar;
      signals.push("commonNeighbor");
    }
  }

  // Signal 4: typeAffinity
  if (nodeA.type && nodeB.type) {
    const affinity = getTypeAffinity(nodeA.type, nodeB.type);
    base += SIGNAL_WEIGHTS.typeAffinity * affinity;
    signals.push("typeAffinity");
  }

  return { base, signals };
}

/**
 * Calculate final edge weight with dynamic factors.
 * @returns {{ weight: number, signals: string[], factors: object }}
 */
function calculateEdgeWeight(nodeA, nodeB, allNodes) {
  const { base, signals } = calculateBaseWeight(nodeA, nodeB, allNodes);
  if (base === 0) return null;

  // Hub penalty: use the max degree of the two nodes
  const maxDegree = Math.max(nodeA.degree, nodeB.degree);
  const hub = hubPenalty(maxDegree);

  // Rarity bonus: use the outLinks count of the node with fewer links
  const minOutLinks = Math.min(
    getResolvedOutLinks(nodeA.outLinks, allNodes).length,
    getResolvedOutLinks(nodeB.outLinks, allNodes).length
  );
  const rarity = rarityBonus(minOutLinks);

  // Reinforcement bonus
  const reinforce = reinforcementBonus(signals.length);

  const weight = Math.round(base * hub * rarity * reinforce * 100) / 100;

  return {
    weight,
    signals,
    factors: {
      base: Math.round(base * 100) / 100,
      hubPenalty: Math.round(hub * 100) / 100,
      rarityBonus: Math.round(rarity * 100) / 100,
      reinforcementBonus: Math.round(reinforce * 100) / 100,
    },
  };
}

/**
 * Calculate edges for all node pairs that have at least one signal.
 * @param {Map<string, object>} nodes
 * @returns {Array<{source: string, target: string, weight: number, signals: string[], factors: object}>}
 */
function calculateEdges(nodes) {
  const edges = [];
  const seen = new Set();
  const slugs = [...nodes.keys()];

  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const nodeA = nodes.get(slugs[i]);
      const nodeB = nodes.get(slugs[j]);
      const key = [slugs[i], slugs[j]].sort().join("|||");
      if (seen.has(key)) continue;
      seen.add(key);

      const result = calculateEdgeWeight(nodeA, nodeB, nodes);
      if (result && result.weight > 0) {
        edges.push({
          source: slugs[i],
          target: slugs[j],
          weight: result.weight,
          signals: result.signals,
          factors: result.factors,
        });
      }
    }
  }

  edges.sort((a, b) => b.weight - a.weight);
  return edges;
}

module.exports = {
  SIGNAL_WEIGHTS,
  TYPE_AFFINITY,
  getTypeAffinity,
  hubPenalty,
  rarityBonus,
  reinforcementBonus,
  calculateBaseWeight,
  calculateEdgeWeight,
  calculateEdges,
};
