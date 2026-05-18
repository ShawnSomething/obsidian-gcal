import { AccountConfig } from "./types";
import { TokenStore } from "../auth/TokenStore";
import { CalendarMeta, CalEvent } from "../context/CalendarContext";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GoogleCalendarAPI {
	private tokenStore: TokenStore;
	private clientId: string;
	private clientSecret: string;
	private refreshPromises: Map<string, Promise<void>> = new Map();

	constructor(tokenStore: TokenStore, clientId: string, clientSecret: string) {
		this.tokenStore = tokenStore;
		this.clientId = clientId;
		this.clientSecret = clientSecret;
	}

	async getWithAuth(accountConfig: AccountConfig, url: string): Promise<Response> {
		const token = await this.ensureFreshToken(accountConfig);
		return fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});
	}

	async patchWithAuth(
		accountConfig: AccountConfig,
		url: string,
		body: object
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
		body: object
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
		body: object
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
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader"
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch calendar list for ${account.accountId}: ${response.statusText}`);
    }

    const data = await response.json();
    return (data.items ?? []).map((item: any) => ({
        id: item.id,
        accountId: account.accountId,
        summary: item.summary,
        backgroundColor: item.backgroundColor ?? "#4285F4",
        visible: true,
    }));
}

async getEvents(
    account: AccountConfig,
    calendarId: string,
    timeMin: Date,
    timeMax: Date
): Promise<CalEvent[]> {
    const params = new URLSearchParams({
        singleEvents: "true",
        maxResults: "250",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
    });

    const response = await this.getWithAuth(
        account,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch events for ${calendarId}: ${response.statusText}`);
    }

    const data = await response.json();
    return (data.items ?? [])
        .filter((item: any) => item.status !== "cancelled")
        .map((item: any) => ({
            id: item.id,
            iCalUID: item.iCalUID,
            calendarId,
            accountId: account.accountId,
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
                item.attendees?.find((a: any) => a.self)?.responseStatus ?? "accepted",
            recurrence: item.recurrence,
            recurringEventId: item.recurringEventId,
        }));
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
				(a) => a.accountId === account.accountId
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
			(a) => a.accountId === account.accountId
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
			throw new Error(`Token refresh failed for ${account.accountId}: ${response.statusText}`);
		}

		const tokens = await response.json();
		await this.tokenStore.updateTokens(
			account.accountId,
			tokens.access_token,
			Date.now() + tokens.expires_in * 1000
		);
	}
}