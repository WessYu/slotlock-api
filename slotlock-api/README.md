# SlotLock API

Backend de reservas focado em consistência, concorrência e idempotência.

## Stack

- Node.js + TypeScript
- Fastify
- PostgreSQL
- Prisma
- Docker Compose
- Zod

## Diferencial técnico

A proteção contra overbooking não depende de um simples `SELECT` antes do `INSERT`.
O PostgreSQL possui uma `EXCLUDE CONSTRAINT` com `tstzrange`, tornando impossível
persistir duas reservas `CONFIRMED` que se sobreponham para o mesmo recurso, mesmo
quando duas requisições chegam ao mesmo tempo.

A criação também exige `Idempotency-Key`, então retries do cliente não geram reservas duplicadas.

## Rodando

```bash
cp .env.example .env
docker compose up -d
npm install
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

API: `http://localhost:3333`

## Endpoints iniciais

- `GET /health`
- `GET /v1/resources`
- `POST /v1/reservations`
- `GET /v1/reservations/:id`
- `DELETE /v1/reservations/:id`

### Criar reserva

```bash
curl -X POST http://localhost:3333/v1/reservations \
  -H 'content-type: application/json' \
  -H 'idempotency-key: demo-001-unique' \
  -d '{
    "resourceId": "UUID_DO_RECURSO",
    "customerEmail": "wess@example.com",
    "startsAt": "2026-10-01T14:00:00-03:00",
    "endsAt": "2026-10-01T15:00:00-03:00"
  }'
```

Uma tentativa concorrente que sobreponha esse intervalo deve retornar `409 RESERVATION_CONFLICT`.

## Próximos milestones

1. Teste de concorrência disparando 20 requests simultâneas para o mesmo horário.
2. JWT + RBAC para painel administrativo.
3. Disponibilidade por intervalo e timezone explícito.
4. Redis para rate limiting distribuído e cache de disponibilidade.
5. Outbox pattern + worker para e-mail/webhooks.
6. OpenAPI e observabilidade.
