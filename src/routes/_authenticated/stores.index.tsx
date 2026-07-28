import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/stores/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
