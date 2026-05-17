# Obsidian Google Calendar Plugin — PRD + Tech Design

## Status
`In Progress` — Started May 2026

---

## 1. Goal

Build an Obsidian sidebar plugin with a fully interactive Google Calendar view.
Multiple Google accounts, bi-directional sync, drag-to-move, accept/reject.
Modelled on Akiflow's calendar UX.

Personal use first. Publish to Obsidian community plugin store once stable.

---

## 2. About the Developer

Junior-level developer. Has built TSX apps but no full products.
First Obsidian plugin. Needs principal-engineer-level guidance throughout.
Comfortable with React/TSX. Needs Obsidian-specific patterns explained.

---

## 3. Features (Priority Order)

| # | Feature | Notes |
|---|---|---|
| 1 | Multiple Google account auth | OAuth 2.0 with PKCE, one-time setup per account |
| 2 | Unified calendar view | All active calendars merged into one view |
| 3 | Accept / Reject invites | Per calendar, per account |
| 4 | Drag to move events → gCal sync | Standard 3-way modal for recurring |
| 5 | Edit events → gCal sync | Same 3-way modal for recurring |
| 6 | Create events → gCal sync | Click empty time slot to start |
| 7 | Day / 3-day / Week view toggle | Buttons in panel header |
| 8 | Mini month view | Navigation only — click date jumps main view |
| 9 | Open in browser button | `htmlLink` field from Google API |
| 10 | Obsidian sidebar panel | `ItemView`, user-draggable width |

### Out of Scope (v1)
- Mobile
- Outlook / non-Google calendars
- Task management / time-blocking
- Natural language event creation

---

## 4. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript | Obsidian standard |
| UI | React 18 (TSX) | Dev has TSX experience |
| Calendar UI | FullCalendar.js v6 | MIT, drag-drop built in, proven in Obsidian |
| Calendar API | Google Calendar REST API v3 | Direct HTTP, no SDK bloat |
| Auth | OAuth 2.0 with PKCE | Desktop flow via local HTTP server |
| Token storage | `plugin.saveData()` | Local only, never leaves device |
| Build | esbuild | Obsidian plugin template standard |

### FullCalendar packages
- @fullcalendar/core
- @fullcalendar/react
- @fullcalendar/timegrid
- @fullcalendar/daygrid
- @fullcalendar/interaction

### esbuild config additions (already applied)
```js
jsx: "automatic",
loader: { ".css": "css" },
```

---

## 5. Architecture

### 5.1 File Structure
```
obsidian-gcal/
├── src/
│   ├── main.ts                   ← Plugin entry point, registers ItemView + settings tab
│   ├── CalendarView.tsx          ← ItemView shell, mounts React root
│   ├── context/
│   │   └── CalendarContext.tsx   ← React Context + useReducer (global state)
│   ├── components/
│   │   ├── CalendarPanel.tsx     ← FullCalendar config + view logic
│   │   ├── MiniMonth.tsx         ← Mini month navigation widget
│   │   ├── EventModal.tsx        ← Create / edit modal
│   │   ├── RecurringModal.tsx    ← "This / Following / All" choice
│   │   └── CalendarToggle.tsx    ← Show/hide individual calendars
│   ├── settings/
│   │   └── SettingsTab.ts        ← Obsidian PluginSettingTab (account management)
│   ├── auth/
│   │   ├── OAuthManager.ts       ← OAuth PKCE flow per account ✓ CREATED
│   │   └── TokenStore.ts         ← Read/write tokens via plugin.saveData()
│   ├── api/
│   │   ├── GoogleCalendarAPI.ts  ← All API calls with auto-refresh
│   │   └── types.ts              ← TypeScript types for all Google API shapes ✓ CREATED
│   └── utils/
│       └── dedup.ts              ← Event deduplication by iCalUID
├── styles.css
├── manifest.json
├── package.json
└── esbuild.config.mjs
```

### 5.2 React Mounting Pattern (Critical for Obsidian)

Obsidian's `ItemView` is not a React component. Mount/unmount manually.

```typescript
// CalendarView.tsx
async onOpen() {
  const container = this.containerEl.children[1];
  if (!container) throw new Error("CalendarView: container not found");
  this.root = createRoot(container);
  this.root.render(<CalendarPanel plugin={this.plugin} />);
}

async onClose() {
  this.root?.unmount();
}
```

Missing `onClose` unmount = memory leak on every sidebar close.

### 5.3 State Management

React Context + useReducer. No external state library.

`CalendarContext.tsx` provides:
- `accounts: AccountConfig[]`
- `calendars: CalendarMeta[]`
- `events: CalEvent[]`
- `activeView: "day" | "3day" | "week"`
- `selectedDate: Date`
- `dispatch` — actions: `SET_EVENTS`, `SET_CALENDARS`, `TOGGLE_CALENDAR`, `SET_VIEW`, `SET_DATE`

### 5.4 Data Model

**Persisted to disk (`plugin.saveData()`):**
```typescript
interface PluginData {
  accounts: AccountConfig[];
  calendarVisibility: Record<string, boolean>;
  clientId: string;
  clientSecret: string;
}

interface AccountConfig {
  accountId: string;    // email as unique key
  displayName: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;  // unix ms timestamp
}
```

**In-memory:**
```typescript
interface CalendarMeta {
  id: string;
  accountId: string;
  summary: string;
  backgroundColor: string;
  visible: boolean;
}

interface CalEvent {
  id: string;
  iCalUID: string;
  calendarId: string;
  accountId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink: string;
  color: string;
  attendees: Attendee[];
  selfResponseStatus: "accepted" | "declined" | "tentative" | "needsAction";
  recurrence?: string[];
  recurringEventId?: string;
}
```

### 5.5 OAuth Flow (per account)

1. User enters Client ID + Secret in plugin settings
2. Clicks "Add Account"
3. Plugin generates PKCE `code_verifier` + `code_challenge` (SHA-256)
4. Plugin generates random `state` token (CSRF protection)
5. Starts local HTTP server on `localhost:42813`
6. Opens browser to Google OAuth URL
7. User approves → browser redirects to `localhost:42813/callback`
8. Plugin verifies `state`, exchanges `code` for tokens
9. Tokens saved, server shuts down

**Token refresh — with race condition protection:**
```typescript
private refreshPromise: Promise<void> | null = null;

private async ensureFreshToken(account: AccountConfig): Promise<string> {
  if (Date.now() < account.tokenExpiry - 60000) return account.accessToken;
  if (!this.refreshPromise) {
    this.refreshPromise = this.doRefresh(account).finally(() => {
      this.refreshPromise = null;
    });
  }
  await this.refreshPromise;
  return account.accessToken;
}
```

**Port conflict handling:**
Try 42813 first. If `EADDRINUSE`, scan up to 42817. All ports must be registered in GCP as redirect URIs.

### 5.6 Event Fetching

On load + every 5 minutes (`plugin.registerInterval`):
1. Per account → `GET /calendar/v3/users/me/calendarList`
2. Filter to visible calendars
3. Per calendar → `GET /calendar/v3/calendars/{id}/events`
   - `timeMin/timeMax` = current view window
   - `singleEvents=true`
   - `maxResults=250`
4. Merge all events, deduplicate by `iCalUID`
5. Dispatch `SET_EVENTS`
6. On view date change → refetch immediately

### 5.7 Write Operations

**Drag-to-move:** `PATCH` with `sendUpdates=none`. Call `revert()` on error.
**Edit event:** `PUT` full event body, `sendUpdates=all`.
**Create event:** `POST`, `sendUpdates=all`.
**Accept/Decline:** `PATCH` attendees array (must send full array).

### 5.8 Recurring Event Write Patterns

- **This event only** — PATCH/PUT the instance ID directly
- **This and following** — Split series: modify master RRULE + POST new series
- **All events** — PATCH/PUT the master event via `recurringEventId`

### 5.9 FullCalendar Config Notes

**Height fix:**
```tsx
<div style={{ height: "100%", overflow: "hidden" }}>
  <FullCalendar height="100%" ... />
</div>
```
Plus in CSS: `.view-content { height: 100%; }`

**3-day view:**
```tsx
views={{ threeDays: { type: "timeGrid", duration: { days: 3 } } }}
```

---

## 6. Obsidian-Specific Patterns

### Settings Tab
Extend `PluginSettingTab`. Register in `main.ts` via `this.addSettingTab(...)`.

### Theming (CSS Variables)
| Obsidian variable | Used for |
|---|---|
| `--background-primary` | Calendar background |
| `--background-secondary` | Time slot background |
| `--text-normal` | Event text, time labels |
| `--text-muted` | Faint labels, borders |
| `--interactive-accent` | Today highlight |
| `--background-modifier-border` | Grid lines |

### manifest.json
```json
{
  "id": "gcal-obsidian",
  "name": "Google Calendar",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Interactive Google Calendar sidebar with multi-account support.",
  "author": "Your Name",
  "authorUrl": "https://github.com/yourhandle",
  "isDesktopOnly": true
}
```

---

## 7. Dev Environment

- Repo: `/Users/shawnkhoo/Documents/Code/obsidian-gcal/obsidian-gcal`
- Test vault: `/Users/shawnkhoo/Documents/Code/obsidian-gcal/gcal-test`
- Plugin symlinked into vault's `.obsidian/plugins/obsidian-gcal/`
- `npm run dev` — watches and rebuilds on save
- Hot-reload: not working due to symlink issue. Use `Cmd+P` → "Reload app without saving" manually.

---

## 8. Google Cloud Setup — DONE

- Project created
- Calendar API enabled
- OAuth 2.0 credentials created (Desktop App type)
- Redirect URIs registered: `http://localhost:42813` through `42817`
- Client ID + Secret saved

---

## 9. Build Phases

### Phase 1 — Scaffolding ✅ DONE
- [x] Clone Obsidian sample plugin template
- [x] Configure esbuild for TSX + CSS
- [x] Register `ItemView`, mount React root, confirm sidebar renders
- [x] Install FullCalendar, render static test event with correct height

### Phase 2 — Auth 🔄 IN PROGRESS
- [x] OAuthManager.ts — PKCE flow scaffolded
- [x] types.ts — AccountConfig + PluginData types created
- [ ] Fix bug in OAuthManager.ts (codeChallenge/codeVerifier mismatch in buildAuthUrl)
- [ ] TokenStore.ts — read/write via `plugin.saveData()`
- [ ] Auto-refresh with race condition lock
- [ ] Settings tab UI — enter Client ID/Secret, add/remove accounts
- [ ] Wire OAuthManager into settings tab
- [ ] Multi-account support (accounts array)

### Phase 3 — Read Data
- [ ] Fetch calendar list per account
- [ ] Fetch + merge events for view window
- [ ] Deduplication by `iCalUID`
- [ ] Render in FullCalendar with resolved colors
- [ ] Calendar show/hide toggles
- [ ] 5-min polling via `plugin.registerInterval`
- [ ] Manual refresh button in CalendarPanel header — triggers same fetch as interval

### Phase 4 — Write Operations
- [ ] Drag-to-move → PATCH (`sendUpdates=none`)
- [ ] Revert on API error
- [ ] Edit modal → PUT
- [ ] Create modal → POST
- [ ] RecurringModal with correct API pattern per scope choice

### Phase 5 — Accept / Reject
- [ ] Show response buttons when `selfResponseStatus === "needsAction"`
- [ ] PATCH `responseStatus` with full attendees array

### Phase 6 — UI Polish
- [ ] Mini month navigation widget
- [ ] View toggle (Day / 3D / Week) using FullCalendar API
- [ ] Open in browser button (`htmlLink`)
- [ ] Obsidian CSS variable mapping for dark/light theme

### Phase 7 — Publish Prep
- [ ] Error handling + user-facing messages for all failure cases
- [ ] README with GCP setup guide
- [ ] GitHub releases (`main.js`, `manifest.json`, `styles.css`)
- [ ] PR to `obsidian/obsidian-releases`

---

## 10. Known Risks

| Risk | Mitigation |
|---|---|
| OAuth community distribution | Require users to bring own GCP credentials |
| API rate limits | 5-min polling is safe; exponential backoff on 429 |
| `sendUpdates` defaulting to notify | Always pass `sendUpdates=none` on drags |
| Recurring event complexity | Three cases mapped explicitly in section 5.8 |
| Port 42813 in use | Scan 42813–42817, register all in GCP |
| Shared calendar dedup | Deduplicate by `iCalUID` before render |
| Token refresh race | Refresh lock pattern in `GoogleCalendarAPI.ts` |
| FullCalendar 0-height render | Explicit `height="100%"` + parent CSS required |
| Plugin store review | `isDesktopOnly: true`, no remote code, no data collection |

---

## 11. Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Mobile | Desktop only (v1) | Mobile OAuth is a separate complexity |
| State management | React Context + useReducer | Right scale, no extra dependencies |
| Recurring edits | Standard 3-way modal | Matches Google Calendar UX |
| Calendar visibility default | All active calendars visible | Matches Google Calendar default |
| Event creation | Click empty slot | Akiflow-style, least friction |
| Default new event calendar | First account's primary | Overridable in create modal |
| `sendUpdates` on drag | `none` | Dragging should not spam attendees |
| `sendUpdates` on explicit edit | `all` | User is intentionally changing the event |
| `baseUrl` in tsconfig | Removed | esbuild handles resolution, not needed |
| `moduleResolution` in tsconfig | Changed to `bundler` | Correct setting when esbuild is bundling |

---

## 12. Current State

**Last updated:** May 2026

- GCP setup: DONE
- Phase 1: DONE
- Phase 2: IN PROGRESS

### Immediate Next Steps

1. Fix bug in `OAuthManager.ts` — `buildAuthUrl` receives `codeChallenge` but internally calls `generateCodeVerifier()` again, breaking PKCE. Pass `codeChallenge` through from `authorizeNewAccount()` correctly.
2. Build `TokenStore.ts`
3. Build `SettingsTab.ts` — UI for Client ID/Secret + add/remove accounts
4. Wire it all together and test the OAuth flow end-to-end with a real Google account