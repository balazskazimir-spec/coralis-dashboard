# Coralis Dashboard

Current app version: `0.3.0`

Coralis is a role-based villa operations and portfolio platform with dedicated views for:
- `admin / CEO`
- `staff / operations`
- `investor`

## Local Development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Release Tracking

Use these files as the source of truth:
- [CHANGELOG.md](./CHANGELOG.md): product and engineering changes by version
- [package.json](./package.json): current app version

Recommended release flow:
1. Add finished work to `CHANGELOG.md`
2. Bump the version in `package.json`
3. Keep related deploy/schema notes in the same release entry

Versioning rule:
- Use neutral release labels such as `v0.3.0`, `v0.3.1`, `v0.4.0`
- Do not use personal names in release naming
- For any meaningful feature or shipped fix, update both the version and the changelog entry

## Supabase Schemas

The project uses SQL schema files in [`supabase`](./supabase):
- `message_inbox_schema.sql`
- `staff_ops_schema.sql`
- `staff_expenses_schema.sql`
- `invoices_schema.sql`

Run these in the Supabase SQL Editor when a feature requires new tables.
