/* Sparse equipment counters shared by the profile and equipment leaderboard.
   A missing snapshot is different from an unchanged value: callers need that
   distinction before they can safely derive a window statistic. */

export const EQUIPMENT_FIELDS = {
  weapons: ["kills", "headshotKills", "shotsHit", "shotsFired", "timeEquipped"],
  archetypes: ["kills", "timeIn", "vehiclesDestroyedWith"]
};

export const EQUIPMENT_TRACKING_STARTS = {
  kills: "2026-07-10",
  headshotKills: "2026-08-10",
  shotsHit: "2026-08-10",
  shotsFired: "2026-08-10",
  timeEquipped: "2026-08-10",
  timeIn: "2026-08-10",
  vehiclesDestroyedWith: "2026-08-10"
};

const CATEGORY_STATS = {
  weapons: {
    time: "timeEquipped",
    vehiclesDestroyed: null
  },
  archetypes: {
    time: "timeIn",
    vehiclesDestroyed: "vehiclesDestroyedWith"
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
  const tracking = trackingStartIndex(category, field, dates, fieldTrackingStarts);
  const start = readEquipmentField(entry, field, startIndex, observedIndexes);
  const end = readEquipmentField(entry, field, endIndex, observedIndexes);
  const startPredatesTracking = tracking.index >= 0
    ? startIndex < tracking.index
    : Boolean(tracking.date && dates[startIndex] && dates[startIndex] < tracking.date);
  if (startPredatesTracking) {
    return {
      value: null,
      known: false,
      reason: "tracking_not_started",
      trackingStartDate: tracking.date,
      start,
      end
    };
  }
  if (!start.known || !end.known) {
    return { value: null, known: false, reason: start.reason ?? end.reason ?? "unknown_endpoint", start, end };
  }
  return { value: end.value - start.value, known: true, reason: null, start, end };
}

function fieldValue(fields, field) {
  return fields[field]?.known ? fields[field].value : null;
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

function statsFromFields(category, fields) {
  const kills = fieldValue(fields, "kills");
  const timeField = CATEGORY_STATS[category].time;
  const timeSeconds = fieldValue(fields, timeField);
  const accuracyRatio = category === "weapons" ? ratio(fieldValue(fields, "shotsHit"), fieldValue(fields, "shotsFired")) : null;
  const hsRatio = category === "weapons" ? ratio(fieldValue(fields, "headshotKills"), kills) : null;
  const stats = {
    kills,
    timeSeconds,
    accuracy: accuracyRatio === null ? null : accuracyRatio * 100,
    hsPercent: hsRatio === null ? null : hsRatio * 100,
    kpm: ratio(kills, Number.isFinite(timeSeconds) ? timeSeconds / 60 : null),
    vehiclesDestroyed: fieldValue(fields, CATEGORY_STATS[category].vehiclesDestroyed)
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
  const fields = statsFields(entry, category, (value, field) =>
    equipmentPeriodDelta(value, field, startIndex, endIndex, dates, observedIndexes, fieldTrackingStarts, category)
  );
  return { ...statsFromFields(category, fields), fields };
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
      artifact.archetypes &&
      typeof artifact.archetypes === "object" &&
      !Array.isArray(artifact.archetypes)
  );
}

export function validEquipmentCatalogue(catalogue) {
  return Boolean(
    catalogue &&
      catalogue.classes &&
      typeof catalogue.classes === "object" &&
      catalogue.weapons &&
      typeof catalogue.weapons === "object" &&
      catalogue.archetypes &&
      typeof catalogue.archetypes === "object"
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
