import { expect, it } from "vitest";
import { groupMemoryByDate } from "./memory-date-groups";

it("uses local calendar days for timestamps and leaves undated groups out of the timeline", () => {
	const timestamp = "2026-10-31T23:30:00Z";
	const local = new Date(timestamp);
	const day = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
	const nodes = [
		{ id: "timestamp", type: "source", label: "Timestamp", status: null, date: timestamp },
		{ id: "day", type: "source", label: "Day", status: null, date: "2026-10-01" },
		{ id: "invalid", type: "source", label: "Invalid", status: null, date: "2026-99-99" },
	];
	const result = groupMemoryByDate(nodes, [], new Set());
	expect(result.dates.map((date) => date.dateKey)).toEqual(["2026-10-01", day, "unknown"]);
	expect(result.edges.filter((edge) => edge.type === "date_next")).toHaveLength(1);
	expect(result.edges.filter((edge) => edge.type === "date_source")).toHaveLength(3);
	expect(nodes).toHaveLength(3);
});
