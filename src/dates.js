// Logique de dates et de texte, pure (sans I/O) pour rester testable.

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // février = max (bissextile)

export const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Valide jour/mois et, si fourni, l'année (29/02 exige une année bissextile). */
export function validateBirthday({ day, month, year = null }, currentYear) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Mois invalide (1-12).';
  if (!Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH[month - 1]) {
    return `Jour invalide pour ${MONTH_NAMES[month - 1]}.`;
  }
  if (year !== null) {
    if (!Number.isInteger(year) || year < 1900 || year > currentYear) return 'Année invalide.';
    if (month === 2 && day === 29 && !isLeap(year)) return `${year} n'est pas une année bissextile.`;
  }
  return null;
}

/** Date courante {year, month, day, hour} dans un fuseau IANA. */
export function nowIn(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

/** Jour effectif de l'anniversaire pour une année donnée: le 29/02 est fêté le 28/02 hors bissextile. */
function effectiveDate(b, year) {
  if (b.month === 2 && b.day === 29 && !isLeap(year)) return { month: 2, day: 28 };
  return { month: b.month, day: b.day };
}

export function isBirthdayToday(b, today) {
  const e = effectiveDate(b, today.year);
  return e.month === today.month && e.day === today.day;
}

const utcDay = (y, m, d) => Date.UTC(y, m - 1, d) / 86_400_000;

/** Nombre de jours avant la prochaine occurrence (0 = aujourd'hui). */
export function daysUntil(b, today) {
  const t = utcDay(today.year, today.month, today.day);
  for (const year of [today.year, today.year + 1]) {
    const e = effectiveDate(b, year);
    const diff = utcDay(year, e.month, e.day) - t;
    if (diff >= 0) return diff;
  }
  /* c8 ignore next */
  throw new Error('unreachable');
}

export function ageOn(b, year) {
  return b.year ? year - b.year : null;
}

export function formatDate(b) {
  const base = `${b.day} ${MONTH_NAMES[b.month - 1]}`;
  return b.year ? `${base} ${b.year}` : base;
}

export const DEFAULT_MESSAGE = '🎂 Joyeux anniversaire {user} ! 🎉';
export const MAX_MESSAGE_LENGTH = 1000;

/**
 * Variables: {user} (mention), {nom}, {age} (« ? » si l'année est inconnue), {date}.
 * Un unique passage évite qu'une valeur substituée soit re-interprétée.
 */
export function renderMessage(template, { userId, name, age, birthday }) {
  const vars = {
    user: `<@${userId}>`,
    nom: name,
    age: age === null ? '?' : String(age),
    date: formatDate({ ...birthday, year: null }),
  };
  return template.replace(/\{(user|nom|age|date)\}/g, (_, k) => vars[k]);
}

/** Année de la prochaine occurrence (aujourd'hui compris): sert à afficher le bon âge dans l'aperçu. */
export function nextBirthdayYear(b, today) {
  const d = new Date(Date.UTC(today.year, today.month - 1, today.day + daysUntil(b, today)));
  return d.getUTCFullYear();
}
