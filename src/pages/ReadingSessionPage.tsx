import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  computeDailyGoals,
  DailyGoal,
  getBookCumulativeThroughDate
} from "../challengeDailyGoals";
import { applyLegacyDailyReading, applyMultiplePerBookDailyReading } from "../challengeReadingProgress";
import { useBasePath, withBase } from "../routing";
import { loadBooks, loadChallenge, loadReadingPace, saveChallenge, subscribeBooks } from "../storage";
import { Book, ReadingChallenge } from "../types";

function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!d || !m || !y) return dateStr;
  return `${d}-${m}-${y}`;
}

function isValidYmd(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function goalIsActiveReadingDay(goal: DailyGoal, challenge: ReadingChallenge): boolean {
  const legacyOff = new Set(challenge.offDays ?? []);
  const offDaysAuto = new Set(challenge.offDaysAuto ?? []);
  const offDaysManual = new Set(challenge.offDaysManual ?? []);
  const isAutoOff = (d: string) => offDaysAuto.has(d) || legacyOff.has(d);
  const isManualOff = (d: string) => offDaysManual.has(d);
  const isOffDay = isAutoOff(goal.date) || isManualOff(goal.date);
  const hasTargets = Boolean(goal.bookTargets?.length);
  const hasWeekChallenge = Boolean(challenge.weeklyChallenge);
  const isNoReadDay = (hasWeekChallenge && !hasTargets) || isOffDay;
  return !isNoReadDay;
}

function getPagesTodayForBook(
  challenge: ReadingChallenge,
  dateStr: string,
  bookId: string
): number {
  const wc = challenge.weeklyChallenge;
  if (!wc) return 0;
  const plan = wc.books.find((b) => b.bookId === bookId);
  return plan?.dailyPages[dateStr] || 0;
}

/** Verdeelt sessie-pagina’s over boeken naar verhouding van het dagdoel per boek. */
function distributeSessionPagesAcrossBooks(
  challenge: ReadingChallenge,
  dateStr: string,
  bookIds: string[],
  sessionPages: number
): Record<string, number> {
  const weights = bookIds.map((id) => getPagesTodayForBook(challenge, dateStr, id));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || sessionPages <= 0) {
    const out: Record<string, number> = {};
    bookIds.forEach((id) => {
      out[id] = 0;
    });
    return out;
  }
  const raw = weights.map((w) => (sessionPages * w) / sum);
  const floors = raw.map((r) => Math.floor(r));
  let rem = sessionPages - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rem > 0; k++) {
    floors[order[k].i]++;
    rem--;
  }
  const out: Record<string, number> = {};
  bookIds.forEach((id, i) => {
    out[id] = floors[i];
  });
  return out;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

type SessionDoneSnapshot = {
  bookEnds?: Array<{ bookId: string; title: string; endPage: number; dayTarget: number }>;
  plannedMinutes: number;
};

/** Berekent challenge zoals na opslaan van de huidige formulierwaarden; `null` bij ongeldige invoer. */
function tryProjectChallengeFromSessionForm(
  challenge: ReadingChallenge,
  dateParam: string,
  snap: SessionDoneSnapshot,
  readPagesByBook: Record<string, string>,
  legacyReadPage: string
): ReadingChallenge | null {
  if (snap.bookEnds?.length) {
    const pagesByBookId: Record<string, number> = {};
    for (const b of snap.bookEnds) {
      const raw = (readPagesByBook[b.bookId] ?? "").trim();
      const n = Number(raw.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return null;
      pagesByBookId[b.bookId] = Math.round(n);
    }
    return applyMultiplePerBookDailyReading(challenge, dateParam, pagesByBookId);
  }
  const raw = legacyReadPage.trim();
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return applyLegacyDailyReading(challenge, dateParam, Math.round(n));
}

export function ReadingSessionPage() {
  const { date: dateParam } = useParams<{ date: string }>();
  const navigate = useNavigate();
  const basePath = useBasePath();
  const challengePath = withBase(basePath, "/challenge");

  const [books, setBooks] = useState<Book[]>(() => loadBooks());
  const [challenge, setChallenge] = useState<ReadingChallenge | null>(() => loadChallenge());

  useEffect(() => {
    return subscribeBooks(setBooks);
  }, []);

  useEffect(() => {
    setChallenge(loadChallenge());
  }, [dateParam]);

  const pagesPerHour = loadReadingPace();

  const dailyGoals = useMemo(
    () => computeDailyGoals(challenge, books),
    [challenge, books]
  );

  const goal = useMemo(() => {
    if (!dateParam || !isValidYmd(dateParam) || !dailyGoals || !challenge) return null;
    return dailyGoals.find((g) => g.date === dateParam) ?? null;
  }, [dateParam, dailyGoals, challenge]);

  const invalidRedirect =
    !dateParam ||
    !isValidYmd(dateParam) ||
    !challenge ||
    !goal ||
    !goalIsActiveReadingDay(goal, challenge);

  const [durationMinutes, setDurationMinutes] = useState(30);
  const [customMinutes, setCustomMinutes] = useState("");
  const [phase, setPhase] = useState<"setup" | "running" | "done">("setup");
  const [endAtMs, setEndAtMs] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [progressSaved, setProgressSaved] = useState(false);
  const [readPagesByBook, setReadPagesByBook] = useState<Record<string, string>>({});
  const [legacyReadPage, setLegacyReadPage] = useState("");
  const [sessionToast, setSessionToast] = useState("");
  const [sessionFormError, setSessionFormError] = useState("");
  /** Welke boeken van de dag horen bij deze sessie (weekchallenge met meerdere boeken). */
  const [selectedSessionBookIds, setSelectedSessionBookIds] = useState<Set<string>>(() => new Set());

  const weekBookIdsKey = useMemo(() => {
    const wc = challenge?.weeklyChallenge;
    if (!wc || !dateParam) return "";
    return wc.books
      .filter((p) => (p.dailyPages[dateParam] || 0) > 0)
      .map((p) => p.bookId)
      .sort()
      .join("|");
  }, [challenge?.weeklyChallenge, dateParam]);

  useEffect(() => {
    if (!weekBookIdsKey) {
      setSelectedSessionBookIds(new Set());
      return;
    }
    setSelectedSessionBookIds(new Set(weekBookIdsKey.split("|")));
  }, [weekBookIdsKey]);

  // Snapshot targets when entering running (stable during timer)
  const [snapshot, setSnapshot] = useState<{
    sessionPages: number;
    legacyEndPage?: number;
    bookEnds?: Array<{ bookId: string; title: string; endPage: number; dayTarget: number }>;
    endClockLabel: string;
    plannedMinutes: number;
  } | null>(null);

  function buildSnapshot(minutes: number, bookIdsForSession: string[]) {
    if (!goal || !challenge || !pagesPerHour) return null;
    const sp = Math.round((pagesPerHour * minutes) / 60);
    const endD = new Date(Date.now() + minutes * 60_000);

    if (goal.bookTargets?.length) {
      const targets = goal.bookTargets.filter((bt) => bookIdsForSession.includes(bt.bookId));
      if (targets.length === 0) return null;
      const ids = targets.map((b) => b.bookId);
      const alloc = distributeSessionPagesAcrossBooks(challenge, goal.date, ids, sp);
      const bookEnds = targets.map((bt) => {
        const raw = challenge.dailyReadingPerBook?.[goal.date]?.[bt.bookId];
        const fallback = getBookCumulativeThroughDate(challenge, goal.date, bt.bookId);
        const currentNum =
          typeof raw === "number" && !Number.isNaN(raw)
            ? raw
            : typeof fallback === "number"
              ? fallback
              : 0;
        const add = alloc[bt.bookId] ?? 0;
        const endPage = Math.min(currentNum + add, bt.cumulativePage);
        return {
          bookId: bt.bookId,
          title: bt.bookTitle,
          endPage,
          dayTarget: bt.cumulativePage
        };
      });
      return {
        sessionPages: sp,
        bookEnds,
        endClockLabel: formatClock(endD),
        plannedMinutes: minutes
      };
    }

    const maxPage = challenge.weeklyPages;
    const targetUntilToday =
      goal.plannedCumulative != null && maxPage != null
        ? Math.min(goal.plannedCumulative, maxPage)
        : goal.plannedCumulative ?? maxPage ?? 0;
    const current = goal.cumulativePages;
    const legacyEndPage = Math.min(current + sp, targetUntilToday);
    return {
      sessionPages: sp,
      legacyEndPage,
      endClockLabel: formatClock(endD),
      plannedMinutes: minutes
    };
  }

  function maxPageForBook(bookId: string): number | undefined {
    return goal?.bookTargets?.find((bt) => bt.bookId === bookId)?.totalPages;
  }

  function commitSessionProgress() {
    setSessionFormError("");
    if (!challenge || !dateParam || !goal || !snapshot) return;

    if (snapshot.bookEnds?.length) {
      const pagesByBookId: Record<string, number> = {};
      for (const b of snapshot.bookEnds) {
        const raw = (readPagesByBook[b.bookId] ?? "").trim();
        const n = Number(raw.replace(",", "."));
        if (!Number.isFinite(n) || n < 0) {
          setSessionFormError("Vul bij elk boek een geldig bladzijden-getal in.");
          return;
        }
        const rounded = Math.round(n);
        const max = maxPageForBook(b.bookId);
        if (max != null && rounded > max) {
          setSessionFormError(`Maximaal ${max} blz voor “${b.title}”.`);
          return;
        }
        pagesByBookId[b.bookId] = rounded;
      }
      const next = applyMultiplePerBookDailyReading(challenge, dateParam, pagesByBookId);
      saveChallenge(next);
      setChallenge(next);
    } else {
      const raw = legacyReadPage.trim();
      const n = Number(raw.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        setSessionFormError("Vul een geldig bladzijden-getal in.");
        return;
      }
      const rounded = Math.round(n);
      const max = challenge.weeklyPages;
      if (max != null && rounded > max) {
        setSessionFormError(`Maximaal blz ${max} voor dit doel.`);
        return;
      }
      const next = applyLegacyDailyReading(challenge, dateParam, rounded);
      saveChallenge(next);
      setChallenge(next);
    }

    setProgressSaved(true);
    setSessionToast("Opgeslagen bij je dagdoel.");
    window.setTimeout(() => setSessionToast(""), 4500);
  }

  function handleStart() {
    if (!pagesPerHour || !goal || !challenge) return;
    const min =
      customMinutes.trim() !== ""
        ? Math.max(1, Math.min(600, Number(customMinutes.replace(",", ".")) || 0))
        : durationMinutes;
    if (!Number.isFinite(min) || min < 1) return;
    const idsForSession =
      goal.bookTargets?.length && selectedSessionBookIds.size > 0
        ? goal.bookTargets.filter((bt) => selectedSessionBookIds.has(bt.bookId)).map((bt) => bt.bookId)
        : goal.bookTargets?.length
          ? []
          : [];
    if (goal.bookTargets?.length && idsForSession.length === 0) return;
    const snap = buildSnapshot(min, idsForSession);
    if (!snap) return;
    setSnapshot(snap);
    const end = Date.now() + min * 60_000;
    setEndAtMs(end);
    setRemainingMs(end - Date.now());
    setPhase("running");
  }

  useEffect(() => {
    if (phase !== "running") return;
    const tick = () => {
      const left = endAtMs - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        setPhase("done");
        return;
      }
      setRemainingMs(left);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [phase, endAtMs]);

  useEffect(() => {
    if (phase !== "done" || !snapshot) return;
    setProgressSaved(false);
    setSessionFormError("");
    if (snapshot.bookEnds?.length) {
      const init: Record<string, string> = {};
      snapshot.bookEnds.forEach((b) => {
        init[b.bookId] = String(b.endPage);
      });
      setReadPagesByBook(init);
      setLegacyReadPage("");
    } else {
      setReadPagesByBook({});
      setLegacyReadPage(
        snapshot.legacyEndPage != null ? String(snapshot.legacyEndPage) : ""
      );
    }
  }, [phase, snapshot]);

  const sessionRemainingHint = useMemo(() => {
    if (phase !== "done" || !snapshot || !challenge || !dateParam || !pagesPerHour) return null;
    const projected = tryProjectChallengeFromSessionForm(
      challenge,
      dateParam,
      snapshot,
      readPagesByBook,
      legacyReadPage
    );
    if (!projected) return null;
    const goals = computeDailyGoals(projected, books);
    const g = goals?.find((x) => x.date === dateParam);
    if (!g) return null;
    const rem = g.remaining;
    const minutesFloat = (rem * 60) / pagesPerHour;
    const minutesRounded = rem <= 0 ? 0 : Math.max(1, Math.round(minutesFloat));
    const pm = snapshot.plannedMinutes;
    const sessionsNeeded =
      rem <= 0 || pm <= 0 ? 0 : Math.max(1, Math.ceil(minutesFloat / pm));
    return { remainingPages: rem, minutesRounded, sessionsNeeded, sessionMinutes: pm };
  }, [
    phase,
    snapshot,
    challenge,
    dateParam,
    books,
    pagesPerHour,
    readPagesByBook,
    legacyReadPage
  ]);

  if (invalidRedirect) {
    return <Navigate to={challengePath} replace />;
  }

  const dayLabel = goal
    ? new Intl.DateTimeFormat("nl-NL", {
        weekday: "long",
        day: "numeric",
        month: "long"
      }).format(goal.dateObj)
    : "";

  const legacyDayPage =
    goal!.plannedCumulative != null && challenge!.weeklyPages != null
      ? Math.min(goal!.plannedCumulative, challenge!.weeklyPages)
      : goal!.plannedCumulative ?? challenge!.weeklyPages ?? null;

  return (
    <div className="page reading-session-page">
      <header className="reading-session-header">
        <Link to={challengePath} className="reading-session-back">
          ← Challenge
        </Link>
        <p className="reading-session-meta-top">
          {formatDateDisplay(goal!.date)}
          {dayLabel ? ` · ${dayLabel}` : ""}
        </p>
      </header>

      {!pagesPerHour && (
        <section className="card reading-session-card reading-session-warning">
          <p className="reading-session-plain">
            Stel <strong>bladzijden per uur</strong> in via{" "}
            <Link to={withBase(basePath, "/profiel")}>Profiel</Link>.
          </p>
        </section>
      )}

      {pagesPerHour && phase === "setup" && (
        <section className="card reading-session-card">
          <p className="reading-session-plain reading-session-muted-block">{pagesPerHour} blz/u</p>
          <div className="reading-session-presets" role="group" aria-label="Duur">
            {[15, 30, 45, 60].map((m) => (
              <button
                key={m}
                type="button"
                className={`reading-session-preset ${durationMinutes === m && customMinutes.trim() === "" ? "selected" : ""}`}
                onClick={() => {
                  setDurationMinutes(m);
                  setCustomMinutes("");
                }}
              >
                {m}′
              </button>
            ))}
          </div>
          <label className="reading-session-inline-field">
            <span className="reading-session-inline-label">Anders</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              placeholder="min"
              className="reading-session-input-min"
            />
          </label>

          <div className="reading-session-rule" />
          <p className="reading-session-plain">
            Vandaag: <strong>{goal!.target} blz</strong>
          </p>
          {goal!.bookTargets?.length ? (
            <>
              <ul className="reading-session-plain-list reading-session-book-pick-list">
                {goal!.bookTargets.map((bt) => (
                  <li key={bt.bookId}>
                    {goal!.bookTargets!.length > 1 ? (
                      <label className="reading-session-book-label">
                        <input
                          type="checkbox"
                          checked={selectedSessionBookIds.has(bt.bookId)}
                          onChange={() => {
                            setSelectedSessionBookIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(bt.bookId)) next.delete(bt.bookId);
                              else next.add(bt.bookId);
                              return next;
                            });
                          }}
                        />
                        <span>
                          {bt.bookTitle} → blz {bt.cumulativePage}
                        </span>
                      </label>
                    ) : (
                      <span>
                        {bt.bookTitle} → blz {bt.cumulativePage}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {goal!.bookTargets.length > 1 && (
                <p className="reading-session-hint-small">
                  Vink alleen de boeken aan die je nu leest. De timer verdeelt je sessie-blz daarover; het andere
                  boek blijft vandaag wel in je dagdoel staan.
                </p>
              )}
            </>
          ) : (
            legacyDayPage != null && (
              <p className="reading-session-plain">Tot blz {legacyDayPage}</p>
            )
          )}

          <button
            type="button"
            className="primary-button reading-session-start-btn"
            onClick={handleStart}
            disabled={
              Boolean(
                goal!.bookTargets &&
                  goal!.bookTargets.length > 1 &&
                  selectedSessionBookIds.size === 0
              )
            }
          >
            Start
          </button>
        </section>
      )}

      {pagesPerHour && phase === "running" && snapshot && (
        <section className="card reading-session-card reading-session-active">
          <div className="reading-session-timer-block" aria-live="polite">
            <span className="reading-session-timer-digits">{formatCountdown(remainingMs)}</span>
            <p className="reading-session-timer-caption">
              Tot {snapshot.endClockLabel} · ~{snapshot.sessionPages} blz · dag {goal!.target} blz
            </p>
          </div>
          <div className="reading-session-rule" />
          {snapshot.bookEnds?.length ? (
            <ul className="reading-session-plain-list">
              {snapshot.bookEnds.map((b) => (
                <li key={b.bookId}>
                  {b.title}: {b.endPage} <span className="reading-session-faint">/ {b.dayTarget}</span>
                </li>
              ))}
            </ul>
          ) : (
            snapshot.legacyEndPage != null && (
              <p className="reading-session-plain">Streef: blz {snapshot.legacyEndPage}</p>
            )
          )}
        </section>
      )}

      {pagesPerHour && phase === "done" && snapshot && (
        <section className="card reading-session-card reading-session-done">
          <p className="reading-session-done-lead">Klaar ({snapshot.plannedMinutes}′)</p>
          <p className="reading-session-plain">Dagdoel: {goal!.target} blz</p>
          {sessionRemainingHint && (
            <p className="reading-session-plain reading-session-remaining-hint">
              {sessionRemainingHint.remainingPages <= 0 ? (
                <>Met deze bladzijden is je dagdoel voor vandaag gehaald.</>
              ) : (
                <>
                  Nog ongeveer <strong>{sessionRemainingHint.minutesRounded} minuten</strong> lezen voor je
                  dagdoel — dat zijn nog{" "}
                  <strong>
                    {sessionRemainingHint.sessionsNeeded === 1
                      ? "1 sessie"
                      : `${sessionRemainingHint.sessionsNeeded} sessies`}
                  </strong>{" "}
                  van {sessionRemainingHint.sessionMinutes} minuten (zoals deze timer, op {pagesPerHour}{" "}
                  blz/u).
                </>
              )}
            </p>
          )}
          {snapshot.bookEnds?.length ? (
            <ul className="reading-session-plain-list">
              {snapshot.bookEnds.map((b) => (
                <li key={b.bookId}>
                  {b.title}: streef blz {b.endPage}
                </li>
              ))}
            </ul>
          ) : (
            snapshot.legacyEndPage != null && (
              <p className="reading-session-plain">Streef: blz {snapshot.legacyEndPage}</p>
            )
          )}

          {!progressSaved ? (
            <>
              <div className="reading-session-rule" />
              <p className="reading-session-plain">Waar ben je geëindigd?</p>
              <p className="reading-session-hint-small">
                Standaard staat elk veld op je sessiedoel; verhoog het als je verder bent gelezen.
              </p>
              {snapshot.bookEnds?.length ? (
                <div className="reading-session-page-inputs">
                  {snapshot.bookEnds.map((b) => (
                    <label key={b.bookId} className="reading-session-page-field">
                      <span className="reading-session-page-field-label">{b.title}</span>
                      <span className="reading-session-page-field-row">
                        <span className="reading-session-page-prefix">Tot blz</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={maxPageForBook(b.bookId) ?? undefined}
                          value={readPagesByBook[b.bookId] ?? ""}
                          onChange={(e) =>
                            setReadPagesByBook((prev) => ({
                              ...prev,
                              [b.bookId]: e.target.value
                            }))
                          }
                          className="reading-session-input-min reading-session-page-input"
                        />
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <label className="reading-session-page-field reading-session-page-field-single">
                  <span className="reading-session-page-field-row">
                    <span className="reading-session-page-prefix">Gelezen tot blz</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={challenge?.weeklyPages ?? undefined}
                      value={legacyReadPage}
                      onChange={(e) => setLegacyReadPage(e.target.value)}
                      className="reading-session-input-min reading-session-page-input"
                    />
                  </span>
                </label>
              )}
              {sessionFormError && (
                <p className="reading-session-form-error" role="alert">
                  {sessionFormError}
                </p>
              )}
              <p className="reading-session-hint-small">
                Dit wordt hetzelfde opgeslagen als bij &quot;Gelezen tot bladzijde&quot; op de challenge voor vandaag.
              </p>
              <div className="reading-session-outcome-row">
                <button
                  type="button"
                  className="primary-button reading-session-outcome-btn"
                  onClick={() => commitSessionProgress()}
                >
                  Opslaan bij dagdoel
                </button>
              </div>
            </>
          ) : (
            <p className="reading-session-plain reading-session-saved-note">
              Je bladzijden staan bij je dagdoel voor vandaag.
            </p>
          )}

          <div className="reading-session-done-actions">
            <button type="button" className="primary-button" onClick={() => navigate(challengePath)}>
              Challenge
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setProgressSaved(false);
                setSessionToast("");
                setSessionFormError("");
                setPhase("setup");
                setSnapshot(null);
                setCustomMinutes("");
              }}
            >
              Opnieuw
            </button>
          </div>
        </section>
      )}

      {sessionToast ? (
        <div className="reading-session-toast" role="status">
          {sessionToast}
        </div>
      ) : null}
    </div>
  );
}
