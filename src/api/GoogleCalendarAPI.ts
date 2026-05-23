import { AccountConfig } from "./types";
import { TokenStore } from "../auth/TokenStore";
import { CalendarMeta, CalEvent, Attendee } from "../context/CalendarContext";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GoogleCalendarAPI {
	private tokenStore: TokenStore;
	private clientId: string;
	private clientSecret: string;
	private refreshPromises: Map<string, Promise<void>> = new Map();

	constructor(
		tokenStore: TokenStore,
		clientId: string,
		clientSecret: string,
	) {
		this.tokenStore = tokenStore;
		this.clientId = clientId;
		this.clientSecret = clientSecret;
	}

	async getWithAuth(
		accountConfig: AccountConfig,
		url: string,
	): Promise<Response> {
		const token = await this.ensureFreshToken(accountConfig);
		return fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});
	}

	async deleteWithAuth(
		account: AccountConfig,
		url: string,
	): Promise<Response> {
		const token = await this.ensureFreshToken(account);
		return fetch(url, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
	}

	async patchWithAuth(
		accountConfig: AccountConfig,
		url: string,
		body: object,
	): Promise<Response> {
		const token = await this.ensureFreshToken(accountConfig);
		return fetch(url, {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
	}

	async putWithAuth(
		accountConfig: AccountConfig,
		url: string,
		body: object,
	): Promise<Response> {
		const token = await this.ensureFreshToken(accountConfig);
		return fetch(url, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
	}

	async postWithAuth(
		accountConfig: AccountConfig,
		url: string,
		body: object,
	): Promise<Response> {
		const token = await this.ensureFreshToken(accountConfig);
		return fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
	}

	async getCalendarList(account: AccountConfig): Promise<CalendarMeta[]> {
		const response = await this.getWithAuth(
			account,
			"https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
		);

		if (!response.ok) {
			const err = await response.json();
			throw new Error(
				err.error?.message ??
					`Failed to fetch calendar list for ${account.accountId}`,
			);
		}

		const data = await response.json();
		return (data.items ?? []).map((item: any) => ({
			id: item.id,
			accountId: account.accountId,
			summary: item.summary,
			backgroundColor: item.backgroundColor ?? "#4285F4",
			visible: true,
			accessRole: item.accessRole ?? "reader",
		}));
	}

	async postEvent(
		account: AccountConfig,
		calendarId: string,
		event: {
			title: string;
			start: string;
			end: string;
			allDay: boolean;
			recurrence?: string[];
			location?: string;
			description?: string;
		},
	): Promise<CalEvent> {
		const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`;

		const startField = event.allDay
			? { date: event.start }
			: {
					dateTime: event.start,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				};

		const endField = event.allDay
			? { date: event.end }
			: {
					dateTime: event.end,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				};

		const response = await this.postWithAuth(account, url, {
			summary: event.title,
			start: startField,
			end: endField,
			...(event.recurrence ? { recurrence: event.recurrence } : {}),
			...(event.location ? { location: event.location } : {}),
			...(event.description ? { description: event.description } : {}),
		});

		if (!response.ok) {
			const err = await response.json();
			throw new Error(err.error?.message ?? "Failed to create event");
		}

		const data = await response.json();
		return this.mapItem(data, calendarId, account.accountId);
	}

	async getEvents(
		account: AccountConfig,
		calendarId: string,
		timeMin: Date,
		timeMax: Date,
	): Promise<CalEvent[]> {
		const params = new URLSearchParams({
			singleEvents: "true",
			maxResults: "250",
			timeMin: timeMin.toISOString(),
			timeMax: timeMax.toISOString(),
		});

		const response = await this.getWithAuth(
			account,
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
		);

		if (!response.ok) {
			const err = await response.json();
			throw new Error(
				err.error?.message ??
					`Failed to fetch events for ${calendarId}`,
			);
		}

		const data = await response.json();
		return (data.items ?? [])
			.filter((item: any) => item.status !== "cancelled")
			.map((item: any) =>
				this.mapItem(item, calendarId, account.accountId),
			);
	}

	async patchEventTimes(
		account: AccountConfig,
		calendarId: string,
		eventId: string,
		start: string,
		end: string,
	): Promise<CalEvent> {
		const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=none`;

		const response = await this.patchWithAuth(account, url, {
			start: { dateTime: start },
			end: { dateTime: end },
		});

		if (!response.ok) {
			const err = await response.json();
			throw new Error(err.error?.message ?? "Failed to update event");
		}

		const data = await response.json();
		return this.mapItem(data, calendarId, account.accountId);
	}

	async putEvent(
		account: AccountConfig,
		calendarId: string,
		eventId: string,
		updates: {
			title: string;
			start: string;
			end: string;
			allDay: boolean;
			location?: string;
			description?: string;
			recurrence?: string[];
		},
	): Promise<CalEvent> {
		const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`;

		const startField = updates.allDay
			? { date: updates.start }
			: {
					dateTime: updates.start,
					...(updates.recurrence
						? {
								timeZone:
									Intl.DateTimeFormat().resolvedOptions()
										.timeZone,
							}
						: {}),
				};

		const endField = updates.allDay
			? { date: updates.end }
			: {
					dateTime: updates.end,
					...(updates.recurrence
						? {
								timeZone:
									Intl.DateTimeFormat().resolvedOptions()
										.timeZone,
							}
						: {}),
				};

		const response = await this.putWithAuth(account, url, {
			summary: updates.title,
			start: startField,
			end: endField,
			...(updates.location !== undefined
				? { location: updates.location }
				: {}),
			...(updates.description !== undefined
				? { description: updates.description }
				: {}),
			...(updates.recurrence !== undefined
				? { recurrence: updates.recurrence }
				: {}),
		});

		if (!response.ok) {
			const err = await response.json();
			throw new Error(err.error?.message ?? "Failed to update event");
		}

		const data = await response.json();
		return this.mapItem(data, calendarId, account.accountId);
	}

	async getEvent(
		account: AccountConfig,
		calendarId: string,
		eventId: string,
	): Promise<any> {
		const response = await this.getWithAuth(
			account,
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
		);
		if (!response.ok) {
			const err = await response.json();
			throw new Error(
				err.error?.message ?? `Failed to fetch event ${eventId}`,
			);
		}
		return response.json();
	}

	async splitRecurringSeries(
		account: AccountConfig,
		calendarId: string,
		instance: CalEvent,
		updates: {
			title: string;
			start: string;
			end: string;
			allDay: boolean;
			location?: string;
			description?: string;
		},
	): Promise<void> {
		// Fetch master to get its current RRULE
		const master = await this.getEvent(
			account,
			calendarId,
			instance.recurringEventId!,
		);
		const originalRecurrence: string[] = master.recurrence ?? [];

		// UNTIL = day before this instance in UTC datetime format
		const instanceStart = new Date(instance.start);
		const until = new Date(instanceStart);
		until.setUTCDate(until.getUTCDate() - 1);
		const untilStr =
			until.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

		// Truncate master RRULE — strip any existing UNTIL/COUNT, add new UNTIL
		const truncatedRecurrence = originalRecurrence.map((rule) => {
			if (!rule.startsWith("RRULE:")) return rule;
			const parts = rule
				.replace("RRULE:", "")
				.split(";")
				.filter(
					(p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="),
				);
			parts.push(`UNTIL=${untilStr}`);
			return "RRULE:" + parts.join(";");
		});

		// Step 1 — truncate the master series
		const patchRes = await this.patchWithAuth(
			account,
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(instance.recurringEventId!)}?sendUpdates=none`,
			{ recurrence: truncatedRecurrence },
		);
		if (!patchRes.ok) {
			const err = await patchRes.json();
			throw new Error(
				err.error?.message ?? "Failed to truncate master series",
			);
		}

		// Step 1.5 — delete the original instance so it doesn't ghost after truncation
		const deleteRes = await this.deleteWithAuth(
			account,
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(instance.id)}?sendUpdates=none`,
		);
		if (!deleteRes.ok && deleteRes.status !== 410) {
			// Rollback master
			await this.patchWithAuth(
				account,
				`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(instance.recurringEventId!)}?sendUpdates=none`,
				{ recurrence: originalRecurrence },
			);
			throw new Error("Failed to delete original instance.");
		}

		// Step 2 — POST new series from this instance forward
		const newEvent = {
			summary: updates.title,
			start: updates.allDay
				? { date: updates.start.split("T")[0] }
				: {
						dateTime: updates.start,
						timeZone:
							Intl.DateTimeFormat().resolvedOptions().timeZone,
					},
			end: updates.allDay
				? { date: updates.end.split("T")[0] }
				: {
						dateTime: updates.end,
						timeZone:
							Intl.DateTimeFormat().resolvedOptions().timeZone,
					},
			recurrence: originalRecurrence, // new series inherits original RRULE, no UNTIL
			attendees: instance.attendees,
			...(updates.location ? { location: updates.location } : {}),
			...(updates.description
				? { description: updates.description }
				: {}),
		};
		const postRes = await this.postWithAuth(
			account,
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
			newEvent,
		);

		if (!postRes.ok) {
			// Rollback — restore original RRULE on master
			await this.patchWithAuth(
				account,
				`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(instance.recurringEventId!)}?sendUpdates=none`,
				{ recurrence: originalRecurrence },
			);
			throw new Error(
				"Failed to create new series. Original series has been restored. If the calendar looks wrong, check Google Calendar directly.",
			);
		}
	}

	async deleteRecurringAndFollowing(
		account: AccountConfig,
		calendarId: string,
		instance: CalEvent,
	): Promise<void> {
		const masterUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${instance.recurringEventId}`;
		const masterRes = await this.getWithAuth(account, masterUrl);
		if (!masterRes.ok) throw new Error("Failed to fetch master event");
		const master = await masterRes.json();

		const originalRecurrence: string[] = master.recurrence ?? [];

		// Calculate UNTIL = 1 second before instance start, in UTC RRULE format
		const instanceDate = new Date(instance.start);
		instanceDate.setSeconds(instanceDate.getSeconds() - 1);
		const until = instanceDate
			.toISOString()
			.replace(/[-:]/g, "")
			.replace(".000", "");

		const updatedRecurrence = originalRecurrence.map((rule: string) => {
			if (!rule.startsWith("RRULE:")) return rule;
			if (rule.includes("UNTIL="))
				return rule.replace(/UNTIL=[^;]+/, `UNTIL=${until}`);
			if (rule.includes("COUNT="))
				return rule.replace(/COUNT=[^;]+/, `UNTIL=${until}`);
			return `${rule};UNTIL=${until}`;
		});

		const patchRes = await this.patchWithAuth(account, masterUrl, {
			recurrence: updatedRecurrence,
		});
		if (!patchRes.ok) throw new Error("Failed to truncate master series");

		const instanceUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${instance.id}`;
		const deleteRes = await this.deleteWithAuth(account, instanceUrl);

		if (!deleteRes.ok) {
			// Rollback master RRULE
			await this.patchWithAuth(account, masterUrl, {
				recurrence: originalRecurrence,
			});
			throw new Error(
				"Failed to delete instance — series truncation rolled back",
			);
		}
	}

	async patchAttendeeResponse(
		account: AccountConfig,
		calendarId: string,
		eventId: string,
		attendees: Attendee[],
		responseStatus: "accepted" | "declined" | "tentative",
	): Promise<CalEvent> {
		const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`;

		const updatedAttendees = attendees.map((a) =>
			a.self ? { ...a, responseStatus } : a,
		);

		const response = await this.patchWithAuth(account, url, {
			attendees: updatedAttendees,
		});

		if (!response.ok) {
			const err = await response.json();
			throw new Error(
				err.error?.message ?? "Failed to update response status",
			);
		}

		const data = await response.json();
		return this.mapItem(data, calendarId, account.accountId);
	}

	private mapItem(
		item: any,
		calendarId: string,
		accountId: string,
	): CalEvent {
		return {
			id: item.id,
			iCalUID: item.iCalUID,
			calendarId,
			accountId,
			title: item.summary ?? "(No title)",
			start: item.start?.dateTime ?? item.start?.date,
			end: item.end?.dateTime ?? item.end?.date,
			allDay: !item.start?.dateTime,
			htmlLink: item.htmlLink ?? "",
			color: item.colorId ?? "",
			attendees: (item.attendees ?? []).map((a: any) => ({
				email: a.email,
				responseStatus: a.responseStatus,
				self: a.self ?? false,
			})),
			selfResponseStatus:
				item.attendees?.find((a: any) => a.self)?.responseStatus ??
				"accepted",
			recurrence: item.recurrence,
			recurringEventId: item.recurringEventId,
			location: item.location,
			description: item.description,
			hangoutLink: item.hangoutLink,
		};
	}

	private async ensureFreshToken(account: AccountConfig): Promise<string> {
		// 60s buffer — refresh before it actually expires
		if (Date.now() < account.tokenExpiry - 60_000) {
			return account.accessToken;
		}

		const existing = this.refreshPromises.get(account.accountId);
		if (existing) {
			await existing;
			// After refresh, the stored account has the new token
			// Re-read from store so we return the updated value
			const updated = await this.tokenStore.load();
			const fresh = updated.accounts.find(
				(a) => a.accountId === account.accountId,
			);
			return fresh?.accessToken ?? account.accessToken;
		}

		const promise = this.doRefresh(account).finally(() => {
			this.refreshPromises.delete(account.accountId);
		});

		this.refreshPromises.set(account.accountId, promise);
		await promise;

		const updated = await this.tokenStore.load();
		const fresh = updated.accounts.find(
			(a) => a.accountId === account.accountId,
		);
		return fresh?.accessToken ?? account.accessToken;
	}

	private async doRefresh(account: AccountConfig): Promise<void> {
		const response = await fetch(GOOGLE_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: this.clientId,
				client_secret: this.clientSecret,
				refresh_token: account.refreshToken,
				grant_type: "refresh_token",
			}),
		});

		if (!response.ok) {
			throw new Error(
				`Token refresh failed for ${account.accountId}: ${response.statusText}`,
			);
		}

		const tokens = await response.json();
		await this.tokenStore.updateTokens(
			account.accountId,
			tokens.access_token,
			Date.now() + tokens.expires_in * 1000,
		);
	}
}
