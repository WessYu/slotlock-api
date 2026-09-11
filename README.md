# SlotLock API

A reservation backend built around **concurrency, consistency, authentication, authorization, availability, and idempotent retries**.

SlotLock is not a CRUD demo. Its core problem is preventing overbooking under concurrent writes while enforcing user ownership and administrative boundaries.

![CI](https://github.com/WessYu/slotlock-api/actions/workflows/ci.yml/badge.svg)

## What it proves

The concurrency test sends **20 overlapping reservation requests simultaneously**.

```text
20 concurrent requests
├─ 1  -> 201 Created
├─ 19 -> 409 Conflict
└─ 0  -> overbookings
```

The final guarantee lives in PostgreSQL:

```sql
EXCLUDE USING gist (
  resource_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
)
WHERE (status = 'CONFIRMED');
```

## Stack

- Node.js + TypeScript
- Fastify
- PostgreSQL
- Prisma
- Zod
- Node.js `scrypt` + HMAC-SHA256
- Vitest
- Docker / Docker Compose

## Authentication

SlotLock uses:

- access tokens valid for 15 minutes;
- opaque refresh tokens valid for 30 days;
- refresh-token rotation and revocation;
- SHA-256 storage for refresh-token digests;
- Node.js `scrypt` with random salts for password hashing.

Registration always creates a `USER`. Public input cannot assign `ADMIN`.

Roles:

- `USER`: creates and accesses only its own reservations;
- `ADMIN`: sees all reservations and manages resources.

## API

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | Public | API + database health |
| `POST` | `/v1/auth/register` | Public | Create account |
| `POST` | `/v1/auth/login` | Public | Start session |
| `POST` | `/v1/auth/refresh` | Public | Rotate refresh token |
| `POST` | `/v1/auth/logout` | Public | Revoke refresh token |
| `GET` | `/v1/auth/me` | Authenticated | Current identity |
| `GET` | `/v1/resources` | Public | List resources |
| `POST` | `/v1/resources` | ADMIN | Create resource |
| `PATCH` | `/v1/resources/:id` | ADMIN | Update resource |
| `GET` | `/v1/resources/:id/availability` | Public | Availability slots |
| `GET` | `/v1/reservations` | Authenticated | Own reservations; ADMIN sees all |
| `POST` | `/v1/reservations` | Authenticated | Create own reservation |
| `GET` | `/v1/reservations/:id` | Owner / ADMIN | Read reservation |
| `DELETE` | `/v1/reservations/:id` | Owner / ADMIN | Cancel reservation |

### Register

```bash
curl -X POST http://localhost:3333/v1/auth/register \
  -H "content-type: application/json" \
  -d '{
    "name": "Wess",
    "email": "wess@example.com",
    "password": "a-long-development-password"
  }'
```

### Create a reservation

The API derives `userId` and `customerEmail` from the authenticated account instead of trusting identity fields in the request body.

```bash
curl -X POST http://localhost:3333/v1/reservations \
  -H "authorization: Bearer ACCESS_TOKEN" \
  -H "content-type: application/json" \
  -H "idempotency-key: demo-001-unique" \
  -d '{
    "resourceId": "RESOURCE_UUID",
    "startsAt": "2026-10-01T14:00:00Z",
    "endsAt": "2026-10-01T15:00:00Z"
  }'
```

A reused idempotency key must belong to the same user and describe the same reservation. Otherwise the API returns `409 IDEMPOTENCY_KEY_REUSED`.

### Availability

```bash
curl "http://localhost:3333/v1/resources/RESOURCE_UUID/availability?from=2026-10-20T09%3A00%3A00-03%3A00&to=2026-10-20T12%3A00%3A00-03%3A00&slotMinutes=60"
```

Availability uses explicit timezone offsets, bounded windows, UTC-normalized output, and the same `[start,end)` interval semantics as the database constraint.

Availability is informative, not a lock. PostgreSQL remains the final source of truth during reservation creation.

## Running locally

```bash
cp .env.example .env
npm ci
npm run prisma:generate
npm run prisma:deploy
npm test
npm run dev
```

Example environment:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/slotlock?schema=public"
JWT_SECRET="use-a-random-secret-of-at-least-32-bytes"
PORT=3333
HOST=0.0.0.0
```

With Docker available, PostgreSQL can be started with:

```bash
docker compose up -d
```

## Engineering decisions

**Database-enforced concurrency**  
PostgreSQL owns the no-overlap invariant through an exclusion constraint.

**Authenticated ownership**  
Reservation ownership comes from the verified access token. Clients cannot choose another `userId` or `customerEmail`.

**Current-role authorization**  
After verifying an access token, protected requests resolve the user from PostgreSQL. Role changes therefore take effect without waiting for the token to expire.

**Refresh-token rotation**  
Refresh sessions are revocable and rotated with a conditional database update, preventing the same token from successfully rotating twice.

**Non-destructive cancellation**  
Cancellation changes status to `CANCELLED`, preserving history while releasing the interval.

## Tests

The integration suite covers:

- 20-request concurrent booking contention;
- availability boundaries and timezone handling;
- unauthenticated access rejection;
- USER vs ADMIN permissions;
- reservation ownership;
- ADMIN access to another user's reservation;
- refresh-token rotation and replay rejection;
- cross-user idempotency-key reuse protection.

## Roadmap

- [x] PostgreSQL overlap constraint
- [x] Idempotency
- [x] Cancellation
- [x] Concurrency test
- [x] Availability
- [x] Authentication + RBAC
- [x] Refresh-token rotation
- [x] Reservation ownership
- [x] CI with PostgreSQL
- [ ] Rescheduling
- [ ] Redis-backed distributed rate limiting and availability cache
- [ ] Transactional outbox + workers
- [ ] OpenAPI
- [ ] Structured observability

---

Built as a backend engineering project focused on correctness under contention.
