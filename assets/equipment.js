/* Sparse equipment counters shared by the profile and equipment leaderboard.
   A missing snapshot is different from an unchanged value: callers need that
   distinction before they can safely derive a window statistic. */

export const EQUIPMENT_FIELDS = {
  weapons: ["kills", "headshotKills", "shotsHit", "shotsFired", "accuracy", "timeEquipped"],
  // GameTools has no per-weapon assists counter, so Assists is a vehicle-only
  // stat rather than a gap in the weapon list.
  vehicles: ["kills", "timeIn", "vehiclesDestroyedWith", "assists", "roadKills"]
};

export const EQUIPMENT_TRACKING_STARTS = {
  kills: "2026-07-10",
  headshotKills: "2026-08-10",
  shotsHit: "2026-08-10",
  shotsFired: "2026-08-10",
  accuracy: "2026-08-11",
  timeEquipped: "2026-08-10",
  timeIn: "2026-08-10",
  vehiclesDestroyedWith: "2026-08-10",
  assists: "2026-08-10",
  roadKills: "2026-08-10"
};

const CATEGORY_STATS = {
  weapons: {
    time: "timeEquipped",
    vehiclesDestroyed: null,
    assists: null,
    roadKills: null
  },
  vehicles: {
    time: "timeIn",
    vehiclesDestroyed: "vehiclesDestroyedWith",
    assists: "assists",
    roadKills: "roadKills"
  }
};

function isValidIndex(index) {
  return Number.isInteger(index) && index >= 0;
}

function observedAt(observedIndexes, dateIndex) {
  return Array.isArray(observedIndexes) && observedIndexes.some((index) => index === dateIndex);
}

// Read one flat [dateIndex, value, ...] change-list. `known: false` is the
// only safe result for a date without an observation or a prior change.
export function readSparseValue(changes, dateIndex, observedIndexes = []) {
  if (!isValidIndex(dateIndex)) {
    return { value: null, known: false, sourceIndex: null };
  }

  // A prior change is a deliberate carry only on another observed payload;
  // an unobserved date must never inherit a neighbouring day's value.
  if (!observedAt(observedIndexes, dateIndex)) {
    return { value: null, known: false, sourceIndex: null };
  }

  let value = null;
  let sourceIndex = null;
  if (Array.isArray(changes)) {
    for (let position = 0; position + 1 < changes.length; position += 2) {
      const changeIndex = changes[position];
      const changeValue = changes[position + 1];
      if (Number.isInteger(changeIndex) && changeIndex <= dateIndex && Number.isFinite(changeValue)) {
        if (sourceIndex === null || changeIndex >= sourceIndex) {
          value = changeValue;
          sourceIndex = changeIndex;
        }
      }
    }
  }
  if (sourceIndex !== null) {
    return { value, known: true, sourceIndex };
  }
  return { value: 0, known: true, sourceIndex: null, observedZero: true };
}

export function readEquipmentField(entry, field, dateIndex, observedIndexes = entry?.observed) {
  if (!entry || !Array.isArray(entry[field])) {
    return { value: null, known: false, sourceIndex: null, reason: "field_missing" };
  }
  return readSparseValue(entry[field], dateIndex, observedIndexes);
}

function trackingStartIndex(category, field, dates, fieldTrackingStarts = null) {
  const categoryStarts = fieldTrackingStarts?.[category];
  const hasPublishedStart = categoryStarts && Object.prototype.hasOwnProperty.call(categoryStarts, field);
  const startDate = hasPublishedStart ? categoryStarts[field] : EQUIPMENT_TRACKING_STARTS[field] ?? null;
  const index = Array.isArray(dates) ? dates.indexOf(startDate) : -1;
  return { date: startDate ?? null, index };
}

// The first published date this field was being recorded on. A tracking start
// that is not itself a published date still has a floor: the first date after
// it. -1 means no published date is covered at all.
function trackingFloorIndex(tracking, dates) {
  if (!tracking.date) return 0;
  if (tracking.index >= 0) return tracking.index;
  if (!Array.isArray(dates)) return -1;
  return dates.findIndex((date) => date >= tracking.date);
}

// A window endpoint has to be a date this member was actually observed on --
// an unobserved date has no value to read, and carrying a neighbouring day's
// counter is what the sparse reader exists to prevent.
function firstObservedFrom(observedIndexes, floorIndex) {
  if (!Array.isArray(observedIndexes) || floorIndex < 0) return -1;
  let first = -1;
  for (const index of observedIndexes) {
    if (!isValidIndex(index) || index < floorIndex) continue;
    if (first < 0 || index < first) first = index;
  }
  return first;
}

// Where this field's window really starts: no earlier than the date the field
// began being recorded, and no earlier than this member's first observation on
// or after that. A field promoted into the archive partway through, or a member
// linked last week, is not a reason to refuse a 14-day window outright -- it is
// a reason to report the span that exists and say which date it starts from,
// the same way the counter period math resolves per-member start dates.
export function equipmentPeriodStartIndex(
  field,
  startIndex,
  dates = [],
  observedIndexes = [],
  fieldTrackingStarts = null,
  category = "weapons"
) {
  const tracking = trackingStartIndex(category, field, dates, fieldTrackingStarts);
  const floor = trackingFloorIndex(tracking, dates);
  if (floor < 0 || !isValidIndex(startIndex)) return { index: -1, tracking };
  return { index: firstObservedFrom(observedIndexes, Math.max(startIndex, floor)), tracking };
}

export function equipmentPeriodDelta(
  entry,
  field,
  startIndex,
  endIndex,
  dates = [],
  observedIndexes = entry?.observed,
  fieldTrackingStarts = null,
  category = "weapons"
) {
  const { index: effectiveStart, tracking } = equipmentPeriodStartIndex(
    field,
    startIndex,
    dates,
    observedIndexes,
    fieldTrackingStarts,
    category
  );
  // Nothing left of the window once it is clamped: the field started after it,
  // or this member has no observation inside it.
  if (effectiveStart < 0 || effectiveStart >= endIndex) {
    return {
      value: null,
      known: false,
      reason: "tracking_not_started",
      trackingStartDate: tracking.date,
      startIndex: null,
      start: readEquipmentField(entry, field, startIndex, observedIndexes),
      end: readEquipmentField(entry, field, endIndex, observedIndexes)
    };
  }
  const start = readEquipmentField(entry, field, effectiveStart, observedIndexes);
  const end = readEquipmentField(entry, field, endIndex, observedIndexes);
  if (!start.known || !end.known) {
    return { value: null, known: false, reason: start.reason ?? end.reason ?? "unknown_endpoint", startIndex: null, start, end };
  }
  return {
    value: end.value - start.value,
    known: true,
    reason: null,
    startIndex: effectiveStart,
    startDate: dates?.[effectiveStart] ?? null,
    clamped: effectiveStart > startIndex,
    trackingStartDate: tracking.date,
    start,
    end
  };
}

function fieldValue(fields, field) {
  return fields[field]?.known ? fields[field].value : null;
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

// A percentage outside 0-100 is not a reading, it is an artifact of counting
// pellet hits against shells fired. Shotguns land at 131% and worse, so the
// honest answer is that this window has no accuracy rather than an impossible
// one. Career avoids the whole problem by reading GameTools' own figure.
function sanePercent(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

// `mode` decides where accuracy comes from. Career reads the published rate,
// which is exact and needs no arithmetic. Period cannot: differencing two
// career percentages is meaningless, so the window is derived from its own shot
// deltas -- the reason both the rate and the counters are published.
function statsFromFields(category, fields, mode = "career", alignedPair = null) {
  const kills = fieldValue(fields, "kills");
  const timeField = CATEGORY_STATS[category].time;
  const timeSeconds = fieldValue(fields, timeField);
  // Two fields promoted into the archive on different dates cover different
  // spans of the same window, and a rate built from one field's 14 days over
  // another's 2 is not a number anyone should see. `alignedPair` re-reads both
  // over the later of the two starts; without it the values are already
  // comparable and are read straight off the fields.
  const pair = alignedPair ?? ((numeratorField, denominatorField) =>
    [fieldValue(fields, numeratorField), fieldValue(fields, denominatorField)]);
  const [hits, shots] = category === "weapons" ? pair("shotsHit", "shotsFired") : [null, null];
  const [headshotKills, headshotDenominator] = category === "weapons" ? pair("headshotKills", "kills") : [null, null];
  const [rateKills, rateSeconds] = pair("kills", timeField);
  const accuracyRatio = ratio(hits, shots);
  const derivedAccuracy = accuracyRatio === null ? null : sanePercent(accuracyRatio * 100);
  const publishedAccuracy = category === "weapons" ? fieldValue(fields, "accuracy") : null;
  const hsRatio = category === "weapons" ? ratio(headshotKills, headshotDenominator) : null;
  const stats = {
    kills,
    timeSeconds,
    accuracy: mode === "career" ? publishedAccuracy ?? derivedAccuracy : derivedAccuracy,
    hsPercent: hsRatio === null ? null : hsRatio * 100,
    kpm: ratio(rateKills, Number.isFinite(rateSeconds) ? rateSeconds / 60 : null),
    vehiclesDestroyed: fieldValue(fields, CATEGORY_STATS[category].vehiclesDestroyed),
    assists: fieldValue(fields, CATEGORY_STATS[category].assists),
    roadKills: fieldValue(fields, CATEGORY_STATS[category].roadKills)
  };
  return stats;
}

function statsFields(entry, category, readField) {
  return Object.fromEntries(EQUIPMENT_FIELDS[category].map((field) => [field, readField(entry, field)]));
}

function equipmentCareerField(entry, category, field, latestIndex, dates, observedIndexes, fieldTrackingStarts) {
  const tracking = trackingStartIndex(category, field, dates, fieldTrackingStarts);
  const value = readEquipmentField(entry, field, latestIndex, observedIndexes);
  const latestDate = dates?.[latestIndex];
  if (tracking.date && latestDate && latestDate < tracking.date) {
    return { value: null, known: false, reason: "tracking_not_started", trackingStartDate: tracking.date };
  }
  return value;
}

export function equipmentCareerStats(
  entry,
  category,
  latestObservedIndex,
  observedIndexes = entry?.observed,
  dates = [],
  fieldTrackingStarts = null
) {
  const fields = statsFields(entry, category, (value, field) =>
    equipmentCareerField(value, category, field, latestObservedIndex, dates, observedIndexes, fieldTrackingStarts)
  );
  return { ...statsFromFields(category, fields), fields };
}

export function equipmentPeriodStats(
  entry,
  category,
  startIndex,
  endIndex,
  dates = [],
  observedIndexes = entry?.observed,
  fieldTrackingStarts = null
) {
  const delta = (field, from) =>
    equipmentPeriodDelta(entry, field, from, endIndex, dates, observedIndexes, fieldTrackingStarts, category);
  const fields = statsFields(entry, category, (value, field) => delta(field, startIndex));
  // Both halves of a rate, read over the later of their two starts, so the
  // window a rate describes is one span rather than two.
  const alignedPair = (numeratorField, denominatorField) => {
    const numerator = fields[numeratorField];
    const denominator = fields[denominatorField];
    if (!numerator?.known || !denominator?.known) return [null, null];
    if (numerator.startIndex === denominator.startIndex) return [numerator.value, denominator.value];
    const from = Math.max(numerator.startIndex, denominator.startIndex);
    const alignedNumerator = delta(numeratorField, from);
    const alignedDenominator = delta(denominatorField, from);
    return alignedNumerator.known && alignedDenominator.known
      ? [alignedNumerator.value, alignedDenominator.value]
      : [null, null];
  };
  return { ...statsFromFields(category, fields, "period", alignedPair), fields };
}

export function latestObservedIndex(observedIndexes) {
  return Array.isArray(observedIndexes)
    ? observedIndexes.filter((index) => isValidIndex(index)).reduce((latest, index) => Math.max(latest, index), -1)
    : -1;
}

export function validEquipmentArtifact(artifact) {
  return Boolean(
    artifact &&
      Array.isArray(artifact.dates) &&
      artifact.dates.length > 0 &&
      artifact.members &&
      typeof artifact.members === "object"
  );
}

// Per-member profile files intentionally have a different contract from the
// all-member kills index; keeping this validator separate prevents a wrong
// artifact shape from silently reaching the profile renderer.
export function validEquipmentMemberFile(artifact) {
  return Boolean(
    artifact &&
      typeof artifact.discordId === "string" &&
      artifact.discordId.length > 0 &&
      Array.isArray(artifact.dates) &&
      artifact.dates.length > 0 &&
      artifact.weapons &&
      typeof artifact.weapons === "object" &&
      !Array.isArray(artifact.weapons) &&
      artifact.vehicles &&
      typeof artifact.vehicles === "object" &&
      !Array.isArray(artifact.vehicles)
  );
}

export function validEquipmentCatalogue(catalogue) {
  return Boolean(
    catalogue &&
      catalogue.classes &&
      typeof catalogue.classes === "object" &&
      catalogue.weapons &&
      typeof catalogue.weapons === "object" &&
      catalogue.vehicles &&
      typeof catalogue.vehicles === "object"
  );
}

export function equipmentFieldsPresent(artifact, category) {
  const fields = new Set();
  if (!validEquipmentArtifact(artifact) || !EQUIPMENT_FIELDS[category]) return fields;
  for (const member of Object.values(artifact.members)) {
    for (const entry of Object.values(member?.[category] ?? {})) {
      for (const field of EQUIPMENT_FIELDS[category]) {
        if (Array.isArray(entry?.[field])) fields.add(field);
      }
    }
  }
  return fields;
}
