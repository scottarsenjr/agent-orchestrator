import path from "node:path";
import { describe, expect, it } from "vitest";
import { automaticUpdatesEnabled, electronProfilePath } from "./desktop-isolation";

describe("desktop isolation", () => {
	it("keeps existing defaults and isolates a custom data directory", () => {
		expect(electronProfilePath({}, "home", true, "data")).toBe(path.join("home", ".ao", "electron"));
		expect(electronProfilePath({}, "home", false, "data")).toBe(path.join("home", ".ao", "dev", "electron"));
		expect(electronProfilePath({ AO_DATA_DIR: "isolated" }, "home", true, "isolated")).toBe(path.join("isolated", "electron"));
		expect(electronProfilePath({ AO_DATA_DIR: "isolated" }, "home", false, "isolated")).toBe(path.join("isolated", "electron"));
		expect(electronProfilePath({ AO_DEV_ELECTRON_DIR: "dev-profile" }, "home", false, "data")).toBe("dev-profile");
		expect(electronProfilePath({ AO_DATA_DIR: "isolated", AO_DEV_ELECTRON_DIR: "dev-profile" }, "home", false, "isolated")).toBe("dev-profile");
		expect(electronProfilePath({ AO_DATA_DIR: "isolated", AO_DEV_ELECTRON_DIR: "dev-profile" }, "home", true, "isolated")).toBe(path.join("isolated", "electron"));
	});
	it("can disable updates without changing the packaged default", () => {
		expect(automaticUpdatesEnabled({}, true)).toBe(true);
		expect(automaticUpdatesEnabled({ AO_DISABLE_AUTO_UPDATES: "1" }, true)).toBe(false);
		expect(automaticUpdatesEnabled({}, false)).toBe(false);
	});
});
