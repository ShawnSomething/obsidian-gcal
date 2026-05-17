import { AccountConfig } from "./types";
import { TokenStore } from "../auth/TokenStore";

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