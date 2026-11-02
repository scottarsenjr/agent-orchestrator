import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarDays, CircleDot, FileText, Link2, Tag } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiClient, getApiBaseUrl } from "../lib/api-client";
import { hidesShellTopbar } from "../lib/platform";
import { Dialog, DialogContent, DialogOverlay, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { MemoryGraph } from "./MemoryGraph";

type Node = { id: string; type: string; label: string; content: string; source_id: string | null; date: string | null; status: string | null; provenance: Record<string, unknown> | null };
type Graph = { visibility_token: string; nodes: Node[]; edges: { id: string; source: string; target: string; type: string }[]; counts: { visible: number; returned: number } | null; truncated: boolean; empty_reason: string | null; context: { branch: string | null; commit: string | null; dirty: boolean }; errors: unknown[] };

function Field({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
	return <label className="flex min-w-32 flex-col gap-1 text-xs text-muted-foreground"><span>{label}</span><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} size="sm" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></label>;
}

function MemoryLoading({ label }: { label: string }) {
	return <div role="status" aria-live="polite" className="flex min-h-64 flex-1 items-center justify-center bg-[#171717] p-6 text-[#c8c8ca]">
		<div className="flex flex-col items-center gap-3 text-sm"><LoaderCircle aria-hidden="true" className="size-6 animate-spin text-violet-400 motion-reduce:animate-none" /><span>{label}</span></div>
	</div>;
}

export function MemoryView({ initialProject, onProjectChange }: { initialProject?: string; onProjectChange?: (project: string) => void } = {}) {
	const { t } = useTranslation();
	const catalog = useQuery({ queryKey: ["memory", "catalog"], queryFn: async () => {
		const [projects, sessions] = await Promise.all([apiClient.GET("/api/v1/projects"), apiClient.GET("/api/v1/sessions")]);
		if (projects.error || sessions.error) throw new Error(t("memory.loadProjectsError"));
		return (projects.data?.projects ?? []).filter((p) => p.path && !p.folderMissing).map((p) => ({ ...p, sessions: (sessions.data?.sessions ?? []).filter((s) => s.projectId === p.id).map((s) => ({ id: s.id, title: s.displayName || s.id })) }));
	} });
	const workspaces = catalog.data ?? [];
	const [project, setProject] = useState(initialProject ?? "");
	const [scope, setScope] = useState("project");
	const [session, setSession] = useState("");
	const [query, setQuery] = useState("");
	const [type, setType] = useState("all");
	const [status, setStatus] = useState("all");
	const [graph, setGraph] = useState<Graph | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState("");
	const current = workspaces.find((w) => w.id === project);
	const sessions = current?.sessions ?? [];
	const valid = Boolean(project && (scope === "project" || (session && session !== "none")));
	const key = JSON.stringify([project, scope, session, query, type, status]);
	useEffect(() => {
		if (!project && workspaces.length) {
			setProject(workspaces[0].id);
			onProjectChange?.(workspaces[0].id);
		}
	}, [project, workspaces, onProjectChange]);
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
				if (result.errors?.length) throw new Error(t("memory.readWorkspaceError"));
				if (metadata && result.visibility_token === token) return;
				if (metadata) { setGraph(null); setSelected(null); setState("loading"); result = await read(false); if (disposed) return; }
				if (result.errors?.length) throw new Error(t("memory.readWorkspaceError"));
				if (token && token !== result.visibility_token) setSelected(null);
				token = result.visibility_token; setGraph(result); setError(""); setState("ready");
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
	const statusOptions = [{ value: "proposed", label: t("memory.proposed") }, { value: "implemented_in_branch", label: t("memory.implementedInBranch") }, { value: "accepted", label: t("memory.accepted") }, { value: "legacy", label: t("memory.legacy") }];
	function clear() { setSelected(null); setGraph(null); }
	return <div className="flex min-h-0 flex-1 flex-col bg-background">
		<header className="workspace-topbar-container center-panel-titlebar flex h-toolbar shrink-0 items-center border-b border-border-strong"><h1 className={hidesShellTopbar() ? "text-sm font-medium" : "sr-only"}>{t("memory.title")}{current ? ` / ${current.name}` : ""}</h1></header>
		<div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
			<Field label={t("memory.project")} value={project || "none"} onChange={(v) => { clear(); setProject(v); setScope("project"); setSession(""); onProjectChange?.(v); }} options={workspaces.length ? workspaces.map((w) => ({ value: w.id, label: w.name })) : [{ value: "none", label: t("memory.noLocalProjects") }]} />
			<Field label={t("memory.scope")} value={scope} onChange={(v) => { clear(); setScope(v); setSession(""); }} options={[{ value: "project", label: t("memory.project") }, { value: "worktree", label: t("memory.worktree") }, { value: "session", label: t("memory.session") }]} />
			{scope !== "project" && <Field label={t("memory.sessionWorkspace")} value={session || "none"} onChange={(v) => { clear(); setSession(v); }} options={[{ value: "none", label: t("memory.selectSession") }, ...sessions.map((s) => ({ value: s.id, label: s.title }))]} />}
			<label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">{t("memory.search")}<Input aria-label={t("memory.searchPlaceholder")} value={query} onChange={(e) => { clear(); setQuery(e.target.value); }} placeholder={t("memory.searchPlaceholder")} /></label>
			<Field label={t("memory.type")} value={type} onChange={(v) => { clear(); setType(v); }} options={[{ value: "all", label: t("memory.allTypes") }, { value: "source", label: t("memory.source") }, { value: "proposition", label: t("memory.proposition") }, { value: "entity", label: t("memory.entity") }]} />
			<Field label={t("memory.status")} value={status} onChange={(v) => { clear(); setStatus(v); }} options={[{ value: "all", label: t("memory.allStatuses") }, ...statusOptions]} />
		</div>
		<p className="px-4 pt-2 text-xs text-muted-foreground">{t(scope === "project" ? "memory.projectWorkspace" : "memory.sessionScopeNote")}</p>
		{catalog.isError ? <p role="alert" className="p-4 text-sm">{t("memory.loadProjectsError")}</p> : catalog.isLoading ? <MemoryLoading label={t("memory.loadingProjects")} /> : !valid || session === "none" ? <p className="p-4 text-sm text-muted-foreground">{t("memory.selectProjectSession")}</p> : state === "loading" ? <MemoryLoading label={t("memory.loadingMemory")} /> : state === "error" ? <p role="alert" className="p-4 text-sm">{error}</p> : graph && nodes.length === 0 ? <div className="p-4 text-sm text-muted-foreground"><p>{t(graph.empty_reason === "no_matches" ? "memory.noMatches" : "memory.empty")}</p><p className="mt-2 text-xs">{t("memory.zeroNodes")} · {graph.context.branch || t("memory.noBranch")}{graph.context.dirty ? ` · ${t("memory.uncommittedChanges")}` : ""}</p></div> : graph && <>
			<div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground"><span>{t("memory.nodeCount", { returned: graph.counts?.returned ?? nodes.length, visible: graph.counts?.visible ?? nodes.length })}</span>{graph.truncated && <span>{t("memory.truncated")}</span>}<span>{graph.context.branch || t("memory.noBranch")}{graph.context.dirty ? ` · ${t("memory.uncommittedChanges")}` : ""}</span></div>
			<div className="flex min-h-0 flex-1 flex-row">
				<MemoryGraph key={project} project={project} nodes={nodes} edges={graph.edges} selected={selected} onSelect={setSelected} resetKey={key} />
				<ul className="sr-only" aria-label={t("memory.storedLinks")}>{graph.edges.map((edge) => <li key={edge.id}>{nodeLabels.get(edge.source) ?? edge.source} {t("memory.to")} {nodeLabels.get(edge.target) ?? edge.target} — {edge.type.replaceAll("_", " ")}</li>)}</ul>
				<Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
					{detail && <DialogContent aria-describedby={undefined} aria-label={t("memory.details")} overlay={<DialogOverlay className="bg-black/65 backdrop-blur-sm" />} className="max-h-[min(85vh,900px)] w-[min(900px,calc(100vw-48px))] max-w-none overflow-y-auto rounded-xl border-[#3b3b3d] bg-[#1c1c1c] p-0 text-[#dedee2] shadow-2xl">
						<article className="mx-auto w-full max-w-[720px] px-8 pb-12 pt-10 sm:px-14 sm:pt-14">
							<DialogTitle className="break-words pr-5 text-[28px] font-bold leading-tight text-[#e2e2e7] sm:text-[32px]">{detail.label}</DialogTitle>
							<h2 className="mb-4 mt-8 text-sm font-semibold text-[#d4d4db]">{t("memory.details")}</h2>
							<dl className="space-y-3 text-sm">
								<div className="grid grid-cols-[136px_minmax(0,1fr)] gap-3"><dt className="flex items-center gap-2 text-[#a8a8b1]"><Tag size={15} />{t("memory.type")}</dt><dd><span className="rounded-full bg-[#392c55] px-2 py-0.5 text-[#c7a7ff]">{detail.type}</span></dd></div>
								<div className="grid grid-cols-[136px_minmax(0,1fr)] gap-3"><dt className="flex items-center gap-2 text-[#a8a8b1]"><CircleDot size={15} />{t("memory.status")}</dt><dd>{detail.status ? (statusOptions.find((option) => option.value === detail.status)?.label ?? detail.status.replaceAll("_", " ")) : "—"}</dd></div>
								<div className="grid grid-cols-[136px_minmax(0,1fr)] gap-3"><dt className="flex items-center gap-2 text-[#a8a8b1]"><CalendarDays size={15} />{t("memory.date")}</dt><dd>{detail.date || "—"}</dd></div>
								<div className="grid grid-cols-[136px_minmax(0,1fr)] gap-3"><dt className="flex items-center gap-2 text-[#a8a8b1]"><FileText size={15} />{t("memory.source")}</dt><dd className="break-all">{detail.source_id || "—"}</dd></div>
								{Object.entries(detail.provenance ?? {}).map(([k, v]) => <div key={k} className="grid grid-cols-[136px_minmax(0,1fr)] gap-3"><dt className="flex items-center gap-2 text-[#a8a8b1]"><Link2 size={15} />{k.replaceAll("_", " ")}</dt><dd className="break-all">{String(v)}</dd></div>)}
							</dl>
							<div className="mt-10 break-words text-sm leading-7 text-[#e0e0e4] [&_a]:text-[#b695ff] [&_a]:underline [&_code]:rounded [&_code]:bg-[#303033] [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-2xl [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-4 [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-[#252525] [&_pre]:p-3">
								<Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt}</span> }}>{detail.content}</Markdown>
							</div>
							{detailLinks.length > 0 && <section className="mt-8 border-t border-[#38383b] pt-5" aria-label={t("memory.storedLinks")}>
								<h3 className="text-xs font-medium text-[#aaaab3]">{t("memory.storedLinks")}</h3>
								<ul className="mt-3 space-y-2">{detailLinks.map((edge) => <li key={edge.id} className="break-words text-xs text-[#c4b5fd]">{nodeLabels.get(edge.source) ?? edge.source} <span aria-hidden="true">→</span><span className="sr-only"> {t("memory.to")} </span> {nodeLabels.get(edge.target) ?? edge.target} <span className="text-[#85858d]">· {edge.type.replaceAll("_", " ")}</span></li>)}</ul>
							</section>}
						</article>
					</DialogContent>}
				</Dialog>
			</div>
		</>}
	</div>;
}
