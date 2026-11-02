import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryGraph } from "./MemoryGraph";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("zooms around the pointer even after panning", () => {
	const { container } = render(<MemoryGraph nodes={[]} edges={[]} selected={null} onSelect={() => {}} resetKey="zoom" />);
	const svg = container.querySelector("svg")!;
	vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 100, top: 50, width: 180, height: 300, right: 280, bottom: 350, x: 100, y: 50, toJSON: () => ({}) });
	fireEvent.keyDown(svg, { key: "ArrowRight" });
	const before = svg.getAttribute("viewBox")!.split(" ").map(Number);
	const cursor = { x: 45, y: 90 };
	const anchor = { x: before[0] + cursor.x * before[2] / 180, y: before[1] + cursor.y * before[3] / 300 };
	fireEvent.wheel(svg, { clientX: 145, clientY: 140, deltaY: -120 });
	const after = svg.getAttribute("viewBox")!.split(" ").map(Number);
	expect(after[2]).toBeLessThan(before[2]);
	expect(after[0] + cursor.x * after[2] / 180).toBeCloseTo(anchor.x);
	expect(after[1] + cursor.y * after[3] / 300).toBeCloseTo(anchor.y);
	fireEvent.wheel(svg, { clientX: 145, clientY: 140, deltaY: 120 });
	const restored = svg.getAttribute("viewBox")!.split(" ").map(Number);
	expect(restored[0]).toBeCloseTo(before[0]);
	expect(restored[1]).toBeCloseTo(before[1]);
	expect(restored[2]).toBeCloseTo(before[2]);
});

it("highlights the hovered node, its label and only its real neighbors", () => {
	const { container } = render(<MemoryGraph resetKey="hover" selected={null} onSelect={() => {}} nodes={[
		{ id: "a", type: "source", label: "A very long memory name that should remain fully visible on hover", status: null },
		{ id: "b", type: "entity", label: "Neighbor", status: null },
		{ id: "c", type: "entity", label: "Unrelated", status: null },
	]} edges={[{ id: "ab", source: "a", target: "b", type: "source_entity" }]} />);
	const node = screen.getByRole("button", { name: /source: A very long memory name/ });
	fireEvent.pointerEnter(node);
	expect(node.querySelector("text")?.textContent).toBe("A very long memory name that should remain fully visible on hover");
	expect(node.querySelector("circle")).toHaveAttribute("stroke", "white");
	expect(screen.getByRole("button", { name: "entity: Neighbor" })).toHaveAttribute("opacity", "1");
	expect(screen.getByRole("button", { name: "entity: Unrelated" })).toHaveAttribute("opacity", "0.2");
	expect(container.querySelector("line")).toHaveAttribute("stroke", "#c4b5fd");
	fireEvent.pointerLeave(node);
	expect(node.querySelector("text")).toBeNull();
	fireEvent.focus(node);
	expect(node.querySelector("text")).not.toBeNull();
	fireEvent.blur(node);
	expect(node.querySelector("text")).toBeNull();
});

it("keeps a queued pan safe when the pointer is released before React renders", () => {
	vi.stubGlobal("PointerEvent", MouseEvent);
	const { container } = render(<MemoryGraph nodes={[]} edges={[]} selected={null} onSelect={() => {}} resetKey="pan" />);
	const svg = container.querySelector("svg")!;
	Object.defineProperty(svg, "setPointerCapture", { value: vi.fn(), configurable: true });
	act(() => {
		fireEvent.pointerDown(svg, { clientX: 10, clientY: 20, pointerId: 1 });
		fireEvent.pointerMove(svg, { clientX: 40, clientY: 50, pointerId: 1 });
		fireEvent.pointerUp(svg, { pointerId: 1 });
	});
	expect(svg.getAttribute("viewBox")?.split(" ").slice(0, 2)).toEqual(["-30", "-30"]);
});

it("renders actual links, filters orphans, groups nodes and selects details", () => {
	const onSelect = vi.fn();
	render(<MemoryGraph resetKey="project" selected={null} onSelect={onSelect} nodes={[
		{ id: "a", type: "source", label: "Source", status: "accepted" },
		{ id: "b", type: "entity", label: "Entity", status: null },
		{ id: "c", type: "proposition", label: "Orphan", status: null },
	]} edges={[{ id: "ab", source: "a", target: "b", type: "source_entity" }]} />);
	const source = screen.getByRole("button", { name: "source: Source" });
	expect(source.querySelector("circle")).toHaveAttribute("fill", "#48bfea");
	fireEvent.click(source);
	expect(onSelect).toHaveBeenCalledWith("a");
	expect(screen.getByRole("button", { name: "proposition: Orphan" })).toBeInTheDocument();
	fireEvent.click(screen.getByRole("checkbox", { name: "Orphan nodes" }));
	expect(screen.queryByRole("button", { name: "proposition: Orphan" })).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("checkbox", { name: "Arrows" }));
	expect(document.querySelector('line[marker-end="url(#memory-arrow)"]')).toBeInTheDocument();
});

it("persists graph settings separately for each project", () => {
	const props = { nodes: [], edges: [], selected: null, onSelect: vi.fn(), resetKey: "x" };
	const view = render(<MemoryGraph {...props} project="one" />);
	fireEvent.click(screen.getByRole("checkbox", { name: "Orphan nodes" }));
	view.unmount();
	const other = render(<MemoryGraph {...props} project="two" />);
	expect(screen.getByRole("checkbox", { name: "Orphan nodes" })).toBeChecked();
	other.unmount();
	render(<MemoryGraph {...props} project="one" />);
	expect(screen.getByRole("checkbox", { name: "Orphan nodes" })).not.toBeChecked();
});
