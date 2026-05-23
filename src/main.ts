import { Plugin, WorkspaceLeaf } from "obsidian";
import { CalendarView, VIEW_TYPE } from "./CalendarView";
import { SettingsTab } from "./settings/SettingsTab";
import { TokenStore } from "./auth/TokenStore";
import { GoogleCalendarAPI } from "./api/GoogleCalendarAPI";
import { PluginData } from "./api/types";

export interface CommandBridge {
	setView: (view: "day" | "3day" | "week") => void;
	goToToday: () => void;
	refresh: () => void;
	next: () => void;
  	prev: () => void;
}

export default class GCalPlugin extends Plugin {
	tokenStore!: TokenStore;
	api!: GoogleCalendarAPI;
	data!: PluginData;
	commandBridge: CommandBridge | null = null;

	async onload() {
		this.tokenStore = new TokenStore(this);
		this.data = await this.tokenStore.load();

		this.api = new GoogleCalendarAPI(
			this.tokenStore,
			this.data.clientId,
			this.data.clientSecret,
		);

		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CalendarView(leaf, this),
		);

		this.addSettingTab(new SettingsTab(this.app, this));

		this.addRibbonIcon("calendar", "Google Calendar", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-gcal-view",
			name: "Open Google Calendar",
			callback: () => {
				const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
				if (existing.length > 0) {
					existing[0]!.detach();
					return;
				}
				this.activateView();
			},
		});

		this.addCommand({
			id: "gcal-view-day",
			name: "Google Calendar: Day view",
			callback: () => this.commandBridge?.setView("day"),
		});

		this.addCommand({
			id: "gcal-view-3day",
			name: "Google Calendar: 3-day view",
			callback: () => this.commandBridge?.setView("3day"),
		});

		this.addCommand({
			id: "gcal-view-week",
			name: "Google Calendar: Week view",
			callback: () => this.commandBridge?.setView("week"),
		});

		this.addCommand({
			id: "gcal-today",
			name: "Google Calendar: Go to today",
			callback: () => this.commandBridge?.goToToday(),
		});

		this.addCommand({
			id: "gcal-refresh",
			name: "Google Calendar: Refresh",
			callback: () => this.commandBridge?.refresh(),
		});

		this.addCommand({
			id: "gcal-next",
			name: "Google Calendar: Next",
			callback: () => this.commandBridge?.next(),
		});

		this.addCommand({
			id: "gcal-prev",
			name: "Google Calendar: Previous",
			callback: () => this.commandBridge?.prev(),
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
			this.data.clientSecret,
		);
	}
}
