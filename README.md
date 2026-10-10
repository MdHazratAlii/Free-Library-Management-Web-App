# Library Pro

A modern, offline-capable, **open-source** Library Management System built with
React 19, TanStack Start, and Supabase. Manage books, categories, students,
issues, overdue tracking, and fines — all from a single admin dashboard with
export to PDF/XLSX, PWA support, and role-based access control.

Runs anywhere you can host a TanStack Start app — first-class support for
**Cloudflare Workers / Pages** + **Supabase**. No vendor lock-in.

## One-Click Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FYOUR-GITHUB-USER%2FYOUR-REPO)

Replace `YOUR-GITHUB-USER/YOUR-REPO` with your fork's path. After deploying:

1. Run `supabase/setup.sql` in your Supabase project (see [Database Setup](#database-setup)).
2. Add the [environment variables](#environment-variables) in Cloudflare.

## Features

- Admin-only dashboard with role-based access control (RLS-enforced)
- CRUD for Books, Categories, Students, Issues, and Fines
- Automatic book details by ISBN (Open Library first, Google Books fallback; no API key needed)
- Bulk book import from pasted ISBNs, Excel (`.xlsx` / `.xls`), or CSV, with a downloadable template
- Import preview, per-row progress, quantity adjustment, and automatic creation of missing categories
- Global search, per-table filters, pagination
- Student profile view with full borrow history
- Cover / profile image upload with automatic WebP compression to Supabase Storage (private bucket, signed URLs)
- Configurable institute/library settings (name, logo, address, fine rate, max issues)
- Export to PDF and XLSX (single-table and full report)
- Progressive Web App with offline caching (never caches authenticated API responses)
- Rate-limited keep-alive endpoint (`/api/public/health`) for UptimeRobot
- Multi-language UI, responsive with a mobile-friendly sidebar

## ISBN Lookup and Bulk Book Import

### Add or edit one book

1. Open **Books → Add Book** (or edit an existing book).
2. Enter an ISBN-10 or ISBN-13 and click **Fetch**, or press Enter in the ISBN field.
3. Review the title, author, publication year, cover, and matching existing category before saving.

Lookup uses Open Library first and falls back to Google Books when needed. It runs
in your browser and needs internet access, but no API key or additional Supabase
function. Some books have incomplete metadata or no match; enter those details
manually. A barcode scanner that types into the ISBN field can be used; there is
no built-in camera scanner.

### Import multiple books

1. Open **Books → Import (ISBN / Excel)**.
2. Paste ISBNs separated by newlines, commas, or semicolons, then click **Add ISBNs**;
   or upload an Excel/CSV file. Only the first worksheet is read.
3. Use **Download template** for the expected column names.
4. Click **Fetch details by ISBN** to look up missing details.
5. Review the preview, adjust quantities, remove unwanted rows, then click **Save**.

| Column | Purpose |
| --- | --- |
| `Title` | Required to save a row; can be supplied by ISBN lookup |
| `Author` | Optional author name(s) |
| `ISBN` | ISBN-10 or ISBN-13; keep spreadsheet cells as text to preserve leading zeros |
| `Category` | Matches an existing name case-insensitively, or creates a new category when saving |
| `Year` | Publication year; defaults to 2024 when omitted |
| `Quantity` | Number of copies; defaults to 1, with a minimum of 1 |
| `Cover_URL` | Optional extra column for an external cover image URL |

Rows without a title or ISBN are skipped. Rows still missing a title after lookup
are not saved. Imports add new records and do not deduplicate by ISBN or update
existing books. Each row is saved separately, so a partial import is possible;
check the row statuses before retrying. Imported copies initially have their full
quantity available. ISBN lookup covers remain external URLs; uploaded images use
the private Supabase bucket. The new import controls are currently English-only.

## Tech Stack

- React 19 + TypeScript
- TanStack Start (SSR) + TanStack Router + TanStack Query
- Supabase (Postgres, Auth, Storage, RLS)
- Tailwind CSS v4
- Recharts, jsPDF, SheetJS (xlsx)
- Vite + vite-plugin-pwa
- Cloudflare Workers runtime

## Prerequisites

- Node.js 20+ and [Bun](https://bun.sh) (or npm/pnpm)
- A free [Supabase](https://supabase.com) project
- A free [Cloudflare](https://dash.cloudflare.com) account (for hosting)
- [Supabase CLI](https://supabase.com/docs/guides/cli) — optional

## Installation

```bash
git clone https://github.com/YOUR-GITHUB-USER/YOUR-REPO.git
cd YOUR-REPO
bun install     # or: npm install
```

## Environment Variables

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Supabase project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable / anon key — safe for the browser |
| `SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PROJECT_ID` | Project ref (subdomain of your Supabase URL) |

`VITE_*` values are baked in at build time, so they **must be present when you build**
(locally or in Cloudflare's build settings). The non-`VITE_` values are read by the server at runtime.

> Never commit or use a `service_role` key. This app only needs the publishable/anon key;
> all access control is enforced by Postgres RLS.

## Create a Supabase Project

1. Create a project at [supabase.com](https://supabase.com).
2. **Project Settings → API**: copy the **Project URL** and **anon / publishable key** into `.env`.
3. **Authentication → Providers**: enable **Email**. (Email confirmation can be off during development.)
4. Recommended: **Authentication → Settings → Leaked password protection** ON (Pro plan).

## Database Setup

### Option A — one SQL command (recommended)

Open **SQL Editor → New query**, paste the whole of [`supabase/setup.sql`](supabase/setup.sql), click **Run**.

It creates everything in one go and is safe to re-run:

- Tables: `categories`, `books`, `students`, `book_issues`, `fines`, `user_roles`, `health_check_limits`
- Enum `app_role`, all GRANTs, RLS on every table, admin-only policies
- Functions: `has_role`, `has_any_admin`, `bootstrap_admin`, `check_keep_alive`
- Private storage bucket `library-images` + admin-only storage policy

The same `books` and `categories` tables support manual entry, ISBN lookup, and
spreadsheet imports. No extra import tables, API keys, or database functions are
required. Re-running the script preserves library rows; it does not insert sample
books or deduplicate imports. Review and back up an existing database before
applying schema changes.

### Option B — Supabase CLI

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/setup.sql
```

Set `SUPABASE_DB_URL` locally to your Supabase database connection string from
**Connect**; it is a private credential used only for setup, never a browser or
Cloudflare application variable. Alternatively, use the SQL Editor above.

### First admin user

No account is seeded as admin.

1. Open the app and sign up with the librarian email.
2. The app calls `public.bootstrap_admin()`, which grants `admin` to the **first** user only.
   Later sign-ups get no role until an admin grants one:

```sql
insert into public.user_roles (user_id, role)
values ('<user-uuid>', 'admin');
```

### Storage

| Bucket | Public | Purpose |
| --- | --- | --- |
| `library-images` | No (private) | Book covers, student photos, avatar, library logo. Read via signed URLs. |

Policy: **Admins manage library-images** — only signed-in users with the `admin` role
can read, upload, update or delete files. There is no public read access.

### Verify

```bash
bun run verify:supabase
```

This is a preliminary checker, not proof of a complete setup. It currently uses
anonymous table reads and attempted empty inserts; the intentionally auth-only
table grants in `setup.sql` mean it can report permission failures for a correctly
secured project. Private bucket checks and RPC checks are also limited without a
session. Do not grant anonymous table access to make it pass. Verify by signing
in as an admin, adding a book, importing a small template, and uploading an image.

## Running Locally

```bash
bun run dev       # http://localhost:8080
bun run test      # unit tests
```

## Deploy to Cloudflare

The production build targets the Cloudflare Workers runtime.

### Cloudflare Workers (recommended)

```bash
bun run build
npx nitro deploy --prebuilt   # deploys dist/ via Wrangler
```

Or connect your GitHub repo under **Workers & Pages → Create → Import a repository**:

- Build command: `bun run build`
- Deploy command: `npx nitro deploy --prebuilt`
- Add all six variables from the table above under **Settings → Variables**
  (for both build and runtime).

### Cloudflare Pages

This repository currently targets **Cloudflare Workers**, including SSR and the
health endpoint. A static-only Pages upload will not run those server features.
Using Pages requires a compatible Pages server adapter and its generated output;
do not assume the Workers output can be uploaded as a static Pages site. The
Workers commands above are the configured deployment path.

## Keep-Alive / Health Check (UptimeRobot)

Free Supabase projects pause after inactivity. Point UptimeRobot at:

```
https://YOUR-DOMAIN/api/public/health
```

- Monitor type: **HTTP(s)**, method **GET**, interval **15 minutes**, expect **200**
- Response: `{"status":"ok","message":"Supabase is alive"}`
- Read-only for library data; uses only the publishable key; GET only, no query
  params; security headers; 10 checks/hour then a 1-hour block (`429`).

## Project Structure

```
src/
  routes/                    file-based routes (TanStack Router)
    __root.tsx               app shell + head metadata
    index.tsx                entry (Auth or Dashboard)
    auth.tsx                 sign-in / bootstrap admin
    _authenticated/          admin-only dashboard
    api/public/health.ts     keep-alive endpoint
  integrations/supabase/     Supabase clients + types
  lib/                       utilities (ISBN lookup, image upload, settings, i18n, health check, exports)
  components/                UI components
  styles.css                 design tokens + styles
scripts/
  verify-supabase.mjs        setup checker
supabase/
  setup.sql                  complete database setup (single file)
  migrations/                incremental migrations
  config.toml                Supabase CLI config (set your project_id)
```

## Security Notes

- Admin rights come only from `public.user_roles` checked by RLS — never from browser storage.
- No service-role key is used anywhere in the app.
- Storage is private; images are served through signed URLs.

## Contributing

PRs welcome. Please run `bun run test` and `bun run build` before submitting.

## License

[MIT](LICENSE)
