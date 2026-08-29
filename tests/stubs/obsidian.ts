// Runtime stub for the `obsidian` package.
//
// The real package ships types only (`main: ""`), so anything importing it
// explodes under a test runner. vitest.config.ts aliases "obsidian" here.
// Only the surface our source actually imports is implemented.
import { vi } from "vitest";

export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface RequestUrlResponse {
  status: number;
  json: unknown;
  text: string;
}

/** Configure per-test with `vi.mocked(requestUrl).mockResolvedValue(...)`. */
export const requestUrl = vi.fn<(p: RequestUrlParam) => Promise<RequestUrlResponse>>();

export class Notice {
  constructor(public message: string, public timeout?: number) {}
}

export interface CommandSpec {
  id: string;
  name: string;
  callback?: () => void;
}

/**
 * Records what a plugin registers during onload() so tests can assert on it.
 * Only the methods GCalPlugin.onload() actually calls are implemented.
 */
export class Plugin {
  app: App = new App();
  commands: CommandSpec[] = [];
  views: string[] = [];
  ribbonIcons: { icon: string; title: string }[] = [];
  private stored: unknown = null;

  addCommand(cmd: CommandSpec): CommandSpec {
    this.commands.push(cmd);
    return cmd;
  }
  addRibbonIcon(icon: string, title: string): HTMLElement {
    this.ribbonIcons.push({ icon, title });
    return {} as HTMLElement;
  }
  addSettingTab(): void {}
  registerView(type: string): void {
    this.views.push(type);
  }
  async loadData(): Promise<unknown> {
    return this.stored;
  }
  async saveData(data: unknown): Promise<void> {
    this.stored = data;
  }
}
export class PluginSettingTab {}
export class Modal {}
export class ItemView {}
export class Setting {}
export class App {}
export class WorkspaceLeaf {}
export const addIcon = vi.fn();

/** Build a RequestUrlResponse without repeating the shape in every test. */
export function makeResponse(
  status: number,
  json: unknown = {}
): RequestUrlResponse {
  return { status, json, text: JSON.stringify(json) };
}
