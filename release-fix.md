# GCal Sidebar — Warning Fix Checklist

## Context

The Obsidian automated review system flagged warnings blocking the plugin update.
The **only hard blocker** from the review was:

> "Unexpected use of 'fetch'. Use the built-in `requestUrl` function instead."
> - src/api/GoogleCalendarAPI.ts:28, src/api/GoogleCalendarAPI.ts:38, src/api/GoogleCalendarAPI.ts:50, src/api/GoogleCalendarAPI.ts:66, src/api/GoogleCalendarAPI.ts:82, src/api/GoogleCalendarAPI.ts:561, src/auth/OAuthManager.ts:103, src/auth/OAuthManager.ts:125

Everything else in this doc was identified from a broader static analysis pass.
Those fixes are good hygiene but **did not cause the review rejection**.

**Golden rule: zero behaviour change. Every fix here must leave the plugin working exactly as it does today.**

---

## What's Done

### CalendarToggle.tsx ✅
- [x] `document` → `activeDocument` (lines 16, 17)
  - Both `addEventListener`/`removeEventListener` calls. `activeDocument` is an Obsidian global, no import needed.

### ContextMenu.tsx ✅
- [x] `document` → `activeDocument` (lines 27, 28, 73)
  - Both event listener calls + `document.body` → `activeDocument.body` in `createPortal`.

### MiniMonth.tsx ✅
- [x] `document` → `activeDocument` (lines 32, 33)
  - Both event listener calls.

### OAuthManager.ts ✅
- [x] `require()` import forbidden (line 156)
  - Added `import { exec } from "child_process"` at top. Removed inline `require` from `openBrowser()`.

### CalendarPanel.tsx ✅ (Step A+B)
- [x] Removed 6 redundant `!` assertions:
  - 5x `editingEvent!` → `editingEvent` inside `onSplitSeries` (already narrowed by `{editingEvent && ...}` guard)
  - 1x `contextMenu.calEvent.hangoutLink!` → `hangoutLink` (already in truthy branch of ternary)
- [x] Added `void` to 11 floating promises:
  - `navigateNextRef` + `navigatePrevRef`: `fetchWindowRef.current?.then()` and `fetchAllWindowsRef.current?.()`
  - `handleDateSelect`: 5 calls across next/prev/arbitrary-jump branches
  - `useEffect([activeView])`: `fetchAllWindowsRef.current?.(state.selectedDate)`
  - `setInterval` poll: wrapped in `{ void ...; }`
  - `commandBridge.goToToday` and `commandBridge.refresh`
  - midnight timer: `fetchAllWindowsRef.current?.(newToday)`
- Updated file saved — use it as the source for Step C.

### GoogleCalendarAPI.ts ✅ — `fetch` → `requestUrl`
- [x] Added `import { requestUrl, RequestUrlResponse } from "obsidian"`
- [x] All 5 helper methods (`getWithAuth`, `deleteWithAuth`, `patchWithAuth`, `putWithAuth`, `postWithAuth`) converted
  - Return type changed: `Promise<Response>` → `Promise<RequestUrlResponse>`
  - Call shape: `fetch(url, { method, headers, body })` → `requestUrl({ url, method, headers, body })`
- [x] `doRefresh` converted — URLSearchParams body changed to `.toString()`
- [x] All `response.ok` → `response.status < 200 || response.status >= 300` throughout file
- [x] All `await response.json()` → `response.json` (property, not method) throughout file
- [x] `response.statusText` → `response.status` in doRefresh error string (statusText doesn't exist on RequestUrlResponse)

### OAuthManager.ts ✅ — `fetch` → `requestUrl`
- [x] Added `import { requestUrl } from "obsidian"`
- [x] `exchangeCodeForTokens`: `fetch` → `requestUrl`, URLSearchParams body → `.toString()`, `.ok` → status check, `await response.json()` → `response.json`
- [x] `fetchAccountInfo`: `fetch` → `requestUrl`, same response pattern

### CalendarPanel.tsx ✅ — `res.ok` follow-on fix
- [x] Two direct `deleteWithAuth` call sites in CalendarPanel were checking `res.ok`
  - Both changed to `res.status < 200 || res.status >= 300`
  - Root cause: changing the return type of `deleteWithAuth` from `Promise<Response>` to `Promise<RequestUrlResponse>` cascades to any caller that reads the response directly

---

## Key Learnings — `requestUrl` vs `fetch`

- `RequestUrlResponse` has no `.ok` property — always check `.status` directly
- `RequestUrlResponse` has no `.statusText` — use `.status` (a number) in error strings
- `response.json` is a pre-parsed property, not a method — no `await`, no `()`
- URLSearchParams body must be `.toString()` — `requestUrl` takes `string | ArrayBuffer`, not URLSearchParams
- `requestUrl` does NOT throw on non-2xx HTTP status codes — it returns the response with the status, same as `fetch`. Only throws on network-level failures (DNS, connection refused etc.)
- Changing return type of a helper method cascades — any caller in any file that reads the response needs the same `.ok` → `.status` update. Check all call sites, not just the file being changed.

---

## What's Remaining

### CalendarPanel.tsx — Step C ← NEXT
- [ ] `eventDrop`, `eventResize`, `eventClick` are `async` but FC types expect `() => void`
  - Fix: wrap each in `(info) => { void (async () => { ... })(); }`
- [ ] Same fix for EventModal.tsx line 635
- Need current CalendarPanel.tsx (Step A+B+res.ok version) + EventModal.tsx

### CalendarPanel.tsx — unsafe `any`
- [ ] Lines 856, 858: `calEvent.recurrence` typed as `any` — comes from raw API response
  - Pairs with the `requestUrl` rewrite (typed raw responses fix this)

### EventModal.tsx — unnecessary type assertions
- [ ] Lines 76, 79, 82, 85, 88, 91, 96, 97, 102, 155, 169, 601, 613, 615, 630
  - Need EventModal.tsx to see exact assertions

### main.ts — unhandled promises
- [ ] Lines 49, 61, 69, 80, 137, 146 — `void` prefix needed
- [ ] Unsafe `any` on undocumented Obsidian internals (lines 56, 65, 68, 73, 75, 78) — **Won't fix** (intentional casts to access `.collapsed`, `.expand`, `.parent` etc.)

### SettingsTab.ts
- [ ] Unhandled promises (lines 76, 108) — `void` prefix
- [ ] `async display()` returns Promise where void expected
- [ ] Unsafe `.message` on caught error (line 111)
- [ ] `setWarning` → `setDestructive` (line 71) — **Won't fix** (recommendation only)
- [ ] `display` → `getSettingDefinitions` — **Deferred** (significant rewrite, different API shape)

### TokenStore.ts
- [ ] Unsafe `any` (lines 12, 13) — low blast radius, small fix

---

## Recommended Order for Next Session

1. ~~`fetch` → `requestUrl` (GoogleCalendarAPI.ts + OAuthManager.ts)~~ ✅ DONE
2. Step C — CalendarPanel.tsx + EventModal.tsx async FC attributes ← START HERE
3. EventModal.tsx unnecessary assertions
4. main.ts + SettingsTab.ts unhandled promises
5. TokenStore.ts unsafe `any`