export type ReadStatus = "wil-ik-lezen" | "aan-het-lezen" | "gelezen";

export interface Book {
  id: string;
  title: string;
  authors: string;
  coverUrl?: string;
  description?: string;
  status: ReadStatus;
  pageCount?: number; // Aantal pagina's in het boek (optioneel)
  rating?: number;
  notes?: string;
  startedAt?: string;
  finishedAt?: string;
  seriesName?: string;
  seriesNumber?: number;
  order?: number;
  /** Ids van eigen planken waarop dit boek staat (naast status voor standaardplanken) */
  shelfIds?: string[];
}

export interface Shelf {
  id: string;
  name: string;
  system?: boolean;
}

/** Minimale boekinfo voor gedeelde items (zodat ontvanger kan toevoegen aan TBR). */
export interface SharedBookSnapshot {
  title: string;
  authors: string;
  coverUrl?: string;
  seriesName?: string;
}

/** Een gedeeld item in de inbox van een gebruiker. */
export interface SharedItem {
  from: string;
  books: SharedBookSnapshot[];
  shelfName?: string;
  sharedAt: string;
}

export interface WeeklyBookPlan {
  bookId: string; // Referentie naar Book.id of een tijdelijke ID voor een weekboek
  totalPages: number; // Totaal te lezen pagina's van dit boek in deze week
  dailyPages: Record<string, number>; // Datum (YYYY-MM-DD) -> aantal pagina's voor dit boek op die dag
  days?: number; // In hoeveel dagen je dit boek in deze week wilt lezen
}

export interface WeeklyChallenge {
  id: string; // Unieke ID voor deze weekchallenge
  startDate: string; // Startdatum YYYY-MM-DD
  endDate: string; // Einddatum YYYY-MM-DD
  books: WeeklyBookPlan[]; // Per-boek planning voor deze week
  completed?: boolean; // Of deze weekchallenge is afgevinkt
}

export interface ReadingChallenge {
  year: number;
  targetBooks: number;
  weeklyPages?: number; // Aantal bladzijden per week (legacy)
  dailyReading?: Record<string, number>; // Datum (YYYY-MM-DD) -> aantal bladzijden gelezen die dag (cumulatief)
  /** Per-boek voortgang: datum -> bookId -> cumulatieve bladzijde van dat boek tot einde van die dag */
  dailyReadingPerBook?: Record<string, Record<string, number>>;
  startDate?: string; // Startdatum van het (week)doel YYYY-MM-DD (legacy)
  endDate?: string; // Einddatum van het (week)doel YYYY-MM-DD (legacy)
  offDays?: string[]; // (Legacy) dagen zonder tijd
  offDaysAuto?: string[]; // Dagen zonder tijd die automatisch over andere leesdagen verdeeld worden
  offDaysManual?: string[]; // Dagen zonder tijd die je zelf regelt
  startPage?: number; // Bladzijde waarop je aan deze periode begint (legacy)
  weeklyBookPlans?: WeeklyBookPlan[]; // Per-boek planning voor deze week (legacy)
  weeklyChallenge?: WeeklyChallenge; // Actieve weekchallenge
}

