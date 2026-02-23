interface RatingStarsProps {
  value?: number;
  onChange?: (value: number) => void;
}

const stars = [1, 2, 3, 4, 5] as const;

export function RatingStars({ value = 0, onChange }: RatingStarsProps) {
  return (
    <div className="rating-stars">
      {stars.map((star) => (
        <button
          key={star}
          type="button"
          className={
            "star-button" + (star <= value ? " star-button-active" : "")
          }
          onClick={() => onChange?.(star)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

