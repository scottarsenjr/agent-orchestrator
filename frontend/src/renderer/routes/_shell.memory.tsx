import { createFileRoute } from "@tanstack/react-router";
import { MemoryView } from "../components/MemoryView";

export const Route = createFileRoute("/_shell/memory")({ component: MemoryView });
