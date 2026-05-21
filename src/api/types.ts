export interface AccountConfig {
	accountId: string;
	displayName: string;
	accessToken: string;
	refreshToken: string;
	tokenExpiry: number;
}

export interface PluginData {
	accounts: AccountConfig[];
	calendarVisibility: Record<string, boolean>;
	clientId: string;
	clientSecret: string;
	viewDensity: ViewDensity;
}

export type ViewDensity = "compact" | "medium" | "large";