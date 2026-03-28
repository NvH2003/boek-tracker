import { getWeekDateRangeFromChallenge } from "./challengeDailyGoals";
import { ReadingChallenge } from "./types";

/** Zelfde logica als op de challenge-pagina: cumulatieve blz voor legacy-weekdoel vanaf datum door de week. */
export function applyLegacyDailyReading(
  challenge: ReadingChallenge,
  date: string,
  cumulativePages: number
): ReadingChallenge {
  const range = getWeekDateRangeFromChallenge(challenge);
  const fromIdx = range.indexOf(date);
  const dailyReading = { ...challenge.dailyReading };
  for (let i = fromIdx >= 0 ? fromIdx : 0; i < range.length; i++) {
    dailyReading[range[i]] = cumulativePages;
  }
  return { ...challenge, dailyReading };
}

/** Eén boek bijwerken; dagtotalen herberekend. */
export function applyPerBookDailyReading(
  challenge: ReadingChallenge,
  date: string,
  bookId: string,
  cumulativePages: number
): ReadingChallenge {
  if (!challenge.weeklyChallenge) return challenge;
  const range = getWeekDateRangeFromChallenge(challenge);
  const fromIdx = range.indexOf(date);
  const perBook = { ...(challenge.dailyReadingPerBook || {}) };
  for (let i = fromIdx >= 0 ? fromIdx : 0; i < range.length; i++) {
    const d = range[i];
    perBook[d] = { ...perBook[d], [bookId]: cumulativePages };
  }
  const dailyReading = { ...challenge.dailyReading };
  for (const d of range) {
    const tot = challenge.weeklyChallenge.books.reduce(
      (sum, p) => sum + (perBook[d]?.[p.bookId] ?? 0),
      0
    );
    dailyReading[d] = tot;
  }
  return {
    ...challenge,
    dailyReadingPerBook: perBook,
    dailyReading
  };
}

/** Meerdere boeken tegelijk (bijv. leessessie); één keer door de weekrange. */
export function applyMultiplePerBookDailyReading(
  challenge: ReadingChallenge,
  date: string,
  pagesByBookId: Record<string, number>
): ReadingChallenge {
  if (!challenge.weeklyChallenge) return challenge;
  const ids = Object.keys(pagesByBookId);
  if (ids.length === 0) return challenge;
  const range = getWeekDateRangeFromChallenge(challenge);
  const fromIdx = range.indexOf(date);
  const perBook = { ...(challenge.dailyReadingPerBook || {}) };
  for (let i = fromIdx >= 0 ? fromIdx : 0; i < range.length; i++) {
    const d = range[i];
    const row = { ...perBook[d] };
    for (const bookId of ids) {
      row[bookId] = pagesByBookId[bookId];
    }
    perBook[d] = row;
  }
  const dailyReading = { ...challenge.dailyReading };
  for (const d of range) {
    const tot = challenge.weeklyChallenge.books.reduce(
      (sum, p) => sum + (perBook[d]?.[p.bookId] ?? 0),
      0
    );
    dailyReading[d] = tot;
  }
  return {
    ...challenge,
    dailyReadingPerBook: perBook,
    dailyReading
  };
}
