import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MemoryView } from "../components/MemoryView";

export const Route = createFileRoute("/_shell/memory")({
	validateSearch: (search: Record<string, unknown>): { project?: string } => ({
		project: typeof search.project === "string" && search.project ? search.project : undefined,
	}),
	component: MemoryRoute,
});

function MemoryRoute() {
	const { project } = Route.useSearch();
	const navigate = useNavigate();
	return <MemoryView key={project ?? "default"} initialProject={project} onProjectChange={(id) => {
		void navigate({ to: "/memory", search: { project: id }, replace: true });
	}} />;
}
