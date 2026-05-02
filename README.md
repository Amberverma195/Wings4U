# Wings4U Platform

Wings4U is a full-stack restaurant ordering and operations platform built for a chicken wing shop. It supports customer ordering, menu customization, checkout, store staff tools, a Kitchen Display System (KDS), Point of Sale (POS), realtime order updates, customer support, discounts, rewards, and local print/cash-drawer workflows.

This repository is the monorepo for the Wings4U website, API, database schema, shared contracts, and operations tooling.

## What It Does

- Customer ordering for pickup and delivery
- Rich menu builders for wings, wing combos, lunch specials, wraps, burgers, sides, sauces, and item customizations
- Cart, checkout, tax, discounts, wallet/store credit, rewards, and order history
- Admin dashboard for menu, staff, promos, reviews, reports, settings, support, and order management
- KDS surface for kitchen and dispatch workflows
- POS surface for walk-in and phone orders using station-password access
- Realtime order updates over Socket.IO
- Store-network gated KDS/POS access
- Prisma-backed PostgreSQL database model and migrations
- Local print-agent workspace for receipts and cash drawer integration

## Tech Stack

- **Web:** Next.js, React, TypeScript
- **API:** NestJS, TypeScript
- **Database:** PostgreSQL with Prisma
- **Realtime:** Socket.IO
- **Monorepo:** npm workspaces

## Repository Structure

```text
apps/
  api/           NestJS API and realtime gateway
  web/           Next.js customer site, admin, KDS, and POS surfaces
  print-agent/   Local receipt printer and cash drawer agent

packages/
  database/      Prisma schema, migrations, seed/import scripts
  contracts/     Shared cross-app types and contracts
  pricing/       Shared pricing package

Docs/            Product, architecture, menu, schema, and audit notes
infra/           Local infrastructure files
ops/             Runbooks and operational notes
Cmds/            Local command notes
```

## Getting Started

Install dependencies from the repo root:

```bash
npm install
```

Copy and configure environment files:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

Generate Prisma client:

```bash
npm run db:generate
```

Run database migrations:

```bash
npm run db:migrate
```

Start the API and web app together:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:api
npm run dev:web
```

Default local ports:

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- Realtime gateway: `/ws`

## Useful Commands

```bash
npm run db:validate
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run build:api
npm run build:web
npm run test:e2e
npm run ci
```

## Core Surfaces

### Customer Site

Customers can browse the menu, customize items, place pickup or delivery orders, track orders, manage profiles and addresses, view order history, and contact support.

### Admin

Admins can manage menu items, categories, sauces, staff, promotions, settings, reviews, reports, order changes, support tickets, and operational configuration.

### KDS

The Kitchen Display System is a station-gated in-store surface. It shows active orders, supports kitchen status changes, cancellation requests, dispatch workflows, and realtime updates.

### POS

The Point of Sale is an in-store station surface for walk-in and phone orders. It uses the same menu builders as customer ordering, shares live menu data, sends orders to KDS, and listens for realtime order status changes.

## Notes

- KDS and POS access is hidden outside configured trusted store IP ranges.
- KDS and POS use station password sessions, separate from normal customer/admin login.
- The database schema and migrations live in `packages/database`.
- Product and implementation notes live in `Docs`.

## License

Private project. All rights reserved.
