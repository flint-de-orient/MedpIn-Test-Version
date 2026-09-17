"use client";

import { Field, textInput } from "@/components/form";
import type { WeeklyHours } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The first place a practice sees patients, and when.
 *
 * ---- Why the console asks at all ------------------------------------------
 *
 * A practice with no location cannot take a booking, and a location with no
 * hours offers no slots. The console's create used to stop at the head doctor,
 * so every practice made there opened onto a diary nobody could book into, and
 * the practice found out when its first patient could not. Both ways a practice
 * comes into existence — made here, or approved from an application — now ask
 * the same questions with these same fields.
 *
 * ---- One sitting a day, on purpose ------------------------------------------
 *
 * The model allows several windows a day (a morning and an evening sitting).
 * Onboarding asks for one per day because that is what somebody reads off a
 * signboard over the phone; the practice adds its evening sitting from its own
 * settings, where the full editor is.
 */

/** Monday first: the order a clinic's week is written in, not JavaScript's. */
const DAYS: { day: number; label: string }[] = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];

export type FirstLocation = {
  name: string;
  addressLine: string;
  city: string;
  phone: string;
  /** The practice's own number for patients, which every location shares. */
  emergencyPhone: string;
  days: Record<number, { open: boolean; start: string; end: string }>;
};

export function emptyFirstLocation(): FirstLocation {
  return {
    name: "",
    addressLine: "",
    city: "",
    phone: "",
    emergencyPhone: "",
    days: Object.fromEntries(DAYS.map((d) => [d.day, { open: false, start: "10:00", end: "14:00" }])),
  };
}

/** The windows as the server stores them. */
export function hoursFrom(loc: FirstLocation): WeeklyHours[] {
  return DAYS.filter((d) => loc.days[d.day]?.open).map((d) => ({
    dayOfWeek: d.day,
    start: loc.days[d.day].start,
    end: loc.days[d.day].end,
  }));
}

/**
 * The first thing wrong with the hours, in words, or null.
 *
 * Asked before the server is, because the server refuses the whole practice
 * over one bad day and the operator should not have to find which.
 */
export function hoursProblem(loc: FirstLocation): string | null {
  for (const d of DAYS) {
    const row = loc.days[d.day];
    if (!row?.open) continue;
    if (!/^\d{2}:\d{2}$/.test(row.start) || !/^\d{2}:\d{2}$/.test(row.end)) {
      return `${d.label}: enter both times.`;
    }
    if (row.start >= row.end) return `${d.label}: the sitting ends before it starts.`;
  }
  return null;
}

/** "Mon 10:00–14:00 · Thu 10:00–13:00", or "no hours yet". */
export function hoursSummary(hours: WeeklyHours[]): string {
  if (!hours.length) return "no hours yet";
  return DAYS.flatMap((d) =>
    hours.filter((h) => h.dayOfWeek === d.day).map((h) => `${d.label} ${h.start}–${h.end}`),
  ).join(" · ");
}

export function FirstLocationFields({
  value,
  onChange,
  practiceName,
  showAddress = true,
}: {
  value: FirstLocation;
  onChange: (next: FirstLocation) => void;
  /** What the location is called when nobody types a name. */
  practiceName: string;
  /** The approval path takes the address from the application. */
  showAddress?: boolean;
}) {
  const set = (patch: Partial<FirstLocation>) => onChange({ ...value, ...patch });
  const setDay = (day: number, patch: Partial<FirstLocation["days"][number]>) =>
    onChange({ ...value, days: { ...value.days, [day]: { ...value.days[day], ...patch } } });

  return (
    <>
      <Field label="Location name" hint="optional — the practice's name if left blank">
        <input
          className={textInput}
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={practiceName || undefined}
          maxLength={160}
        />
      </Field>

      {showAddress ? (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Address" hint="optional">
            <input
              className={textInput}
              value={value.addressLine}
              onChange={(e) => set({ addressLine: e.target.value })}
              maxLength={400}
            />
          </Field>
          <Field label="City" hint="optional">
            <input
              className={textInput}
              value={value.city}
              onChange={(e) => set({ city: e.target.value })}
              maxLength={120}
            />
          </Field>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Location phone" hint="optional — the desk patients ring">
          <input
            className={`${textInput} tnum font-mono text-body`}
            value={value.phone}
            onChange={(e) => set({ phone: e.target.value })}
            inputMode="tel"
            maxLength={40}
          />
        </Field>
        <Field label="Patient call number" hint="optional — emergencies and the app">
          <input
            className={`${textInput} tnum font-mono text-body`}
            value={value.emergencyPhone}
            onChange={(e) => set({ emergencyPhone: e.target.value })}
            inputMode="tel"
            maxLength={40}
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-muted-foreground text-micro font-medium tracking-[0.04em] uppercase">
          Opening hours
          <span className="ml-1.5 font-normal normal-case tracking-normal">
            optional — one sitting a day; more from the practice&apos;s settings
          </span>
        </legend>
        <div className="border-input mt-1.5 flex flex-col divide-y rounded-sm border">
          {DAYS.map((d) => {
            const row = value.days[d.day];
            return (
              <div key={d.day} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <label className="flex min-w-[4.5rem] items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={row.open}
                    onChange={(e) => setDay(d.day, { open: e.target.checked })}
                  />
                  {d.label}
                </label>
                {row.open ? (
                  <span className="flex flex-1 items-center gap-2">
                    <input
                      type="time"
                      aria-label={`${d.label} opens`}
                      className={cn(textInput, "tnum font-mono text-body")}
                      value={row.start}
                      onChange={(e) => setDay(d.day, { start: e.target.value })}
                    />
                    <span aria-hidden className="text-muted-foreground">
                      –
                    </span>
                    <input
                      type="time"
                      aria-label={`${d.label} closes`}
                      className={cn(textInput, "tnum font-mono text-body")}
                      value={row.end}
                      onChange={(e) => setDay(d.day, { end: e.target.value })}
                    />
                  </span>
                ) : (
                  <span className="text-muted-foreground text-caption">closed</span>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}
