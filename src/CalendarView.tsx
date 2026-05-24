import { ItemView, WorkspaceLeaf } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import CalendarPanel from "./components/CalendarPanel";
import { CalendarProvider } from "./context/CalendarContext";
import GCalPlugin from "./main";

export const VIEW_TYPE = "gcal-view";

export class CalendarView extends ItemView {
	private root: Root | null = null;
	plugin: GCalPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: GCalPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return "GCal Sidebar"; }
	getIcon() { return "gcal-icon"; }

	async onOpen() {
		const container = this.containerEl.children[1];
		if (!container) throw new Error("CalendarView: container not found");
		this.root = createRoot(container);
		this.root.render(
			<CalendarProvider>
				<CalendarPanel plugin={this.plugin} />
			</CalendarProvider>
		);
	}

	async onClose() {
		this.root?.unmount();
	}
}