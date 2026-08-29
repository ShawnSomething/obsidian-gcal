// Converts a UTC ISO string to the "YYYY-MM-DDTHH:mm" shape a
// datetime-local input expects, shifted into device-local time.
// Pair with `new Date(value).toISOString()` on save — do NOT reattach
// the offset manually, that double-shifts.
export function toLocalInput(isoString: string): string {
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
