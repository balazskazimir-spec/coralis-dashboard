# Changelog

All notable changes to this project should be tracked here.

This file follows a lightweight Keep a Changelog style.

## [0.3.0] - 2026-03-27

### Added
- Management fee workspace for CEO and investor with per-villa configuration and monthly fee history.
- Investor villa hero media for `Villa Mira` and `Villa Serra`.
- Release metadata surfaced in the app shell with version and release date.

### Changed
- Investor dashboard redesigned with a cleaner hero, better KPI hierarchy, annualized YTD framing, and improved health/performance storytelling.
- Investor villa detail redesigned for a more unified premium look with currency switching and cleaner KPI presentation.
- Investor revenue allocation and net performance sections reworked for a clearer, more technical visual style.
- Release tracking now follows version-first naming using neutral semantic versions rather than personal naming.

### Fixed
- Investor dashboard YTD KPI logic now aligns annualized ROI with annualized revenue, fee, and net profit figures.
- Investor villa YTD math now uses only in-range nights up to today and no longer leaks future stay revenue into current-period KPIs.
- Occupancy and compact IDR formatting corrected on investor villa pages.
- Hero layout and spacing issues across investor views that caused overlap, empty zones, and unstable composition.

## [0.2.0] - 2026-03-27

### Added
- Role-based product structure for `admin`, `staff`, and `investor`.
- Dedicated CEO/admin dashboard with portfolio KPIs, charts, villa performance, alerts, and operational visibility.
- Dedicated staff dashboard with timeline, inbox, tasks, issues, assigned villas, and operational expense workflow.
- Unified inbox with thread statuses, quick replies, context panel, and Supabase-backed message persistence.
- Supabase-backed staff operations system for tasks and issues.
- Investor invoices area with downloadable invoice statements and PDF/HTML/CSV export.
- Supabase-backed invoice engine with:
  - invoice threshold config
  - auto-issued invoices from accumulated expenses
  - manual invoice creation by admin/staff
  - investor read-only invoice access

### Changed
- Demo data updated to more realistic Lombok 2026 operating assumptions and IDR pricing.
- Expenses analytics redesigned for executive use with revenue context and improved visual hierarchy.
- Sidebar navigation split more clearly by role.
- Local and production data loading stabilized for dashboard and operational pages.

### Fixed
- Multiple hydration, rerender, and realtime loop issues across dashboard, inbox, staff, and expenses pages.
- Broken chart aggregation and category handling in admin expenses analytics.
- Invoice UI warnings caused by shorthand/non-shorthand style conflicts.
- Schema-safe Supabase selects for production compatibility.

## [0.1.0] - 2026-03-26

### Added
- Initial Coralis dashboard foundation with villas, bookings, expenses, and base analytics.
