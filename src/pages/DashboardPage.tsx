import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { loadBooks, loadShelves, saveShelves, loadChallenge, saveChallenge, saveBooks, subscribeBooks, loadFriends, shareWithFriend } from "../storage";
import { Book, Shelf, ReadStatus, ReadingChallenge } from "../types";
import { useBasePath, withBase } from "../routing";
import { BookDetailPage } from "./BookDetailPage";

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function sortBooksBySeries(books: Book[]): Book[] {
  return [...books].sort((a, b) => {
    // Voor "Wil ik lezen": volgorde is de hoogste prioriteit
    if (a.status === "wil-ik-lezen" && b.status === "wil-ik-lezen") {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      
      // Boeken met volgorde (order > 0) komen voor boeken zonder volgorde (order = 0)
      if (orderA > 0 && orderB === 0) return -1;
      if (orderA === 0 && orderB > 0) return 1;
      
      // Als beide een volgorde hebben, sorteer op volgorde
      if (orderA > 0 && orderB > 0) {
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        // Zelfde volgorde, ga door naar volgende sorteerregel
      }
      
      // Zelfde volgorde (of beide geen volgorde), dan op auteur
      const authorCompare = a.authors.localeCompare(b.authors);
      if (authorCompare !== 0) {
        return authorCompare;
      }
      // Zelfde auteur, sorteer op serie naam
      if (a.seriesName && b.seriesName) {
        if (a.seriesName !== b.seriesName) {
          return a.seriesName.localeCompare(b.seriesName);
        }
        // Zelfde serie, sorteer op nummer
        const numA = a.seriesNumber ?? 0;
        const numB = b.seriesNumber ?? 0;
        if (numA !== numB) {
          return numA - numB;
        }
        // Zelfde serie en nummer, sorteer op titel
        return a.title.localeCompare(b.title);
      }
      // Als een boek geen serie heeft, komt het na boeken met serie (binnen dezelfde auteur)
      if (a.seriesName && !b.seriesName) return -1;
      if (!a.seriesName && b.seriesName) return 1;
      // Beide geen serie, sorteer op titel
      return a.title.localeCompare(b.title);
    } else if (a.status === "wil-ik-lezen" && b.status !== "wil-ik-lezen") {
      // Boeken met "Wil ik lezen" komen eerst
      return -1;
    } else if (a.status !== "wil-ik-lezen" && b.status === "wil-ik-lezen") {
      return 1;
    }
    
    // Voor andere statussen: eerst op auteur
    const authorCompare = a.authors.localeCompare(b.authors);
    if (authorCompare !== 0) {
      return authorCompare;
    }
    
    // Zelfde auteur, sorteer op serie naam
    if (a.seriesName && b.seriesName) {
      if (a.seriesName !== b.seriesName) {
        return a.seriesName.localeCompare(b.seriesName);
      }
      // Zelfde serie, sorteer op nummer
      const numA = a.seriesNumber ?? 0;
      const numB = b.seriesNumber ?? 0;
      if (numA !== numB) {
        return numA - numB;
      }
      // Zelfde serie en nummer, sorteer op titel
      return a.title.localeCompare(b.title);
    }
    
    // Als een boek geen serie heeft, komt het na boeken met serie (binnen dezelfde auteur)
    if (a.seriesName && !b.seriesName) return -1;
    if (!a.seriesName && b.seriesName) return 1;
    
    // Beide geen serie, sorteer op volgorde, dan op titel
    const orderA = a.order ?? 0;
    const orderB = b.order ?? 0;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.title.localeCompare(b.title);
  });
}

function getBooksForShelf(shelf: Shelf, books: Book[]): Book[] {
  // Voor standaardboekenkasten: match op status
  const statusMap: Record<string, ReadStatus> = {
    "wil-ik-lezen": "wil-ik-lezen",
    "aan-het-lezen": "aan-het-lezen",
    "gelezen": "gelezen"
  };
  
  const status = statusMap[shelf.id];
  if (status) {
    const filtered = books.filter((b) => b.status === status);
    return sortBooksBySeries(filtered);
  }
  
  // Voor custom boekenkasten: filter op shelfIds
  return books
    .filter((b) => b.shelfIds?.includes(shelf.id))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function getShelfLink(shelf: Shelf, basePath: string): string {
  return withBase(basePath, `/plank/${shelf.id}`);
}

type DashboardMode = "toggle" | "desktop" | "mobile";

export function DashboardPage({ mode = "toggle" }: { mode?: DashboardMode }) {
  const basePath = useBasePath();
  const [books, setBooks] = useState<Book[]>(() => loadBooks());
  const [shelves, setShelves] = useState<Shelf[]>(() => loadShelves());
  const [challenge, setChallenge] = useState<ReadingChallenge | null>(() =>
    loadChallenge()
  );
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [dashboardView, setDashboardView] = useState<"desktop" | "mobile">(
    mode === "toggle" ? "desktop" : mode
  );
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [editingPageCount, setEditingPageCount] = useState<string>("");
  const [editingSeriesName, setEditingSeriesName] = useState<string>("");
  const [editingSeriesNumber, setEditingSeriesNumber] = useState<string>("");
  const [editingOrder, setEditingOrder] = useState<string>("");
  const [useCustomSeries, setUseCustomSeries] = useState(false);
  const [mobileBooksSubTab, setMobileBooksSubTab] = useState<"leeslijst" | "gelezen">("leeslijst");
  const [readSeriesFilter, setReadSeriesFilter] = useState<string>("alle");
  const [readSortDirection, setReadSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [showAddToShelfModal, setShowAddToShelfModal] = useState(false);
  const [showShareWithBuddyModal, setShowShareWithBuddyModal] = useState(false);
  const [shareWithBuddyError, setShareWithBuddyError] = useState("");
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [detailModalBookId, setDetailModalBookId] = useState<string | null>(null);
  const [newShelfName, setNewShelfName] = useState("");
  const [showModalStatusMenu, setShowModalStatusMenu] = useState(false);
  const [selectionBarPosition, setSelectionBarPosition] = useState({ bottom: 96, leftPercent: 50 });
  const [toast, setToast] = useState("");
  const selectionBarDragRef = useRef<{ startY: number; startBottom: number; startX: number; startLeft: number } | null>(null);

  const STATUS_LABELS: Record<ReadStatus, string> = {
    "wil-ik-lezen": "Wil ik lezen",
    "aan-het-lezen": "Aan het lezen",
    gelezen: "Gelezen",
    "geen-status": "Geen status"
  };
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);
  const longPressBookIdRef = useRef<string | null>(null);

  function handleSelectionBarPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    selectionBarDragRef.current = {
      startY: e.clientY,
      startBottom: selectionBarPosition.bottom,
      startX: e.clientX,
      startLeft: selectionBarPosition.leftPercent
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function handleSelectionBarPointerMove(e: React.PointerEvent) {
    if (selectionBarDragRef.current == null) return;
    const { startY, startBottom, startX, startLeft } = selectionBarDragRef.current;
    const deltaY = startY - e.clientY;
    const deltaXPercent = ((e.clientX - startX) / window.innerWidth) * 100;
    let newBottom = Math.round(startBottom + deltaY);
    let newLeft = startLeft + deltaXPercent;
    newBottom = Math.max(60, Math.min(500, newBottom));
    newLeft = Math.max(5, Math.min(95, newLeft));
    setSelectionBarPosition({ bottom: newBottom, leftPercent: newLeft });
  }
  function handleSelectionBarPointerUp(e: React.PointerEvent) {
    if (selectionBarDragRef.current != null) {
      selectionBarDragRef.current = null;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
  }

  function toggleBookSelected(id: string) {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function enterSelectionModeWith(id: string) {
    setSelectionMode(true);
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  const existingSeries = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      if (b.seriesName) set.add(b.seriesName);
    });
    return Array.from(set).sort();
  }, [books]);

  // Sync books tussen tabs/shells (web ↔ mobile)
  useEffect(() => {
    return subscribeBooks(setBooks);
  }, []);

  // Als we een vaste mode hebben (desktop/mobile), forceer die view.
  useEffect(() => {
    if (mode !== "toggle") {
      setDashboardView(mode);
    }
  }, [mode]);
  
  function openBookInfo(book: Book) {
    setSelectedBook(book);
    setEditingPageCount(book.pageCount != null ? String(book.pageCount) : "");
    setEditingSeriesName(book.seriesName ?? "");
    setEditingSeriesNumber(book.seriesNumber != null ? String(book.seriesNumber) : "");
    setEditingOrder(book.order != null ? String(book.order) : "");
    setUseCustomSeries(!!(book.seriesName && !existingSeries.includes(book.seriesName)));
  }

  function openDetailPopup(bookId: string) {
    setDetailModalBookId(bookId);
  }

  function removeBook(bookId: string) {
    const next = books.filter((b) => b.id !== bookId);
    updateBooks(next);
    if (selectedBook?.id === bookId) setSelectedBook(null);
  }

  function updateBookSeries(
    bookId: string,
    seriesName: string | undefined,
    seriesNumber: number | undefined,
    order: number | undefined
  ) {
    const next = books.map((b) =>
      b.id === bookId
        ? {
            ...b,
            seriesName: seriesName?.trim() || undefined,
            seriesNumber,
            order: order ?? b.order
          }
        : b
    );
    updateBooks(next);
    if (selectedBook?.id === bookId) {
      setSelectedBook({
        ...selectedBook,
        seriesName: seriesName?.trim() || undefined,
        seriesNumber,
        order: order ?? selectedBook.order
      });
    }
  }

  const SYSTEM_SHELF_STATUS: Record<string, ReadStatus> = {
    "wil-ik-lezen": "wil-ik-lezen",
    "aan-het-lezen": "aan-het-lezen",
    "gelezen": "gelezen"
  };

  function getBookPlankNames(book: Book): string[] {
    const ids = book.shelfIds ?? [];
    return ids
      .map((id) => shelves.find((s) => s.id === id)?.name)
      .filter((name): name is string => name != null)
      .sort((a, b) => a.localeCompare(b));
  }

  function addBooksToShelf(shelfId: string) {
    const status = SYSTEM_SHELF_STATUS[shelfId];
    const isCustomShelf = !status;
    const ids = Array.from(selectedBookIds);
    const next = books.map((b) => {
      if (!ids.includes(b.id)) return b;
      const shelfIds = b.shelfIds ?? [];
      if (isCustomShelf) {
        if (shelfIds.includes(shelfId)) return b;
        return { ...b, shelfIds: [...shelfIds, shelfId] };
      }
      return { ...b, status: status! };
    });
    updateBooks(next);
    setSelectedBookIds(new Set());
    setShowAddToShelfModal(false);
    const shelfName = status ? STATUS_LABELS[status] : (shelves.find((s) => s.id === shelfId)?.name ?? "boekenkast");
    setToast(ids.length === 1 ? `Boek toegevoegd aan "${shelfName}".` : `${ids.length} boeken toegevoegd aan "${shelfName}".`);
    window.setTimeout(() => setToast(""), 2500);
  }

  function getSortedTbrBooks() {
    return books
      .filter((b) => b.status === "wil-ik-lezen")
      .sort((a, b) => {
        const orderA = a.order ?? 0;
        const orderB = b.order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.title.localeCompare(b.title);
      });
  }

  function moveTbrBook(bookId: string, direction: "up" | "down") {
    const tbrBooks = getSortedTbrBooks();
    const index = tbrBooks.findIndex((b) => b.id === bookId);
    if (index === -1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= tbrBooks.length) return;

    const reordered = [...tbrBooks];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    const orderMap = new Map<string, number>();
    reordered.forEach((b, idx) => {
      orderMap.set(b.id, idx + 1);
    });

    const nextBooks = books.map((b) =>
      b.status === "wil-ik-lezen" && orderMap.has(b.id)
        ? { ...b, order: orderMap.get(b.id)! }
        : b
    );
    updateBooks(nextBooks);
  }

  function moveTbrBookToTop(bookId: string) {
    const tbrBooks = getSortedTbrBooks();
    const index = tbrBooks.findIndex((b) => b.id === bookId);
    if (index === -1 || index === 0) return;

    const reordered = [...tbrBooks];
    const [moved] = reordered.splice(index, 1);
    reordered.unshift(moved);

    const orderMap = new Map<string, number>();
    reordered.forEach((b, idx) => {
      orderMap.set(b.id, idx + 1);
    });

    const nextBooks = books.map((b) =>
      b.status === "wil-ik-lezen" && orderMap.has(b.id)
        ? { ...b, order: orderMap.get(b.id)! }
        : b
    );
    updateBooks(nextBooks);
    if (selectedBook?.id === bookId) {
      setEditingOrder("1");
      setSelectedBook({ ...selectedBook, order: 1 });
    }
  }

  function moveTbrBookToBottom(bookId: string) {
    const tbrBooks = getSortedTbrBooks();
    const index = tbrBooks.findIndex((b) => b.id === bookId);
    if (index === -1 || index === tbrBooks.length - 1) return;

    const reordered = [...tbrBooks];
    const [moved] = reordered.splice(index, 1);
    reordered.push(moved);

    const orderMap = new Map<string, number>();
    reordered.forEach((b, idx) => {
      orderMap.set(b.id, idx + 1);
    });

    const nextBooks = books.map((b) =>
      b.status === "wil-ik-lezen" && orderMap.has(b.id)
        ? { ...b, order: orderMap.get(b.id)! }
        : b
    );
    updateBooks(nextBooks);
    if (selectedBook?.id === bookId) {
      const newOrder = reordered.length;
      setEditingOrder(String(newOrder));
      setSelectedBook({ ...selectedBook, order: newOrder });
    }
  }


  function updateBooks(next: Book[]) {
    saveBooks(next);
    setBooks(next);
    // Als alle geselecteerde boeken verwijderd of gewijzigd zijn, en er niks meer geselecteerd is,
    // schakel de selectiemodus uit.
    setSelectedBookIds((prev) => {
      const remaining = new Set(
        Array.from(prev).filter((id) => next.some((b) => b.id === id))
      );
      if (remaining.size === 0) {
        setSelectionMode(false);
      }
      return remaining;
    });
  }

  function updateBookPageCount(bookId: string, pageCount: number | undefined) {
    const next = books.map((b) =>
      b.id === bookId ? { ...b, pageCount } : b
    );
    updateBooks(next);
    // Update ook selectedBook als het hetzelfde boek is
    if (selectedBook && selectedBook.id === bookId) {
      setSelectedBook({ ...selectedBook, pageCount });
    }
  }

  function updateBookStatus(bookId: string, newStatus: ReadStatus) {
    const next = books.map((b) =>
      b.id === bookId
        ? {
            ...b,
            status: newStatus,
            // Als je een boek als gelezen markeert, zet finishedAt op vandaag
            finishedAt:
              newStatus === "gelezen"
                ? new Date().toISOString().slice(0, 10)
                : b.finishedAt
          }
        : b
    );
    updateBooks(next);
  }

  const challengeStats = useMemo(() => {
    if (!challenge) return null;
    const now = new Date();
    const yearNum = challenge.year;
    const todayYear = now.getFullYear();
    const totalDays = 365 + (yearNum % 4 === 0 ? 1 : 0);
    const dayOfYear =
      yearNum === todayYear ? getDayOfYear(now) : totalDays;

    const readThisYear = books.filter((b) => {
      if (b.status !== "gelezen") return false;
      
      if (b.finishedAt) {
        const d = new Date(b.finishedAt);
        return d.getFullYear() === yearNum;
      }
      
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
      statusText = `Je loopt ${Math.abs(diffRounded)} boeken voor op schema 🎉`;
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

  // Bereken dagelijkse doel van vandaag
  const todayGoal = useMemo(() => {
    if (
      !challenge?.weeklyPages ||
      !challenge.startDate ||
      !challenge.endDate
    )
      return null;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = formatDate(today);

    const start = new Date(challenge.startDate + "T00:00:00");
    const end = new Date(challenge.endDate + "T00:00:00");
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const legacyOff = new Set(challenge.offDays || []);
    const offDaysAuto = new Set(challenge.offDaysAuto || []);
    const offDaysManual = new Set(challenge.offDaysManual || []);
    const isOff = offDaysAuto.has(todayStr) || offDaysManual.has(todayStr) || legacyOff.has(todayStr);

    if (today < start || today > end || isOff) {
      return null;
    }

    const dailyReading = challenge.dailyReading || {};
    const startPage = challenge.startPage ?? 0;
    const totalPagesInBook = challenge.weeklyPages;
    const pagesToRead = totalPagesInBook - startPage;
    if (pagesToRead <= 0) return null;

    // Verzamel alle dagen in het geselecteerde bereik
    const allDays: Array<{ date: Date; dateStr: string }> = [];
    let cursor = new Date(start);
    while (cursor <= end) {
      const date = new Date(cursor);
      const dateStr = formatDate(date);
      allDays.push({ date, dateStr });
      cursor.setDate(cursor.getDate() + 1);
    }

    const activeDays = allDays.filter(
      (d) =>
        !offDaysAuto.has(d.dateStr) &&
        !offDaysManual.has(d.dateStr) &&
        !legacyOff.has(d.dateStr)
    );
    if (activeDays.length === 0) return null;

    const pagesPerDay = pagesToRead / activeDays.length;

    // Bereken cumulatieve bladzijden per dag
    let previousCumulative = startPage;
    const cumulativePagesPerDay: number[] = [];
    for (const day of allDays) {
      const cumulative = dailyReading[day.dateStr] || previousCumulative;
      cumulativePagesPerDay.push(cumulative);
      previousCumulative = cumulative;
    }
    
    // Totale gelezen bladzijden in deze periode (bovenop startbladzijde)
    const lastCumulative =
      cumulativePagesPerDay[cumulativePagesPerDay.length - 1] ?? startPage;
    const totalReadInWeek = Math.max(0, lastCumulative - startPage);
    
    // Verdeel de totale gelezen bladzijden over de dagen
    // waarbij later gelezen bladzijden ook meetellen voor eerdere dagen
    let remainingPages = totalReadInWeek;
    const effectiveReads: number[] = [];
    let accumulatedDebt = 0;
    
    for (let i = 0; i < allDays.length; i++) {
      const day = allDays[i];
      if (
        offDaysAuto.has(day.dateStr) ||
        offDaysManual.has(day.dateStr) ||
        legacyOff.has(day.dateStr)
      ) {
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
    
    // Bereken schuld tot vandaag
    accumulatedDebt = 0;
    for (let i = 0; i < allDays.length; i++) {
      const day = allDays[i];
      if (day.dateStr === todayStr) break;
      if (
        offDaysAuto.has(day.dateStr) ||
        offDaysManual.has(day.dateStr) ||
        legacyOff.has(day.dateStr)
      )
        continue;
      const target = pagesPerDay + accumulatedDebt;
      const effectiveRead = effectiveReads[i];
      if (effectiveRead < target) {
        accumulatedDebt = target - effectiveRead;
      } else {
        accumulatedDebt = 0;
      }
    }
    
    // Doel en effectieve gelezen bladzijden voor vandaag
    const todayTarget = pagesPerDay + accumulatedDebt;
    const todayIndex = allDays.findIndex((d) => d.dateStr === todayStr);
    const todayEffectiveRead = todayIndex >= 0 ? effectiveReads[todayIndex] : 0;
    const remaining = Math.max(0, todayTarget - todayEffectiveRead);
    
    // Bereken cumulatieve bladzijden voor vandaag
    const todayCumulative =
      todayIndex >= 0 ? cumulativePagesPerDay[todayIndex] : 0;
    
    return {
      target: Math.round(todayTarget * 10) / 10,
      read: Math.round(todayEffectiveRead * 10) / 10,
      remaining: Math.round(remaining * 10) / 10,
      isComplete: todayEffectiveRead >= todayTarget,
      cumulativePages: todayCumulative,
      date: todayStr
    };
  }, [challenge]);

  /** Voor een boek in de weekchallenge: huidige bladzijde (hoogste uit dailyReadingPerBook) en totaal. */
  function getChallengeProgress(bookId: string): { current: number; total: number } | null {
    const wc = challenge?.weeklyChallenge;
    if (!wc) return null;
    const plan = wc.books.find((p) => p.bookId === bookId);
    if (!plan) return null;
    const perBook = challenge.dailyReadingPerBook || {};
    let current = 0;
    for (const dayRecord of Object.values(perBook)) {
      const val = dayRecord[bookId];
      if (typeof val === "number" && val > current) current = val;
    }
    return { current, total: plan.totalPages };
  }

  function updateDailyReading(date: string, cumulativePages: number) {
    if (!challenge) return;
    const updated = {
      ...challenge,
      dailyReading: {
        ...challenge.dailyReading,
        [date]: cumulativePages
      }
    };
    saveChallenge(updated);
    setChallenge(updated);
  }

  function markDayAsComplete() {
    if (!challenge || !todayGoal) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay();
    const daysFromThursday = (dayOfWeek + 3) % 7;
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - daysFromThursday);
    weekStart.setHours(0, 0, 0, 0);
    
    // Vind de vorige dag in de periode
    let previousCumulative = challenge.startPage ?? 0;
    if (daysFromThursday > 0) {
      const previousDate = new Date(today);
      previousDate.setDate(previousDate.getDate() - 1);
      const previousDateStr = formatDate(previousDate);
      previousCumulative =
        challenge.dailyReading?.[previousDateStr] ?? previousCumulative;
    }
    
    // Het doel is om het target te halen, dus voeg dat toe aan de vorige cumulatieve waarde
    const newCumulative = previousCumulative + todayGoal.target;
    updateDailyReading(todayGoal.date, Math.ceil(newCumulative));
  }

  return (
    <div className={`page dashboard-page ${dashboardView === "mobile" ? "dashboard-mobile-view" : ""}`}>
      <div className="page-header" style={{ display: dashboardView === "mobile" ? "none" : undefined }}>
        <h1>Dashboard</h1>
        {mode === "toggle" && (
          <div className="dashboard-view-toggle">
            <button
              type="button"
              className={`view-toggle-button ${dashboardView === "desktop" ? "active" : ""}`}
              onClick={() => setDashboardView("desktop")}
            >
              Overzicht
            </button>
            <button
              type="button"
              className={`view-toggle-button ${dashboardView === "mobile" ? "active" : ""}`}
              onClick={() => setDashboardView("mobile")}
            >
              Mobiele stijl
            </button>
          </div>
        )}
      </div>

      {dashboardView === "desktop" && challenge && challengeStats && (
        <section className="card challenge-card">
          <div className="challenge-header">
            <h2>Lees-challenge {challenge.year}</h2>
            <div className="challenge-progress-bar-wrapper">
              <div className="challenge-progress-bar">
                <div 
                  className="challenge-progress-fill"
                  style={{ width: `${Math.min(100, (challengeStats.finishedCount / challenge.targetBooks) * 100)}%` }}
                ></div>
              </div>
              <div className="challenge-progress-text">
                <strong>{challengeStats.finishedCount}</strong> / <strong>{challenge.targetBooks}</strong>
              </div>
            </div>
          </div>
          <div className="challenge-summary">
            <div className="challenge-stats-grid">
              <div className="challenge-stat-item">
                <div className="challenge-stat-label">Verwacht</div>
                <div className="challenge-stat-value">{challengeStats.expectedByNow}</div>
              </div>
              <div className="challenge-stat-item">
                <div className="challenge-stat-label">Nog te gaan</div>
                <div className="challenge-stat-value">{challengeStats.remaining}</div>
              </div>
              <div className={`challenge-status challenge-status-${challengeStats.status}`}>
                {challengeStats.statusText}
              </div>
            </div>
            {todayGoal && (
              <div className="challenge-daily-goal">
                <div className="challenge-daily-goal-header">
                  <div>
                    <strong>{getDayName(new Date()).substring(0, 2)}</strong>
                    <span className="challenge-daily-goal-date">
                      {" "}{new Date().getDate()}/{new Date().getMonth() + 1}
                    </span>
                  </div>
                  <span className="today-badge-small">Nu</span>
                </div>
                <div className="challenge-daily-goal-content">
                  <div className="challenge-daily-goal-target">
                    Doel: {Math.round(todayGoal.target)} blz
                  </div>
                  <div className="challenge-daily-goal-input">
                    <label className="challenge-daily-goal-input-label">
                      Gelezen tot bladzijde...
                    </label>
                    <input
                      type="number"
                      value={todayGoal.cumulativePages || ""}
                      onChange={(e) => {
                        const pages = Number(e.target.value) || 0;
                        updateDailyReading(todayGoal.date, pages);
                      }}
                      min="0"
                      placeholder="0"
                      className="challenge-pages-input"
                    />
                  </div>
                  {!todayGoal.isComplete && (
                    <button
                      className="challenge-complete-button"
                      onClick={markDayAsComplete}
                      title="Markeer doel als behaald"
                    >
                      ✓ Afvinken
                    </button>
                  )}
                  {todayGoal.isComplete && (
                    <div className="challenge-daily-goal-complete">✓ Behaald</div>
                  )}
                  {todayGoal.remaining > 0 && !todayGoal.isComplete && (
                    <div className="challenge-daily-goal-remaining">
                      Nog {Math.round(todayGoal.remaining)} blz
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {dashboardView === "desktop" && (
        <section className="card">
          <h2>Mijn boekenkasten</h2>
          <div className="shelves-grid">
            {shelves
            .sort((a, b) => {
              // Sorteer op belangrijkheid: aan-het-lezen > wil-ik-lezen > gelezen
              const priority: Record<string, number> = {
                "aan-het-lezen": 1,
                "wil-ik-lezen": 2,
                "gelezen": 3
              };
              const priorityA = priority[a.id] ?? 999;
              const priorityB = priority[b.id] ?? 999;
              return priorityA - priorityB;
            })
            .map((shelf) => {
            const shelfBooks = getBooksForShelf(shelf, books);
            const link = getShelfLink(shelf, basePath);
            const isCurrentlyReading = shelf.id === "aan-het-lezen";
            const isTBR = shelf.id === "wil-ik-lezen";
            const isRead = shelf.id === "gelezen";
            return (
              <Link
                key={shelf.id}
                to={link}
                className={`shelf-card-link ${isCurrentlyReading ? "shelf-compact" : ""} ${isTBR ? "shelf-priority" : ""} ${isRead ? "shelf-secondary" : ""}`}
              >
                <div className={`shelf-card ${isCurrentlyReading ? "shelf-card-compact" : ""} ${isTBR ? "shelf-card-priority" : ""} ${isRead ? "shelf-card-secondary" : ""}`}>
                  <h3>
                    {shelf.name}
                    <span className="book-count">({shelfBooks.length})</span>
                  </h3>
                  {shelfBooks.length === 0 ? (
                    <p className="empty-shelf">Geen boeken op deze boekenkast</p>
                  ) : (
                    <div className={isCurrentlyReading ? "shelf-books-list-with-descriptions" : "shelf-books-grid"}>
                      {shelfBooks.slice(0, isCurrentlyReading ? 3 : 6).map((book) => {
                        const isExpanded = expandedDescriptions.has(book.id);
                        return (
                          <div key={book.id} className={isCurrentlyReading ? "shelf-book-with-description" : ""}>
                            <Link
                              to={withBase(basePath, `/boek/${book.id}`)}
                              className="shelf-book-item-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="shelf-book-item">
                                {book.coverUrl ? (
                                  <img
                                    src={book.coverUrl}
                                    alt={book.title}
                                    className="shelf-book-cover"
                                  />
                                ) : (
                                  <div className="shelf-book-placeholder">
                                    {book.title.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                {book.seriesName && (
                                  <div className="shelf-book-series-badge">
                                    {book.seriesName}
                                    {book.seriesNumber && ` #${book.seriesNumber}`}
                                  </div>
                                )}
                                <div
                                  className="shelf-book-title"
                                  title={book.title}
                                >
                                  {book.title}
                                </div>
                              </div>
                            </Link>
                            {isCurrentlyReading && book.description && (
                              <div className="shelf-book-description-wrapper">
                                <button
                                  className="description-toggle-button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const newExpanded = new Set(expandedDescriptions);
                                    if (isExpanded) {
                                      newExpanded.delete(book.id);
                                    } else {
                                      newExpanded.add(book.id);
                                    }
                                    setExpandedDescriptions(newExpanded);
                                  }}
                                >
                                  {isExpanded ? "▲ Verberg beschrijving" : "▼ Bekijk beschrijving"}
                                </button>
                                {isExpanded && (
                                  <div className="shelf-book-description">
                                    {book.description}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {shelfBooks.length > (isCurrentlyReading ? 3 : 6) && (
                        <div className="shelf-book-more">
                          +{shelfBooks.length - (isCurrentlyReading ? 3 : 6)} meer
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
          </div>
        </section>
      )}

      {dashboardView === "mobile" && (
        <section className="card mobile-reading-lists">
          <div className="mobile-books-subtabs" role="tablist" aria-label="Leeslijst of uitgelezen">
            <button
              type="button"
              role="tab"
              aria-selected={mobileBooksSubTab === "leeslijst"}
              className={`mobile-subtab ${mobileBooksSubTab === "leeslijst" ? "active" : ""}`}
              onClick={() => setMobileBooksSubTab("leeslijst")}
            >
              Leeslijst
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileBooksSubTab === "gelezen"}
              className={`mobile-subtab ${mobileBooksSubTab === "gelezen" ? "active" : ""}`}
              onClick={() => setMobileBooksSubTab("gelezen")}
            >
              Uitgelezen
            </button>
          </div>

          {mobileBooksSubTab === "leeslijst" && (
            <>
              <h2 className="mobile-section-heading">Aan het lezen</h2>
              <div className="mobile-reading-list">
                {books
                  .filter((b) => b.status === "aan-het-lezen")
                  .map((book) => {
                    const progress = getChallengeProgress(book.id);
                    const showDailyGoalProgress = progress && progress.total > 0;
                    const isSelected = selectedBookIds.has(book.id);
                    return (
                    <div
                      key={book.id}
                      className={`mobile-reading-item ${isSelected ? "mobile-reading-item-selected" : ""}`}
                    >
                      {selectionMode && (
                        <button
                          type="button"
                          className={`mobile-reading-checkbox ${isSelected ? "checked" : ""}`}
                          onClick={() => toggleBookSelected(book.id)}
                          aria-pressed={isSelected}
                        >
                          <span className="mobile-reading-checkbox-icon">{isSelected ? "✓" : ""}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="mobile-reading-main"
                    onTouchStart={() => {
                          if (selectionMode) return;
                          longPressBookIdRef.current = book.id;
                          longPressTimerRef.current = setTimeout(() => {
                            const id = longPressBookIdRef.current;
                            if (id) {
                              enterSelectionModeWith(id);
                              suppressNextClickRef.current = true;
                              longPressBookIdRef.current = null;
                            }
                            longPressTimerRef.current = null;
                          }, 500);
                        }}
                        onTouchEnd={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          longPressBookIdRef.current = null;
                        }}
                        onTouchCancel={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          longPressBookIdRef.current = null;
                        }}
                        onMouseDown={() => {
                          if (selectionMode) return;
                          longPressBookIdRef.current = book.id;
                          longPressTimerRef.current = setTimeout(() => {
                            const id = longPressBookIdRef.current;
                            if (id) {
                              enterSelectionModeWith(id);
                              suppressNextClickRef.current = true;
                              longPressBookIdRef.current = null;
                            }
                            longPressTimerRef.current = null;
                          }, 500);
                        }}
                        onMouseUp={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          longPressBookIdRef.current = null;
                        }}
                        onMouseLeave={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          longPressBookIdRef.current = null;
                        }}
                        onClick={(e) => {
                          if (suppressNextClickRef.current) {
                            e.preventDefault();
                            e.stopPropagation();
                            suppressNextClickRef.current = false;
                            return;
                          }
                          if (selectionMode) {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleBookSelected(book.id);
                            return;
                          }
                          openBookInfo(book);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!selectionMode) {
                            enterSelectionModeWith(book.id);
                          } else {
                            toggleBookSelected(book.id);
                          }
                        }}
                      >
                        <div className="mobile-reading-cover">
                          {book.coverUrl ? (
                            <img src={book.coverUrl} alt={book.title} />
                          ) : (
                            <div className="mobile-reading-placeholder">
                              {book.title.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="mobile-reading-text">
                          {book.seriesName && (
                            <div className="mobile-reading-series-badge">
                              {book.seriesName}
                              {book.seriesNumber != null ? ` #${book.seriesNumber}` : ""}
                            </div>
                          )}
                          <div className="mobile-reading-title">{book.title}</div>
                          <div className="mobile-reading-author">{book.authors}</div>
                          {getBookPlankNames(book).length > 0 && (
                            <div className="mobile-reading-planks">
                              <span className="mobile-reading-planks-label">Boekenkasten:</span>
                              {getBookPlankNames(book).map((name) => (
                                <span key={name} className="plank-pill plank-pill-inline">{name}</span>
                              ))}
                            </div>
                          )}
                          {!showDailyGoalProgress && (
                            <>
                              <div className="mobile-reading-pages">
                                {book.pageCount != null
                                  ? `${book.pageCount} blz`
                                  : "Vul zelf het aantal pagina's in"}
                              </div>
                              <button
                                type="button"
                                className="mobile-reading-details"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  openDetailPopup(book.id);
                                }}
                              >
                                Details
                              </button>
                            </>
                          )}
                          {showDailyGoalProgress && (
                            <>
                              <div className="mobile-reading-challenge-progress">
                                <div className="mobile-reading-progress-bar-wrap">
                                  <div
                                    className="mobile-reading-progress-bar-fill"
                                    style={{ width: `${Math.min(100, (progress!.current / progress!.total) * 100)}%` }}
                                  />
                                </div>
                                <div className="mobile-reading-progress-pages">
                                  Bladzijde <strong>{progress!.current}</strong> van {progress!.total}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="mobile-reading-details"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  openDetailPopup(book.id);
                                }}
                              >
                                Details
                              </button>
                            </>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="mobile-reading-action reading"
                        onClick={() => updateBookStatus(book.id, "gelezen")}
                      >
                        ✓
                      </button>
                    </div>
                  );
                  })}
                {books.filter((b) => b.status === "aan-het-lezen").length === 0 && (
                  <p className="page-intro-small">Je bent nu met geen enkel boek bezig.</p>
                )}
              </div>

              <h2 className="mobile-section-heading">TBR</h2>
              <div className="mobile-reading-list">
                {getSortedTbrBooks().map((book) => {
                  const isSelected = selectedBookIds.has(book.id);
                  return (
                  <div
                    key={book.id}
                    className={`mobile-reading-item ${isSelected ? "mobile-reading-item-selected" : ""}`}
                  >
                    {selectionMode && (
                      <button
                        type="button"
                        className={`mobile-reading-checkbox ${isSelected ? "checked" : ""}`}
                        onClick={() => toggleBookSelected(book.id)}
                        aria-pressed={isSelected}
                      >
                        <span className="mobile-reading-checkbox-icon">{isSelected ? "✓" : ""}</span>
                      </button>
                    )}
                    <div className="mobile-reading-left">
                      <div className="mobile-reading-order">
                        <button
                          type="button"
                          className="mobile-order-button"
                          onClick={() => moveTbrBook(book.id, "up")}
                          aria-label="Omhoog in TBR"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="mobile-order-button"
                          onClick={() => moveTbrBook(book.id, "down")}
                          aria-label="Omlaag in TBR"
                        >
                          ▼
                        </button>
                      </div>
                      <button
                        type="button"
                        className="mobile-reading-main"
                        onTouchStart={() => {
                          if (selectionMode) return;
                          longPressBookIdRef.current = book.id;
                          longPressTimerRef.current = setTimeout(() => {
                            const id = longPressBookIdRef.current;
                            if (id) {
                              enterSelectionModeWith(id);
                              suppressNextClickRef.current = true;
                              longPressBookIdRef.current = null;
                            }
                            longPressTimerRef.current = null;
                          }, 500);
                        }}
                        onTouchEnd={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          longPressBookIdRef.current = null;
                        }}
                        onTouchCancel={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          longPressBookIdRef.current = null;
                        }}
                        onMouseDown={() => {
                          if (selectionMode) return;
                          longPressBookIdRef.current = book.id;
                          longPressTimerRef.current = setTimeout(() => {
                            const id = longPressBookIdRef.current;
                            if (id) {
                              enterSelectionModeWith(id);
                              suppressNextClickRef.current = true;
                              longPressBookIdRef.current = null;
                            }
                            longPressTimerRef.current = null;
                          }, 500);
                        }}
                        onMouseUp={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          longPressBookIdRef.current = null;
                        }}
                        onMouseLeave={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          longPressBookIdRef.current = null;
                        }}
                        onClick={(e) => {
                          if (suppressNextClickRef.current) {
                            e.preventDefault();
                            e.stopPropagation();
                            suppressNextClickRef.current = false;
                            return;
                          }
                          if (selectionMode) {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleBookSelected(book.id);
                            return;
                          }
                          openBookInfo(book);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!selectionMode) {
                            enterSelectionModeWith(book.id);
                          } else {
                            toggleBookSelected(book.id);
                          }
                        }}
                      >
                        <div className="mobile-reading-cover">
                          {book.coverUrl ? (
                            <img src={book.coverUrl} alt={book.title} />
                          ) : (
                            <div className="mobile-reading-placeholder">
                              {book.title.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="mobile-reading-text">
                          {book.seriesName && (
                            <div className="mobile-reading-series-badge">
                              {book.seriesName}
                              {book.seriesNumber != null ? ` #${book.seriesNumber}` : ""}
                            </div>
                          )}
                          <div className="mobile-reading-title">{book.title}</div>
                          <div className="mobile-reading-author">{book.authors}</div>
                          {getBookPlankNames(book).length > 0 && (
                            <div className="mobile-reading-planks">
                              <span className="mobile-reading-planks-label">Boekenkasten:</span>
                              {getBookPlankNames(book).map((name) => (
                                <span key={name} className="plank-pill plank-pill-inline">{name}</span>
                              ))}
                            </div>
                          )}
                          <div className="mobile-reading-pages">
                            {book.pageCount != null
                              ? `${book.pageCount} blz`
                              : "Vul zelf het aantal pagina's in"}
                          </div>
                          <button
                            type="button"
                            className="mobile-reading-details"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openDetailPopup(book.id);
                            }}
                          >
                            Details
                          </button>
                        </div>
                      </button>
                    </div>
                    <button
                      type="button"
                      className="mobile-reading-action start"
                      onClick={() => updateBookStatus(book.id, "aan-het-lezen")}
                    >
                      Start
                    </button>
                  </div>
                  );
                })}
                {books.filter((b) => b.status === "wil-ik-lezen").length === 0 && (
                  <p className="page-intro-small">Je TBR-lijst is leeg.</p>
                )}
              </div>
            </>
          )}

          {mobileBooksSubTab === "gelezen" && (
            <>
              <h2 className="mobile-section-heading">Uitgelezen</h2>
              <div className="mobile-reading-filters">
                <div className="mobile-reading-filter">
                  <label className="mobile-reading-filter-label">Serie</label>
                  <select
                    className="mobile-reading-filter-select"
                    value={readSeriesFilter}
                    onChange={(e) => setReadSeriesFilter(e.target.value)}
                  >
                    <option value="alle">Alle series</option>
                    {existingSeries.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mobile-reading-filter">
                  <label className="mobile-reading-filter-label">Sorteren</label>
                  <button
                    type="button"
                    className="mobile-reading-sort-toggle"
                    onClick={() =>
                      setReadSortDirection((prev) => (prev === "desc" ? "asc" : "desc"))
                    }
                  >
                    Datum uitgelezen ·{" "}
                    {readSortDirection === "desc" ? "Nieuwste eerst" : "Oudste eerst"}
                  </button>
                </div>
              </div>
              <div className="mobile-reading-list mobile-reading-list-simple">
                {(() => {
                  const readBooks = books.filter((b) => b.status === "gelezen");
                  const filtered =
                    readSeriesFilter === "alle"
                      ? readBooks
                      : readBooks.filter((b) => b.seriesName === readSeriesFilter);
                  const sorted = [...filtered].sort((a, b) => {
                    const aDate = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
                    const bDate = b.finishedAt ? new Date(b.finishedAt).getTime() : 0;
                    if (aDate === bDate) {
                      return a.title.localeCompare(b.title);
                    }
                    return readSortDirection === "desc" ? bDate - aDate : aDate - bDate;
                  });
                  return sorted;
                })().map((book) => {
                  const isSelected = selectedBookIds.has(book.id);
                  return (
                  <div
                    key={book.id}
                    className={`mobile-reading-item mobile-reading-item-simple ${isSelected ? "mobile-reading-item-selected" : ""}`}
                  >
                    {selectionMode && (
                      <button
                        type="button"
                        className={`mobile-reading-checkbox ${isSelected ? "checked" : ""}`}
                        onClick={() => toggleBookSelected(book.id)}
                        aria-pressed={isSelected}
                      >
                        <span className="mobile-reading-checkbox-icon">{isSelected ? "✓" : ""}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="mobile-reading-main"
                    onTouchStart={() => {
                        if (selectionMode) return;
                        longPressBookIdRef.current = book.id;
                        longPressTimerRef.current = setTimeout(() => {
                          const id = longPressBookIdRef.current;
                          if (id) {
                            enterSelectionModeWith(id);
                            suppressNextClickRef.current = true;
                            longPressBookIdRef.current = null;
                          }
                          longPressTimerRef.current = null;
                        }, 500);
                      }}
                      onTouchEnd={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                        longPressBookIdRef.current = null;
                      }}
                      onTouchCancel={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                        longPressBookIdRef.current = null;
                      }}
                      onMouseDown={() => {
                        if (selectionMode) return;
                        longPressBookIdRef.current = book.id;
                        longPressTimerRef.current = setTimeout(() => {
                          const id = longPressBookIdRef.current;
                          if (id) {
                            enterSelectionModeWith(id);
                            suppressNextClickRef.current = true;
                            longPressBookIdRef.current = null;
                          }
                          longPressTimerRef.current = null;
                        }, 500);
                      }}
                      onMouseUp={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                        longPressBookIdRef.current = null;
                      }}
                      onMouseLeave={() => {
                        if (longPressTimerRef.current) {
                          clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = null;
                        }
                        longPressBookIdRef.current = null;
                      }}
                      onClick={(e) => {
                        if (suppressNextClickRef.current) {
                          e.preventDefault();
                          e.stopPropagation();
                          suppressNextClickRef.current = false;
                          return;
                        }
                        if (selectionMode) {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleBookSelected(book.id);
                          return;
                        }
                        openBookInfo(book);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (!selectionMode) {
                          enterSelectionModeWith(book.id);
                        } else {
                          toggleBookSelected(book.id);
                        }
                      }}
                    >
                      <div className="mobile-reading-cover">
                        {book.coverUrl ? (
                          <img src={book.coverUrl} alt={book.title} />
                        ) : (
                          <div className="mobile-reading-placeholder">
                            {book.title.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="mobile-reading-text">
                        {book.seriesName && (
                          <div className="mobile-reading-series-badge">
                            {book.seriesName}
                            {book.seriesNumber != null ? ` #${book.seriesNumber}` : ""}
                          </div>
                        )}
                        <div className="mobile-reading-title">{book.title}</div>
                        <div className="mobile-reading-author">{book.authors}</div>
                        {getBookPlankNames(book).length > 0 && (
                          <div className="mobile-reading-planks">
                            <span className="mobile-reading-planks-label">Boekenkasten:</span>
                            {getBookPlankNames(book).map((name) => (
                              <span key={name} className="plank-pill plank-pill-inline">{name}</span>
                            ))}
                          </div>
                        )}
                        {book.finishedAt && (
                          <div className="mobile-reading-finished">
                            Uitgelezen: {book.finishedAt}
                          </div>
                        )}
                      </div>
                    </button>
                  </div>
                  );
                })}
                {books.filter((b) => b.status === "gelezen").length === 0 && (
                  <p className="page-intro-small">Nog geen uitgelezen boeken.</p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {selectionMode && (
        <div
          className="mobile-selection-bar"
          style={{
            bottom: `${selectionBarPosition.bottom}px`,
            left: `${selectionBarPosition.leftPercent}%`,
            transform: "translateX(-50%)"
          }}
        >
          <div
            className="mobile-selection-bar-drag-handle"
            onPointerDown={handleSelectionBarPointerDown}
            onPointerMove={handleSelectionBarPointerMove}
            onPointerUp={handleSelectionBarPointerUp}
            onPointerLeave={handleSelectionBarPointerUp}
            role="button"
            tabIndex={0}
            aria-label="Versleep om het menu te verplaatsen"
          >
            ⋮⋮
          </div>
          <span className="mobile-selection-count">
            {selectedBookIds.size} geselecteerd
          </span>
          <button
            type="button"
            className="primary-button mobile-selection-add"
            disabled={selectedBookIds.size === 0}
            onClick={() => setShowAddToShelfModal(true)}
          >
            Toevoegen aan boekenkast
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={selectedBookIds.size === 0}
            onClick={() => { setShareWithBuddyError(""); setShowShareWithBuddyModal(true); }}
          >
            Delen met Boekbuddy
          </button>
          <button
            type="button"
            className="secondary-button destructive"
            disabled={selectedBookIds.size === 0}
            onClick={() => setShowDeleteSelectedModal(true)}
          >
            Verwijderen
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setSelectedBookIds(new Set());
              setSelectionMode(false);
            }}
          >
            Selectiemodus sluiten
          </button>
        </div>
      )}

      {dashboardView === "mobile" && showDeleteSelectedModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteSelectedModal(false)}>
          <div className="modal modal-add-to-shelf" onClick={(e) => e.stopPropagation()}>
            <h3>Geselecteerde boeken verwijderen</h3>
            <p className="modal-intro">
              Weet je zeker dat je {selectedBookIds.size} boek{selectedBookIds.size === 1 ? "" : "en"} uit je bibliotheek wilt verwijderen? Dit kan niet ongedaan worden gemaakt.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowDeleteSelectedModal(false)}
              >
                Annuleren
              </button>
              <button
                type="button"
                className="primary-button destructive"
                onClick={() => {
                  const next = books.filter((b) => !selectedBookIds.has(b.id));
                  updateBooks(next);
                  setSelectedBookIds(new Set());
                  setShowDeleteSelectedModal(false);
                  if (selectedBook?.id && selectedBookIds.has(selectedBook.id)) {
                    setSelectedBook(null);
                  }
                }}
              >
                Verwijderen
              </button>
            </div>
          </div>
        </div>
      )}

      {dashboardView === "mobile" && showAddToShelfModal && (
        <div className="modal-backdrop" onClick={() => setShowAddToShelfModal(false)}>
          <div
            className="modal modal-add-to-shelf"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Toevoegen aan boekenkast</h3>
            <p className="modal-intro">
              Kies een boekenkast voor {selectedBookIds.size} boek{selectedBookIds.size === 1 ? "" : "en"}. De huidige status van elk boek blijft behouden.
            </p>
            <ul className="add-to-shelf-list">
              {shelves.map((shelf) => (
                <li key={shelf.id}>
                  <button
                    type="button"
                    className="add-to-shelf-item"
                    onClick={() => addBooksToShelf(shelf.id)}
                  >
                    {shelf.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="add-to-shelf-new">
              <input
                type="text"
                value={newShelfName}
                onChange={(e) => setNewShelfName(e.target.value)}
                placeholder="Nieuwe boekenkast naam…"
                className="add-to-shelf-new-input"
              />
              <button
                type="button"
                className="add-to-shelf-item add-to-shelf-new-btn"
                disabled={!newShelfName.trim()}
                onClick={() => {
                  const name = newShelfName.trim();
                  if (!name) return;
                  const newShelf: Shelf = { id: `shelf-${Date.now()}`, name };
                  const next = [...shelves, newShelf];
                  saveShelves(next);
                  setShelves(next);
                  addBooksToShelf(newShelf.id);
                  setNewShelfName("");
                }}
              >
                Nieuwe boekenkast aanmaken
              </button>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => { setShowAddToShelfModal(false); setNewShelfName(""); }}
            >
              Sluiten
            </button>
          </div>
        </div>
      )}

      {dashboardView === "mobile" && showShareWithBuddyModal && (
        <div className="modal-backdrop" onClick={() => { setShowShareWithBuddyModal(false); setShareWithBuddyError(""); }}>
          <div
            className="modal modal-add-to-shelf"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delen met Boekbuddy</h3>
            <p className="modal-intro">
              Kies een Boekbuddy om {selectedBookIds.size} boek{selectedBookIds.size === 1 ? "" : "en"} mee te delen. Ze kunnen de boeken dan aan hun TBR toevoegen.
            </p>
            {shareWithBuddyError && <p className="form-error">{shareWithBuddyError}</p>}
            <ul className="add-to-shelf-list">
              {loadFriends().map((friend) => (
                <li key={friend}>
                  <button
                    type="button"
                    className="add-to-shelf-item"
                    onClick={() => {
                      const selectedBooks = books.filter((b) => selectedBookIds.has(b.id));
                      const snapshots = selectedBooks.map((b) => ({
                        title: b.title,
                        authors: b.authors,
                        coverUrl: b.coverUrl,
                        seriesName: b.seriesName
                      }));
                      const result = shareWithFriend(friend, snapshots);
                      if (result.ok) {
                        setSelectedBookIds(new Set());
                        setShowShareWithBuddyModal(false);
                        setShareWithBuddyError("");
                        setToast(snapshots.length === 1 ? `Boek gedeeld met ${friend}.` : `${snapshots.length} boeken gedeeld met ${friend}.`);
                        window.setTimeout(() => setToast(""), 2500);
                      } else {
                        setShareWithBuddyError(result.error);
                      }
                    }}
                  >
                    {friend}
                  </button>
                </li>
              ))}
            </ul>
            {loadFriends().length === 0 && (
              <p className="modal-intro">Je hebt nog geen Boekbuddies. Voeg eerst vrienden toe via Profiel.</p>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() => { setShowShareWithBuddyModal(false); setShareWithBuddyError(""); }}
            >
              Sluiten
            </button>
          </div>
        </div>
      )}

      {dashboardView === "mobile" && detailModalBookId && (
        <div
          className="book-detail-popup-overlay"
          onClick={() => setDetailModalBookId(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Boekdetails"
        >
          <div className="book-detail-popup-inner" onClick={(e) => e.stopPropagation()}>
            <BookDetailPage
              modalBookId={detailModalBookId}
              onClose={() => setDetailModalBookId(null)}
            />
          </div>
        </div>
      )}

      {dashboardView === "mobile" && selectedBook && (
        <div className="modal-backdrop" onClick={() => setSelectedBook(null)}>
          <div
            className="modal modal-book-info"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <h3>{selectedBook.title}</h3>
            <p className="modal-intro">{selectedBook.authors}</p>

            <div className="modal-book-status-row">
              <span className="modal-book-status-label">Status:</span>
              <div className="status-dropdown">
                <button
                  type="button"
                  className={`modal-book-status-select status-select status-dropdown-trigger status-select-${selectedBook.status}`}
                  onClick={() => setShowModalStatusMenu((v) => !v)}
                >
                  {STATUS_LABELS[selectedBook.status]}
                  <span className="status-dropdown-caret">▾</span>
                </button>
                {showModalStatusMenu && (
                  <div className="status-dropdown-menu">
                    {(Object.entries(STATUS_LABELS) as [ReadStatus, string][])
                      .map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={`book-detail-status-pill book-detail-status-pill-${value} ${
                            selectedBook.status === value ? "selected" : ""
                          }`}
                          onClick={() => {
                            updateBookStatus(selectedBook.id, value);
                            setSelectedBook({ ...selectedBook, status: value });
                            setShowModalStatusMenu(false);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
            {getBookPlankNames(selectedBook).length > 0 && (
              <div className="modal-book-planks-row">
                <span className="modal-book-status-label">Boekenkast:</span>
                <div className="modal-book-plank-pills">
                  {getBookPlankNames(selectedBook).map((name) => (
                    <span key={name} className="plank-pill plank-pill-inline">{name}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-page-count-edit">
              <label className="modal-page-count-label">Aantal pagina&apos;s:</label>
              <input
                type="number"
                min="1"
                value={editingPageCount}
                onChange={(e) => setEditingPageCount(e.target.value)}
                onBlur={() => {
                  const pageCount = editingPageCount.trim()
                    ? Number(editingPageCount)
                    : undefined;
                  if (pageCount !== undefined && pageCount > 0) {
                    updateBookPageCount(selectedBook.id, pageCount);
                  } else if (editingPageCount.trim() === "") {
                    updateBookPageCount(selectedBook.id, undefined);
                  }
                }}
                placeholder="Bijv. 467"
                className="modal-page-count-input"
              />
            </div>

            <div className="modal-series-edit">
              <label className="modal-page-count-label">Serie (optioneel)</label>
              {!useCustomSeries && existingSeries.length > 0 ? (
                <select
                  value={editingSeriesName}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new__") {
                      setUseCustomSeries(true);
                      setEditingSeriesName("");
                    } else {
                      setEditingSeriesName(v);
                      const sn = v && editingSeriesNumber ? Number(editingSeriesNumber) : undefined;
                      const ord = !v && editingOrder ? Number(editingOrder) : undefined;
                      updateBookSeries(selectedBook.id, v || undefined, sn, ord);
                    }
                  }}
                  className="modal-series-select"
                >
                  <option value="">Geen serie</option>
                  {existingSeries.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  <option value="__new__">+ Nieuwe serie</option>
                </select>
              ) : (
                <>
                  <input
                    type="text"
                    value={editingSeriesName}
                    onChange={(e) => setEditingSeriesName(e.target.value)}
                    onBlur={() => {
                      const name = editingSeriesName.trim() || undefined;
                      const num = name && editingSeriesNumber ? Number(editingSeriesNumber) : undefined;
                      const ord = !name && editingOrder ? Number(editingOrder) : undefined;
                      updateBookSeries(selectedBook.id, name, num, ord);
                    }}
                    placeholder="Bijv. De zeven zussen"
                    className="modal-series-input"
                  />
                  {existingSeries.length > 0 && (
                    <button
                      type="button"
                      className="link-button modal-series-toggle"
                      onClick={() => setUseCustomSeries(false)}
                    >
                      Kies bestaande serie
                    </button>
                  )}
                </>
              )}
            {editingSeriesName && (
              <div className="modal-series-extra">
                <label className="modal-page-count-label">Nr. in serie</label>
                <input
                  type="number"
                  min="1"
                  value={editingSeriesNumber}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditingSeriesNumber(v);
                    updateBookSeries(
                      selectedBook.id,
                      editingSeriesName || undefined,
                      v ? Number(v) : undefined,
                      undefined
                    );
                  }}
                  placeholder="1"
                  className="modal-page-count-input"
                />
              </div>
            )}
            </div>

            {selectedBook.coverUrl && (
              <div className="modal-book-cover">
                <img src={selectedBook.coverUrl} alt={selectedBook.title} />
              </div>
            )}
            {selectedBook.description ? (
              <p className="modal-description">{selectedBook.description}</p>
            ) : (
              <p className="modal-description">
                Er is nog geen beschrijving beschikbaar voor dit boek.
              </p>
            )}

            <div className="modal-actions modal-actions-book">
              {selectedBook.status === "wil-ik-lezen" && (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => moveTbrBookToTop(selectedBook.id)}
                    title="Zet dit boek bovenaan de TBR-lijst"
                  >
                    Bovenaan TBR
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => moveTbrBookToBottom(selectedBook.id)}
                    title="Zet dit boek onderaan de TBR-lijst"
                  >
                    Onderaan TBR
                  </button>
                </>
              )}
              {selectedBook.status === "aan-het-lezen" && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    updateBookStatus(selectedBook.id, "wil-ik-lezen");
                    setSelectedBook({ ...selectedBook, status: "wil-ik-lezen" });
                  }}
                >
                  Terug naar TBR
                </button>
              )}
              <button
                type="button"
                className="secondary-button destructive"
                onClick={() => {
                  if (window.confirm("Weet je zeker dat je dit boek wilt verwijderen?")) {
                    removeBook(selectedBook.id);
                    setSelectedBook(null);
                    setToast("Boek verwijderd.");
                    window.setTimeout(() => setToast(""), 2500);
                  }
                }}
              >
                Verwijderen
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSelectedBook(null)}
              >
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
