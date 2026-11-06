const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // février = max (bissextile)

export const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

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

export function nowIn(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

// Le 29 février est fêté le 28 les années non bissextiles.
function effectiveDate(b, year) {
  if (b.month === 2 && b.day === 29 && !isLeap(year)) return { month: 2, day: 28 };
  return { month: b.month, day: b.day };
}

export function isBirthdayToday(birthday, today) {
  const date = effectiveDate(birthday, today.year);
  return date.month === today.month && date.day === today.day;
}

const utcDay = (y, m, d) => Date.UTC(y, m - 1, d) / 86_400_000;

export function daysUntil(birthday, today) {
  const currentDay = utcDay(today.year, today.month, today.day);
  for (const year of [today.year, today.year + 1]) {
    const date = effectiveDate(birthday, year);
    const diff = utcDay(year, date.month, date.day) - currentDay;
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

// Un seul passage évite de remplacer les variables présentes dans une valeur.
export function renderMessage(template, { userId, name, age, birthday }) {
  const vars = {
    user: `<@${userId}>`,
    nom: name,
    age: age === null ? '?' : String(age),
    date: formatDate({ ...birthday, year: null }),
  };
  return template.replace(/\{(user|nom|age|date)\}/g, (_, k) => vars[k]);
}

export function nextBirthdayYear(b, today) {
  const d = new Date(Date.UTC(today.year, today.month - 1, today.day + daysUntil(b, today)));
  return d.getUTCFullYear();
}

const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// La validité de la date est vérifiée séparément par validateBirthday.
export function parseBirthdayInput(raw) {
  const text = strip(raw.toLowerCase().trim()).replace(/\s+/g, ' ');

  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };

  m = text.match(/^(\d{1,2}) ?[/.\- ] ?(\d{1,2})(?: ?[/.\- ] ?(\d{4}))?$/);
  if (m) return { day: Number(m[1]), month: Number(m[2]), year: m[3] ? Number(m[3]) : null };

  m = text.match(/^(\d{1,2})(?:er)? ([a-z]{3,})\.?(?: (\d{4}))?$/);
  if (m) {
    const idx = MONTH_NAMES.findIndex((n) => strip(n).startsWith(m[2]));
    if (idx >= 0) return { day: Number(m[1]), month: idx + 1, year: m[3] ? Number(m[3]) : null };
  }
  return null;
}
