import { STANDARD_SHELF_GENRES } from "../standardGenres";

type Props = {
  /** Reeds gekozen genres (lowercase voor vergelijking) */
  selectedLowerSet: Set<string>;
  onPick: (label: string) => void;
  disabled?: boolean;
};

/**
 * Inklapbare lijst met vaste genre-labels (Engels) — één tik om toe te voegen.
 */
export function StandardGenrePickList({ selectedLowerSet, onPick, disabled }: Props) {
  return (
    <details className="standard-genres-disclosure">
      <summary className="standard-genres-summary">
        Standaardlijst (Engels, zoals Goodreads) — automatisch na ophalen waar het past; hier handmatig tikken
      </summary>
      <div className="standard-genres-grid" role="group" aria-label="Standaard genres">
        {STANDARD_SHELF_GENRES.map((label) => {
          const taken = selectedLowerSet.has(label.toLowerCase());
          return (
            <button
              key={label}
              type="button"
              disabled={disabled || taken}
              className={`standard-genre-chip${taken ? " standard-genre-chip--added" : ""}`}
              onClick={() => onPick(label)}
            >
              {taken ? "✓ " : "+ "}
              {label}
            </button>
          );
        })}
      </div>
    </details>
  );
}
