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
  /** Obsidian throws on status 400+ unless this is explicitly false. */
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  json: unknown;
  text: string;
}

type Responder = (p: RequestUrlParam) => RequestUrlResponse | Promise<RequestUrlResponse>;

let responder: Responder = () => makeResponse(200, {});

/** Set what requestUrl returns. Throw-on-4xx is layered on top, as in Obsidian. */
export function respondWith(r: Responder | RequestUrlResponse): void {
  responder = typeof r === "function" ? r : () => r;
}

/**
 * Mirrors the real contract: Obsidian's requestUrl throws on status 400+ unless
 * the caller passes `throw: false`. A resolving stub is what let 14 unreachable
 * `response.status` checks — and the rollbacks behind them — ship green.
 * Any call that forgets `throw: false` now throws here too.
 */
export const requestUrl = vi.fn(
  async (p: RequestUrlParam): Promise<RequestUrlResponse> => {
    const res = await responder(p);
    if (res.status >= 400 && p.throw !== false) {
      throw new Error(`Request failed, status ${res.status}`);
    }
    return res;
  }
);

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
