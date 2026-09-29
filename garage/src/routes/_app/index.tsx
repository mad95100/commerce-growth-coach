import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard/Dashboard.tsx";

export const Route = createFileRoute("/_app/")({ component: Dashboard });
