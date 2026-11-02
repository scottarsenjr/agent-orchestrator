import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";
import { createFullAppI18n } from "../i18n/all-messages";
import { MemoryView } from "./MemoryView";

vi.mock("../lib/api-client", () => ({ getApiBaseUrl: () => "http://localhost", apiClient: { GET: async (path: string) => path.endsWith("projects") ? { data: { projects: [{ id: "p", name: "Project", path: "/project" }] } } : { data: { sessions: [] } } } }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("shows stored link type and direction in selected details", async () => {
	const graph = { visibility_token: "v1", context: { branch: "main", dirty: false }, nodes: [
		{ id: "source", type: "source", label: "Example source", content: "Source detail", status: "accepted", provenance: {} },
		{ id: "entity", type: "entity", label: "Related entity", content: "Entity detail", status: null, provenance: {} },
	], edges: [{ id: "link", source: "source", target: "entity", type: "source_entity" }], counts: { visible: 2, returned: 2 }, truncated: false, empty_reason: null, errors: [] };
	vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => graph })));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(<QueryClientProvider client={client}><MemoryView /></QueryClientProvider>);
	await userEvent.setup().click(await screen.findByRole("button", { name: "source: Example source" }));
	const links = within(screen.getByRole("complementary", { name: "Memory details" })).getByRole("region", { name: "Stored memory links" });
	expect(within(links).getByText("source entity")).toBeInTheDocument();
	expect(within(links).getByText("→")).toBeVisible();
	expect(links.textContent).toContain("Example source");
	expect(links.textContent).toContain("Related entity");
});

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

it.each(["in-band", "transport"] as const)("clears stale memory after a same-token %s error and refetches on recovery", async (failure) => {
	const graph = { visibility_token: "same", context: { branch: "main", dirty: false }, nodes: [{ id: "n", type: "source", label: "Example source", content: "Private detail", status: "accepted", provenance: {} }], edges: [], counts: { visible: 1, returned: 1 }, truncated: false, empty_reason: null, errors: [] };
	const fetchMock = vi.fn(async (_url: string) => {
		switch (fetchMock.mock.calls.length) {
			case 1: return { ok: true, json: async () => graph };
			case 2:
				if (failure === "transport") throw new Error("network outage");
				return { ok: true, json: async () => ({ visibility_token: "same", errors: ["read failed"] }) };
			case 3: return { ok: true, json: async () => ({ visibility_token: "same", errors: [] }) };
			case 4: return { ok: true, json: async () => graph };
			default: throw new Error("unexpected graph request");
		}
	});
	vi.stubGlobal("fetch", fetchMock);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(<QueryClientProvider client={client}><MemoryView /></QueryClientProvider>);
	await userEvent.setup().click(await screen.findByRole("button", { name: "source: Example source" }));
	expect(screen.getByText("Private detail")).toBeInTheDocument();
	fireEvent(document, new Event("visibilitychange"));
	const alert = await screen.findByRole("alert");
	expect(alert).toHaveTextContent(failure === "transport" ? "network outage" : "Memory provider could not read this workspace.");
	expect(screen.queryByText("Private detail")).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "source: Example source" })).not.toBeInTheDocument();
	fireEvent(document, new Event("visibilitychange"));
	expect(await screen.findByRole("button", { name: "source: Example source" })).toBeInTheDocument();
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	expect(screen.queryByText("Private detail")).not.toBeInTheDocument();
	expect(fetchMock).toHaveBeenCalledTimes(4);
});

it("shows translated known status and readable unknown status in details", async () => {
	const i18n = createFullAppI18n("fr");
	const graph = { visibility_token: "v1", context: { branch: "main", dirty: false }, nodes: [
		{ id: "known", type: "proposition", label: "Implemented claim", content: "Known detail", status: "implemented_in_branch", provenance: {} },
		{ id: "unknown", type: "proposition", label: "Future claim", content: "Future detail", status: "future_status", provenance: {} },
	], edges: [], counts: { visible: 2, returned: 2 }, truncated: false, empty_reason: null, errors: [] };
	vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => graph })));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}><MemoryView /></QueryClientProvider></I18nextProvider>);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "proposition: Implemented claim" }));
	const details = screen.getByRole("complementary");
	expect(within(details).getByText(i18n.t("memory.implementedInBranch"))).toBeInTheDocument();
	expect(within(details).queryByText("implemented_in_branch")).not.toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "proposition: Future claim" }));
	expect(within(details).getByText("future status")).toBeInTheDocument();
});
