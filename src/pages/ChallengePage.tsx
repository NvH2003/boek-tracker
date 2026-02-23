import { FormEvent, useMemo, useState } from "react";
import { useBasePath } from "../routing";
import { loadBooks, loadChallenge, saveChallenge } from "../storage";
import { ReadingChallenge, WeeklyBookPlan, WeeklyChallenge } from "../types";

/** Later weer inschakelen: "Geen tijd deze dag" bij dagelijkse leesdoelen */
const SHOW_OFFDAY_UI = false;

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateFromString(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00");
}

/** Formaat voor tonen: dag-maand-jaar (bijv. 05-02-2026) */
function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!d || !m || !y) return dateStr;
  return `${d}-${m}-${y}`;
}

function getDayName(date: Date): string {
  const days = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
  return days[date.getDay()];
}

function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff =
    date.getTime() -
    start.getTime() +
    (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function ChallengePage() {
  const basePath = useBasePath();
  const isMobile = basePath !== "/web";

  const [challenge, setChallenge] = useState<ReadingChallenge | null>(() =>
    loadChallenge()
  );
  const [targetBooks, setTargetBooks] = useState<string>(
    () => challenge?.targetBooks.toString() ?? ""
  );
  const [year, setYear] = useState<string>(
    () => challenge?.year.toString() ?? new Date().getFullYear().toString()
  );
  const [weeklyPages, setWeeklyPages] = useState<string>(
    () => challenge?.weeklyPages?.toString() ?? ""
  );
  const [startDate, setStartDate] = useState<string>(
    () => challenge?.startDate ?? formatDate(new Date())
  );
  const [endDate, setEndDate] = useState<string>(
    () => challenge?.endDate ?? formatDate(new Date())
  );
  const [startPageInput, setStartPageInput] = useState<string>(
    () => (challenge?.startPage != null ? String(challenge.startPage) : "")
  );

  const [offdayModal, setOffdayModal] = useState<{
    date: string;
    mode: "auto" | "manual";
    distribution: Record<string, number>;
  } | null>(null);

  const books = useMemo(() => loadBooks(), []);

  type WeekDraftRow = {
    totalPages: string;
    dailyPages: Record<string, string>;
    selectedDays: string[];
    bookId?: string;
  };

  const [isYearModalOpen, setIsYearModalOpen] = useState(false);
  const [isWeekModalOpen, setIsWeekModalOpen] = useState(false);
  const [editingWeekChallenge, setEditingWeekChallenge] = useState<WeeklyChallenge | null>(null);
  const [weekChallengeStartDate, setWeekChallengeStartDate] = useState<string>(
    () => challenge?.weeklyChallenge?.startDate ?? formatDate(new Date())
  );
  const [weekChallengeEndDate, setWeekChallengeEndDate] = useState<string>(
    () => challenge?.weeklyChallenge?.endDate ?? formatDate(new Date())
  );
  const [weekBookCount, setWeekBookCount] = useState<number>(
    () => challenge?.weeklyChallenge?.books.length || 1
  );
  const [weekBooksDraft, setWeekBooksDraft] = useState<WeekDraftRow[]>(() => {
    const existing = challenge?.weeklyChallenge?.books || [];
    if (existing.length === 0) {
      return [{ totalPages: "", dailyPages: {}, selectedDays: [] }];
    }
    const start = existing[0] ? getDateFromString(challenge?.weeklyChallenge?.startDate || formatDate(new Date())) : new Date();
    const end = existing[0] ? getDateFromString(challenge?.weeklyChallenge?.endDate || formatDate(new Date())) : new Date();
    const allDays: string[] = [];
    let dayCursor = new Date(start);
    while (dayCursor <= end) {
      allDays.push(formatDate(dayCursor));
      dayCursor.setDate(dayCursor.getDate() + 1);
    }
    return existing.map((p) => ({
      bookId: p.bookId,
      totalPages: p.totalPages ? String(p.totalPages) : "",
      dailyPages: allDays.reduce((acc, date) => {
        acc[date] = p.dailyPages[date] ? String(p.dailyPages[date]) : "";
        return acc;
      }, {} as Record<string, string>),
      selectedDays: Object.keys(p.dailyPages).filter((d) => p.dailyPages[d] > 0),
    }));
  });
  const [weekSelectedBookIds, setWeekSelectedBookIds] = useState<string[]>([]);
  const [weekReadingDays, setWeekReadingDays] = useState<string[]>([]);

  function syncWeekBooksDraft(count: number) {
    setWeekBooksDraft((prev) => {
      const next = [...prev];
      if (count > next.length) {
        const start = getDateFromString(weekChallengeStartDate);
        const end = getDateFromString(weekChallengeEndDate);
        const allDays: string[] = [];
        let dayCursor = new Date(start);
        while (dayCursor <= end) {
          allDays.push(formatDate(dayCursor));
          dayCursor.setDate(dayCursor.getDate() + 1);
        }
        while (next.length < count) {
          next.push({ 
            totalPages: "", 
            dailyPages: allDays.reduce((acc, date) => {
              acc[date] = "";
              return acc;
            }, {} as Record<string, string>),
            selectedDays: []
          });
        }
      } else if (count < next.length) {
        next.length = count;
      }
      return next;
    });
  }

  function openWeekModal(editChallenge?: WeeklyChallenge) {
    if (editChallenge) {
      setEditingWeekChallenge(editChallenge);
      setWeekChallengeStartDate(editChallenge.startDate);
      setWeekChallengeEndDate(editChallenge.endDate);
      setWeekBookCount(editChallenge.books.length);
      const start = getDateFromString(editChallenge.startDate);
      const end = getDateFromString(editChallenge.endDate);
      const allDays: string[] = [];
      let dayCursor = new Date(start);
      while (dayCursor <= end) {
        allDays.push(formatDate(dayCursor));
        dayCursor.setDate(dayCursor.getDate() + 1);
      }
      setWeekBooksDraft(editChallenge.books.map((p) => ({
        totalPages: p.totalPages ? String(p.totalPages) : "",
        dailyPages: allDays.reduce((acc, date) => {
          acc[date] = p.dailyPages[date] ? String(p.dailyPages[date]) : "";
          return acc;
        }, {} as Record<string, string>),
        selectedDays: Object.keys(p.dailyPages).filter(d => p.dailyPages[d] > 0)
      })));
    } else {
      const todayDate = new Date();
      const today = formatDate(todayDate);
      const endDate = (() => {
        const d = new Date(todayDate);
        d.setDate(d.getDate() + 6);
        return formatDate(d);
      })();
      setEditingWeekChallenge(null);
      setWeekChallengeStartDate(today);
      setWeekChallengeEndDate(endDate);
      setWeekBookCount(1);
      setWeekSelectedBookIds([]);
      setWeekReadingDays([]);
      const start = getDateFromString(today);
      const end = getDateFromString(endDate);
      const allDays: string[] = [];
      let dayCursor = new Date(start);
      while (dayCursor <= end) {
        allDays.push(formatDate(dayCursor));
        dayCursor.setDate(dayCursor.getDate() + 1);
      }
      setWeekBooksDraft([{ 
        totalPages: "", 
        dailyPages: allDays.reduce((acc, date) => {
          acc[date] = "";
          return acc;
        }, {} as Record<string, string>),
        selectedDays: []
      }]);
    }
    setIsWeekModalOpen(true);
  }

  function autoDistributeBookPages(bookIndex: number) {
    const book = weekBooksDraft[bookIndex];
    if (!book || !book.totalPages || book.selectedDays.length === 0) return;
    
    const totalPages = Number(book.totalPages);
    const selectedDays = book.selectedDays;
    
    // Verdeel gelijkmatig met afronden naar boven
    let remaining = totalPages;
    const distribution: Record<string, number> = {};
    selectedDays.forEach((date, index) => {
      const slotsLeft = selectedDays.length - index;
      const share = Math.ceil(remaining / slotsLeft);
      distribution[date] = share;
      remaining -= share;
    });
    
    setWeekBooksDraft((prev) => {
      const next = [...prev];
      next[bookIndex] = {
        ...next[bookIndex],
        dailyPages: {
          ...next[bookIndex].dailyPages,
          ...Object.fromEntries(Object.entries(distribution).map(([date, pages]) => [date, String(pages)]))
        }
      };
      return next;
    });
  }

  function saveWeekChallengeFromDraft(
    draftsOverride?: WeekDraftRow[]
  ) {
    if (!challenge) return;
    const start = getDateFromString(weekChallengeStartDate);
    const end = getDateFromString(weekChallengeEndDate);
    const allDays: string[] = [];
    let dayCursor = new Date(start);
    while (dayCursor <= end) {
      allDays.push(formatDate(dayCursor));
      dayCursor.setDate(dayCursor.getDate() + 1);
    }
    
    const sourceDrafts =
      draftsOverride && draftsOverride.length > 0 ? draftsOverride : weekBooksDraft;

    const plans: WeeklyBookPlan[] = sourceDrafts.map((row, idx) => {
      const dailyPages: Record<string, number> = {};
      allDays.forEach(date => {
        const pages = Number(row.dailyPages[date] || 0);
        if (pages > 0) {
          dailyPages[date] = pages;
        }
      });
      return {
        bookId: row.bookId || `week-book-${idx + 1}`,
        totalPages: Number(row.totalPages) || 0,
        dailyPages,
        days: row.selectedDays.length
      };
    });
    
    const weekChallenge: WeeklyChallenge = {
      id: editingWeekChallenge?.id || `week-${Date.now()}`,
      startDate: weekChallengeStartDate,
      endDate: weekChallengeEndDate,
      books: plans,
      completed: editingWeekChallenge?.completed || false
    };
    
    const updated: ReadingChallenge = {
      ...challenge,
      weeklyChallenge: weekChallenge,
      // Update legacy fields voor backward compatibility
      startDate: weekChallengeStartDate,
      endDate: weekChallengeEndDate,
      weeklyPages: plans.reduce((sum, p) => sum + p.totalPages, 0)
    };
    
    if (!editingWeekChallenge) {
      updated.dailyReading = {};
      updated.dailyReadingPerBook = {};
    }
    
    saveChallenge(updated);
    setChallenge(updated);
    setIsWeekModalOpen(false);
    setEditingWeekChallenge(null);
  }

  function deleteWeekChallenge() {
    if (!challenge) return;
    const updated: ReadingChallenge = {
      ...challenge,
      weeklyChallenge: undefined,
      dailyReading: {},
      startDate: undefined,
      endDate: undefined,
      weeklyPages: undefined
    };
    saveChallenge(updated);
    setChallenge(updated);
  }

  function toggleWeekChallengeComplete() {
    if (!challenge?.weeklyChallenge) return;
    const updated: ReadingChallenge = {
      ...challenge,
      weeklyChallenge: {
        ...challenge.weeklyChallenge,
        completed: !challenge.weeklyChallenge.completed
      }
    };
    saveChallenge(updated);
    setChallenge(updated);
  }

  // Bereken dagelijkse doelen met doorlopende schuld binnen gekozen bereik
  const dailyGoals = useMemo(() => {
    // Gebruik weekchallenge als die bestaat, anders legacy weeklyPages
    const weekChallenge = challenge?.weeklyChallenge;
    if (!weekChallenge && (!challenge?.weeklyPages || !challenge.startDate || !challenge.endDate)) {
      return null;
    }

    const start = weekChallenge 
      ? getDateFromString(weekChallenge.startDate)
      : getDateFromString(challenge.startDate!);
    const end = weekChallenge
      ? getDateFromString(weekChallenge.endDate)
      : getDateFromString(challenge.endDate!);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    if (end < start) return null;

    const dailyReading = challenge.dailyReading || {};
    // Legacy offDays worden standaard als automatisch verdeeld gezien
    const legacyOff = new Set(challenge.offDays ?? []);
    const offDaysAuto = new Set(challenge.offDaysAuto ?? []);
    const offDaysManual = new Set(challenge.offDaysManual ?? []);
    const isAutoOff = (dateStr: string) =>
      offDaysAuto.has(dateStr) || legacyOff.has(dateStr);
    const isManualOff = (dateStr: string) => offDaysManual.has(dateStr);

    // Verzamel alle dagen in het geselecteerde bereik
    const goals: Array<{
      date: string;
      dateObj: Date;
      target: number;
      cumulativePages: number; // Tot welke bladzijde je bent gekomen
      pagesReadToday: number; // Hoeveel bladzijden je die dag hebt gelezen
      remaining: number;
      effectiveRead: number; // Effectieve gelezen bladzijden inclusief latere dagen
      plannedCumulative?: number; // Geplande bladzijde waarop je zou moeten zijn
      bookTargets?: Array<{ bookId: string; bookTitle: string; cumulativePage: number; totalPages: number }>; // Per boek: doel en totaal (alleen boeken die die dag te lezen zijn)
    }> = [];

    const allDays: Array<{ date: Date; dateStr: string }> = [];
    let dayCursor = new Date(start);
    while (dayCursor <= end) {
      const date = new Date(dayCursor);
      const dateStr = formatDate(date);
      allDays.push({ date, dateStr });
      dayCursor.setDate(dayCursor.getDate() + 1);
    }

    // Bereken doelen per dag op basis van weekchallenge of legacy
    if (weekChallenge) {
      const dailyReadingPerBook = challenge.dailyReadingPerBook || {};
      const usePerBook =
        Object.keys(dailyReadingPerBook).length > 0;
      const effectiveDailyReading: Record<string, number> = usePerBook
        ? {}
        : { ...dailyReading };
      if (usePerBook) {
        allDays.forEach((d) => {
          effectiveDailyReading[d.dateStr] = weekChallenge.books.reduce(
            (sum, p) => sum + (dailyReadingPerBook[d.dateStr]?.[p.bookId] ?? 0),
            0
          );
        });
      }

      // Weekchallenge: combineer alle boeken per dag
      const targetPagesPerDay: Record<string, number> = {};
      const plannedCumulativeByDate: Record<string, number> = {};
      let cumulativeTarget = 0;
      
      for (const day of allDays) {
        let dayTotal = 0;
        weekChallenge.books.forEach(book => {
          dayTotal += book.dailyPages[day.dateStr] || 0;
        });
        targetPagesPerDay[day.dateStr] = dayTotal;
        if (!isAutoOff(day.dateStr) && !isManualOff(day.dateStr)) {
          cumulativeTarget += dayTotal;
          plannedCumulativeByDate[day.dateStr] = cumulativeTarget;
        }
      }
      
      // Bereken cumulatieve bladzijden per dag (totaal, voor voortgang)
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
      
      // Bereken effectieve gelezen bladzijden
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
      
      // Per-boek doelen: alleen boeken die op deze dag nog te lezen zijn (dailyPages > 0)
      const bookTargetsByDay: Array<Array<{ bookId: string; bookTitle: string; cumulativePage: number; totalPages: number }>> = [];
      for (let i = 0; i < allDays.length; i++) {
        const day = allDays[i];
        const targets: Array<{ bookId: string; bookTitle: string; cumulativePage: number; totalPages: number }> = [];
        weekChallenge.books.forEach((plan, planIdx) => {
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

      // Maak goals
      for (let i = 0; i < allDays.length; i++) {
        const day = allDays[i];
        const cumulativePages = cumulativePagesPerDay[i];
        const pagesReadToday = pagesReadPerDay[i];
        const autoOff = isAutoOff(day.dateStr);
        const manualOff = isManualOff(day.dateStr);
        const isOffDay = autoOff || manualOff;
        const target = isOffDay ? 0 : (targetPagesPerDay[day.dateStr] || 0);
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
      // Legacy: gebruik oude logica met weeklyPages
      const startPage = challenge.startPage ?? 0;
      const totalPagesInBook = challenge.weeklyPages!;
      const pagesToRead = totalPagesInBook - startPage;
      if (pagesToRead <= 0) return null;
      
      const activeDays = allDays.filter(
        (d) => !isAutoOff(d.dateStr) && !isManualOff(d.dateStr)
      );
      if (activeDays.length === 0) return null;

      const pagesPerDay = pagesToRead / activeDays.length;

      // Geplande cumulatieve doelen per actieve dag
      const plannedCumulativeByDate: Record<string, number> = {};
      for (let i = 0; i < activeDays.length; i++) {
        const plannedReadUpTo = Math.ceil((pagesToRead * (i + 1)) / activeDays.length);
        const plannedTotal = Math.min(startPage + plannedReadUpTo, totalPagesInBook);
        plannedCumulativeByDate[activeDays[i].dateStr] = plannedTotal;
      }

      // Bereken cumulatieve bladzijden per dag
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
  }, [challenge, books]);

  const stats = useMemo(() => {
    if (!challenge) return null;
    const now = new Date();
    const yearNum = challenge.year;
    const todayYear = now.getFullYear();
    const totalDays = 365 + (yearNum % 4 === 0 ? 1 : 0);
    const dayOfYear =
      yearNum === todayYear ? getDayOfYear(now) : totalDays;

    const readThisYear = books.filter((b) => {
      // Tel alleen boeken mee met status "gelezen"
      if (b.status !== "gelezen") return false;
      
      // Als er een finishedAt is, gebruik die om te bepalen in welk jaar het telt
      if (b.finishedAt) {
        const d = new Date(b.finishedAt);
        return d.getFullYear() === yearNum;
      }
      
      // Als er geen finishedAt is maar wel status "gelezen", tel mee voor het huidige jaar
      // (als het challenge-jaar het huidige jaar is)
      if (yearNum === todayYear) {
        return true;
      }
      
      return false;
    });

    const finishedCount = readThisYear.length;
    const expectedByNow =
      (challenge.targetBooks * dayOfYear) / totalDays;

    const diff = finishedCount - expectedByNow;
    const diffRounded = Math.round(diff * 10) / 10;

    let status: "voor" | "achter" | "op-schema" = "op-schema";
    let statusText = "";
    if (diff > 0.5) {
      status = "voor";
      statusText = `Je loopt ${Math.abs(diffRounded)} boeken voor op schema`;
    } else if (diff < -0.5) {
      status = "achter";
      statusText = `Je loopt ${Math.abs(diffRounded)} boeken achter op schema`;
    } else {
      statusText = "Je ligt precies op schema";
    }

    return {
      finishedCount,
      expectedByNow: expectedByNow.toFixed(1),
      remaining: Math.max(challenge.targetBooks - finishedCount, 0),
      status,
      statusText,
      diff: diffRounded
    };
  }, [books, challenge]);

  function saveYearChallenge() {
    const target = Number(targetBooks);
    const yearNum = Number(year);
    if (!target || !yearNum) return;
    const next: ReadingChallenge = {
      year: yearNum,
      targetBooks: target,
      weeklyPages: weeklyPages ? Number(weeklyPages) : undefined,
      dailyReading: challenge?.dailyReading || {},
      startDate: startDate || challenge?.startDate,
      endDate: endDate || challenge?.endDate,
      offDays: challenge?.offDays || [],
      offDaysAuto: challenge?.offDaysAuto || challenge?.offDays || [],
      offDaysManual: challenge?.offDaysManual || [],
      startPage: startPageInput ? Number(startPageInput) : challenge?.startPage
    };
    saveChallenge(next);
    setChallenge(next);
    setIsYearModalOpen(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    saveYearChallenge();
  }

  /** Geef alle datums in de week (start t/m end) terug voor doorvoeren naar elke dag. */
  function getWeekDateRange(): string[] {
    const wc = challenge?.weeklyChallenge;
    const start = wc ? getDateFromString(wc.startDate) : (challenge?.startDate ? getDateFromString(challenge.startDate) : null);
    const end = wc ? getDateFromString(wc.endDate) : (challenge?.endDate ? getDateFromString(challenge.endDate) : null);
    if (!start || !end || end < start) return [];
    const out: string[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      out.push(formatDate(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  /** Vul je cumulatieve bladzijde in voor een dag; alle dagen erna worden gesynchroniseerd met dezelfde waarde. */
  function updateDailyReading(date: string, cumulativePages: number) {
    if (!challenge) return;
    const range = getWeekDateRange();
    const fromIdx = range.indexOf(date);
    const dailyReading = { ...challenge.dailyReading };
    for (let i = fromIdx >= 0 ? fromIdx : 0; i < range.length; i++) {
      dailyReading[range[i]] = cumulativePages;
    }
    const updated = { ...challenge, dailyReading };
    saveChallenge(updated);
    setChallenge(updated);
  }

  /** Vul je cumulatieve bladzijde in voor een boek op een dag; alle dagen erna worden gesynchroniseerd met dezelfde waarde. */
  function updateDailyReadingPerBook(date: string, bookId: string, cumulativePages: number) {
    if (!challenge?.weeklyChallenge) return;
    const range = getWeekDateRange();
    const fromIdx = range.indexOf(date);
    const perBook = { ...(challenge.dailyReadingPerBook || {}) };
    for (let i = fromIdx >= 0 ? fromIdx : 0; i < range.length; i++) {
      const d = range[i];
      perBook[d] = { ...perBook[d], [bookId]: cumulativePages };
    }
    const dailyReading = { ...challenge.dailyReading };
    for (let i = fromIdx >= 0 ? fromIdx : 0; i < range.length; i++) {
      const d = range[i];
      const tot = challenge.weeklyChallenge.books.reduce(
        (sum, p) => sum + (perBook[d]?.[p.bookId] ?? 0),
        0
      );
      dailyReading[d] = tot;
    }
    const updated = {
      ...challenge,
      dailyReadingPerBook: perBook,
      dailyReading
    };
    saveChallenge(updated);
    setChallenge(updated);
  }

  function markBookDayComplete(
    goal: NonNullable<typeof dailyGoals>[0],
    bookId: string,
    targetCumulative: number
  ) {
    if (!challenge) return;
    updateDailyReadingPerBook(goal.date, bookId, targetCumulative);
  }

  function markDayAsComplete(goal: NonNullable<typeof dailyGoals>[0]) {
    if (!challenge) return;
    if (goal.bookTargets && goal.bookTargets.length > 0) {
      goal.bookTargets.forEach((bt) => {
        updateDailyReadingPerBook(goal.date, bt.bookId, bt.cumulativePage);
      });
      return;
    }
    let previousCumulative = 0;
    const previousDate = new Date(goal.dateObj);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousDateStr = formatDate(previousDate);
    previousCumulative = challenge.dailyReading?.[previousDateStr] || 0;
    const newCumulative = previousCumulative + goal.target;
    updateDailyReading(goal.date, Math.ceil(newCumulative));
  }

  function clearChallenge() {
    saveChallenge(null);
    setChallenge(null);
  }

  function openYearModalForNewYear() {
    setYear(String(new Date().getFullYear() + 1));
    setTargetBooks("");
    setIsYearModalOpen(true);
  }

  const yearChallengeForm = (
    <form onSubmit={(e) => { e.preventDefault(); saveYearChallenge(); }} className="challenge-form">
      <label className="form-field">
        <span>Jaar</span>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          min="2000"
          max="2100"
        />
      </label>
      <label className="form-field">
        <span>Aantal boeken</span>
        <input
          type="number"
          value={targetBooks}
          onChange={(e) => setTargetBooks(e.target.value)}
          min="1"
        />
      </label>
      <label className="form-field">
        <span>Pagina's in het boek</span>
        <input
          type="number"
          value={weeklyPages}
          onChange={(e) => setWeeklyPages(e.target.value)}
          min="1"
          placeholder="Bijv. 467"
        />
      </label>
      <label className="form-field">
        <span>Begonnen op bladzijde (optioneel)</span>
        <input
          type="number"
          value={startPageInput}
          onChange={(e) => setStartPageInput(e.target.value)}
          min="0"
          placeholder="Bijv. 137"
        />
      </label>
      <div className="form-field-inline">
        <label className="form-field">
          <span>Begin van het doel</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Einde van het doel</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={startDate}
          />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="primary-button">
          Doel opslaan
        </button>
        {challenge && (
          <button
            type="button"
            onClick={() => { clearChallenge(); setIsYearModalOpen(false); }}
            className="secondary-button"
          >
            Doel wissen
          </button>
        )}
      </div>
    </form>
  );

  return (
    <div className="page">
      {isYearModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsYearModalOpen(false)}>
          <div className="modal year-challenge-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Jaardoel bewerken</h3>
            <p className="modal-intro">
              Stel je leesdoel in voor het jaar: aantal boeken.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); saveYearChallenge(); }} className="challenge-form">
              <label className="form-field">
                <span>Jaar</span>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  min="2000"
                  max="2100"
                />
              </label>
              <label className="form-field">
                <span>Aantal boeken</span>
                <input
                  type="number"
                  value={targetBooks}
                  onChange={(e) => setTargetBooks(e.target.value)}
                  min="1"
                />
              </label>
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={() => setIsYearModalOpen(false)}>
                  Annuleren
                </button>
                <button type="submit" className="primary-button">
                  Doel opslaan
                </button>
                {challenge && (
                  <button
                    type="button"
                    onClick={() => { clearChallenge(); setIsYearModalOpen(false); }}
                    className="secondary-button"
                  >
                    Doel wissen
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
      {isMobile ? (
        <>
          {!challenge ? (
            <>
              <p className="page-intro challenge-page-mobile-intro">
                Stel een jaardoel in (aantal boeken) en zie of je op schema ligt.
              </p>
              <section className="card challenge-mobile-summary-card">
                <p className="page-intro-small">Nog geen jaardoel ingesteld.</p>
                <button type="button" className="primary-button" onClick={() => setIsYearModalOpen(true)}>
                  Jaardoel instellen
                </button>
              </section>
            </>
          ) : (
            <>
              {/* Voortgang bovenaan, visueel met voortgangsbalk en kleuren */}
              {stats && (
                <section className={`card challenge-mobile-progress-hero challenge-mobile-progress-${stats.finishedCount >= challenge.targetBooks ? "behaald" : stats.status}`}>
                  <div className="challenge-mobile-progress-heading">
                    <h2>Voortgang {challenge.year}</h2>
                    <button
                      type="button"
                      className="link-button challenge-mobile-progress-edit"
                      onClick={() => setIsYearModalOpen(true)}
                    >
                      Bewerken
                    </button>
                  </div>
                  <div className="challenge-mobile-progress-bar-wrapper">
                    <div
                      className="challenge-mobile-progress-bar-fill"
                      style={{ width: `${Math.min(100, (stats.finishedCount / challenge.targetBooks) * 100)}%` }}
                    />
                  </div>
                  <p className="challenge-mobile-progress-count">
                    <strong>{stats.finishedCount}</strong> van <strong>{challenge.targetBooks}</strong> boeken
                  </p>
                  {stats.status === "achter" && (
                    <p className="challenge-mobile-progress-expected">
                      Om op schema te liggen: <strong>{stats.expectedByNow}</strong> boeken
                    </p>
                  )}
                  {stats.finishedCount >= challenge.targetBooks ? (
                    <div className="challenge-mobile-progress-behaald-block">
                      <span className="challenge-mobile-progress-behaald-text">Doel behaald! 🎉</span>
                      <button
                        type="button"
                        className="primary-button challenge-mobile-progress-new-year"
                        onClick={openYearModalForNewYear}
                      >
                        Doel voor nieuw jaar instellen
                      </button>
                    </div>
                  ) : (
                    <p className={`challenge-mobile-progress-status challenge-mobile-status-${stats.status}`}>
                      {stats.statusText}
                      {stats.status === "voor" && " 😎"}
                      {stats.status === "op-schema" && " 😊"}
                      {stats.status === "achter" && " 😢"}
                    </p>
                  )}
                </section>
              )}

              <section className="card challenge-mobile-summary-card">
                <h2>Weekchallenge</h2>
                {challenge.weeklyChallenge ? (
                  <>
                    <p className="challenge-mobile-summary-text">
                      {formatDateDisplay(challenge.weeklyChallenge.startDate)} t/m {formatDateDisplay(challenge.weeklyChallenge.endDate)}
                      {" · "}{challenge.weeklyChallenge.books.length} boeken
                      {challenge.weeklyChallenge.completed && " · ✓ Voltooid"}
                    </p>
                    {(() => {
                      const wc = challenge.weeklyChallenge!;
                      const totalPages = wc.books.reduce(
                        (sum, b) => sum + (b.totalPages || 0),
                        0
                      );
                      const readingDaySet = new Set<string>();
                      wc.books.forEach((plan) => {
                        Object.keys(plan.dailyPages).forEach((d) =>
                          readingDaySet.add(d)
                        );
                      });
                      const daysCount = readingDaySet.size;
                      const perDay =
                        daysCount > 0 ? Math.ceil(totalPages / daysCount) : 0;
                      const related = wc.books
                        .map((plan) => books.find((b) => b.id === plan.bookId))
                        .filter(Boolean) as typeof books;
                      if (!totalPages || !daysCount) return null;
                      return (
                        <p className="challenge-mobile-summary-text">
                          {related.length > 0 && (
                            <>
                              {related.map((b) => (
                                <span key={b.id} className="challenge-week-titles-line">
                                  <strong>{b.title}</strong>
                                  <br />
                                </span>
                              ))}
                            </>
                          )}
                          In totaal <strong>{totalPages} pagina&apos;s</strong> in{" "}
                          <strong>{daysCount} leesdagen</strong> → ongeveer{" "}
                          <strong>{perDay} blz per dag</strong>.
                        </p>
                      );
                    })()}
                    <div className="challenge-mobile-summary-actions">
                      <button type="button" className="secondary-button" onClick={() => openWeekModal(challenge.weeklyChallenge!)}>
                        Bewerken
                      </button>
                      <button type="button" className="secondary-button" onClick={toggleWeekChallengeComplete}>
                        {challenge.weeklyChallenge.completed ? "Niet voltooid" : "Afvinken"}
                      </button>
                      {challenge.weeklyChallenge.completed && (
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => openWeekModal()}
                        >
                          Nieuwe weekchallenge
                        </button>
                      )}
                      <button type="button" className="link-button destructive" onClick={deleteWeekChallenge}>
                        Verwijderen
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="page-intro-small">Geen actieve weekchallenge.</p>
                    <button type="button" className="primary-button" onClick={() => openWeekModal()}>
                      Nieuwe weekchallenge
                    </button>
                  </>
                )}
              </section>
            </>
          )}
        </>
      ) : (
        <>
          <p className="page-intro">
            Stel een jaardoel in (aantal boeken) en zie of je op schema ligt om het
            te halen.
          </p>

          <section className="card">
            <h2>Mijn doel</h2>
            {yearChallengeForm}
          </section>

      {challenge && (
        <section className="card">
          <div className="weekchallenge-header">
            <h2>Weekchallenge</h2>
            <button
              type="button"
              className="primary-button"
              onClick={() => openWeekModal()}
            >
              Nieuwe weekchallenge
            </button>
          </div>
          {challenge.weeklyChallenge ? (
            <div className="weekchallenge-info">
              <p className="page-intro-small">
                Weekchallenge van <strong>{formatDateDisplay(challenge.weeklyChallenge.startDate)}</strong> t/m{" "}
                <strong>{formatDateDisplay(challenge.weeklyChallenge.endDate)}</strong> met{" "}
                <strong>{challenge.weeklyChallenge.books.length} boeken</strong>.
                {challenge.weeklyChallenge.completed && (
                  <span className="completed-badge"> ✓ Voltooid</span>
                )}
              </p>
              {(() => {
                const wc = challenge.weeklyChallenge!;
                const totalPages = wc.books.reduce(
                  (sum, b) => sum + (b.totalPages || 0),
                  0
                );
                const readingDaySet = new Set<string>();
                wc.books.forEach((plan) => {
                  Object.keys(plan.dailyPages).forEach((d) => readingDaySet.add(d));
                });
                const daysCount = readingDaySet.size;
                const perDay = daysCount > 0 ? Math.ceil(totalPages / daysCount) : 0;
                const related = wc.books
                  .map((plan) => books.find((b) => b.id === plan.bookId))
                  .filter(Boolean) as typeof books;
                if (!totalPages || !daysCount) return null;
                return (
                  <p className="page-intro-small">
                    {related.length > 0 && (
                      <>
                        {related.map((b) => (
                          <span key={b.id} className="challenge-week-titles-line">
                            <strong>{b.title}</strong>
                            <br />
                          </span>
                        ))}
                      </>
                    )}
                    In totaal <strong>{totalPages} pagina&apos;s</strong> in{" "}
                    <strong>{daysCount} leesdagen</strong> → ongeveer{" "}
                    <strong>{perDay} blz per dag</strong>.
                  </p>
                );
              })()}
              <div className="weekchallenge-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openWeekModal(challenge.weeklyChallenge!)}
                >
                  Bewerken
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={toggleWeekChallengeComplete}
                >
                  {challenge.weeklyChallenge.completed ? "Markeer als niet voltooid" : "Afvinken"}
                </button>
                <button
                  type="button"
                  className="link-button destructive"
                  onClick={deleteWeekChallenge}
                >
                  Verwijderen
                </button>
              </div>
            </div>
          ) : (
            <p className="page-intro-small">
              Maak een nieuwe weekchallenge aan met de knop hiernaast.
            </p>
          )}
        </section>
      )}

        </>
      )}

      {isWeekModalOpen && (() => {
        const start = getDateFromString(weekChallengeStartDate);
        const end = getDateFromString(weekChallengeEndDate);
        const allDays: Array<{ date: Date; dateStr: string }> = [];
        let dayCursor = new Date(start);
        while (dayCursor <= end) {
          const date = new Date(dayCursor);
          allDays.push({ date, dateStr: formatDate(date) });
          dayCursor.setDate(dayCursor.getDate() + 1);
        }

        const readingDays =
          weekReadingDays.length > 0
            ? weekReadingDays
            : allDays.map((d) => d.dateStr);

        const selectedBooksForWeek = books.filter((b) =>
          weekSelectedBookIds.includes(b.id)
        );

        const totalPagesToRead = selectedBooksForWeek.reduce((sum, b) => {
          return sum + (b.pageCount || 0);
        }, 0);

        const pagesPerDay =
          readingDays.length > 0 ? Math.ceil(totalPagesToRead / readingDays.length) : 0;

        function buildWeekDraftFromMobileSelection(): WeekDraftRow[] | null {
          if (!selectedBooksForWeek.length || !readingDays.length) {
            return null;
          }
          const readingDaysSorted = [...readingDays].sort();
          const totalPagesToRead = selectedBooksForWeek.reduce(
            (s, b) => s + (b.pageCount || 0),
            0
          );
          const pagesPerDay =
            totalPagesToRead > 0 && readingDaysSorted.length > 0
              ? Math.ceil(totalPagesToRead / readingDaysSorted.length)
              : 0;
          if (pagesPerDay <= 0) return null;
          // Vul elke dag met pagesPerDay blz; haal uit boeken in volgorde. Als boek 1 op een dag nog maar 20 blz heeft, vul de rest van de dag met boek 2 (bijv. 130 blz).
          const allocations: { bookIndex: number; dateStr: string; pages: number }[] = [];
          let bookIndex = 0;
          let remainingInBook = selectedBooksForWeek[0]?.pageCount ?? 0;
          for (const dateStr of readingDaysSorted) {
            let remainingToFill = pagesPerDay;
            while (remainingToFill > 0 && bookIndex < selectedBooksForWeek.length) {
              const take = Math.min(remainingInBook, remainingToFill);
              if (take > 0) {
                allocations.push({ bookIndex, dateStr, pages: take });
                remainingInBook -= take;
                remainingToFill -= take;
              }
              if (remainingInBook <= 0) {
                bookIndex += 1;
                remainingInBook = selectedBooksForWeek[bookIndex]?.pageCount ?? 0;
              }
            }
          }
          const drafts: WeekDraftRow[] = selectedBooksForWeek.map((book, i) => {
            const daily: Record<string, string> = {};
            readingDaysSorted.forEach((d) => {
              daily[d] = "";
            });
            allocations
              .filter((a) => a.bookIndex === i)
              .forEach((a) => {
                daily[a.dateStr] = String(a.pages);
              });
            const selectedDays = readingDaysSorted.filter((d) => Number(daily[d] || 0) > 0);
            return {
              bookId: book.id,
              totalPages: String(book.pageCount ?? 0),
              dailyPages: daily,
              selectedDays,
            };
          });
          return drafts.length ? drafts : [];
        }

        return (
          <div className="modal-backdrop">
            <div className="modal weekchallenge-modal">
              {isMobile ? (
                <>
                  <h3>Nieuwe weekchallenge</h3>
                  <p className="modal-intro">
                    Kies je boek(en), periode en leesdagen. We verdelen het totaal aantal
                    pagina&apos;s gelijk over alle leesdagen. Je leest eerst het ene boek uit;
                    als je op een dag dat boek afrondt, ga je dezelfde dag door met het volgende boek.
                  </p>
                  <div className="form-field-inline">
                    <label className="form-field">
                      <span>Startdatum</span>
                      <input
                        type="date"
                        value={weekChallengeStartDate}
                        onChange={(e) => {
                          setWeekChallengeStartDate(e.target.value);
                        }}
                      />
                    </label>
                    <label className="form-field">
                      <span>Einddatum</span>
                      <input
                        type="date"
                        value={weekChallengeEndDate}
                        min={weekChallengeStartDate}
                        onChange={(e) => {
                          setWeekChallengeEndDate(e.target.value);
                        }}
                      />
                    </label>
                  </div>
                  <div className="form-field">
                    <span>Boek(en)</span>
                    <div className="weekchallenge-mobile-book-list">
                      {(() => {
                        const candidateBooks = books.filter(
                          (b) =>
                            b.status === "aan-het-lezen" || b.status === "wil-ik-lezen"
                        );
                        const currentlyReading = candidateBooks
                          .filter((b) => b.status === "aan-het-lezen")
                          .sort((a, b) => a.title.localeCompare(b.title));
                        const tbrBooks = candidateBooks
                          .filter((b) => b.status === "wil-ik-lezen")
                          .sort((a, b) => {
                            const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
                            const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
                            if (aOrder !== bOrder) return aOrder - bOrder;
                            return a.title.localeCompare(b.title);
                          });
                        const selectable = [...currentlyReading, ...tbrBooks];
                        if (!selectable.length) {
                          return (
                            <p className="page-intro-small">
                              Je hebt nog geen boeken op je leeslijst of TBR.
                            </p>
                          );
                        }
                        return selectable.map((book) => {
                          const isSelected = weekSelectedBookIds.includes(book.id);
                          const pages = book.pageCount;
                          return (
                            <button
                              key={book.id}
                              type="button"
                              className={`weekchallenge-mobile-book-pill ${
                                isSelected ? "selected" : ""
                              }`}
                              onClick={() => {
                                setWeekSelectedBookIds((prev) =>
                                  isSelected
                                    ? prev.filter((id) => id !== book.id)
                                    : [...prev, book.id]
                                );
                              }}
                            >
                              <div className="weekchallenge-mobile-book-pill-inner">
                                <div className="weekchallenge-mobile-book-cover">
                                  {book.coverUrl ? (
                                    <img src={book.coverUrl} alt={book.title} />
                                  ) : (
                                    <div className="weekchallenge-mobile-book-cover-placeholder">
                                      {book.title.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                </div>
                                <div className="weekchallenge-mobile-book-text">
                                  <div className="weekchallenge-mobile-book-title">
                                    {book.title}
                                  </div>
                                  <div className="weekchallenge-mobile-book-meta">
                                    <span>{book.authors}</span>
                                    {pages ? (
                                      <span> · {pages} blz</span>
                                    ) : (
                                      <span> · aantal pagina&apos;s onbekend</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  <div className="form-field">
                    <span>Leesdagen</span>
                    <div className="weekchallenge-mobile-days-chips">
                      {allDays.map((day) => {
                        const isSelected = readingDays.includes(day.dateStr);
                        return (
                          <button
                            key={day.dateStr}
                            type="button"
                            className={`weekchallenge-mobile-day-chip ${
                              isSelected ? "selected" : ""
                            }`}
                            onClick={() => {
                              setWeekReadingDays((prev) => {
                                const exists = prev.includes(day.dateStr);
                                if (exists) {
                                  return prev.filter((d) => d !== day.dateStr);
                                }
                                return [...prev, day.dateStr].sort();
                              });
                            }}
                          >
                            {getDayName(day.date).substring(0, 2)} {formatDateDisplay(day.dateStr)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="weekchallenge-mobile-summary">
                    {selectedBooksForWeek.length === 0 ? (
                      <p className="weekchallenge-mobile-summary-text">
                        Kies minimaal één boek om een weekchallenge te maken.
                      </p>
                    ) : readingDays.length === 0 ? (
                      <p className="weekchallenge-mobile-summary-text">
                        Kies de dagen waarop je wilt lezen.
                      </p>
                    ) : (
                      <p className="weekchallenge-mobile-summary-text">
                        In totaal{" "}
                        <strong>{totalPagesToRead || 0} pagina&apos;s</strong> in{" "}
                        <strong>{readingDays.length} leesdagen</strong> → ongeveer{" "}
                        <strong>{pagesPerDay} blz per dag</strong>.
                      </p>
                    )}
                  </div>

                  <div className="modal-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setIsWeekModalOpen(false);
                        setEditingWeekChallenge(null);
                      }}
                    >
                      Annuleren
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        const drafts = buildWeekDraftFromMobileSelection();
                        if (!drafts) return;
                        saveWeekChallengeFromDraft(drafts);
                      }}
                    >
                      Weekchallenge opslaan
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3>
                    {editingWeekChallenge ? "Weekchallenge bewerken" : "Nieuwe weekchallenge"}
                  </h3>
                  <p className="modal-intro">
                    Geef aan hoeveel boeken je in deze week wilt lezen en per boek
                    hoeveel pagina&apos;s je per dag leest.
                  </p>
                  <div className="form-field-inline">
                    <label className="form-field">
                      <span>Startdatum</span>
                      <input
                        type="date"
                        value={weekChallengeStartDate}
                        onChange={(e) => {
                          setWeekChallengeStartDate(e.target.value);
                          // Update dailyPages voor alle boeken
                          const newStart = getDateFromString(e.target.value);
                          const newEnd = getDateFromString(weekChallengeEndDate);
                          const newDays: string[] = [];
                          let cursor = new Date(newStart);
                          while (cursor <= newEnd) {
                            newDays.push(formatDate(cursor));
                            cursor.setDate(cursor.getDate() + 1);
                          }
                          setWeekBooksDraft((prev) =>
                            prev.map((book) => ({
                              ...book,
                              dailyPages: newDays.reduce((acc, date) => {
                                acc[date] = book.dailyPages[date] || "";
                                return acc;
                              }, {} as Record<string, string>),
                            }))
                          );
                        }}
                      />
                    </label>
                    <label className="form-field">
                      <span>Einddatum</span>
                      <input
                        type="date"
                        value={weekChallengeEndDate}
                        min={weekChallengeStartDate}
                        onChange={(e) => {
                          setWeekChallengeEndDate(e.target.value);
                          // Update dailyPages voor alle boeken
                          const newStart = getDateFromString(weekChallengeStartDate);
                          const newEnd = getDateFromString(e.target.value);
                          const newDays: string[] = [];
                          let cursor = new Date(newStart);
                          while (cursor <= newEnd) {
                            newDays.push(formatDate(cursor));
                            cursor.setDate(cursor.getDate() + 1);
                          }
                          setWeekBooksDraft((prev) =>
                            prev.map((book) => ({
                              ...book,
                              dailyPages: newDays.reduce((acc, date) => {
                                acc[date] = book.dailyPages[date] || "";
                                return acc;
                              }, {} as Record<string, string>),
                            }))
                          );
                        }}
                      />
                    </label>
                  </div>
                  <div className="form-field">
                    <span>Aantal boeken deze week</span>
                    <input
                      type="number"
                      min={1}
                      value={weekBookCount}
                      onChange={(e) => {
                        const value = Math.max(1, Number(e.target.value) || 1);
                        setWeekBookCount(value);
                        syncWeekBooksDraft(value);
                      }}
                    />
                  </div>
                  <div className="weekchallenge-books-list">
                    {Array.from({ length: weekBookCount }).map((_, index) => {
                      const row = weekBooksDraft[index] || {
                        totalPages: "",
                        dailyPages: {},
                        selectedDays: [],
                      };
                      return (
                        <div key={index} className="weekchallenge-book-card">
                          <div className="weekchallenge-book-header">
                            <h4>Boek {index + 1}</h4>
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => autoDistributeBookPages(index)}
                              disabled={!row.totalPages || row.selectedDays.length === 0}
                            >
                              Automatisch verdelen
                            </button>
                          </div>
                          <div className="weekchallenge-book-fields">
                            <label>
                              <span>Pagina&apos;s in dit boek</span>
                              <input
                                type="number"
                                min={1}
                                value={row.totalPages}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setWeekBooksDraft((prev) => {
                                    const next = [...prev];
                                    next[index] = {
                                      ...next[index],
                                      totalPages: value,
                                    };
                                    return next;
                                  });
                                }}
                              />
                            </label>
                          </div>
                          <div className="weekchallenge-days-grid">
                            {allDays.map((day) => {
                              const isSelected = row.selectedDays.includes(day.dateStr);
                              const pagesValue = row.dailyPages[day.dateStr] || "";
                              return (
                                <div key={day.dateStr} className="weekchallenge-day-item">
                                  <label className="weekchallenge-day-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => {
                                        setWeekBooksDraft((prev) => {
                                          const next = [...prev];
                                          const current = next[index] || {
                                            totalPages: "",
                                            dailyPages: {},
                                            selectedDays: [],
                                          };
                                          if (e.target.checked) {
                                            current.selectedDays = [
                                              ...current.selectedDays,
                                              day.dateStr,
                                            ];
                                          } else {
                                            current.selectedDays = current.selectedDays.filter(
                                              (d) => d !== day.dateStr
                                            );
                                            current.dailyPages[day.dateStr] = "";
                                          }
                                          next[index] = current;
                                          return next;
                                        });
                                      }}
                                    />
                                    <span>
                                      {getDayName(day.date).substring(0, 2)} {formatDateDisplay(day.dateStr)}
                                    </span>
                                  </label>
                                  {isSelected && (
                                    <input
                                      type="number"
                                      min={0}
                                      value={pagesValue}
                                      placeholder="0"
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        setWeekBooksDraft((prev) => {
                                          const next = [...prev];
                                          next[index] = {
                                            ...next[index],
                                            dailyPages: {
                                              ...next[index].dailyPages,
                                              [day.dateStr]: value,
                                            },
                                          };
                                          return next;
                                        });
                                      }}
                                      className="weekchallenge-day-pages-input"
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setIsWeekModalOpen(false);
                        setEditingWeekChallenge(null);
                      }}
                    >
                      Annuleren
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => saveWeekChallengeFromDraft()}
                    >
                      {editingWeekChallenge ? "Wijzigingen opslaan" : "Weekchallenge opslaan"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {!isMobile && challenge && stats && (
        <section className="card">
          <h2>Voortgang {challenge.year}</h2>
          <ul className="challenge-stats">
            <li>
              <strong>Gelezen:</strong> {stats.finishedCount} van{" "}
              {challenge.targetBooks} boeken
            </li>
            <li>
              <strong>Verwacht tot nu toe:</strong>{" "}
              {stats.expectedByNow} boeken
            </li>
            <li>
              <strong>Nog te gaan:</strong> {stats.remaining} boeken
            </li>
            <li>
              <strong>Status:</strong> {stats.statusText}
            </li>
          </ul>
        </section>
      )}

      {challenge && dailyGoals && (
        <section className="card">
          <h2>Dagelijkse leesdoelen</h2>
          <p className="page-intro-small">
            {challenge.weeklyChallenge ? (
              <>
                Weekchallenge met <strong>{challenge.weeklyChallenge.books.length} boeken</strong>.
                {" "}
                {challenge.weeklyChallenge.startDate && challenge.weeklyChallenge.endDate && (
                  <>
                    Periode van{" "}
                    <strong>{formatDateDisplay(challenge.weeklyChallenge.startDate)}</strong> t/m{" "}
                    <strong>{formatDateDisplay(challenge.weeklyChallenge.endDate)}</strong>.
                  </>
                )}
              </>
            ) : challenge.weeklyPages ? (
              <>
                <strong>{challenge.weeklyPages} pagina's in het boek</strong>
                {typeof challenge.startPage === "number" && (
                  <>
                    {" "}
                    (begonnen op bladzijde {challenge.startPage},{" "}
                    <strong>
                      nog{" "}
                      {Math.max(
                        0,
                        challenge.weeklyPages - challenge.startPage
                      )}{" "}
                      te gaan
                    </strong>
                    )
                  </>
                )}
                .{" "}
                {(() => {
                  const activeCount = Math.max(
                    1,
                    dailyGoals.filter(
                      (g) =>
                        !(
                          (challenge.offDaysAuto || challenge.offDays || [])
                            .includes(g.date) ||
                          (challenge.offDaysManual || []).includes(g.date)
                        )
                    ).length
                  );
                  const pagesLeft =
                    typeof challenge.startPage === "number"
                      ? Math.max(
                          0,
                          challenge.weeklyPages - challenge.startPage
                        )
                      : challenge.weeklyPages;
                  const perDay = Math.ceil(pagesLeft / activeCount);
                  return (
                    <>
                      Dat is ongeveer{" "}
                      <strong>{perDay} blz</strong> per actieve leesdag.
                    </>
                  );
                })()}
                {" "}
                {challenge.startDate && challenge.endDate && (
                  <>
                    Periode van{" "}
                    <strong>{challenge.startDate}</strong> t/m{" "}
                    <strong>{challenge.endDate}</strong>.
                  </>
                )}
              </>
            ) : (
              "Maak een weekchallenge aan om dagelijkse doelen te zien."
            )}
          </p>
          {(challenge.weeklyChallenge || challenge.weeklyPages) && dailyGoals && (
            <div className="daily-goals-list-compact">
              {dailyGoals.map((goal) => {
                const isToday = goal.date === formatDate(new Date());
                const isPast = goal.dateObj < new Date() && !isToday;
                const isAutoOff =
                  (challenge.offDaysAuto || challenge.offDays || []).includes(
                    goal.date
                  );
                const isManualOff = (challenge.offDaysManual || []).includes(
                  goal.date
                );
                const isOffDay = isAutoOff || isManualOff;
                const isThursday = goal.dateObj.getDay() === 4;
                const isComplete = goal.effectiveRead >= goal.target;
                const plannedCumulative = goal.plannedCumulative;
                let targetUntilToday: number;
                if (challenge.weeklyChallenge) {
                  // Voor weekchallenge: gebruik plannedCumulative (totaal aantal pagina's tot die dag)
                  targetUntilToday = plannedCumulative || 0;
                } else {
                  // Legacy: gebruik maxPage
                  const maxPage = challenge.weeklyPages;
                  targetUntilToday =
                    plannedCumulative && maxPage
                      ? Math.min(plannedCumulative, maxPage)
                      : plannedCumulative || maxPage || 0;
                }
                return (
                  <div
                    key={goal.date}
                    className={`daily-goal-item-compact ${isToday ? "today" : ""} ${isPast ? "past" : ""} ${isThursday ? "week-start" : ""} ${isComplete ? "complete" : ""} ${isOffDay ? "off-day" : ""}`}
                  >
                    <div className="daily-goal-header-compact">
                      <div>
                        <strong>{getDayName(goal.dateObj).substring(0, 2)}</strong>
                        <span className="daily-goal-date-compact">
                          {" "}{formatDateDisplay(goal.date)}
                        </span>
                      </div>
                      <div className="daily-goal-badges-compact">
                        {isToday && <span className="today-badge-small">Nu</span>}
                        {isAutoOff && (
                          <span className="offday-badge-small">Geen tijd</span>
                        )}
                        {isManualOff && (
                          <span className="offday-badge-small">
                            Geen tijd (ik regel het)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="daily-goal-content-compact">
                      {!isOffDay && goal.bookTargets && goal.bookTargets.length > 0 ? (
                        goal.bookTargets.map((bt) => {
                          const raw = challenge.dailyReadingPerBook?.[goal.date]?.[bt.bookId];
                          const bookValue = raw !== undefined && raw !== null
                            ? raw
                            : (goal.bookTargets!.length === 1 ? goal.cumulativePages : "");
                          const bookComplete = Number(bookValue) >= bt.cumulativePage;
                          return (
                            <div key={bt.bookId} className="daily-goal-book-block">
                              <div className="daily-goal-target-compact">
                                <strong>{bt.bookTitle}</strong>: tot bladzijde {bt.cumulativePage}
                              </div>
                              <div className="daily-goal-input-compact">
                                <label className="daily-goal-input-label">
                                  Gelezen tot bladzijde
                                </label>
                                <input
                                  type="number"
                                  value={bookValue || ""}
                                  onChange={(e) => {
                                    const pages = Number(e.target.value) || 0;
                                    updateDailyReadingPerBook(goal.date, bt.bookId, pages);
                                  }}
                                  min="0"
                                  max={bt.totalPages}
                                  placeholder="0"
                                  className="pages-input-compact"
                                />
                              </div>
                              {!bookComplete ? (
                                <button
                                  type="button"
                                  className="complete-button"
                                  onClick={() => markBookDayComplete(goal, bt.bookId, bt.cumulativePage)}
                                  title="Boek voor vandaag afvinken"
                                >
                                  ✓ Afvinken
                                </button>
                              ) : (
                                <div className="daily-goal-complete-compact">✓ Behaald</div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <>
                          {!isOffDay && (
                            <div className="daily-goal-target-compact">
                              Lees tot bladzijde {targetUntilToday}
                            </div>
                          )}
                          <div className="daily-goal-input-compact">
                            <label className="daily-goal-input-label">
                              Gelezen tot bladzijde...
                            </label>
                            <input
                              type="number"
                              value={goal.cumulativePages || ""}
                              onChange={(e) => {
                                const pages = Number(e.target.value) || 0;
                                updateDailyReading(goal.date, pages);
                              }}
                              min="0"
                              placeholder="0"
                              className="pages-input-compact"
                            />
                          </div>
                          {!isOffDay && (
                            <>
                              {!isComplete && (
                                <button
                                  type="button"
                                  className="complete-button"
                                  onClick={() => markDayAsComplete(goal)}
                                  title="Markeer doel als behaald"
                                >
                                  ✓ Afvinken
                                </button>
                              )}
                              {isComplete && (
                                <div className="daily-goal-complete-compact">✓ Behaald</div>
                              )}
                              {goal.remaining > 0 && !isComplete && (
                                <div className="daily-goal-remaining-compact">
                                  Nog {Math.ceil(goal.remaining)} blz
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                      {SHOW_OFFDAY_UI && (
                        <div className="daily-goal-offday-toggle">
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                              const mode: "auto" | "manual" = isManualOff
                                ? "manual"
                                : "auto";
                              const distribution: Record<string, number> = {};
                              dailyGoals
                                .filter((g2) => g2.date !== goal.date)
                                .forEach((g2) => {
                                  distribution[g2.date] = 0;
                                });
                              setOffdayModal({
                                date: goal.date,
                                mode,
                                distribution
                              });
                            }}
                          >
                            Geen tijd deze dag
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {SHOW_OFFDAY_UI && offdayModal && (
            <div className="modal-backdrop">
              <div className="modal">
                {(() => {
                  const modalGoal = dailyGoals.find(
                    (g) => g.date === offdayModal.date
                  );
                  const totalToDistribute = modalGoal
                    ? Math.round(modalGoal.target)
                    : 0;
                  const distributed = Object.values(
                    offdayModal.distribution
                  ).reduce((sum, v) => sum + (v || 0), 0);
                  const remaining = totalToDistribute - distributed;
                  return (
                    <>
                      <h3>
                        Geen tijd op{" "}
                        {modalGoal
                          ? `${getDayName(modalGoal.dateObj)} (${modalGoal.date})`
                          : offdayModal.date}
                      </h3>
                      <p className="modal-intro">
                        Kies wat je wilt doen met het doel van{" "}
                        <strong>{totalToDistribute} blz</strong> voor deze dag.
                      </p>
                      <div className="modal-radio-group">
                        <label>
                          <input
                            type="radio"
                            name="offday-mode"
                            checked={offdayModal.mode === "auto"}
                            onChange={() =>
                              setOffdayModal({
                                ...offdayModal,
                                mode: "auto"
                              })
                            }
                          />{" "}
                          Automatisch verdelen over de andere leesdagen
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="offday-mode"
                            checked={offdayModal.mode === "manual"}
                            onChange={() =>
                              setOffdayModal({
                                ...offdayModal,
                                mode: "manual"
                              })
                            }
                          />{" "}
                          Ik regel het zelf (ik kies waar de extra bladzijden
                          heen gaan)
                        </label>
                      </div>

                      {offdayModal.mode === "manual" && modalGoal && (
                        <div className="modal-distribution">
                          <p className="modal-distribution-intro">
                            Verdeel de <strong>{totalToDistribute} blz</strong>{" "}
                            over de andere dagen. Dit is een hulpmiddel: je moet
                            later zelf de hogere bladzijdes invullen bij die
                            dagen.
                          </p>
                          <div className="modal-distribution-list">
                            {dailyGoals
                              .filter((g) => g.date !== offdayModal.date)
                              .map((g) => (
                                <div
                                  key={g.date}
                                  className="modal-distribution-row"
                                >
                                  <span>
                                    {getDayName(g.dateObj).substring(0, 2)}{" "}
                                    {g.dateObj.getDate()}/
                                    {g.dateObj.getMonth() + 1}
                                  </span>
                                  <div className="modal-distribution-controls">
                                    <label>
                                      <input
                                        type="checkbox"
                                        checked={
                                          (offdayModal.distribution[g.date] ||
                                            0) > 0
                                        }
                                        onChange={(e) => {
                                          const startPageLocal =
                                            challenge.startPage ?? 0;
                                          const totalPagesInBook =
                                            challenge.weeklyPages ??
                                            totalToDistribute;

                                          const currentlySelected = Object.entries(
                                            offdayModal.distribution
                                          )
                                            .filter(
                                              ([, v]) => (v || 0) > 0
                                            )
                                            .map(([date]) => date);

                                          let selectedDates: string[];
                                          if (e.target.checked) {
                                            selectedDates = Array.from(
                                              new Set([
                                                ...currentlySelected,
                                                g.date
                                              ])
                                            );
                                          } else {
                                            selectedDates = currentlySelected.filter(
                                              (d) => d !== g.date
                                            );
                                          }

                                          if (selectedDates.length === 0) {
                                            setOffdayModal({
                                              ...offdayModal,
                                              distribution: {}
                                            });
                                            return;
                                          }

                                          // Verdeel de bladzijden gelijkmatig en rond per dag naar boven af
                                          let remaining = totalToDistribute;
                                          const newDistribution: Record<
                                            string,
                                            number
                                          > = {};
                                          selectedDates.forEach(
                                            (date, index) => {
                                              const slotsLeft =
                                                selectedDates.length - index;
                                              const share = Math.ceil(
                                                remaining / slotsLeft
                                              );
                                              newDistribution[date] = share;
                                              remaining -= share;
                                            }
                                          );

                                          setOffdayModal({
                                            ...offdayModal,
                                            distribution: newDistribution
                                          });
                                        }}
                                      />{" "}
                                      Extra op deze dag
                                    </label>
                                    {(() => {
                                      const extra =
                                        offdayModal.distribution[g.date] || 0;
                                      if (extra <= 0) return null;
                                      const planned =
                                        g.plannedCumulative ??
                                        (challenge.startPage ?? 0);
                                      const maxPage =
                                        challenge.weeklyPages ?? planned;
                                      const newTarget = Math.min(
                                        planned + extra,
                                        maxPage
                                      );
                                      return (
                                        <div className="modal-extra-summary">
                                          +{extra} blz → tot bladzijde{" "}
                                          {newTarget}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              ))}
                          </div>
                          <div className="modal-summary">
                            <div>
                              Totaal extra ingepland:{" "}
                              <strong>{distributed} blz</strong>
                            </div>
                            <div>
                              Nog te verdelen:{" "}
                              <strong>
                                {remaining > 0 ? remaining : 0} blz
                              </strong>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="modal-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setOffdayModal(null)}
                        >
                          Annuleren
                        </button>
                        {challenge && (
                          <>
                            {(() => {
                              const isAuto =
                                offdayModal.mode === "auto" && challenge;
                              const isManual =
                                offdayModal.mode === "manual" && challenge;
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="primary-button"
                                    onClick={() => {
                                      if (!challenge) return;
                                      const autoSet = new Set(
                                        challenge.offDaysAuto ||
                                          challenge.offDays ||
                                          []
                                      );
                                      const manualSet = new Set(
                                        challenge.offDaysManual || []
                                      );
                                      if (isAuto) {
                                        autoSet.add(offdayModal.date);
                                        manualSet.delete(offdayModal.date);
                                      } else if (isManual) {
                                        autoSet.delete(offdayModal.date);
                                        manualSet.add(offdayModal.date);
                                      }
                                      const updated: ReadingChallenge = {
                                        ...challenge,
                                        offDays: Array.from(autoSet),
                                        offDaysAuto: Array.from(autoSet),
                                        offDaysManual: Array.from(manualSet)
                                      };
                                      saveChallenge(updated);
                                      setChallenge(updated);
                                      setOffdayModal(null);
                                    }}
                                  >
                                    Opslaan
                                  </button>
                                  {(() => {
                                    const isCurrentlyOff =
                                      (challenge.offDaysAuto ||
                                        challenge.offDays ||
                                        []).includes(offdayModal.date) ||
                                      (challenge.offDaysManual || []).includes(
                                        offdayModal.date
                                      );
                                    if (!isCurrentlyOff) return null;
                                    return (
                                      <button
                                        type="button"
                                        className="link-button destructive"
                                        onClick={() => {
                                          if (!challenge) return;
                                          const autoSet = new Set(
                                            challenge.offDaysAuto ||
                                              challenge.offDays ||
                                              []
                                          );
                                          const manualSet = new Set(
                                            challenge.offDaysManual || []
                                          );
                                          autoSet.delete(offdayModal.date);
                                          manualSet.delete(offdayModal.date);
                                          const updated: ReadingChallenge = {
                                            ...challenge,
                                            offDays: Array.from(autoSet),
                                            offDaysAuto: Array.from(autoSet),
                                            offDaysManual: Array.from(
                                              manualSet
                                            )
                                          };
                                          saveChallenge(updated);
                                          setChallenge(updated);
                                          setOffdayModal(null);
                                        }}
                                      >
                                        Geen tijd uitzetten
                                      </button>
                                    );
                                  })()}
                                </>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

