import { Plugin, WorkspaceLeaf } from "obsidian";
import { CalendarView, VIEW_TYPE } from "./CalendarView";
import { SettingsTab } from "./settings/SettingsTab";
import { TokenStore } from "./auth/TokenStore";
import { GoogleCalendarAPI } from "./api/GoogleCalendarAPI";
import { PluginData } from "./api/types";

export default class GCalPlugin extends Plugin {
	tokenStore!: TokenStore;
	api!: GoogleCalendarAPI;
	data!: PluginData;

	async onload() {
		this.tokenStore = new TokenStore(this);
		this.data = await this.tokenStore.load();

		this.api = new GoogleCalendarAPI(
			this.tokenStore,
			this.data.clientId,
			this.data.clientSecret
		);

		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CalendarView(leaf, this)
		);

		this.addSettingTab(new SettingsTab(this.app, this));

		this.addRibbonIcon("calendar", "Google Calendar", () => {
			this.activateView();
		});

		this.app.workspace.onLayoutReady(() => {
			this.activateView();
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]!);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE, active: true });

		const newLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (newLeaf) this.app.workspace.revealLeaf(newLeaf);
	}

	async reloadCredentials() {
		this.data = await this.tokenStore.load();
		this.api = new GoogleCalendarAPI(
			this.tokenStore,
			this.data.clientId,
			this.data.clientSecret
		);
	}
}