# GCal Sidebar — Release Fix Session

## Context
Plugin is published at v1.0.2. Obsidian's automated review is flagging errors and warnings that need to be resolved for future releases.

## Files to paste at start of next thread
- `src/main.ts`
- `src/components/CalendarToggle.tsx`
- `src/settings/SettingsTab.ts`
- `src/api/GoogleCalendarAPI.ts`
- `src/auth/OAuthManager.ts`
- `src/components/CalendarPanel.tsx` (current — already has midnight auto-advance feature)
- `src/components/ContextMenu.tsx`
- `src/components/MiniMonth.tsx`

---

## Errors (must fix — block release)

### CalendarToggle.tsx:132,135
Sets inline styles directly. Must use CSS classes instead.
Rule: `obsidianmd/no-static-styles-assignment`

### main.ts:69,80,141,150
Uses Obsidian APIs newer than declared `minAppVersion`.
Rule: `obsidianmd/no-unsupported-api`
Fix: either bump `minAppVersion` in `manifest.json` to match, or replace the calls with supported equivalents.

### main.ts:134-136
Detaches leaf in `onunload`. Obsidian resets the leaf to default location on next load if detached.
Rule: `obsidianmd/no-detach-leaves-on-unload`
Fix: remove the detach call — just let the leaf persist.

### SettingsTab.ts:20,23,56
Creates HTML heading elements directly. Must use `new Setting(containerEl).setName(...).setHeading()`.
Rule: `obsidianmd/prefer-setting-heading`

---

## Warnings (won't block, but clean up)

### window.setTimeout / clearTimeout / setInterval / clearInterval
All bare `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval` calls in `CalendarPanel.tsx` need `window.` prefix for popout window compatibility.
Lines: 99, 102, 384, 385, 402, 492, 509

### document → activeDocument
All direct `document` references need to be `activeDocument` for popout window compatibility.
Files: CalendarPanel.tsx:482,483 — CalendarToggle.tsx:16,17 — ContextMenu.tsx:27,28,73 — MiniMonth.tsx:32,33

### fetch → requestUrl
All `fetch` calls should use Obsidian's built-in `requestUrl` instead.
Files: GoogleCalendarAPI.ts (multiple), OAuthManager.ts:103,125
Note: `requestUrl` has a different API shape — this needs care.

### Unsafe `any` types in GoogleCalendarAPI.ts
Google API responses are untyped. Fix by adding a raw response interface (e.g. `GoogleEventRaw`) and typing the JSON parse result against it. Lots of lines but the pattern is the same throughout.

### Deprecated APIs in SettingsTab.ts
- `setWarning` → use `setDestructive` (line 71)
- `display` → use `getSettingDefinitions` (lines 76, 108)

### innerHTML usage in SettingsTab.ts:116-120
Don't write to DOM via innerHTML. Rewrite with `createEl` or DOM API calls.

### Unused import
`CommandBridge` imported in `CalendarPanel.tsx:6` but never used. Remove it.

### window.confirm
`CalendarPanel.tsx:141,965` — Obsidian discourages `window.confirm`. Low priority, unlikely to block.

### Promise handling warnings
Various places where async functions are passed where void is expected. Low priority.

---

## Changes made this session

### Midnight auto-advance (CalendarPanel.tsx)

Previously the calendar never updated its anchor date automatically. If Obsidian stayed open overnight, the user had to manually click T to jump to today.

Three additions to `CalendarPanel.tsx`:

**1. `selectedDateRef`** — tracks `state.selectedDate` via a ref so the midnight timer can read the current date without a stale closure.
```typescript
const selectedDateRef = useRef(state.selectedDate);
// effect to keep in sync:
useEffect(() => { selectedDateRef.current = state.selectedDate; }, [state.selectedDate]);
```

**2. `activeViewRef`** — same pattern for `activeView`, so the timer knows which view is active at midnight.
```typescript
const activeViewRef = useRef(activeView);
// effect to keep in sync:
useEffect(() => { activeViewRef.current = activeView; }, [activeView]);
```

**3. Midnight timer effect** — schedules itself to fire at the next midnight, then reschedules. Behavior differs per view:
- **Day**: always advances (today is always the anchor)
- **3-day**: always advances (today is always day 1)
- **Week**: only advances when today has moved past the end of the current week window (i.e. Sunday rolled over into a new week)

```typescript
useEffect(() => {
  let timerId: ReturnType<typeof setTimeout>;
  const schedule = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    timerId = setTimeout(() => {
      const newToday = new Date();
      const newTodayStart = new Date(newToday);
      newTodayStart.setHours(0, 0, 0, 0);
      const view = activeViewRef.current;
      const shouldAdvance = view === "week"
        ? newTodayStart.getTime() >= getViewWindow(selectedDateRef.current, view).timeMax.getTime()
        : true;
      if (shouldAdvance) {
        dispatch({ type: "SET_DATE", payload: newToday });
        calendarRef.current?.getApi().today();
        fetchAllWindowsRef.current?.(newToday);
      }
      schedule();
    }, midnight.getTime() - now.getTime());
  };
  schedule();
  return () => clearTimeout(timerId);
}, []);
```

The timer reschedules itself inside the callback so it keeps firing across multiple days without resetting. Cleanup via `clearTimeout` on unmount.