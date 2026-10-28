import path from "node:path";

// A custom AO data directory also isolates Chromium. Keep the normal packaged
// and development profile locations when no data override is configured.
export function electronProfilePath(env: NodeJS.ProcessEnv, home: string, packaged: boolean, dataDir: string): string {
	if (env.AO_DATA_DIR?.trim()) return path.join(dataDir, "electron");
	return packaged ? path.join(home, ".ao", "electron") : env.AO_DEV_ELECTRON_DIR?.trim() || path.join(home, ".ao", "dev", "electron");
}

export function automaticUpdatesEnabled(env: NodeJS.ProcessEnv, packaged: boolean): boolean {
	return packaged && env.AO_DISABLE_AUTO_UPDATES !== "1";
}
