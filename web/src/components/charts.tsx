import React from "react";

/**
 * One series over months.
 *
 * Lifted out of the analytics page when Billing needed the same shape.
 * Unchanged apart from the export: a chart that is redrawn per page is two
 * charts that disagree about their axis the first time one is tuned.
 *
 * The table under it is not decoration. An SVG is unreadable to a screen
 * reader and unusable to anybody who wants the number rather than the trend,
 * and this console is operated by people doing support.
 */
export function LineChart({
  months,
  values,
  stroke,
  label,
}: {
  months: string[];
  values: number[];
  stroke: string;
  label: string;
}) {
  const W = 720;
  const H = 200;
  const PAD = { top: 16, right: 12, bottom: 26, left: 40 };

  const max = Math.max(...values, 1);
  // A rounded ceiling, so the axis reads 0/25/50 rather than 0/17/34.
  const step = Math.max(1, Math.ceil(max / 4 / 5) * 5);
  const ceil = step * 4;

  const x = (i: number) =>
    PAD.left +
    (i / Math.max(values.length - 1, 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - v / ceil) * (H - PAD.top - PAD.bottom);

  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const area = `${path} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const id = `fill-${label.toLowerCase()}`;

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto px-2 pt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[11rem] w-full min-w-[22rem] sm:h-[13rem]" aria-hidden>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 1, 2, 3, 4].map((i) => {
            const v = step * i;
            return (
              <g key={i}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={PAD.left - 8}
                  y={y(v) + 3.5}
                  textAnchor="end"
                  className="fill-[var(--muted-foreground)] text-micro"
                >
                  {v}
                </text>
              </g>
            );
          })}

          <path d={area} fill={`url(#${id})`} />
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={stroke} />
          ))}

          {months.map((m, i) =>
            // Every other label on a long range, or they collide.
            i % (months.length > 12 ? 3 : 2) === 0 ? (
              <text
                key={m}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-[var(--muted-foreground)] text-micro"
              >
                {m.slice(5)}/{m.slice(2, 4)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <div className="border-border overflow-x-auto border-t">
        <table className="w-full text-micro">
          <caption className="sr-only">{label} at the end of each month</caption>
          <thead>
            <tr className="text-muted-foreground text-left">
              {months.map((m) => (
                <th key={m} scope="col" className="px-2 py-1.5 font-medium whitespace-nowrap">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {values.map((v, i) => (
                <td key={i} className="tnum px-2 py-1.5 font-mono">
                  {v}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
