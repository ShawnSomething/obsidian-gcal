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

	display(): void {
		void(async () => {
		const { containerEl } = this;
		containerEl.empty();

		// --- Client Credentials ---
		new Setting(containerEl)
			.setName("Google Cloud Credentials")
			.setHeading();

		const data = await this.tokenStore.load();

		new Setting(containerEl).setName("Client ID").addText((text) =>
			text
				.setPlaceholder("your-client-id.apps.googleusercontent.com")
				.setValue(data.clientId)
				.onChange(async (value) => {
					const fresh = await this.tokenStore.load();
					await this.tokenStore.saveClientCredentials(
						value,
						fresh.clientSecret,
					);
					await this.plugin.reloadCredentials();
				}),
		);

		new Setting(containerEl).setName("Client Secret").addText((text) =>
			text
				.setPlaceholder("GOCSPX-...")
				.setValue(data.clientSecret)
				.onChange(async (value) => {
					const fresh = await this.tokenStore.load();
					await this.tokenStore.saveClientCredentials(
						fresh.clientId,
						value,
					);
					await this.plugin.reloadCredentials();
				}),
		);

		// --- Accounts ---
		new Setting(containerEl).setName("Connected Accounts").setHeading();

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
								await this.tokenStore.removeAccount(
									account.accountId,
								);
								void this.display();
							}),
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
							new Notice(
								"Enter your Client ID and Secret first.",
							);
							return;
						}

						try {
							const oauth = new OAuthManager(
								freshData.clientId,
								freshData.clientSecret,
							);
							const account = await oauth.authorizeNewAccount();
							console.log("Account returned:", account);
							await this.tokenStore.saveAccount(account);
							console.log("Account saved");
							new Notice(`Connected: ${account.displayName}`);
							void this.display();
						} catch (err) {
							console.error("Auth error:", err);
							new Notice(`Auth failed: ${(err as Error).message}`);
						}
					}),
			);

		const kofiDiv = containerEl.createEl("div", {
			cls: "gcal-settings-kofi",
		});
		const kofiLink = kofiDiv.createEl("a", {
			href: "https://ko-fi.com/shawnsomething",
		});
		kofiLink.setAttr("target", "_blank");
		kofiLink.createEl("img", {
			attr: {
				src: "https://ko-fi.com/img/githubbutton_sm.svg",
				alt: "Support on Ko-fi",
			},
		});
	})();
}
}
