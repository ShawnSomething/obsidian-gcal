import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import { fileURLToPath } from 'url';
import path from 'path';

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				// Obsidian injects these for pop-out window support: they point at
				// the document/window of whichever window holds the active leaf.
				// Used by every outside-click listener in src/components.
				activeDocument: "readonly",
				activeWindow: "readonly",
				// OAuthManager runs in Electron's node context (http, crypto,
				// child_process) and base64url-encodes the PKCE challenge.
				Buffer: "readonly",
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: path.dirname(fileURLToPath(import.meta.url)),
				extraFileExtensions: ['.json']
			},
		},
	},
	...(obsidianmd.configs!.recommended as any[]),
	{
		// Flat config requires the plugin to be registered in the same object
		// as any rule it owns.
		plugins: { obsidianmd: obsidianmd as any },
		rules: {
			// The rule has no proper-noun awareness of its own: it flags any
			// capitalised word mid-string. `brands` REPLACES the plugin's default
			// list rather than extending it, so the 46 defaults are repeated here
			// with our additions at the end. Re-sync if the plugin updates its list.
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					brands: [
						"iOS", "iPadOS", "macOS", "Windows", "Android", "Linux",
						"Obsidian", "Obsidian Sync", "Obsidian Publish",
						"Google Drive", "Dropbox", "OneDrive", "iCloud Drive",
						"YouTube", "Slack", "Discord", "Telegram", "WhatsApp",
						"Twitter", "X", "Readwise", "Zotero", "Excalidraw",
						"Mermaid", "Markdown", "LaTeX", "JavaScript", "TypeScript",
						"Node.js", "npm", "pnpm", "Yarn", "Git", "GitHub", "GitLab",
						"Notion", "Evernote", "Roam Research", "Logseq", "Anki",
						"Reddit", "VS Code", "Visual Studio Code", "IntelliJ IDEA",
						"WebStorm", "PyCharm",
						// Added for this plugin:
						"Google", "Google Cloud", "Google Calendar", "Google Meet",
						"GCal", "GCal Sidebar",
					],
					ignoreRegex: [
						// Literal credential formats shown as input placeholders,
						// not prose: "GOCSPX-..." and a sample OAuth client ID.
						"^GOCSPX-",
						"apps\\.googleusercontent\\.com$",
					],
				},
			],
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);