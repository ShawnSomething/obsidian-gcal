import * as http from "http";
import * as crypto from "crypto";
import { AccountConfig } from "../api/types";

const REDIRECT_PORT_START = 42813;
const REDIRECT_PORT_END = 42817;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export class OAuthManager {
	private clientId: string;
	private clientSecret: string;

	constructor(clientId: string, clientSecret: string) {
		this.clientId = clientId;
		this.clientSecret = clientSecret;
	}

	async authorizeNewAccount(): Promise<AccountConfig> {
		// Step 1: Generate PKCE codes
		const codeVerifier = this.generateCodeVerifier();
		const codeChallenge = await this.generateCodeChallenge(codeVerifier);
		const state = crypto.randomBytes(16).toString("hex");

		// Step 2: Find an available port
		const port = await this.findAvailablePort();
		const redirectUri = `http://localhost:${port}`;

		// Step 3: Start local server + wait for callback
		const code = await this.waitForCallback(port, state);

		// Step 4: Exchange code for tokens
		const tokens = await this.exchangeCodeForTokens(
			code,
			codeVerifier,
			redirectUri
		);

		// Step 5: Get account info (email) from Google
		const accountInfo = await this.fetchAccountInfo(tokens.access_token);

		return {
			accountId: accountInfo.email,
			displayName: accountInfo.email,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			tokenExpiry: Date.now() + tokens.expires_in * 1000,
		};
	}

	private async waitForCallback(port: number, state: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const server = http.createServer((req, res) => {
				const url = new URL(req.url ?? "", `http://localhost:${port}`);
				const code = url.searchParams.get("code");
				const returnedState = url.searchParams.get("state");

				res.writeHead(200, { "Content-Type": "text/html" });
				res.end("<html><body><h2>Authorised. You can close this tab.</h2></body></html>");
				server.close();

				if (returnedState !== state) {
					reject(new Error("OAuth state mismatch — possible CSRF attack"));
					return;
				}
				if (!code) {
					reject(new Error("No code returned from Google"));
					return;
				}

				resolve(code);
			});

			server.listen(port);
			server.on("error", reject);

			// Open browser to Google auth URL
			const authUrl = this.buildAuthUrl(port, state, this.generateCodeVerifier());
			this.openBrowser(authUrl);
		});
	}

	private buildAuthUrl(port: number, state: string, codeChallenge: string): string {
		const params = new URLSearchParams({
			client_id: this.clientId,
			redirect_uri: `http://localhost:${port}`,
			response_type: "code",
			scope: "https://www.googleapis.com/auth/calendar",
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			state,
			access_type: "offline",
			prompt: "consent",
		});
		return `${GOOGLE_AUTH_URL}?${params.toString()}`;
	}

	private async exchangeCodeForTokens(
		code: string,
		codeVerifier: string,
		redirectUri: string
	): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
		const response = await fetch(GOOGLE_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: this.clientId,
				client_secret: this.clientSecret,
				redirect_uri: redirectUri,
				grant_type: "authorization_code",
				code_verifier: codeVerifier,
			}),
		});

		if (!response.ok) {
			throw new Error(`Token exchange failed: ${response.statusText}`);
		}

		return response.json();
	}

	private async fetchAccountInfo(accessToken: string): Promise<{ email: string }> {
		const response = await fetch(
			"https://www.googleapis.com/oauth2/v3/userinfo",
			{ headers: { Authorization: `Bearer ${accessToken}` } }
		);

		if (!response.ok) {
			throw new Error("Failed to fetch account info");
		}

		return response.json();
	}

	private async findAvailablePort(): Promise<number> {
		for (let port = REDIRECT_PORT_START; port <= REDIRECT_PORT_END; port++) {
			const available = await this.isPortAvailable(port);
			if (available) return port;
		}
		throw new Error("No available ports in range 42813-42817");
	}

	private isPortAvailable(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = http.createServer();
			server.listen(port, () => {
				server.close(() => resolve(true));
			});
			server.on("error", () => resolve(false));
		});
	}

	private openBrowser(url: string): void {
		const { exec } = require("child_process");
		exec(`open "${url}"`);
	}

	private generateCodeVerifier(): string {
		return crypto.randomBytes(32).toString("base64url");
	}

	private async generateCodeChallenge(verifier: string): Promise<string> {
		const hash = crypto.createHash("sha256").update(verifier).digest();
		return Buffer.from(hash).toString("base64url");
	}
}