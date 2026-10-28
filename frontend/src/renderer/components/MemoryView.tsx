import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiClient, getApiBaseUrl } from "../lib/api-client";
import { hidesShellTopbar } from "../lib/platform";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Node = { id: string; type: string; label: string; content: string; source_id: string | null; date: string | null; status: string | null; provenance: Record<string, unknown> | null };
type Graph = { visibility_token: string; nodes: Node[]; edges: { id: string; source: string; target: string; type: string }[]; counts: { visible: number; returned: number } | null; truncated: boolean; empty_reason: string | null; context: { branch: string | null; commit: string | null; dirty: boolean }; errors: unknown[] };

function Field({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
	return <label className="flex min-w-32 flex-col gap-1 text-xs text-muted-foreground"><span>{label}</span><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} size="sm" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label>;
}

export function MemoryView() {
	const { t } = useTranslation();
	const catalog = useQuery({ queryKey: ["memory", "catalog"], queryFn: async () => {
		const [projects, sessions] = await Promise.all([apiClient.GET("/api/v1/projects"), apiClient.GET("/api/v1/sessions")]);
		if (projects.error || sessions.error) throw new Error(t("memory.loadProjectsError"));
		return (projects.data?.projects ?? []).filter((p) => p.path && !p.folderMissing).map((p) => ({ ...p, sessions: (sessions.data?.sessions ?? []).filter((s) => s.projectId === p.id).map((s) => ({ id: s.id, title: s.displayName || s.id })) }));
	} });
	const workspaces = catalog.data ?? [];
	const [project, setProject] = useState("");
	const [scope, setScope] = useState("project");
	const [session, setSession] = useState("");
	const [query, setQuery] = useState("");
	const [type, setType] = useState("all");
	const [status, setStatus] = useState("all");
	const [graph, setGraph] = useState<Graph | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState("");
	const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
	const [canvasWidth, setCanvasWidth] = useState(600);
	const [layoutWidth, setLayoutWidth] = useState(800);
	const layoutRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
	const current = workspaces.find((w) => w.id === project);
	const sessions = current?.sessions ?? [];
	const valid = Boolean(project && (scope === "project" || (session && session !== "none")));
	const key = JSON.stringify([project, scope, session, query, type, status]);
	useEffect(() => { if (!project && workspaces.length) setProject(workspaces[0].id); }, [project, workspaces]);
	useEffect(() => {
		setGraph(null); setSelected(null); setState("loading"); setError("");
		if (!valid) return;
		let disposed = false; let busy = false; let token = ""; let controller: AbortController | null = null;
		const params = new URLSearchParams({ projectId: project, scope });
		if (scope !== "project") params.set("sessionId", session);
		if (query) params.set("query", query);
		if (type !== "all") params.set("nodeTypes", type);
		if (status !== "all") params.set("statuses", status);
		async function read(metadata: boolean) {
			controller?.abort(); controller = new AbortController();
			const p = new URLSearchParams(params); if (metadata) p.set("metadataOnly", "true");
			const base = getApiBaseUrl(); if (!base) throw new Error(t("memory.daemonUnavailable"));
			const response = await fetch(`${base}/api/v1/memory/graph?${p}`, { signal: controller.signal, cache: "no-store" });
			if (!response.ok) throw new Error(t(response.status === 503 ? "memory.providerUnavailable" : "memory.loadScopeError"));
			return await response.json() as Graph;
		}
		async function refresh(metadata: boolean) {
			if (busy) return;
			busy = true;
			try {
				let result = await read(metadata); if (disposed) return;
				if (metadata && result.visibility_token === token) return;
				if (metadata) { setGraph(null); setSelected(null); setState("loading"); result = await read(false); if (disposed) return; }
				if (result.errors?.length) throw new Error(t("memory.readWorkspaceError"));
				if (token && token !== result.visibility_token) setSelected(null);
				token = result.visibility_token; setGraph(result); setState("ready");
		} catch (e) { if (disposed || (e instanceof DOMException && e.name === "AbortError")) return; token = ""; setGraph(null); setSelected(null); setError(e instanceof Error ? e.message : t("memory.loadError")); setState("error"); } finally { busy = false; }
		}
		void refresh(false);
		const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 5000);
		const visible = () => { if (document.visibilityState === "visible") void refresh(true); };
		document.addEventListener("visibilitychange", visible);
		return () => { disposed = true; controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
	}, [key, t]); // key represents every request input; no cross-scope cache.
	const nodes = graph?.nodes ?? [];
	const detail = nodes.find((node) => node.id === selected);
	const detailLinks = graph?.edges.filter((edge) => edge.source === selected || edge.target === selected) ?? [];
	const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));
	useEffect(() => {
		const layout = layoutRef.current, canvas = canvasRef.current;
		if (!layout || !canvas) return;
		const update = () => { setLayoutWidth(layout.clientWidth); setCanvasWidth(Math.max(180, canvas.clientWidth)); };
		update(); if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update); observer.observe(layout); observer.observe(canvas);
		return () => observer.disconnect();
	}, [Boolean(graph), Boolean(detail)]);
	const narrow = layoutWidth < 700;
	const columns = Math.max(1, Math.min(4, Math.floor(canvasWidth / 180)));
	const positions = useMemo(() => new Map(nodes.map((node, i) => [node.id, { x: (canvasWidth / columns) * ((i % columns) + .5), y: 55 + Math.floor(i / columns) * 85 }])), [nodes, canvasWidth, columns]);
	const height = Math.max(300, Math.ceil(nodes.length / columns) * 85 + 40);
	function clear() { setSelected(null); setGraph(null); }
	return <div className="flex min-h-0 flex-1 flex-col bg-background">
		<header className="workspace-topbar-container center-panel-titlebar flex h-toolbar shrink-0 items-center border-b border-border-strong"><h1 className={hidesShellTopbar() ? "text-sm font-medium" : "sr-only"}>{t("memory.title")}</h1></header>
		<div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
			<Field label={t("memory.project")} value={project || "none"} onChange={(v) => { clear(); setProject(v); setScope("project"); setSession(""); }} options={workspaces.length ? workspaces.map((w) => ({ value: w.id, label: w.name })) : [{ value: "none", label: t("memory.noLocalProjects") }]} />
			<Field label={t("memory.scope")} value={scope} onChange={(v) => { clear(); setScope(v); setSession(""); }} options={[{ value: "project", label: t("memory.project") }, { value: "worktree", label: t("memory.worktree") }, { value: "session", label: t("memory.session") }]} />
			{scope !== "project" && <Field label={t("memory.sessionWorkspace")} value={session || "none"} onChange={(v) => { clear(); setSession(v); }} options={[{ value: "none", label: t("memory.selectSession") }, ...sessions.map((s) => ({ value: s.id, label: s.title }))]} />}
			<label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">{t("memory.search")}<Input aria-label={t("memory.searchPlaceholder")} value={query} onChange={(e) => { clear(); setQuery(e.target.value); }} placeholder={t("memory.searchPlaceholder")} /></label>
			<Field label={t("memory.type")} value={type} onChange={(v) => { clear(); setType(v); }} options={[{ value: "all", label: t("memory.allTypes") }, { value: "source", label: t("memory.source") }, { value: "proposition", label: t("memory.proposition") }, { value: "entity", label: t("memory.entity") }]} />
			<Field label={t("memory.status")} value={status} onChange={(v) => { clear(); setStatus(v); }} options={[{ value: "all", label: t("memory.allStatuses") }, { value: "proposed", label: t("memory.proposed") }, { value: "implemented_in_branch", label: t("memory.implementedInBranch") }, { value: "accepted", label: t("memory.accepted") }, { value: "legacy", label: t("memory.legacy") }]} />
		</div>
		<p className="px-4 pt-2 text-xs text-muted-foreground">{t(scope === "project" ? "memory.projectWorkspace" : "memory.sessionScopeNote")}</p>
		{catalog.isError ? <p role="alert" className="p-4 text-sm">{t("memory.loadProjectsError")}</p> : catalog.isLoading ? <p role="status" className="p-4 text-sm">{t("memory.loadingProjects")}</p> : !valid || session === "none" ? <p className="p-4 text-sm text-muted-foreground">{t("memory.selectProjectSession")}</p> : state === "loading" ? <p role="status" className="p-4 text-sm">{t("memory.loadingMemory")}</p> : state === "error" ? <p role="alert" className="p-4 text-sm">{error}</p> : graph && nodes.length === 0 ? <div className="p-4 text-sm text-muted-foreground"><p>{t(graph.empty_reason === "no_matches" ? "memory.noMatches" : "memory.empty")}</p><p className="mt-2 text-xs">{t("memory.zeroNodes")} · {graph.context.branch || t("memory.noBranch")}{graph.context.dirty ? ` · ${t("memory.uncommittedChanges")}` : ""}</p></div> : graph && <>
			<div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground"><span>{t("memory.nodeCount", { returned: graph.counts?.returned ?? nodes.length, visible: graph.counts?.visible ?? nodes.length })}</span>{graph.truncated && <span>{t("memory.truncated")}</span>}<span>{graph.context.branch || t("memory.noBranch")}{graph.context.dirty ? ` · ${t("memory.uncommittedChanges")}` : ""}</span><div className="ml-auto flex gap-1"><Button variant="ghost" size="icon-sm" aria-label={t("memory.zoomOut")} onClick={() => setView((v) => ({ ...v, scale: Math.max(.4, v.scale / 1.2) }))}><Minus /></Button><Button variant="ghost" size="icon-sm" aria-label={t("memory.zoomIn")} onClick={() => setView((v) => ({ ...v, scale: Math.min(3, v.scale * 1.2) }))}><Plus /></Button><Button variant="ghost" size="icon-sm" aria-label={t("memory.fitGraph")} onClick={() => setView({ x: 0, y: 0, scale: 1 })}><Maximize2 /></Button></div></div>
			<div ref={layoutRef} className={`flex min-h-0 flex-1 ${narrow ? "flex-col overflow-auto" : "flex-row"}`}>
				<div ref={canvasRef} className="min-h-64 min-w-0 flex-1 overflow-auto" aria-label={t("memory.graph")}><svg className="w-full touch-none" style={{ height }} viewBox={`${view.x} ${view.y} ${canvasWidth / view.scale} ${height / view.scale}`} tabIndex={0} aria-label={t("memory.graphCanvas")} onKeyDown={(e) => { const step = 40 / view.scale; if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); setView((v) => ({ ...v, x: v.x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0), y: v.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0) })); } }} onPointerDown={(e) => { if (e.target === e.currentTarget) { drag.current = { x: e.clientX, y: e.clientY, originX: view.x, originY: view.y }; e.currentTarget.setPointerCapture(e.pointerId); } }} onPointerMove={(e) => { if (drag.current) setView((v) => ({ ...v, x: drag.current!.originX - (e.clientX - drag.current!.x) / v.scale, y: drag.current!.originY - (e.clientY - drag.current!.y) / v.scale })); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
					{graph.edges.map((edge) => { const a = positions.get(edge.source), b = positions.get(edge.target); return a && b ? <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-text-muted)" /> : null; })}
					{nodes.map((node) => { const p = positions.get(node.id)!; return <g key={node.id} role="button" tabIndex={0} className="focus-visible:outline-none focus-visible:[&>rect]:stroke-[var(--ring)]" aria-label={`${node.type}: ${node.label}`} onClick={() => setSelected(node.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(node.id); } }}><rect x={p.x - 78} y={p.y - 23} width="156" height="46" rx="6" fill={selected === node.id ? "var(--color-bg-tertiary)" : "var(--color-bg-secondary)"} stroke="var(--color-border-strong)" /><text x={p.x} y={p.y - 3} textAnchor="middle" fill="var(--color-text-primary)" fontSize="12">{node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}</text><text x={p.x} y={p.y + 13} textAnchor="middle" fill="var(--color-text-muted)" fontSize="10">{node.type}</text></g>; })}
				</svg><ul className="sr-only" aria-label={t("memory.storedLinks")}>{graph.edges.map((edge) => <li key={edge.id}>{nodeLabels.get(edge.source) ?? edge.source} {t("memory.to")} {nodeLabels.get(edge.target) ?? edge.target} — {edge.type.replaceAll("_", " ")}</li>)}</ul></div>
				{detail && <aside className={`${narrow ? "w-full border-t" : "w-72 border-l"} max-w-full overflow-auto border-border p-4`} aria-label={t("memory.details")}>
					<div className="flex items-start justify-between gap-2"><h2 className="text-sm font-medium">{detail.label}</h2><Button variant="ghost" size="sm" onClick={() => setSelected(null)}>{t("memory.closeDetails")}</Button></div>
					<p className="mt-2 whitespace-pre-wrap text-sm">{detail.content}</p>
					<dl className="mt-4 space-y-2 text-xs"><div><dt className="text-muted-foreground">{t("memory.type")}</dt><dd>{detail.type}</dd></div><div><dt className="text-muted-foreground">{t("memory.status")}</dt><dd>{detail.status || "—"}</dd></div><div><dt className="text-muted-foreground">{t("memory.date")}</dt><dd>{detail.date || "—"}</dd></div><div><dt className="text-muted-foreground">{t("memory.source")}</dt><dd className="break-all">{detail.source_id || "—"}</dd></div>{Object.entries(detail.provenance ?? {}).map(([k, v]) => <div key={k}><dt className="text-muted-foreground">{k.replaceAll("_", " ")}</dt><dd className="break-all">{String(v)}</dd></div>)}</dl>
					{detailLinks.length > 0 && <section className="mt-4 border-t border-border pt-3" aria-label={t("memory.storedLinks")}>
						<h3 className="text-xs font-medium">{t("memory.storedLinks")}</h3>
						<ul className="mt-2 divide-y divide-border">{detailLinks.map((edge) => <li key={edge.id} className="py-2 first:pt-0 last:pb-0"><div className="break-words text-xs">{nodeLabels.get(edge.source) ?? edge.source} <span aria-hidden="true">→</span><span className="sr-only"> {t("memory.to")} </span> {nodeLabels.get(edge.target) ?? edge.target}</div><div className="text-xs text-muted-foreground">{edge.type.replaceAll("_", " ")}</div></li>)}</ul>
					</section>}
				</aside>}
			</div>
		</>}
	</div>;
}
