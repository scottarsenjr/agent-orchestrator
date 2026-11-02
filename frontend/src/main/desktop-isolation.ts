import path from "node:path";

// An explicit development profile wins over the data directory, so parallel
// worktrees can share daemon data without sharing Chromium's singleton lock.
// A custom AO data directory isolates packaged builds and other dev launches.
export function electronProfilePath(env: NodeJS.ProcessEnv, home: string, packaged: boolean, dataDir: string): string {
	const devProfile = env.AO_DEV_ELECTRON_DIR?.trim();
	if (!packaged && devProfile) return devProfile;
	if (env.AO_DATA_DIR?.trim()) return path.join(dataDir, "electron");
	return packaged ? path.join(home, ".ao", "electron") : path.join(home, ".ao", "dev", "electron");
}

export function automaticUpdatesEnabled(env: NodeJS.ProcessEnv, packaged: boolean): boolean {
	return packaged && env.AO_DISABLE_AUTO_UPDATES !== "1";
}
