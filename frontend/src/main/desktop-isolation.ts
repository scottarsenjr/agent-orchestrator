import path from "node:path";

// Explicit overrides let a local custom package use an independent Chromium
// profile. Without one, retain the normal packaged and dev locations.
export function electronProfilePath(env: NodeJS.ProcessEnv, home: string, packaged: boolean): string {
	return env.AO_ELECTRON_DIR?.trim() || (packaged ? path.join(home, ".ao", "electron") : env.AO_DEV_ELECTRON_DIR?.trim() || path.join(home, ".ao", "dev", "electron"));
}

export function automaticUpdatesEnabled(env: NodeJS.ProcessEnv, packaged: boolean): boolean {
	return packaged && env.AO_DISABLE_AUTO_UPDATES !== "1";
}
