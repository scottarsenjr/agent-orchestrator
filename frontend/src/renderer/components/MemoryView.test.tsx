import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryView } from "./MemoryView";

vi.mock("../lib/api-client", () => ({ getApiBaseUrl: () => "http://localhost", apiClient: { GET: async (path: string) => path.endsWith("projects") ? { data: { projects: [{ id: "p", name: "Project", path: "/project" }] } } : { data: { sessions: [] } } } }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("clears selected details when search changes and shows no matches", async () => {
	const graph = { visibility_token: "v1", context: { branch: "main", dirty: false }, nodes: [{ id: "n", type: "source", label: "Example source", content: "Private detail", status: "accepted", provenance: {} }], edges: [], counts: { visible: 1, returned: 1 }, truncated: false, empty_reason: null, errors: [] };
	vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("query=") ? { ...graph, nodes: [], counts: { visible: 0, returned: 0 }, empty_reason: "no_matches" } : graph })));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(<QueryClientProvider client={client}><MemoryView /></QueryClientProvider>);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "source: Example source" }));
	expect(screen.getByText("Private detail")).toBeInTheDocument();
	await user.type(screen.getByRole("textbox", { name: "Search memory" }), "missing");
	await waitFor(() => expect(screen.queryByText("Private detail")).not.toBeInTheDocument());
	expect(await screen.findByText("No memory matches these filters.")).toBeInTheDocument();
	expect(screen.getByText("0 nodes · main")).toBeInTheDocument();
});

it("refreshes on visible context change and clears a hidden selected node", async () => {
	let visibility: DocumentVisibilityState = "visible";
	vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
	const graph = { visibility_token: "old", context: { branch: "main", dirty: false }, nodes: [{ id: "n", type: "source", label: "Example source", content: "Old detail", status: "proposed", provenance: {} }], edges: [], counts: { visible: 1, returned: 1 }, truncated: false, empty_reason: null, errors: [] };
	const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("metadataOnly") ? { visibility_token: "new" } : fetchMock.mock.calls.length === 1 ? graph : { ...graph, visibility_token: "new", context: { branch: "other", dirty: false }, nodes: [], counts: { visible: 0, returned: 0 }, empty_reason: "no_visible_memory" } }));
	vi.stubGlobal("fetch", fetchMock);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(<QueryClientProvider client={client}><MemoryView /></QueryClientProvider>);
	await userEvent.setup().click(await screen.findByRole("button", { name: "source: Example source" }));
	expect(screen.getByText("Old detail")).toBeInTheDocument();
	visibility = "hidden";
	fireEvent(document, new Event("visibilitychange"));
	expect(fetchMock).toHaveBeenCalledTimes(1);
	visibility = "visible";
	fireEvent(document, new Event("visibilitychange"));
	await waitFor(() => expect(screen.queryByText("Old detail")).not.toBeInTheDocument());
	expect(await screen.findByText("No visible memory in this workspace.")).toBeInTheDocument();
	expect(screen.getByText("0 nodes · other")).toBeInTheDocument();
	expect(fetchMock).toHaveBeenCalledTimes(3);
});
