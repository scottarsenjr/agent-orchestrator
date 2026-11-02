import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryGraph } from "./MemoryGraph";

afterEach(() => localStorage.clear());

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
