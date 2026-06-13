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

### CalendarPanel.tsx ✅ (Steps A+B+C)
- [x] Removed 6 redundant `!` assertions
- [x] Added `void` to 11 floating promises
- [x] `eventDrop`, `eventResize`, `eventClick` — wrapped in `(info) => { void (async () => { ... })(); }`
  - FC types expect `() => void`; `async` callbacks were incompatible

### EventModal.tsx ✅
- [x] `onClick={handleSave}` → `onClick={() => { void handleSave(); }}` (footer save button)
- [x] All unnecessary `(props as EditProps)` / `(props as CreateProps)` casts removed
  - Replaced `isCreate` ternaries with `props.mode === "create"/"edit"` so TypeScript narrows directly
  - 13 cast sites eliminated across state init and JSX

### GoogleCalendarAPI.ts ✅ — `fetch` → `requestUrl`
- [x] Added `import { requestUrl, RequestUrlResponse } from "obsidian"`
- [x] All 5 helper methods converted (`getWithAuth`, `deleteWithAuth`, `patchWithAuth`, `putWithAuth`, `postWithAuth`)
- [x] `doRefresh` converted — URLSearchParams body changed to `.toString()`
- [x] All `response.ok` → `response.status < 200 || response.status >= 300` throughout file
- [x] All `await response.json()` → `response.json` (property, not method) throughout file
- [x] `response.statusText` → `response.status` in doRefresh error string

### OAuthManager.ts ✅ — `fetch` → `requestUrl`
- [x] Added `import { requestUrl } from "obsidian"`
- [x] `exchangeCodeForTokens` and `fetchAccountInfo` converted — same response pattern

### CalendarPanel.tsx ✅ — `res.ok` follow-on fix
- [x] Two direct `deleteWithAuth` call sites changed from `.ok` → `.status` check

### main.ts ✅
- [x] 6 unhandled promises — `void` prefix added to all `revealLeaf` and `activateView` calls
- Unsafe `any` on undocumented Obsidian internals — **Won't fix** (intentional casts to access `.collapsed`, `.expand`, `.parent` etc.)

### SettingsTab.ts ✅
- [x] `async display()` — removed `async`, wrapped body in `void (async () => { ... })();`
- [x] 2 unhandled `this.display()` calls — `void` prefix added
- [x] `catch (err: any)` → `catch (err)` with `(err as Error).message` cast inside
- `setWarning` → `setDestructive` — **Won't fix** (recommendation only)
- `display` → `getSettingDefinitions` — **Deferred** (significant rewrite, different API shape)

### TokenStore.ts ✅
- [x] `await this.plugin.loadData()` cast to `as PluginData | null` — eliminates implicit `any`

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

### CalendarPanel.tsx — unsafe `any`
- [ ] Lines 856, 858: `calEvent.recurrence` typed as `any` — comes from raw API response
  - May have been resolved as a side effect of the `requestUrl` rewrite (typed raw responses). Verify by building and checking for TS errors.

---

## All Fixes Complete

Everything required to pass Obsidian automated review is done. The only open item is the CalendarPanel `any` which needs a build verification — it may already be clean.