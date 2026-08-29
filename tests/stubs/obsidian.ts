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
export class Plugin {}
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
