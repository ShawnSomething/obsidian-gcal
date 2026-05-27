import { Plugin, WorkspaceLeaf, addIcon } from "obsidian";
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
	duplicate: () => void;
}

export default class GCalPlugin extends Plugin {
	tokenStore!: TokenStore;
	api!: GoogleCalendarAPI;
	data!: PluginData;
	commandBridge: CommandBridge | null = null;

	async onload() {
		const GCAL_ICON = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
		<rect x="10" y="22" width="80" height="68" rx="9" fill="none" stroke="currentColor" stroke-width="6"/>
		<rect x="28" y="10" width="13" height="24" rx="6.5" fill="none" stroke="currentColor" stroke-width="5"/>
		<rect x="59" y="10" width="13" height="24" rx="6.5" fill="none" stroke="currentColor" stroke-width="5"/>
		<text x="10" y="91" font-size="33" font-weight="bold" fill="currentColor" font-family="Arial, sans-serif" letter-spacing="-1">GC</text>
		</svg>`;
		addIcon("gcal-icon", GCAL_ICON);

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

		this.addRibbonIcon("gcal-icon", "GCal Sidebar", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-gcal-view",
			name: "Open Google Calendar",
			callback: () => {
				const rightSplit = this.app.workspace.rightSplit as any;
				const existing =
					this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];

				if (!existing) {
					this.activateView();
					return;
				}

				const isCollapsed = rightSplit.collapsed === true;

				if (isCollapsed) {
					rightSplit.expand();
					this.app.workspace.revealLeaf(existing);
					return;
				}

				const parent = (existing as any).parent;
				const isActive =
					parent?.children?.[parent?.currentTab] === existing;

				if (isActive) {
					rightSplit.collapse();
				} else {
					this.app.workspace.revealLeaf(existing);
				}
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
		
		this.addCommand({
			id: "gcal-duplicate-event",
			name: "Google Calendar: Duplicate event",
			callback: () => this.commandBridge?.duplicate(),
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
