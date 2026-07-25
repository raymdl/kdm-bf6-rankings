// Mark the higher player's point whenever two visible Career series strictly
// invert between adjacent dates. This is deliberately derived from chart data,
// not notification delivery: missing points and ties cannot create a crossing.
export function pairwiseOvertakeFlags(seriesById) {
  const entries = Object.entries(seriesById ?? {});
  const flags = Object.fromEntries(entries.map(([id, values]) => [id, new Array(values.length).fill(false)]));

  for (let index = 1; index < Math.max(0, ...entries.map(([, values]) => values.length)); index += 1) {
    for (const [overtakerId, overtakerValues] of entries) {
      const previousOvertaker = overtakerValues[index - 1];
      const currentOvertaker = overtakerValues[index];
      if (!Number.isFinite(previousOvertaker) || !Number.isFinite(currentOvertaker)) continue;

      for (const [overtakenId, overtakenValues] of entries) {
        if (overtakenId === overtakerId) continue;
        const previousOvertaken = overtakenValues[index - 1];
        const currentOvertaken = overtakenValues[index];
        if (!Number.isFinite(previousOvertaken) || !Number.isFinite(currentOvertaken)) continue;
        if (previousOvertaker < previousOvertaken && currentOvertaker > currentOvertaken) {
          flags[overtakerId][index] = true;
          break;
        }
      }
    }
  }

  return flags;
}
