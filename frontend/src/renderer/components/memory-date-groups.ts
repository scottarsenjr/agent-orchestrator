import type { MemoryGraphEdge, MemoryGraphNode } from "./MemoryGraph";

type DateNode = MemoryGraphNode & { count: number; dateKey: string };

// Date-only values already represent a calendar day; timestamps use the PC's local time zone.
function localDay(value: string | null | undefined): { key: string; label: string } | null {
	if (!value) return null;
	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(value);
	if (!Number.isFinite(date.getTime())) return null;
	if (dateOnly && (date.getFullYear() !== Number(dateOnly[1]) || date.getMonth() !== Number(dateOnly[2]) - 1 || date.getDate() !== Number(dateOnly[3]))) return null;
	const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	return { key, label: new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" }).format(date) };
}

/** Synthetic date links are a view only and are never written into memory. */
export function groupMemoryByDate(nodes: MemoryGraphNode[], edges: MemoryGraphEdge[], collapsed: ReadonlySet<string>) {
	const groups = new Map<string, DateNode>();
	const sourceGroups = new Map<string, string>();
	const sourceIdGroups = new Map<string, string>();
	for (const node of nodes) {
		if (node.type !== "source") continue;
		const day = localDay(node.date);
		const key = day?.key ?? "unknown";
		const id = `date-group:${key}`;
		const group = groups.get(id) ?? { id, type: "date-group", label: day?.label ?? "Unknown date", status: null, date: node.date, dateKey: key, count: 0 };
		group.count++;
		groups.set(id, group);
		sourceGroups.set(node.id, id);
		if (node.source_id) sourceIdGroups.set(node.source_id, id);
	}
	const nodeGroups = new Map(sourceGroups);
	for (const node of nodes) if (node.source_id && sourceIdGroups.has(node.source_id)) nodeGroups.set(node.id, sourceIdGroups.get(node.source_id)!);
	// The producer normally sends source_id, but incidence links also cover older graphs.
	for (const edge of edges) {
		if (sourceGroups.has(edge.source) && !nodeGroups.has(edge.target)) nodeGroups.set(edge.target, sourceGroups.get(edge.source)!);
		if (sourceGroups.has(edge.target) && !nodeGroups.has(edge.source)) nodeGroups.set(edge.source, sourceGroups.get(edge.target)!);
	}
	const visible = nodes.filter((node) => !collapsed.has(nodeGroups.get(node.id) ?? ""));
	const ids = new Set(visible.map((node) => node.id));
	const displayedEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
	for (const [source, group] of sourceGroups) if (ids.has(source)) displayedEdges.push({ id: `date-link:${group}:${source}`, source: group, target: source, type: "date_source" });
	const dateNodes = [...groups.values()].sort((a, b) => a.dateKey === "unknown" ? 1 : b.dateKey === "unknown" ? -1 : a.dateKey.localeCompare(b.dateKey));
	const dated = dateNodes.filter((node) => node.dateKey !== "unknown");
	for (let i = 1; i < dated.length; i++) displayedEdges.push({ id: `date-next:${dated[i - 1].id}:${dated[i].id}`, source: dated[i - 1].id, target: dated[i].id, type: "date_next" });
	return { nodes: [...visible, ...dateNodes], edges: displayedEdges, dates: dateNodes };
}
