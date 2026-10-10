import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Library dashboard — Library Pro" }, { name: "description", content: "View library books, students, borrowing activity, and fines." }, { property: "og:title", content: "Library dashboard — Library Pro" }, { property: "og:description", content: "View library books, students, borrowing activity, and fines." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: () => null,
});