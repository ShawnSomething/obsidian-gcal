import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { OAuthManager } from "../auth/OAuthManager";
import { TokenStore } from "../auth/TokenStore";
import type GCalPlugin from "../main";
import type { DuplicateModifier } from "../api/types";

export class SettingsTab extends PluginSettingTab {
	private plugin: GCalPlugin;
	private tokenStore: TokenStore;

	constructor(app: App, plugin: GCalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.tokenStore = new TokenStore(plugin);
	}

	// display() is deprecated since Obsidian 1.13.0 in favour of the
	// declarative getSettingDefinitions() API. Obsidian's own types say it is
	// "only implemented as a fallback for plugins that need to support
	// Obsidian versions older than 1.13.0" — exactly this plugin
	// (minAppVersion 1.7.2). Migrating is a full rewrite of this tab plus
	// dropping every user below 1.13. Revisit if minAppVersion is raised.
	display(): void {
		void (async () => {
			const { containerEl } = this;
			containerEl.empty();

			// --- Client Credentials ---
			new Setting(containerEl)
				.setName("Google Cloud credentials")
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

			new Setting(containerEl).setName("Client secret").addText((text) =>
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
			new Setting(containerEl).setName("Connected accounts").setHeading();

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
								// setDestructive() is the modern equivalent but needs Obsidian 1.13.0;
								// manifest minAppVersion is 1.7.2. Purely cosmetic — both render a red
								// button. Tried and reverted in b776c4d because it forced minAppVersion
								// up to 1.13.1.
								// eslint-disable-next-line @typescript-eslint/no-deprecated
								.setWarning()
								.onClick(async () => {
									await this.tokenStore.removeAccount(
										account.accountId,
									);
									// eslint-disable-next-line @typescript-eslint/no-deprecated
									void this.display();
								}),
						);
				}
			}

			new Setting(containerEl)
				.setName("Add Google account")
				.setDesc("Opens a browser window to authorise with Google")
				.addButton((btn) =>
					btn
						.setButtonText("Connect account")
						.setCta()
						.onClick(async () => {
							const freshData = await this.tokenStore.load();
							if (
								!freshData.clientId ||
								!freshData.clientSecret
							) {
								new Notice(
									"Enter your client ID and secret first.",
								);
								return;
							}

							try {
								const oauth = new OAuthManager(
									freshData.clientId,
									freshData.clientSecret,
								);
								const account =
									await oauth.authorizeNewAccount();
								await this.tokenStore.saveAccount(account);
								new Notice(`Connected: ${account.displayName}`);
								// eslint-disable-next-line @typescript-eslint/no-deprecated
								void this.display();
							} catch (err) {
								console.error("Auth error:", err);
								new Notice(
									`Auth failed: ${(err as Error).message}`,
								);
							}
						}),
				);

			new Setting(containerEl).setName("Behaviour").setHeading();

			new Setting(containerEl)
				.setName("Duplicate on drag")
				.setDesc(
					"Hold this key while dragging an event to create a copy instead of moving it.",
				)
				.addDropdown((dd) =>
					dd
						.addOption("off", "Off")
						.addOption("meta", "Cmd")
						.addOption("alt", "Alt")
						.addOption("shift", "Shift")
						.setValue(data.duplicateModifier ?? "meta")
						.onChange(async (value) => {
							const fresh = await this.tokenStore.load();
							fresh.duplicateModifier =
								value as DuplicateModifier;
							await this.plugin.saveData(fresh);
							this.plugin.data = fresh;
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
