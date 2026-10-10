# Project replacement

- [x] Import uploaded library application and assets, preserving the connected Supabase environment.
- [x] Check pages and automatic build results.
- [ ] Verify authenticated library actions (blocked: external Supabase session unavailable).

## Keep alive
- [x] Add a minimally privileged health check with durable hourly request limits.
- [x] Verify healthy responses, validation, throttling, and existing app availability.
- [ ] Activate the production monitoring URL (blocked: app must be published by the user).

## Documentation and database setup
- [x] Document ISBN lookup, spreadsheet imports, template fields, and import limitations.
- [x] Align the single-file setup with ISBN imports without changing the connected database.
