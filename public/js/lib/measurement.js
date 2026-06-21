export const LENGTH_UNITS = {
  in: { label: 'inches', short: 'in', factor: 1 / 12, step: 0.125, precision: 2 },
  ft: { label: 'feet', short: 'ft', factor: 1, step: 0.01, precision: 2 },
  cm: { label: 'centimeters', short: 'cm', factor: 1 / 30.48, step: 0.1, precision: 1 },
  m: { label: 'meters', short: 'm', factor: 3.280839895, step: 0.01, precision: 2 }
};

export function normalizeLengthUnit(unit, fallback = 'in') {
  return LENGTH_UNITS[unit] ? unit : fallback;
}

export function lengthUnitOptions(selected = 'in') {
  const active = normalizeLengthUnit(selected);
  return Object.entries(LENGTH_UNITS).map(([value, info]) => (
    `<option value="${value}" ${value === active ? 'selected' : ''}>${info.label}</option>`
  )).join('');
}

export function lengthStep(unit) {
  return LENGTH_UNITS[normalizeLengthUnit(unit)].step;
}

export function lengthUnitLabel(unit) {
  return LENGTH_UNITS[normalizeLengthUnit(unit)].short;
}

export function toFeet(value, unit = 'in') {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return n * LENGTH_UNITS[normalizeLengthUnit(unit)].factor;
}

export function fromFeet(feet, unit = 'in') {
  const n = parseFloat(feet);
  if (!Number.isFinite(n)) return 0;
  return n / LENGTH_UNITS[normalizeLengthUnit(unit)].factor;
}

export function formatLengthInput(feet, unit = 'in') {
  const active = normalizeLengthUnit(unit);
  const value = fromFeet(feet, active);
  if (!value) return '';
  const precision = LENGTH_UNITS[active].precision;
  return trimZeros(value.toFixed(precision));
}

export function formatLength(feet, unit = 'in') {
  if (feet == null || Number.isNaN(Number(feet))) return '—';
  const active = normalizeLengthUnit(unit);
  const precision = LENGTH_UNITS[active].precision;
  return `${trimZeros(fromFeet(feet, active).toFixed(precision))} ${LENGTH_UNITS[active].short}`;
}

function trimZeros(value) {
  return String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
