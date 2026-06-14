import { App, Modal } from "obsidian";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private onConfirm: () => void | Promise<void>,
    private confirmLabel = "Confirm"
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });
    const btnContainer = contentEl.createEl("div", { cls: "modal-button-container" });
    btnContainer.createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.close());
    const confirmBtn = btnContainer.createEl("button", {
      text: this.confirmLabel,
      cls: "mod-warning",
    });
    confirmBtn.addEventListener("click", () => {
      this.close();
      void Promise.resolve(this.onConfirm());
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}