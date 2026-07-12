// Display-only definitions for the publisher-generated Effectiveness Lab.
// Formulas and row values are authoritative in the bot publisher.
export const effectivenessDefinitions = {
  trident: { title: "Composite Effectiveness Index", scoreLabel: "score", higherIsBetter: true },
  sortino: { title: "Risk-Adjusted Impact Score", scoreLabel: "percentile", higherIsBetter: true },
  alpha: { title: "Win Rate Residual", scoreLabel: "pp", higherIsBetter: true }
};
