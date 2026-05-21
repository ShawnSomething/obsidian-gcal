import { AccountConfig, PluginData } from "../api/types";
import type GCalPlugin from "../main";

export class TokenStore {
	private plugin: GCalPlugin;

	constructor(plugin: GCalPlugin) {
		this.plugin = plugin;
	}

	async load(): Promise<PluginData> {
		const data = await this.plugin.loadData();
		return data ?? this.defaultData();
	}

	async saveAccount(account: AccountConfig): Promise<void> {
		const data = await this.load();
		const index = data.accounts.findIndex(
			(a) => a.accountId === account.accountId
		);
		if (index >= 0) {
			data.accounts[index] = account;
		} else {
			data.accounts.push(account);
		}
		await this.plugin.saveData(data);
	}

	async removeAccount(accountId: string): Promise<void> {
		const data = await this.load();
		data.accounts = data.accounts.filter((a) => a.accountId !== accountId);
		await this.plugin.saveData(data);
	}

	async updateTokens(
		accountId: string,
		accessToken: string,
		tokenExpiry: number
	): Promise<void> {
		const data = await this.load();
		const account = data.accounts.find((a) => a.accountId === accountId);
		if (!account) throw new Error(`Account ${accountId} not found in store`);
		account.accessToken = accessToken;
		account.tokenExpiry = tokenExpiry;
		await this.plugin.saveData(data);
	}

	async saveClientCredentials(
		clientId: string,
		clientSecret: string
	): Promise<void> {
		const data = await this.load();
		data.clientId = clientId;
		data.clientSecret = clientSecret;
		await this.plugin.saveData(data);
	}

	private defaultData(): PluginData {
		return {
			accounts: [],
			calendarVisibility: {},
			clientId: "",
			clientSecret: "",
			viewDensity: "compact",
		};
	}
}