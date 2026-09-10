# SlotLock API

A reservation backend designed around **concurrency, consistency, availability, and idempotent retries**.

SlotLock is not a CRUD demo. Its core problem is preventing overbooking when multiple clients attempt to reserve the same resource at the same time while still exposing a predictable availability API.

![CI](https://github.com/WessYu/slotlock-api/actions/workflows/ci.yml/badge.svg)

## What it proves

The concurrency test sends **20 overlapping reservation requests simultaneously**.

```text
20 concurrent requests
├─ 1  -> 201 Created
├─ 19 -> 409 Conflict
└─ 0  -> overbookings
```

The final guarantee lives in PostgreSQL, not in an application-level "check then insert" flow.

```sql
EXCLUDE USING gist (
  resource_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
)
WHERE (status = 'CONFIRMED');
```

That database constraint prevents two confirmed reservations from overlapping for the same resource, including under concurrent writes.

## Stack

- Node.js + TypeScript
- Fastify
- PostgreSQL
- Prisma
- Zod
- Vitest
- Docker / Docker Compose

## Request flow

```text
Client
  -> Fastify
  -> Zod validation
  -> Serializable transaction
  -> Prisma
  -> PostgreSQL exclusion constraint
```

Reservation creation also requires an `Idempotency-Key`. Repeating a successful request with the same key returns the existing reservation instead of creating another row.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | API + database health check |
| `GET` | `/v1/resources` | List reservable resources |
| `GET` | `/v1/resources/:id/availability` | Generate availability slots for a bounded interval |
| `POST` | `/v1/reservations` | Create a reservation |
| `GET` | `/v1/reservations/:id` | Get a reservation |
| `DELETE` | `/v1/reservations/:id` | Cancel a reservation |

### Check availability

Availability accepts an explicit time interval instead of assuming the server's local timezone.

```bash
curl "http://localhost:3333/v1/resources/RESOURCE_UUID/availability?from=2026-10-20T09%3A00%3A00-03%3A00&to=2026-10-20T12%3A00%3A00-03%3A00&slotMinutes=60"
```

Example response:

```json
{
  "resource": {
    "id": "RESOURCE_UUID",
    "name": "Sala Alpha",
    "slug": "sala-alpha"
  },
  "window": {
    "from": "2026-10-20T12:00:00.000Z",
    "to": "2026-10-20T15:00:00.000Z",
    "slotMinutes": 60,
    "normalizedTo": "UTC",
    "intervalSemantics": "[start,end)"
  },
  "summary": {
    "totalSlots": 3,
    "availableSlots": 2,
    "unavailableSlots": 1
  },
  "slots": [
    {
      "startsAt": "2026-10-20T12:00:00.000Z",
      "endsAt": "2026-10-20T13:00:00.000Z",
      "available": true
    }
  ]
}
```

Rules:

- `from` and `to` must include `Z` or an explicit offset such as `-03:00`;
- `slotMinutes` defaults to `60` and accepts values from `15` to `240`;
- the window is limited to 7 days;
- the window must be evenly divisible by `slotMinutes`;
- only `CONFIRMED` reservations block availability;
- interval semantics are half-open: `[start, end)`, matching the database constraint;
- output timestamps are normalized to UTC.

The availability endpoint is informative, not a locking mechanism. The PostgreSQL exclusion constraint remains the source of truth when a reservation is created, so a slot becoming occupied between the availability check and the booking request cannot produce overbooking.

### Create a reservation

```bash
curl -X POST http://localhost:3333/v1/reservations \
  -H "content-type: application/json" \
  -H "idempotency-key: demo-001-unique" \
  -d '{
    "resourceId": "RESOURCE_UUID",
    "customerEmail": "wess@example.com",
    "startsAt": "2026-10-01T14:00:00Z",
    "endsAt": "2026-10-01T15:00:00Z"
  }'
```

An overlapping reservation for the same resource returns:

```json
{
  "error": "RESERVATION_CONFLICT",
  "message": "This resource is already reserved for part of the requested interval."
}
```

## Running locally

### Option 1 — Docker

```bash
cp .env.example .env
docker compose up -d
npm ci
npm run prisma:generate
npm run prisma:deploy
npm test
npm run dev
```

### Option 2 — Existing PostgreSQL

Create a `slotlock` database and point `DATABASE_URL` at it:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/slotlock?schema=public"
PORT=3333
HOST=0.0.0.0
```

Then:

```bash
npm ci
npm run prisma:generate
npm run prisma:deploy
npm test
npm run dev
```

The API runs at `http://localhost:3333`.

The initial migration seeds two resources: `sala-alpha` and `sala-beta`.

## Useful scripts

```bash
npm run dev
npm run build
npm test
npm run check
npm run prisma:generate
npm run prisma:migrate
npm run prisma:deploy
```

## Engineering decisions

**Database-enforced concurrency**  
The API does not rely on a pre-insert availability query as its final protection. PostgreSQL owns the overlap invariant.

**Availability without timezone ambiguity**  
Clients must send absolute instants with `Z` or an explicit UTC offset. Slot output is normalized to UTC and uses the same half-open interval semantics as PostgreSQL.

**Serializable reservation transaction**  
Resource validation and reservation creation execute inside a serializable Prisma transaction.

**Idempotent retries**  
A unique idempotency key prevents duplicate reservations caused by client retries. Payload fingerprint validation is planned as an additional hardening step.

**Cancellation instead of destructive deletion**  
`DELETE /v1/reservations/:id` changes the reservation status to `CANCELLED`, preserving the record while releasing the time interval.

## CI

GitHub Actions starts a real PostgreSQL service, applies the Prisma migration, compiles the TypeScript project, and runs the concurrency and availability tests on every push and pull request.

## Roadmap

- [x] PostgreSQL overlap constraint
- [x] Idempotency key
- [x] Cancellation flow
- [x] 20-request concurrency test
- [x] CI with PostgreSQL
- [x] Availability endpoint with explicit timezone handling
- [ ] Authentication + RBAC
- [ ] Rescheduling flow
- [ ] Redis-backed distributed rate limiting and availability cache
- [ ] Transactional outbox + workers for webhooks/notifications
- [ ] OpenAPI documentation
- [ ] Structured observability

---

Built as a backend engineering project focused on correctness under contention.
