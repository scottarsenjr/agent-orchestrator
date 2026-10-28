import path from "node:path";
import { describe, expect, it } from "vitest";
import { automaticUpdatesEnabled, electronProfilePath } from "./desktop-isolation";

describe("desktop isolation", () => {
	it("keeps existing defaults and honors an explicit packaged profile", () => {
		expect(electronProfilePath({}, "home", true)).toBe(path.join("home", ".ao", "electron"));
		expect(electronProfilePath({}, "home", false)).toBe(path.join("home", ".ao", "dev", "electron"));
		expect(electronProfilePath({ AO_ELECTRON_DIR: "isolated" }, "home", true)).toBe("isolated");
	});
	it("can disable updates without changing the packaged default", () => {
		expect(automaticUpdatesEnabled({}, true)).toBe(true);
		expect(automaticUpdatesEnabled({ AO_DISABLE_AUTO_UPDATES: "1" }, true)).toBe(false);
		expect(automaticUpdatesEnabled({}, false)).toBe(false);
	});
});
