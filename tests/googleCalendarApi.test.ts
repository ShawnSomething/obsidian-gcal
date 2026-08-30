import { describe, it, expect, beforeEach, vi } from "vitest";
// Imported by path, not as "obsidian": vitest.config aliases the bare
// specifier at runtime, but tsc resolves it to the real types-only package.
// Same file either way, so this is the same module instance the API uses.
import { requestUrl, makeResponse, respondWith } from "./stubs/obsidian";
import type { RequestUrlResponse } from "./stubs/obsidian";
import type { CalEvent } from "../src/context/CalendarContext";
import { GoogleCalendarAPI } from "../src/api/GoogleCalendarAPI";
import type { TokenStore } from "../src/auth/TokenStore";
import type { AccountConfig } from "../src/api/types";

const account: AccountConfig = {
  accountId: "me@example.com",
  displayName: "me@example.com",
  accessToken: "token-abc",
  refreshToken: "refresh-abc",
  // Far future so ensureFreshToken short-circuits and never touches the store.
  tokenExpiry: Date.now() + 60 * 60 * 1000,
};

const tokenStore = {} as TokenStore;
const api = new GoogleCalendarAPI(tokenStore, "client-id", "client-secret");

interface DateField { dateTime?: string; date?: string; timeZone?: string }
interface AttendeeField { email: string; responseStatus?: string; self?: boolean }
interface EventBody {
  summary?: string;
  start: DateField;
  end: DateField;
  attendees?: AttendeeField[];
  location?: string;
  description?: string;
  recurrence?: string[];
}

const lastCall = () => vi.mocked(requestUrl).mock.calls.at(-1)?.[0];
const lastBody = () => JSON.parse(lastCall()?.body ?? "{}") as EventBody;

beforeEach(() => {
  // mockClear, not mockReset — mockReset drops the stub's throw-on-4xx
  // implementation and every test starts passing for the wrong reason.
  vi.mocked(requestUrl).mockClear();
  respondWith(makeResponse(200, { id: "e1", iCalUID: "u1" }));
});

describe("postEvent — URL construction (regression)", () => {
  // This exact line was broken three times in one session: once losing
  // `sendUpdates=`, once losing the `s` off `/events`, producing a path
  // like `/eventnone`. A template literal is always syntactically valid,
  // so neither tsc nor eslint can catch it. These tests can.
  const base = {
    title: "T", start: "2026-03-18T09:00:00.000Z",
    end: "2026-03-18T10:00:00.000Z", allDay: false,
  };

  it("targets the /events collection, spelled with the s", async () => {
    await api.postEvent(account, "cal-a", base);
    expect(lastCall()?.url).toContain("/events?");
    expect(lastCall()?.url).not.toMatch(/\/event\?/);
  });

  it("defaults to sendUpdates=all", async () => {
    // handleDuplicate's two pre-existing callers rely on this default.
    // Changing it silently alters the shipped duplicate command and the
    // right-click Duplicate.
    await api.postEvent(account, "cal-a", base);
    expect(lastCall()?.url).toContain("sendUpdates=all");
  });

  it("honours an explicit sendUpdates=none", async () => {
    // The modifier-drag duplicate path passes this so copying a meeting
    // does not email every attendee.
    await api.postEvent(account, "cal-a", base, "none");
    expect(lastCall()?.url).toContain("sendUpdates=none");
  });

  it("interpolates the value rather than the variable name", async () => {
    await api.postEvent(account, "cal-a", base, "none");
    expect(lastCall()?.url).not.toContain("${");
    expect(lastCall()?.url).not.toContain("{sendUpdates}");
  });

  it("url-encodes the calendar id", async () => {
    await api.postEvent(account, "me@example.com", base);
    expect(lastCall()?.url).toContain("me%40example.com");
  });

  it("sends the bearer token", async () => {
    await api.postEvent(account, "cal-a", base);
    expect(lastCall()?.headers?.Authorization).toBe("Bearer token-abc");
  });
});

describe("postEvent — body", () => {
  const base = {
    title: "T", start: "2026-03-18T09:00:00.000Z",
    end: "2026-03-18T10:00:00.000Z", allDay: false,
  };

  it("sends dateTime with a timeZone for timed events", async () => {
    await api.postEvent(account, "cal-a", base);
    expect(lastBody().start.dateTime).toBe(base.start);
    expect(lastBody().start.timeZone).toBeTruthy();
  });

  it("sends bare dates for all-day events", async () => {
    await api.postEvent(account, "cal-a", {
      ...base, allDay: true, start: "2026-03-18", end: "2026-03-19",
    });
    expect(lastBody().start).toEqual({ date: "2026-03-18" });
    expect(lastBody().start.dateTime).toBeUndefined();
  });

  it("omits attendees entirely when there are none", async () => {
    await api.postEvent(account, "cal-a", base);
    expect(lastBody()).not.toHaveProperty("attendees");
  });

  it("sends attendees as email-only objects when present", async () => {
    await api.postEvent(account, "cal-a", {
      ...base, attendees: [{ email: "a@b.com" }],
    });
    expect(lastBody().attendees).toEqual([{ email: "a@b.com" }]);
  });

  it("omits optional fields rather than sending empty strings", async () => {
    await api.postEvent(account, "cal-a", base);
    const body = lastBody();
    expect(body).not.toHaveProperty("location");
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("recurrence");
  });

  it("throws with Google's message on a non-2xx response", async () => {
    respondWith(
      makeResponse(403, { error: { message: "Quota exceeded" } })
    );
    await expect(api.postEvent(account, "cal-a", base)).rejects.toThrow("Quota exceeded");
  });
});

describe("sendUpdates policy per operation (regression)", () => {
  it("drag-to-move never notifies attendees", async () => {
    // Dragging is a nudge, not an announcement — spamming attendees on
    // every drag is the reason this is pinned to none.
    await api.patchEventTimes(account, "cal-a", "e1", "2026-03-18T09:00:00.000Z", "2026-03-18T10:00:00.000Z");
    expect(lastCall()?.url).toContain("sendUpdates=none");
  });

  it("an explicit edit does notify attendees", async () => {
    await api.putEvent(account, "cal-a", "e1", {
      title: "T", start: "2026-03-18T09:00:00.000Z",
      end: "2026-03-18T10:00:00.000Z", allDay: false,
    });
    expect(lastCall()?.url).toContain("sendUpdates=all");
  });

  it("an RSVP notifies the organiser", async () => {
    await api.patchAttendeeResponse(account, "cal-a", "e1", [], "accepted");
    expect(lastCall()?.url).toContain("sendUpdates=all");
  });
});

describe("putEvent — timeZone is required only with recurrence", () => {
  const base = {
    title: "T", start: "2026-03-18T09:00:00.000Z",
    end: "2026-03-18T10:00:00.000Z", allDay: false,
  };

  it("includes timeZone when recurrence is present", async () => {
    // Google returns 400 "Missing timeZone" if recurrence is set without it.
    await api.putEvent(account, "cal-a", "e1", {
      ...base, recurrence: ["RRULE:FREQ=WEEKLY"],
    });
    expect(lastBody().start.timeZone).toBeTruthy();
  });

  it("omits timeZone for a plain timed edit", async () => {
    await api.putEvent(account, "cal-a", "e1", base);
    expect(lastBody().start.timeZone).toBeUndefined();
  });
});

describe("patchAttendeeResponse", () => {
  it("returns the whole attendee list, updating only self", async () => {
    // Google drops any attendee missing from the array, so a partial
    // update silently uninvites everyone else.
    const attendees = [
      { email: "other@x.com", responseStatus: "accepted" as const, self: false },
      { email: "me@example.com", responseStatus: "needsAction" as const, self: true },
    ];
    await api.patchAttendeeResponse(account, "cal-a", "e1", attendees, "declined");
    const sent = lastBody().attendees ?? [];
    expect(sent).toHaveLength(2);
    expect(sent.find((a) => a.self)?.responseStatus).toBe("declined");
    expect(sent.find((a) => a.email === "other@x.com")?.responseStatus).toBe("accepted");
  });
});

describe("getEvents — mapping Google's shape onto CalEvent", () => {
  it("drops cancelled events", async () => {
    respondWith(makeResponse(200, {
      items: [
        { id: "a", iCalUID: "ua", status: "confirmed", start: { dateTime: "2026-03-18T09:00:00Z" }, end: { dateTime: "2026-03-18T10:00:00Z" } },
        { id: "b", iCalUID: "ub", status: "cancelled", start: { dateTime: "2026-03-18T11:00:00Z" }, end: { dateTime: "2026-03-18T12:00:00Z" } },
      ],
    }));
    const out = await api.getEvents(account, "cal-a", new Date(), new Date());
    expect(out.map((e) => e.id)).toEqual(["a"]);
  });

  it("infers allDay from the absence of dateTime", async () => {
    respondWith(makeResponse(200, {
      items: [{ id: "a", iCalUID: "ua", start: { date: "2026-03-18" }, end: { date: "2026-03-19" } }],
    }));
    const [e] = await api.getEvents(account, "cal-a", new Date(), new Date());
    expect(e?.allDay).toBe(true);
    expect(e?.start).toBe("2026-03-18");
  });

  it("treats an event with no attendees as accepted", async () => {
    // Your own events carry no attendee entry for you; defaulting to
    // needsAction would render every solo block as crosshatched.
    respondWith(makeResponse(200, {
      items: [{ id: "a", iCalUID: "ua", start: { dateTime: "2026-03-18T09:00:00Z" }, end: { dateTime: "2026-03-18T10:00:00Z" } }],
    }));
    const [e] = await api.getEvents(account, "cal-a", new Date(), new Date());
    expect(e?.selfResponseStatus).toBe("accepted");
  });

  it("reads selfResponseStatus from the self attendee", async () => {
    respondWith(makeResponse(200, {
      items: [{
        id: "a", iCalUID: "ua",
        start: { dateTime: "2026-03-18T09:00:00Z" }, end: { dateTime: "2026-03-18T10:00:00Z" },
        attendees: [
          { email: "x@y.com", responseStatus: "accepted" },
          { email: "me@example.com", responseStatus: "declined", self: true },
        ],
      }],
    }));
    const [e] = await api.getEvents(account, "cal-a", new Date(), new Date());
    expect(e?.selfResponseStatus).toBe("declined");
  });

  it("falls back to a placeholder title rather than undefined", async () => {
    respondWith(makeResponse(200, {
      items: [{ id: "a", iCalUID: "ua", start: { dateTime: "2026-03-18T09:00:00Z" }, end: { dateTime: "2026-03-18T10:00:00Z" } }],
    }));
    const [e] = await api.getEvents(account, "cal-a", new Date(), new Date());
    expect(e?.title).toBe("(No title)");
  });

  it("requests single events so recurring series expand into instances", async () => {
    respondWith(makeResponse(200, { items: [] }));
    await api.getEvents(account, "cal-a", new Date("2026-03-18"), new Date("2026-03-19"));
    expect(lastCall()?.url).toContain("singleEvents=true");
  });
});

describe("splitRecurringSeries — ordering and rollback (regression)", () => {
  // The bug this file now guards: the split used to truncate the master first,
  // which made the instance id stop resolving, so the DELETE that followed got
  // a 400. requestUrl threw before the rollback could run, leaving the series
  // truncated and every occurrence from that date onward gone.
  const ORIGINAL_RRULE = ["RRULE:FREQ=WEEKLY;BYDAY=MO"];

  const instance = {
    id: "m1_20260518T090000Z",
    iCalUID: "u1",
    calendarId: "cal-a",
    accountId: "me@example.com",
    title: "Standup",
    start: "2026-05-18T09:00:00+08:00",
    end: "2026-05-18T09:15:00+08:00",
    allDay: false,
    htmlLink: "",
    color: "",
    attendees: [],
    selfResponseStatus: "accepted",
    recurringEventId: "m1",
  } as CalEvent;

  const updates = {
    title: "Standup",
    start: "2026-05-18T10:00:00.000Z",
    end: "2026-05-18T10:15:00.000Z",
    allDay: false,
  };

  const master = makeResponse(200, { id: "m1", iCalUID: "u1", recurrence: ORIGINAL_RRULE });

  /** Respond per HTTP method; anything unlisted succeeds. */
  const routeBy = (map: Record<string, RequestUrlResponse>) =>
    respondWith((p) => map[p.method ?? "GET"] ?? makeResponse(200, { id: "new", iCalUID: "un" }));

  const methods = () =>
    vi.mocked(requestUrl).mock.calls.map((c) => c[0].method ?? "GET");

  const bodies = (method: string) =>
    vi.mocked(requestUrl).mock.calls
      .filter((c) => c[0].method === method)
      .map((c) => JSON.parse(c[0].body ?? "{}") as EventBody);

  it("deletes the instance before truncating the master", async () => {
    // Reverse these two and Google 400s the delete. That is the whole bug.
    routeBy({ GET: master });
    await api.splitRecurringSeries(account, "cal-a", instance, updates);
    expect(methods()).toEqual(["GET", "DELETE", "PATCH", "POST"]);
  });

  it("targets the instance id on the delete, not the master", async () => {
    routeBy({ GET: master });
    await api.splitRecurringSeries(account, "cal-a", instance, updates);
    const del = vi.mocked(requestUrl).mock.calls.find((c) => c[0].method === "DELETE");
    expect(del?.[0].url).toContain(encodeURIComponent(instance.id));
  });

  it("treats an already-gone instance as success", async () => {
    // 404/410 means the occurrence is absent, which is the state we wanted.
    routeBy({ GET: master, DELETE: makeResponse(404, { error: { message: "Not Found" } }) });
    await expect(
      api.splitRecurringSeries(account, "cal-a", instance, updates)
    ).resolves.toBeUndefined();
    expect(methods()).toContain("POST");
  });

  it("leaves the master untouched when the instance delete fails", async () => {
    // The delete runs first precisely so a failure here costs nothing.
    routeBy({ GET: master, DELETE: makeResponse(400, { error: { message: "Bad Request" } }) });
    await expect(
      api.splitRecurringSeries(account, "cal-a", instance, updates)
    ).rejects.toThrow("400");
    expect(methods()).not.toContain("PATCH");
    expect(methods()).not.toContain("POST");
  });

  it("restores the original recurrence when the new series fails to post", async () => {
    routeBy({ GET: master, POST: makeResponse(400, { error: { message: "Invalid" } }) });
    await expect(
      api.splitRecurringSeries(account, "cal-a", instance, updates)
    ).rejects.toThrow(/restored/i);
    // Two PATCHes: the truncation, then the rollback putting the RRULE back.
    expect(bodies("PATCH").at(-1)?.recurrence).toEqual(ORIGINAL_RRULE);
  });

  it("truncates the master with an UNTIL", async () => {
    routeBy({ GET: master });
    await api.splitRecurringSeries(account, "cal-a", instance, updates);
    expect(bodies("PATCH")[0]?.recurrence?.[0]).toMatch(/UNTIL=\d{8}T\d{6}Z/);
  });
});
