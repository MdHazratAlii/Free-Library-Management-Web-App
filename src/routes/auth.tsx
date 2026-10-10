import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/auth")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Sign in — Library Pro" }, { name: "description", content: "Sign in to your Library Pro librarian account to manage your library." }, { property: "og:title", content: "Sign in — Library Pro" }, { property: "og:description", content: "Sign in to your Library Pro librarian account to manage your library." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: () => null,
});