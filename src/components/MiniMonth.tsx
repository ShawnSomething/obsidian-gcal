import { useState, useRef, useEffect } from "react";

interface Props {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function getMonFirstIndex(dayOfWeek: number): number {
  return (dayOfWeek + 6) % 7;
}

export default function MiniMonth({ selectedDate, onDateSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setViewDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [selectedDate]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    activeDocument.addEventListener("mousedown", handler);
    return () => activeDocument.removeEventListener("mousedown", handler);
  }, [open]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = getMonFirstIndex(new Date(year, month, 1).getDay());

  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = viewDate.toLocaleString("default", { month: "long", year: "numeric" });
  const triggerLabel = selectedDate.toLocaleString("default", { month: "short", year: "numeric" });

  return (
    <div ref={containerRef} className="gcal-minimonth-container">
      <button
        className="gcal-minimonth-trigger"
        onClick={() => setOpen((o) => !o)}
        title="Pick a date"
      >
        {triggerLabel}
      </button>

      {open && (
        <div className="gcal-minimonth-popover">
          <div className="gcal-minimonth-nav">
            <button className="gcal-minimonth-nav-btn" onClick={() => setViewDate(new Date(year, month - 1, 1))}>‹</button>
            <span className="gcal-minimonth-nav-label">{monthLabel}</span>
            <button className="gcal-minimonth-nav-btn" onClick={() => setViewDate(new Date(year, month + 1, 1))}>›</button>
          </div>

          <div className="gcal-minimonth-grid">
            {DAYS.map((d) => (
              <div key={d} className="gcal-minimonth-day-header">{d}</div>
            ))}
            {cells.map((day, i) => {
              if (!day) return <div key={`e-${i}`} />;
              const cellDate = new Date(year, month, day);
              cellDate.setHours(0, 0, 0, 0);
              const isToday = cellDate.getTime() === today.getTime();
              const isSelected =
                cellDate.getFullYear() === selectedDate.getFullYear() &&
                cellDate.getMonth() === selectedDate.getMonth() &&
                cellDate.getDate() === selectedDate.getDate();
              const isPast = cellDate < today;

              return (
                <div
                  key={day}
                  className={[
                    "gcal-minimonth-day",
                    isToday ? "gcal-minimonth-day--today" : "",
                    isSelected ? "gcal-minimonth-day--selected" : "",
                    isPast && !isSelected ? "gcal-minimonth-day--past" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    onDateSelect(new Date(year, month, day));
                    setOpen(false);
                  }}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}