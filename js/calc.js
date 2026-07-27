// Sports/health calculations. Pure functions — easy to unit test.
// Formulas are estimates for planning only, not medical advice.

/** Age in years from ISO birthdate. */
export function age(birthdateISO, ref = new Date()) {
  if (!birthdateISO) return null;
  const b = new Date(birthdateISO);
  if (isNaN(b)) return null;
  let a = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) a--;
  return a;
}

/** Estimated max heart rate. Tanaka (2001): 208 - 0.7*age (more accurate than 220-age). */
export function maxHR(ageYears) {
  if (ageYears == null) return null;
  return Math.round(208 - 0.7 * ageYears);
}

/**
 * Heart-rate training zones.
 * If restingHR provided uses Karvonen (HR reserve), else % of max HR.
 * Returns 5 zones with [low, high] bpm.
 */
export function hrZones(ageYears, restingHR) {
  const hrMax = maxHR(ageYears);
  if (!hrMax) return null;
  const defs = [
    { key: 'z1', name: 'recovery', lo: 0.50, hi: 0.60 },
    { key: 'z2', name: 'fatburn', lo: 0.60, hi: 0.70 },
    { key: 'z3', name: 'aerobic', lo: 0.70, hi: 0.80 },
    { key: 'z4', name: 'anaerobic', lo: 0.80, hi: 0.90 },
    { key: 'z5', name: 'maximal', lo: 0.90, hi: 1.00 }
  ];
  const useKarvonen = restingHR != null && restingHR > 0;
  const reserve = hrMax - (restingHR || 0);
  return {
    hrMax, method: useKarvonen ? 'karvonen' : 'percent',
    zones: defs.map((d) => ({
      key: d.key, name: d.name,
      low: Math.round(useKarvonen ? restingHR + reserve * d.lo : hrMax * d.lo),
      high: Math.round(useKarvonen ? restingHR + reserve * d.hi : hrMax * d.hi)
    }))
  };
}

/** One-rep-max estimates from a working set. Returns {epley, brzycki, avg}. */
export function oneRepMax(weight, reps) {
  if (!weight || !reps || reps < 1) return null;
  if (reps === 1) return { epley: weight, brzycki: weight, avg: weight };
  const epley = weight * (1 + reps / 30);
  const brzycki = weight * (36 / (37 - reps));
  const valid = reps < 37 ? [epley, brzycki] : [epley];
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  return { epley: round1(epley), brzycki: round1(brzycki), avg: round1(avg) };
}

/** Suggested weight to hit a target rep count from a known 1RM (Epley inverse). */
export function weightForReps(oneRM, reps) {
  if (!oneRM || !reps) return null;
  return round1(oneRM / (1 + reps / 30));
}

/** Body Mass Index + WHO category key. */
export function bmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  const value = weightKg / (m * m);
  let category = 'normal';
  if (value < 18.5) category = 'under';
  else if (value < 25) category = 'normal';
  else if (value < 30) category = 'over';
  else category = 'obese';
  return { value: round1(value), category };
}

/** Body-fat % estimate (Deurenberg from BMI, age, sex). Rough estimate. */
export function bodyFat(weightKg, heightCm, ageYears, sex) {
  const b = bmi(weightKg, heightCm);
  if (!b || ageYears == null) return null;
  const s = sex === 'female' ? 0 : 1;
  const bf = 1.20 * b.value + 0.23 * ageYears - 10.8 * s - 5.4;
  return round1(Math.max(0, bf));
}

/** Basal metabolic rate — Mifflin-St Jeor (kcal/day). */
export function bmr(weightKg, heightCm, ageYears, sex) {
  if (!weightKg || !heightCm || ageYears == null) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return Math.round(base + (sex === 'female' ? -161 : 5));
}

const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 };
/** Total daily energy expenditure (kcal/day). */
export function tdee(weightKg, heightCm, ageYears, sex, activityLevel) {
  const b = bmr(weightKg, heightCm, ageYears, sex);
  if (!b) return null;
  return Math.round(b * (ACTIVITY[activityLevel] || 1.55));
}

function round1(n) { return Math.round(n * 10) / 10; }

/** Total volume (weight * reps summed) for a session.
 *  `weightOf(set, entry)` resolves the effective load per set (defaults to the
 *  raw entered weight); callers pass a resolver to apply the dumbbell 2× rule.
 *  Kept pure — no store/db imports — so it stays unit-testable. */
export function sessionVolume(session, weightOf) {
  const wOf = typeof weightOf === 'function' ? weightOf : (s) => s.weightKg || 0;
  let vol = 0, sets = 0, reps = 0;
  (session.entries || []).forEach((e) => {
    (e.sets || []).forEach((s) => {
      if (s.done !== false && s.reps) {
        vol += (wOf(s, e) || 0) * s.reps;
        reps += s.reps;
        sets += 1;
      }
    });
  });
  return { volume: Math.round(vol), sets, reps };
}
