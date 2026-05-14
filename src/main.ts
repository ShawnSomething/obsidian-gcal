import { Plugin, WorkspaceLeaf } from "obsidian";
import { CalendarView, VIEW_TYPE } from "./CalendarView";

export default class GCalPlugin extends Plugin {
	async onload() {
		this.registerView(
			VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CalendarView(leaf, this)
		);

		this.addRibbonIcon("calendar", "Google Calendar", () => {
			this.activateView();
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	async activateView() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE,
				active: true,
			});
		}
		const activeLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (activeLeaf) {
			this.app.workspace.revealLeaf(activeLeaf);
		}
	}
}