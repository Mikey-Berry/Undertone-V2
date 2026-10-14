// Book list in canonical order with chapter counts (1,189 chapters total).
const RAW = [
  ['Genesis', 'Gen', 50], ['Exodus', 'Ex', 40], ['Leviticus', 'Lev', 27], ['Numbers', 'Num', 36],
  ['Deuteronomy', 'Deut', 34], ['Joshua', 'Josh', 24], ['Judges', 'Judg', 21], ['Ruth', 'Ruth', 4],
  ['1 Samuel', '1 Sam', 31], ['2 Samuel', '2 Sam', 24], ['1 Kings', '1 Ki', 22], ['2 Kings', '2 Ki', 25],
  ['1 Chronicles', '1 Chr', 29], ['2 Chronicles', '2 Chr', 36], ['Ezra', 'Ezra', 10], ['Nehemiah', 'Neh', 13],
  ['Esther', 'Esth', 10], ['Job', 'Job', 42], ['Psalms', 'Ps', 150], ['Proverbs', 'Prov', 31],
  ['Ecclesiastes', 'Eccl', 12], ['Song of Solomon', 'Song', 8], ['Isaiah', 'Isa', 66], ['Jeremiah', 'Jer', 52],
  ['Lamentations', 'Lam', 5], ['Ezekiel', 'Ezek', 48], ['Daniel', 'Dan', 12], ['Hosea', 'Hos', 14],
  ['Joel', 'Joel', 3], ['Amos', 'Amos', 9], ['Obadiah', 'Obad', 1], ['Jonah', 'Jon', 4],
  ['Micah', 'Mic', 7], ['Nahum', 'Nah', 3], ['Habakkuk', 'Hab', 3], ['Zephaniah', 'Zeph', 3],
  ['Haggai', 'Hag', 2], ['Zechariah', 'Zech', 14], ['Malachi', 'Mal', 4],
  ['Matthew', 'Matt', 28], ['Mark', 'Mark', 16], ['Luke', 'Luke', 24], ['John', 'John', 21],
  ['Acts', 'Acts', 28], ['Romans', 'Rom', 16], ['1 Corinthians', '1 Cor', 16], ['2 Corinthians', '2 Cor', 13],
  ['Galatians', 'Gal', 6], ['Ephesians', 'Eph', 6], ['Philippians', 'Phil', 4], ['Colossians', 'Col', 4],
  ['1 Thessalonians', '1 Thess', 5], ['2 Thessalonians', '2 Thess', 3], ['1 Timothy', '1 Tim', 6],
  ['2 Timothy', '2 Tim', 4], ['Titus', 'Titus', 3], ['Philemon', 'Phlm', 1], ['Hebrews', 'Heb', 13],
  ['James', 'Jas', 5], ['1 Peter', '1 Pet', 5], ['2 Peter', '2 Pet', 3], ['1 John', '1 John', 5],
  ['2 John', '2 John', 1], ['3 John', '3 John', 1], ['Jude', 'Jude', 1], ['Revelation', 'Rev', 22],
];

export const BOOKS = RAW.map(([name, abbr, chapters], i) => ({
  i, name, abbr, chapters,
  section: i < 39 ? 'hebrew' : 'greek',
  slug: name.toLowerCase().replace(/\s+/g, '-'),
}));

export const TOTAL = BOOKS.reduce((sum, b) => sum + b.chapters, 0);

const OFFSETS = [];
{
  let acc = 0;
  for (const b of BOOKS) { OFFSETS.push(acc); acc += b.chapters; }
}

export function flatIndex(b, c) { return OFFSETS[b] + c - 1; }

export function fromFlat(f) {
  f = ((f % TOTAL) + TOTAL) % TOTAL;
  let b = BOOKS.length - 1;
  for (let i = 0; i < BOOKS.length; i++) {
    if (OFFSETS[i + 1] === undefined || f < OFFSETS[i + 1]) { b = i; break; }
  }
  return { b, c: f - OFFSETS[b] + 1 };
}

export const chapterKey = (b, c) => `${b}.${c}`;
export const label = (b, c) => `${BOOKS[b].name} ${c}`;

// Links out to the chapter on jw.org. No scripture text is stored or shown in the app.
export const jwUrl = (b, c) =>
  `https://www.jw.org/en/library/bible/study-bible/books/${BOOKS[b].slug}/${c}/`;

// Bible in a year: spreads all chapters evenly over 365 days (3 or 4 a day).
export function yearPlanDay(dayIndex) {
  const d = Math.max(0, Math.min(364, dayIndex));
  const start = Math.floor((d * TOTAL) / 365);
  const end = Math.floor(((d + 1) * TOTAL) / 365);
  const out = [];
  for (let f = start; f < end; f++) out.push(fromFlat(f));
  return out;
}
