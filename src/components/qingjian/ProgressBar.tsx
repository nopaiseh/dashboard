
const STEPS = [
  0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95,
  100,
] as const;

const FILL: Record<(typeof STEPS)[number], string> = {
  0: "qj-barFill0",
  5: "qj-barFill5",
  10: "qj-barFill10",
  15: "qj-barFill15",
  20: "qj-barFill20",
  25: "qj-barFill25",
  30: "qj-barFill30",
  35: "qj-barFill35",
  40: "qj-barFill40",
  45: "qj-barFill45",
  50: "qj-barFill50",
  55: "qj-barFill55",
  60: "qj-barFill60",
  65: "qj-barFill65",
  70: "qj-barFill70",
  75: "qj-barFill75",
  80: "qj-barFill80",
  85: "qj-barFill85",
  90: "qj-barFill90",
  95: "qj-barFill95",
  100: "qj-barFill100",
};

function snap(pct: number): (typeof STEPS)[number] {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  let best: (typeof STEPS)[number] = 0;
  let dist = Infinity;
  for (const step of STEPS) {
    const d = Math.abs(step - clamped);
    if (d < dist) {
      dist = d;
      best = step;
    }
  }
  return best;
}

export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label?: string;
}) {
  const stepped = snap(value);
  return (
    <div
      className={"qj-bar"}
      role="progressbar"
      aria-valuenow={stepped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `进度 ${stepped}%`}
    >
      <i className={`${"qj-barFill"} ${FILL[stepped]}`} />
    </div>
  );
}
