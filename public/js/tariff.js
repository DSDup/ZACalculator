// Pure tariff logic: validation and cost calculations. No DOM access, so it can be
// imported by the browser (app.js) and by Node (scripts/build-manifest.js).

const TYPE_LABELS = {
  power: 'Power (Electricity)',
  water: 'Water',
};

export function typeLabel(type) {
  if (TYPE_LABELS[type]) return TYPE_LABELS[type];
  return type.charAt(0).toUpperCase() + type.slice(1);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate and normalise a raw tariff JSON object.
 * Returns { ok, errors, warnings, tariff }. `tariff` is only set when ok is true.
 */
export function validateTariff(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['File must contain a JSON object.'], warnings, tariff: null };
  }

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const displayName = str(raw.displayName);
  const type = str(raw.type).toLowerCase();
  const unit = str(raw.unit);
  if (!displayName) errors.push('"displayName" is required (text shown in the dropdown).');
  if (!type) errors.push('"type" is required (e.g. "power" or "water").');
  if (!unit) errors.push('"unit" is required (e.g. "kWh" or "kl").');

  if (!Array.isArray(raw.bands) || raw.bands.length === 0) {
    errors.push('"bands" must be a non-empty array.');
  }

  const bands = [];
  if (Array.isArray(raw.bands)) {
    let prevTo = 0;
    raw.bands.forEach((b, i) => {
      const n = i + 1;
      if (!b || typeof b !== 'object') {
        errors.push(`Band ${n}: must be an object.`);
        return;
      }
      if (!isNum(b.rate) || b.rate < 0) {
        errors.push(`Band ${n}: "rate" must be a number >= 0 (currency per ${unit || 'unit'}).`);
        return;
      }
      const isLast = i === raw.bands.length - 1;
      let to = b.to === null || b.to === undefined ? null : b.to;
      if (to !== null && !isNum(to)) {
        errors.push(`Band ${n}: "to" must be a number, or null for the final open-ended band.`);
        return;
      }
      if (to === null && !isLast) {
        errors.push(`Band ${n}: only the last band may have "to": null.`);
        return;
      }
      if (to !== null && to <= prevTo) {
        errors.push(`Band ${n}: "to" (${to}) must be greater than the previous band's "to" (${prevTo}).`);
        return;
      }
      if (to !== null && isLast) {
        warnings.push(`Last band stops at ${to} ${unit}; usage above that is billed at the last band's rate. Use "to": null to make that explicit.`);
        to = null;
      }
      const from = isNum(b.from) ? b.from : null;
      bands.push({ from, to, rate: b.rate });
      if (to !== null) prevTo = to;
    });
  }

  if (raw.fixedMonthlyCharge !== undefined && !(isNum(raw.fixedMonthlyCharge) && raw.fixedMonthlyCharge >= 0)) {
    errors.push('"fixedMonthlyCharge" must be a number >= 0.');
  }
  if (raw.vatPercent !== undefined && !(isNum(raw.vatPercent) && raw.vatPercent >= 0)) {
    errors.push('"vatPercent" must be a number >= 0.');
  }

  if (errors.length) return { ok: false, errors, warnings, tariff: null };

  // Fill in display lower bounds when "from" is omitted (1 for the first band, then previous "to" + 1).
  let prev = 0;
  for (const b of bands) {
    if (b.from === null) b.from = prev + 1;
    if (b.to !== null) prev = b.to;
  }

  return {
    ok: true,
    errors,
    warnings,
    tariff: {
      id: str(raw.id),
      displayName,
      area: str(raw.area),
      type,
      unit,
      currency: str(raw.currency) || 'ZAR',
      effectiveFrom: str(raw.effectiveFrom),
      notes: str(raw.notes),
      source: str(raw.source),
      fixedMonthlyCharge: raw.fixedMonthlyCharge || 0,
      vatPercent: raw.vatPercent || 0,
      ratesIncludeVat: raw.ratesIncludeVat !== false,
      bands,
    },
  };
}

const capOf = (band) => (band.to === null ? Infinity : band.to);

/** Cost of the first `usage` units using the tiered (block) bands, before fixed charge / VAT. */
export function energyCost(tariff, usage) {
  let prev = 0;
  let cost = 0;
  for (const b of tariff.bands) {
    const cap = capOf(b);
    cost += Math.max(0, Math.min(usage, cap) - prev) * b.rate;
    prev = cap;
    if (usage <= cap) break;
  }
  return cost;
}

/** Multiplier applied on top of (energy + fixed) when VAT is not already in the rates. */
function vatFactor(tariff) {
  return tariff.vatPercent > 0 && !tariff.ratesIncludeVat ? 1 + tariff.vatPercent / 100 : 1;
}

/** Index of the band that the next unit after `prev` units falls into. */
function bandAfter(tariff, prev) {
  const i = tariff.bands.findIndex((b) => capOf(b) > prev);
  return i === -1 ? tariff.bands.length - 1 : i;
}

/** Index of the band that the `cum`-th unit falls into (0 when cum is 0). */
function bandAt(tariff, cum) {
  const i = tariff.bands.findIndex((b) => capOf(b) >= cum);
  return i === -1 ? tariff.bands.length - 1 : i;
}

/** Full monthly bill and a per-band and per-day breakdown for `usage` units over `days` days. */
export function calculateMonth(tariff, usage, days) {
  const factor = vatFactor(tariff);
  const fixed = tariff.fixedMonthlyCharge;

  const bandRows = [];
  let prev = 0;
  for (const b of tariff.bands) {
    const cap = capOf(b);
    const used = Math.max(0, Math.min(usage, cap) - prev);
    bandRows.push({ band: b, used, cost: used * b.rate });
    prev = cap;
  }

  const energy = energyCost(tariff, usage);
  const subtotal = energy + fixed;
  const total = subtotal * factor;
  const vat =
    tariff.vatPercent > 0
      ? factor > 1
        ? total - subtotal
        : (total * tariff.vatPercent) / (100 + tariff.vatPercent)
      : 0;

  // Bands are monthly blocks, so each day's cost is the marginal cost of that day's slice of the
  // month's consumption: later days sit in higher bands. Fixed charge is spread evenly.
  const perDayUsage = usage / days;
  const daily = [];
  let cumCost = 0;
  for (let d = 1; d <= days; d++) {
    const startUsage = perDayUsage * (d - 1);
    const endUsage = perDayUsage * d;
    const cost = (energyCost(tariff, endUsage) - energyCost(tariff, startUsage) + fixed / days) * factor;
    cumCost += cost;
    daily.push({
      day: d,
      usage: perDayUsage,
      cumUsage: endUsage,
      cost,
      cumCost,
      bandStart: bandAfter(tariff, startUsage),
      bandEnd: bandAt(tariff, endUsage),
    });
  }

  return {
    usage,
    days,
    bandRows,
    energy,
    fixed,
    vat,
    total,
    perDayUsage,
    avgDailyCost: total / days,
    avgUnitCost: usage > 0 ? total / usage : 0,
    daily,
  };
}

/** How many units a monthly budget (all-in, after fixed charge and VAT) buys. */
export function usageForBudget(tariff, budget) {
  let net = budget / vatFactor(tariff) - tariff.fixedMonthlyCharge;
  if (net <= 0) return 0;

  let prev = 0;
  for (const b of tariff.bands) {
    const cap = capOf(b);
    const blockCost = (cap - prev) * b.rate;
    if (cap === Infinity || net <= blockCost) {
      // A free open-ended band would buy unlimited units; stop at the band's start instead.
      return b.rate > 0 ? prev + net / b.rate : prev;
    }
    net -= blockCost;
    prev = cap;
  }
  return prev;
}
