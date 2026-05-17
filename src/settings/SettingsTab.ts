import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { OAuthManager } from "../auth/OAuthManager";
import { TokenStore } from "../auth/TokenStore";
import type GCalPlugin from "../main";

export class SettingsTab extends PluginSettingTab {
	private plugin: GCalPlugin;
	private tokenStore: TokenStore;

	constructor(app: App, plugin: GCalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.tokenStore = new TokenStore(plugin);
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Google Calendar" });

		// --- Client Credentials ---
		containerEl.createEl("h3", { text: "Google Cloud Credentials" });

		const data = await this.tokenStore.load();

		new Setting(containerEl)
			.setName("Client ID")
			.setDesc("From your Google Cloud OAuth 2.0 credentials")
			.addText((text) =>
				text
					.setPlaceholder("your-client-id.apps.googleusercontent.com")
					.setValue(data.clientId)
					.onChange(async (value) => {
						await this.tokenStore.saveClientCredentials(
							value,
							data.clientSecret
						);
                        await this.plugin.reloadCredentials();
					})
			);

		new Setting(containerEl)
			.setName("Client Secret")
			.setDesc("From your Google Cloud OAuth 2.0 credentials")
			.addText((text) =>
				text
					.setPlaceholder("GOCSPX-...")
					.setValue(data.clientSecret)
					.onChange(async (value) => {
						await this.tokenStore.saveClientCredentials(
							data.clientId,
							value
						);
                        await this.plugin.reloadCredentials();
					})
			);

		// --- Accounts ---
		containerEl.createEl("h3", { text: "Connected Accounts" });

		if (data.accounts.length === 0) {
			containerEl.createEl("p", {
				text: "No accounts connected yet.",
				cls: "setting-item-description",
			});
		} else {
			for (const account of data.accounts) {
				new Setting(containerEl)
					.setName(account.displayName)
					.setDesc(account.accountId)
					.addButton((btn) =>
						btn
							.setButtonText("Remove")
							.setWarning()
							.onClick(async () => {
								await this.tokenStore.removeAccount(account.accountId);
								this.display();
							})
					);
			}
		}

		new Setting(containerEl)
			.setName("Add Google Account")
			.setDesc("Opens a browser window to authorise with Google")
			.addButton((btn) =>
				btn
					.setButtonText("Connect account")
					.setCta()
					.onClick(async () => {
						const freshData = await this.tokenStore.load();
						if (!freshData.clientId || !freshData.clientSecret) {
							new Notice("Enter your Client ID and Secret first.");
							return;
						}

						try {
							const oauth = new OAuthManager(
								freshData.clientId,
								freshData.clientSecret
							);
							const account = await oauth.authorizeNewAccount();
							await this.tokenStore.saveAccount(account);
							new Notice(`Connected: ${account.displayName}`);
							this.display();
						} catch (err: any) {
							new Notice(`Auth failed: ${err.message}`);
						}
					})
			);
	}
}