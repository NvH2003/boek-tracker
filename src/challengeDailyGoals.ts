import { Book, ReadingChallenge, WeeklyBookPlan } from "./types";

export function formatChallengeDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseChallengeDateString(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00");
}

export type DailyGoalBookTarget = {
  bookId: string;
  bookTitle: string;
  cumulativePage: number;
  totalPages: number;
};

export type DailyGoal = {
  date: string;
  dateObj: Date;
  target: number;
  cumulativePages: number;
  pagesReadToday: number;
  remaining: number;
  effectiveRead: number;
  plannedCumulative?: number;
  bookTargets?: DailyGoalBookTarget[];
};

function getPlanFirstReadDate(plan: WeeklyBookPlan): string {
  const dates = Object.keys(plan.dailyPages).filter((d) => (plan.dailyPages[d] || 0) > 0);
  if (dates.length === 0) return "9999-12-31";
  dates.sort();
  return dates[0];
}

export function compareWeekPlansForDisplay(a: WeeklyBookPlan, b: WeeklyBookPlan, books: Book[]): number {
  const aBook = books.find((x) => x.id === a.bookId);
  const bBook = books.find((x) => x.id === b.bookId);

  const aStatusRank = aBook?.status === "aan-het-lezen" ? 0 : aBook?.status === "wil-ik-lezen" ? 1 : 2;
  const bStatusRank = bBook?.status === "aan-het-lezen" ? 0 : bBook?.status === "wil-ik-lezen" ? 1 : 2;
  if (aStatusRank !== bStatusRank) return aStatusRank - bStatusRank;

  const aFirstDate = getPlanFirstReadDate(a);
  const bFirstDate = getPlanFirstReadDate(b);
  if (aFirstDate !== bFirstDate) return aFirstDate.localeCompare(bFirstDate);

  const aOrder = aBook?.order ?? Number.MAX_SAFE_INTEGER;
  const bOrder = bBook?.order ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;

  const aTitle = aBook?.title ?? "";
  const bTitle = bBook?.title ?? "";
  return aTitle.localeCompare(bTitle, "nl-NL");
}

/** Datums YYYY-MM-DD van start t/m eind van actieve challenge-periode (week of legacy). */
export function getWeekDateRangeFromChallenge(challenge: ReadingChallenge | null): string[] {
  const wc = challenge?.weeklyChallenge;
  const start = wc
    ? parseChallengeDateString(wc.startDate)
    : challenge?.startDate
      ? parseChallengeDateString(challenge.startDate)
      : null;
  const end = wc
    ? parseChallengeDateString(wc.endDate)
    : challenge?.endDate
      ? parseChallengeDateString(challenge.endDate)
      : null;
  if (!start || !end || end < start) return [];
  const out: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(formatChallengeDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Laatst bekende cumulatieve pagina voor dit boek t/m deze dag (weekchallenge). */
export function getBookCumulativeThroughDate(
  challenge: ReadingChallenge | null,
  date: string,
  bookId: string
): number | "" {
  if (!challenge?.weeklyChallenge) return "";
  const perBook = challenge.dailyReadingPerBook || {};
  const range = getWeekDateRangeFromChallenge(challenge);
  const toIdx = range.indexOf(date);
  if (toIdx < 0) return "";

  let latest: number | undefined;
  for (let i = 0; i <= toIdx; i++) {
    const d = range[i];
    const v = perBook[d]?.[bookId];
    if (typeof v === "number" && !Number.isNaN(v)) {
      latest = v;
    }
  }
  return latest ?? "";
}

export function computeDailyGoals(
  challenge: ReadingChallenge | null,
  books: Book[]
): DailyGoal[] | null {
  if (!challenge) return null;

  const weekChallenge = challenge.weeklyChallenge;
  if (!weekChallenge && (!challenge.weeklyPages || !challenge.startDate || !challenge.endDate)) {
    return null;
  }

  const start = weekChallenge
    ? parseChallengeDateString(weekChallenge.startDate)
    : parseChallengeDateString(challenge.startDate!);
  const end = weekChallenge
    ? parseChallengeDateString(weekChallenge.endDate)
    : parseChallengeDateString(challenge.endDate!);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (end < start) return null;

  const dailyReading = challenge.dailyReading || {};
  const legacyOff = new Set(challenge.offDays ?? []);
  const offDaysAuto = new Set(challenge.offDaysAuto ?? []);
  const offDaysManual = new Set(challenge.offDaysManual ?? []);
  const isAutoOff = (dateStr: string) => offDaysAuto.has(dateStr) || legacyOff.has(dateStr);
  const isManualOff = (dateStr: string) => offDaysManual.has(dateStr);

  const goals: DailyGoal[] = [];

  const allDays: Array<{ date: Date; dateStr: string }> = [];
  let dayCursor = new Date(start);
  while (dayCursor <= end) {
    const date = new Date(dayCursor);
    const dateStr = formatChallengeDate(date);
    allDays.push({ date, dateStr });
    dayCursor.setDate(dayCursor.getDate() + 1);
  }

  if (weekChallenge) {
    const sortedWeekPlans = [...weekChallenge.books].sort((a, b) =>
      compareWeekPlansForDisplay(a, b, books)
    );
    const dailyReadingPerBook = challenge.dailyReadingPerBook || {};
    const usePerBook = Object.keys(dailyReadingPerBook).length > 0;
    const effectiveDailyReading: Record<string, number> = usePerBook ? {} : { ...dailyReading };
    if (usePerBook) {
      allDays.forEach((d) => {
        effectiveDailyReading[d.dateStr] = weekChallenge.books.reduce(
          (sum, p) => sum + (dailyReadingPerBook[d.dateStr]?.[p.bookId] ?? 0),
          0
        );
      });
    }

    const targetPagesPerDay: Record<string, number> = {};
    const plannedCumulativeByDate: Record<string, number> = {};
    let cumulativeTarget = 0;

    for (const day of allDays) {
      let dayTotal = 0;
      sortedWeekPlans.forEach((book) => {
        dayTotal += book.dailyPages[day.dateStr] || 0;
      });
      targetPagesPerDay[day.dateStr] = dayTotal;
      if (!isAutoOff(day.dateStr) && !isManualOff(day.dateStr)) {
        cumulativeTarget += dayTotal;
        plannedCumulativeByDate[day.dateStr] = cumulativeTarget;
      }
    }

    let lastWithTarget = allDays.length - 1;
    while (
      lastWithTarget >= 0 &&
      (targetPagesPerDay[allDays[lastWithTarget].dateStr] || 0) === 0
    ) {
      lastWithTarget -= 1;
    }
    if (lastWithTarget >= 0 && lastWithTarget < allDays.length - 1) {
      allDays.length = lastWithTarget + 1;
    }

    let previousCumulative = 0;
    const pagesReadPerDay: number[] = [];
    const cumulativePagesPerDay: number[] = [];
    for (const day of allDays) {
      const cumulative = effectiveDailyReading[day.dateStr] ?? previousCumulative;
      const pagesRead = Math.max(0, cumulative - previousCumulative);
      cumulativePagesPerDay.push(cumulative);
      pagesReadPerDay.push(pagesRead);
      previousCumulative = cumulative;
    }

    const totalReadInPeriod = cumulativePagesPerDay[cumulativePagesPerDay.length - 1] ?? 0;
    let remainingPages = totalReadInPeriod;
    const effectiveReads: number[] = [];

    for (let i = 0; i < allDays.length; i++) {
      const day = allDays[i];
      if (isAutoOff(day.dateStr) || isManualOff(day.dateStr)) {
        effectiveReads.push(0);
        continue;
      }
      const target = targetPagesPerDay[day.dateStr] || 0;
      const effectiveRead = Math.min(target, remainingPages);
      effectiveReads.push(effectiveRead);
      remainingPages = Math.max(0, remainingPages - effectiveRead);
    }

    const bookTargetsByDay: DailyGoalBookTarget[][] = [];
    for (let i = 0; i < allDays.length; i++) {
      const day = allDays[i];
      const targets: DailyGoalBookTarget[] = [];
      sortedWeekPlans.forEach((plan, planIdx) => {
        const pagesThisDay = plan.dailyPages[day.dateStr] || 0;
        if (pagesThisDay <= 0) return;
        let cum = 0;
        for (let j = 0; j <= i; j++) {
          cum += plan.dailyPages[allDays[j].dateStr] || 0;
        }
        const book = books.find((b) => b.id === plan.bookId);
        targets.push({
          bookId: plan.bookId,
          bookTitle: book?.title ?? `Boek ${planIdx + 1}`,
          cumulativePage: cum,
          totalPages: plan.totalPages
        });
      });
      bookTargetsByDay.push(targets);
    }

    for (let i = 0; i < allDays.length; i++) {
      const day = allDays[i];
      const cumulativePages = cumulativePagesPerDay[i];
      const pagesReadToday = pagesReadPerDay[i];
      const autoOff = isAutoOff(day.dateStr);
      const manualOff = isManualOff(day.dateStr);
      const isOffDay = autoOff || manualOff;
      const target = isOffDay ? 0 : targetPagesPerDay[day.dateStr] || 0;
      const effectiveRead = isOffDay ? 0 : effectiveReads[i];
      const remaining = isOffDay ? 0 : Math.max(0, target - effectiveRead);

      goals.push({
        date: day.dateStr,
        dateObj: day.date,
        target: Math.ceil(target),
        cumulativePages,
        pagesReadToday: Math.round(pagesReadToday * 10) / 10,
        effectiveRead: Math.round(effectiveRead * 10) / 10,
        remaining: Math.ceil(remaining),
        plannedCumulative: plannedCumulativeByDate[day.dateStr],
        bookTargets: bookTargetsByDay[i]?.length ? bookTargetsByDay[i] : undefined
      });
    }
  } else {
    const startPage = challenge.startPage ?? 0;
    const totalPagesInBook = challenge.weeklyPages!;
    const pagesToRead = totalPagesInBook - startPage;
    if (pagesToRead <= 0) return null;

    const activeDays = allDays.filter((d) => !isAutoOff(d.dateStr) && !isManualOff(d.dateStr));
    if (activeDays.length === 0) return null;

    const pagesPerDay = pagesToRead / activeDays.length;

    const plannedCumulativeByDate: Record<string, number> = {};
    for (let i = 0; i < activeDays.length; i++) {
      const plannedReadUpTo = Math.ceil((pagesToRead * (i + 1)) / activeDays.length);
      const plannedTotal = Math.min(startPage + plannedReadUpTo, totalPagesInBook);
      plannedCumulativeByDate[activeDays[i].dateStr] = plannedTotal;
    }

    let previousCumulative = startPage;
    const pagesReadPerDay: number[] = [];
    const cumulativePagesPerDay: number[] = [];
    for (const day of allDays) {
      const cumulative = dailyReading[day.dateStr] || previousCumulative;
      const pagesRead = Math.max(0, cumulative - previousCumulative);
      cumulativePagesPerDay.push(cumulative);
      pagesReadPerDay.push(pagesRead);
      previousCumulative = cumulative;
    }

    const lastCumulative = cumulativePagesPerDay[cumulativePagesPerDay.length - 1] ?? startPage;
    const totalReadInPeriod = Math.max(0, lastCumulative - startPage);

    let remainingPages = totalReadInPeriod;
    const effectiveReads: number[] = [];
    let accumulatedDebt = 0;

    for (let i = 0; i < allDays.length; i++) {
      const day = allDays[i];
      if (isAutoOff(day.dateStr) || isManualOff(day.dateStr)) {
        effectiveReads.push(0);
        continue;
      }
      const target = pagesPerDay + accumulatedDebt;
      const effectiveRead = Math.min(target, remainingPages);
      effectiveReads.push(effectiveRead);
      remainingPages = Math.max(0, remainingPages - effectiveRead);

      if (effectiveRead < target) {
        accumulatedDebt = target - effectiveRead;
      } else {
        accumulatedDebt = 0;
      }
    }

    accumulatedDebt = 0;
    for (let i = 0; i < allDays.length; i++) {
      const day = allDays[i];
      const cumulativePages = cumulativePagesPerDay[i];
      const pagesReadToday = pagesReadPerDay[i];
      const autoOff = isAutoOff(day.dateStr);
      const manualOff = isManualOff(day.dateStr);
      const isOffDay = autoOff || manualOff;
      const target = isOffDay ? 0 : pagesPerDay + accumulatedDebt;
      const effectiveRead = isOffDay ? 0 : effectiveReads[i];
      const remaining = isOffDay ? 0 : Math.max(0, target - effectiveRead);

      if (!autoOff && !manualOff) {
        if (effectiveRead < target) {
          accumulatedDebt = target - effectiveRead;
        } else {
          accumulatedDebt = 0;
        }
      }

      goals.push({
        date: day.dateStr,
        dateObj: day.date,
        target: Math.round(target * 10) / 10,
        cumulativePages,
        pagesReadToday: Math.round(pagesReadToday * 10) / 10,
        effectiveRead: Math.round(effectiveRead * 10) / 10,
        remaining: Math.round(remaining * 10) / 10,
        plannedCumulative: plannedCumulativeByDate[day.dateStr]
      });
    }
  }

  return goals;
}
