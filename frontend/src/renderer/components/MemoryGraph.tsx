import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState, type SetStateAction, type Dispatch, type PointerEvent } from "react";
import { Maximize2, Minus, Plus, Settings2 } from "lucide-react";

export type MemoryGraphNode = { id: string; type: string; label: string; status: string | null };
export type MemoryGraphEdge = { id: string; source: string; target: string; type: string };
type Point = MemoryGraphNode & SimulationNodeDatum;
type Group = { id: string; query: string; color: string };

const initialGroups: Group[] = [
	{ id: "source", query: "type:source", color: "#48bfea" },
	{ id: "entity", query: "type:entity", color: "#9d5bea" },
	{ id: "accepted", query: "status:accepted", color: "#45b99d" },
];

function useGraphSetting<T>(project: string, name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
	const key = `ao.memory.graph.${encodeURIComponent(project)}.${name}`;
	const [value, setValue] = useState<T>(() => {
		try {
			const raw = localStorage.getItem(key);
			if (raw === null) return initial;
			const saved: unknown = JSON.parse(raw);
			if (Array.isArray(initial)) return (Array.isArray(saved) && saved.every((group) => typeof group?.id === "string" && typeof group?.query === "string" && /^#[0-9a-f]{6}$/i.test(group?.color))) ? saved as T : initial;
			return typeof saved === typeof initial && (typeof saved !== "number" || Number.isFinite(saved)) ? saved as T : initial;
		} catch { return initial; }
	});
	useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be disabled. */ } }, [key, value]);
	return [value, setValue];
}

function groupMatches(node: MemoryGraphNode, query: string) {
	const text = query.trim().toLowerCase();
	if (!text) return false;
	if (text.startsWith("type:")) return node.type.toLowerCase().includes(text.slice(5));
	if (text.startsWith("status:")) return (node.status ?? "").toLowerCase().includes(text.slice(7));
	return node.label.toLowerCase().includes(text);
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
	return <label className="block space-y-2 py-2 text-xs text-[#c8c8ca]"><span>{label}</span><div className="flex items-center gap-3"><span className="w-9 tabular-nums text-[#b4b4b6]">{value.toFixed(step < 1 ? 2 : 0)}</span><input className="w-full accent-violet-500" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></div></label>;
}

export function MemoryGraph({ nodes, edges, selected, onSelect, resetKey, project = "preview" }: { nodes: MemoryGraphNode[]; edges: MemoryGraphEdge[]; selected: string | null; onSelect: (id: string) => void; resetKey: string; project?: string }) {
	const [groups, setGroups] = useGraphSetting(project, "groups", initialGroups);
	const [showOrphans, setShowOrphans] = useGraphSetting(project, "orphans", true);
	const [directions, setDirections] = useGraphSetting(project, "directions", false);
	const [nodeSize, setNodeSize] = useGraphSetting(project, "nodeSize", 1.15);
	const [lineSize, setLineSize] = useGraphSetting(project, "lineSize", 0.8);
	const [textThreshold, setTextThreshold] = useGraphSetting(project, "textThreshold", 1.5);
	const [attraction, setAttraction] = useGraphSetting(project, "attraction", 0.5);
	const [repulsion, setRepulsion] = useGraphSetting(project, "repulsion", 70);
	const [linkStrength, setLinkStrength] = useGraphSetting(project, "linkStrength", 0.5);
	const [distance, setDistance] = useGraphSetting(project, "distance", 55);
	const [settings, setSettings] = useState(true);
	const [animation, setAnimation] = useState(0);
	const [width, setWidth] = useState(600);
	const [height, setHeight] = useState(500);
	const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
	const [hovered, setHovered] = useState<string | null>(null);
	const [focused, setFocused] = useState<string | null>(null);
	const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
	const canvas = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
	const simulationRef = useRef<ReturnType<typeof forceSimulation<Point>> | null>(null);
	const connected = useMemo(() => new Set(edges.flatMap((edge) => [edge.source, edge.target])), [edges]);
	const visible = useMemo(() => showOrphans ? nodes : nodes.filter((node) => connected.has(node.id)), [nodes, connected, showOrphans]);
	const visibleIds = useMemo(() => new Set(visible.map((node) => node.id)), [visible]);
	const visibleEdges = useMemo(() => edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)), [edges, visibleIds]);
	const degree = useMemo(() => { const counts = new Map<string, number>(); for (const edge of visibleEdges) { counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1); counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1); } return counts; }, [visibleEdges]);
	const active = hovered && visibleIds.has(hovered) ? hovered : focused && visibleIds.has(focused) ? focused : null;
	const neighbors = useMemo(() => {
		const ids = new Set<string>();
		if (active) { ids.add(active); for (const edge of visibleEdges) { if (edge.source === active) ids.add(edge.target); if (edge.target === active) ids.add(edge.source); } }
		return ids;
	}, [active, visibleEdges]);
	useEffect(() => { setView({ x: 0, y: 0, scale: 1 }); }, [resetKey]);
	useEffect(() => { setHovered(null); setFocused(null); }, [resetKey]);
	useEffect(() => {
		const element = canvas.current; if (!element) return;
		const resize = () => { setWidth(Math.max(180, element.clientWidth)); setHeight(Math.max(300, element.clientHeight)); };
		resize(); if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();
	}, []);
	useEffect(() => {
		const svg = svgRef.current; if (!svg) return;
		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = svg.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			// The viewBox and SVG can have different aspect ratios in a narrow pane.
			const screenScale = Math.min(rect.width / width, rect.height / height);
			const px = (event.clientX - rect.left - (rect.width - width * screenScale) / 2) / screenScale;
			const py = (event.clientY - rect.top - (rect.height - height * screenScale) / 2) / screenScale;
			const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
			const factor = Math.exp(-Math.max(-400, Math.min(400, delta)) * .0015);
			setView((current) => {
				const scale = Math.max(.2, Math.min(5, current.scale * factor));
				return { x: current.x + px / current.scale - px / scale, y: current.y + py / current.scale - py / scale, scale };
			});
		};
		svg.addEventListener("wheel", wheel, { passive: false });
		return () => svg.removeEventListener("wheel", wheel);
	}, [width, height]);
	useEffect(() => {
		const points: Point[] = visible.map((node) => ({ ...node }));
		const links = visibleEdges.map((edge) => ({ source: edge.source, target: edge.target }));
		const simulation = forceSimulation(points)
			.force("link", forceLink<Point, { source: string | Point; target: string | Point }>(links).id((node) => node.id).distance(distance).strength(linkStrength))
			.force("charge", forceManyBody().strength(-repulsion))
			.force("center", forceCenter(width / 2, height / 2).strength(attraction))
			.force("gravity-x", forceX(width / 2).strength(attraction * .06))
			.force("gravity-y", forceY(height / 2).strength(attraction * .06))
			.force("collide", forceCollide<Point>().radius((node) => 4 + Math.sqrt(degree.get(node.id) ?? 0) * nodeSize));
		simulationRef.current = simulation;
		const update = () => setPositions(new Map(points.map((point) => [point.id, { x: point.x ?? width / 2, y: point.y ?? height / 2 }])));
		simulation.tick(30); update(); simulation.on("tick", update);
		return () => { simulation.stop(); if (simulationRef.current === simulation) simulationRef.current = null; };
	}, [visible, visibleEdges, degree, width, height, distance, linkStrength, repulsion, attraction, nodeSize, animation]);
	const updateGroup = (id: string, change: Partial<Group>) => setGroups((all) => all.map((group) => group.id === id ? { ...group, ...change } : group));
	const moveNode = (event: PointerEvent<SVGGElement>, id: string) => {
		const svg = event.currentTarget.ownerSVGElement;
		const transform = svg?.getScreenCTM?.();
		const point = simulationRef.current?.nodes().find((item) => item.id === id);
		if (!svg || !transform || !point) return;
		const cursor = svg.createSVGPoint(); cursor.x = event.clientX; cursor.y = event.clientY;
		const position = cursor.matrixTransform(transform.inverse());
		point.fx = position.x; point.fy = position.y;
		simulationRef.current?.alphaTarget(.2).restart();
	};
	const releaseNode = (id: string) => {
		const point = simulationRef.current?.nodes().find((item) => item.id === id);
		if (point) { point.fx = null; point.fy = null; }
		simulationRef.current?.alphaTarget(0);
	};
	const pan = (event: PointerEvent<SVGSVGElement>) => {
		const start = drag.current;
		if (!start) return;
		const x = event.clientX, y = event.clientY;
		setView((current) => ({ ...current, x: start.originX - (x - start.x) / current.scale, y: start.originY - (y - start.y) / current.scale }));
	};
	const fit = () => {
		const points = [...positions.values()];
		if (!points.length) return;
		const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
		const left = Math.min(...xs) - 30, top = Math.min(...ys) - 30;
		const graphWidth = Math.max(100, Math.max(...xs) - left + 30), graphHeight = Math.max(100, Math.max(...ys) - top + 30);
		const scale = Math.min(3, Math.max(.2, Math.min((width - (settings ? 260 : 0)) / graphWidth, height / graphHeight)));
		setView({ x: left, y: top, scale });
	};
	return <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#171717]" ref={canvas} aria-label="Memory graph">
		<svg ref={svgRef} className="h-full w-full touch-none" viewBox={`${view.x} ${view.y} ${width / view.scale} ${height / view.scale}`} tabIndex={0} aria-label="Memory graph canvas; use arrow keys to pan" onKeyDown={(event) => { const step = 40 / view.scale; if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); setView((v) => ({ ...v, x: v.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), y: v.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) })); } }} onPointerDown={(event) => { if (event.target === event.currentTarget) { drag.current = { x: event.clientX, y: event.clientY, originX: view.x, originY: view.y }; event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerMove={pan} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
			<defs><marker id="memory-arrow" viewBox="0 0 10 10" refX="12" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8e8e94" /></marker></defs>
			{visibleEdges.map((edge) => { const a = positions.get(edge.source), b = positions.get(edge.target); const highlighted = active && (edge.source === active || edge.target === active); return a && b ? <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={highlighted ? "#c4b5fd" : "#68686c"} strokeOpacity={active ? (highlighted ? .95 : .12) : .48} strokeWidth={highlighted ? lineSize * 1.5 : lineSize} markerEnd={directions ? "url(#memory-arrow)" : undefined} /> : null; })}
			{visible.map((node) => {
				const p = positions.get(node.id) ?? { x: width / 2, y: height / 2 };
				const radius = Math.min(12, (2.2 + Math.sqrt(degree.get(node.id) ?? 0)) * nodeSize);
				const color = groups.find((group) => groupMatches(node, group.query))?.color ?? "#aaaab0";
				const isActive = active === node.id;
				return <g key={node.id} role="button" tabIndex={0} aria-label={`${node.type}: ${node.label}`} className="cursor-pointer outline-none" opacity={active && !neighbors.has(node.id) ? .2 : 1}
					onPointerEnter={() => setHovered(node.id)} onPointerLeave={() => setHovered((id) => id === node.id ? null : id)} onFocus={() => setFocused(node.id)} onBlur={() => setFocused((id) => id === node.id ? null : id)}
					onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); moveNode(event, node.id); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveNode(event, node.id); }} onPointerUp={() => releaseNode(node.id)} onPointerCancel={() => releaseNode(node.id)} onClick={() => onSelect(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); } }}>
					<circle cx={p.x} cy={p.y} r={isActive ? radius * 1.4 : radius} fill={color} stroke={isActive || selected === node.id ? "white" : "none"} strokeWidth={isActive ? 2.5 : 2} />
					<circle cx={p.x} cy={p.y} r={Math.max(radius, 8 / view.scale)} fill="transparent" aria-hidden="true" />
					<title>{node.label}</title>
					{(view.scale >= textThreshold || selected === node.id || isActive) && <text x={p.x} y={p.y + radius + 13} textAnchor="middle" fill={isActive ? "#fff" : "#bbb"} fontSize={isActive ? 12 : 10} fontWeight={isActive ? 600 : 400} stroke="#171717" strokeWidth="3" paintOrder="stroke" pointerEvents="none">{node.label.length > (isActive ? 120 : 48) ? `${node.label.slice(0, isActive ? 119 : 47)}…` : node.label}</text>}
				</g>;
			})}
		</svg>
		<div className="absolute bottom-3 left-3 flex gap-1 rounded border border-[#3b3b3e] bg-[#242424] p-1 text-[#ccc]">{[[Minus, "Zoom out", () => setView((v) => ({ ...v, scale: Math.max(.2, v.scale / 1.2) }))], [Plus, "Zoom in", () => setView((v) => ({ ...v, scale: Math.min(5, v.scale * 1.2) }))], [Maximize2, "Fit graph", fit], [Settings2, "Graph settings", () => setSettings((v) => !v)]] .map(([Icon, label, action]) => { const Symbol = Icon as typeof Minus; return <button key={label as string} className="rounded p-1.5 hover:bg-[#383838]" aria-label={label as string} onClick={action as () => void}><Symbol size={15} /></button>; })}</div>
		{settings && <div role="region" aria-label="Graph settings" className="absolute right-3 top-3 max-h-[calc(100%-1.5rem)] w-60 overflow-y-auto rounded-lg border border-[#39393c] bg-[#252525] text-[#dadada] shadow-xl">
			<details open className="border-b border-[#383838] p-3"><summary className="cursor-pointer text-xs font-semibold">Filters</summary><label className="mt-4 flex items-center justify-between text-xs">Orphan nodes<input aria-label="Orphan nodes" type="checkbox" checked={showOrphans} onChange={(event) => setShowOrphans(event.target.checked)} className="accent-violet-500" /></label></details>
			<details open className="border-b border-[#383838] p-3"><summary className="cursor-pointer text-xs font-semibold">Groups</summary><p className="mt-3 text-[10px] text-[#999]">Match label, type: or status:</p><div className="mt-2 space-y-1">{groups.map((group) => <div key={group.id} className="flex items-center gap-1"><input aria-label="Group query" className="min-w-0 flex-1 rounded border border-[#404043] bg-[#303033] px-2 py-1 text-xs" value={group.query} onChange={(event) => updateGroup(group.id, { query: event.target.value })} /><input aria-label="Group color" type="color" className="h-6 w-6 cursor-pointer border-0 bg-transparent" value={group.color} onChange={(event) => updateGroup(group.id, { color: event.target.value })} /><button aria-label="Remove group" className="px-1 text-[#aaa]" onClick={() => setGroups((all) => all.filter((item) => item.id !== group.id))}>×</button></div>)}</div><button className="mt-2 w-full rounded border border-[#444] bg-[#333] py-1 text-xs" onClick={() => setGroups((all) => [...all, { id: `${Date.now()}-${all.length}`, query: "", color: "#ffca55" }])}>New group</button></details>
			<details open className="border-b border-[#383838] p-3"><summary className="cursor-pointer text-xs font-semibold">Display</summary><label className="mt-3 flex items-center justify-between text-xs">Arrows<input aria-label="Arrows" type="checkbox" checked={directions} onChange={(event) => setDirections(event.target.checked)} className="accent-violet-500" /></label><Slider label="Text fade threshold" value={textThreshold} min={0.2} max={4} step={0.1} onChange={setTextThreshold} /><Slider label="Node size" value={nodeSize} min={0.4} max={3} step={0.05} onChange={setNodeSize} /><Slider label="Line thickness" value={lineSize} min={0.1} max={3} step={0.05} onChange={setLineSize} /><button className="mt-2 w-full rounded border border-[#444] bg-[#333] py-1 text-xs" onClick={() => setAnimation((v) => v + 1)}>Start animation</button></details>
			<details open className="p-3"><summary className="cursor-pointer text-xs font-semibold">Forces</summary><Slider label="Center force" value={attraction} min={0} max={1} step={0.05} onChange={setAttraction} /><Slider label="Repulsion" value={repulsion} min={0} max={300} step={1} onChange={setRepulsion} /><Slider label="Link force" value={linkStrength} min={0} max={1} step={0.05} onChange={setLinkStrength} /><Slider label="Link distance" value={distance} min={10} max={200} step={1} onChange={setDistance} /></details>
		</div>}
	</div>;
}
