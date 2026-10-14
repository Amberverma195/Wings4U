# Production Architectural Deep Dive

## Purpose

This guide explains the asynchronous order-email system implemented in this repository. It is written for a developer who is new to Apache Kafka, transactional outboxes, short-lived workers, and delivery guarantees.

The system sends three customer emails:

1. `ORDER_ACCEPTED` when a manual or automatic KDS acceptance succeeds.
2. `ORDER_PICKED_UP` when a pickup order reaches `PICKED_UP`.
3. `ORDER_DELIVERED` when a delivery order reaches `DELIVERED` through the PIN-gated completion path.

Authentication OTP email remains synchronous and does not use Kafka.

The implementation lives primarily in:

- `apps/api/src/modules/notifications/`
- `apps/api/src/notification-worker.ts`
- `apps/api/src/notification-replay.ts`
- `packages/contracts/src/notifications.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20260716120000_scheduled_order_email_notifications/`
- `railway.notification-worker.json`

## Important Provider Note

The original design names Upstash Kafka. Upstash announced the deprecation of Upstash Kafka in September 2024 and stopped offering it to new users. Do not start a new production deployment assuming that a new Upstash Kafka cluster can be provisioned.

The implementation uses the standard Kafka protocol through KafkaJS, so it is provider-neutral. It can connect to an existing legacy Upstash Kafka cluster or another managed Kafka-compatible provider. The architecture and application code remain the same; only broker credentials and provider-specific topic administration change.

References:

- [Upstash Kafka deprecation announcement](https://upstash.com/blog/workflow-kafka)
- [Railway cron jobs](https://docs.railway.com/cron-jobs)
- [Railway config as code](https://docs.railway.com/config-as-code/reference)
- [Apache Kafka producer configuration](https://kafka.apache.org/40/configuration/producer-configs/)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)

## 1. Executive Visual Flow And Systems Architecture

### 1.1 End-to-end flow

```text
 CUSTOMER DEVICE
 Vercel web or mobile client
          |
          | HTTPS checkout / KDS action
          v
 RAILWAY API WEB NODE
          |
          | 1. Checkout creates order
          | 2. KDS later changes status
          v
 POSTGRESQL ACID TRANSACTION
 +---------------------------------------------------------------+
 | UPDATE orders                                                 |
 |   SET status = 'ACCEPTED' / 'PICKED_UP' / 'DELIVERED'         |
 |                                                               |
 | INSERT notification_outbox                                    |
 |   event_type, real order_number, recipient snapshot, timing,  |
 |   scheduled date, timezone, resolved ETA, topic, available_at |
 |                                                               |
 | COMMIT both changes together                                  |
 +---------------------------------------------------------------+
          |
          | API response does not wait for Kafka or Resend
          v
 CUSTOMER/KDS REQUEST COMPLETES

 Every five minutes, Railway starts a short-lived cron container:

 RAILWAY NOTIFICATION CRON
          |
          | pg_try_advisory_lock(...)
          v
 SINGLE ACTIVE BATCH OWNER
          |
          | SELECT pending outbox rows
          | FOR UPDATE SKIP LOCKED
          v
 KAFKAJS PRODUCER
 acks=all, idempotent=true, key=orderId
          |
          +-----------------------> order-emails.v1
          |                                  |
          |                                  | partition hash(orderId)
          |                                  v
          |                         KAFKA DURABLE LOG
          |                                  |
          |                                  v
          |                         KAFKAJS CONSUMER GROUP
          |                         autoCommit=false
          |                                  |
          |                                  v
          |                         notification_deliveries
          |                         durable dedupe/audit row
          |                                  |
          |                                  v
          |                            RESEND EMAIL API
          |                         Idempotency-Key header
          |                                  |
          |                                  v
          |                           CUSTOMER INBOX
          |
          +--> temporary send failure
          |      INSERT delayed outbox row
          |      topic=order-emails.retry.v1
          |      available_at=now + 5/15/30 minutes
          |
          +--> permanent or exhausted failure
                 INSERT outbox row
                 topic=order-emails.dlq.v1
                 delivery status=DEAD_LETTER

 Worker becomes idle:
          |
          | purge bounded PUBLISHED outbox rows older than 30 days
          | consumer.stop()
          | consumer.disconnect()
          | producer.disconnect()
          | pg_advisory_unlock(...)
          | PostgreSQL connection end
          | Nest application context close
          v
 PROCESS EXITS
 Railway releases worker compute until the next cron invocation
```

### 1.2 Why the API does not send directly

The status update and the email are two different responsibilities:

- The API owns the restaurant fact: the order was accepted, picked up, or delivered.
- The notification pipeline owns the side effect: tell the customer by email.

The API only has to commit the status and an outbox promise. A Kafka outage or Resend outage cannot make the KDS request fail after the kitchen has already accepted the order.

### 1.3 Scale-to-zero economics

Railway cron jobs start a service on a schedule and expect it to terminate when work is complete. Railway currently allows no interval shorter than five minutes and notes that execution may drift by a few minutes.

For the worker process specifically, there is no continuously allocated idle process between runs. When the shop is closed and no orders exist, each invocation starts, finds no work, disconnects, and exits. Therefore the worker has zero idle compute time between cron executions.

This does not mean the entire platform costs exactly zero dollars:

- PostgreSQL, Redis, Kafka, Railway API nodes, network traffic, and Resend can have their own fees.
- Each cron startup consumes a small amount of active compute.
- The claim is specifically that there is no 24/7 idle notification-worker container.

### 1.4 Delivery latency

This is an eventually delivered system. Normal email latency is approximately:

```text
time until next cron start
+ container startup
+ Kafka publish and consume time
+ Resend processing time
```

The usual scheduling contribution is zero to five minutes, but Railway does not guarantee minute-perfect cron starts. The product must not promise an instant acceptance email.

## 2. Kafka For Absolute Beginners: The Chicken Wing Analogy

Imagine the restaurant has a metal ticket rail above the kitchen pass.

- A ticket is an event such as "order 1042 was accepted."
- The rail is a Kafka topic.
- Sections of the rail are Kafka partitions.
- The person pinning tickets is the producer.
- The cook clearing tickets is the consumer.
- A numbered marker showing the last cleared ticket is the offset.

Kafka is useful because pinning a ticket and cooking from a ticket do not have to happen at the same moment. The ticket waits safely until a worker is ready.

### 2.1 Topic

A topic is a named append-only stream of records.

This system uses:

| Topic | Purpose | Suggested retention |
| --- | --- | --- |
| `order-emails.v1` | Initial order email requests | 7 days |
| `order-emails.retry.v1` | Delayed retry requests after temporary failures | 7 days |
| `order-emails.dlq.v1` | Permanently failed or exhausted requests | At least 30 days |

The `.v1` suffix identifies the payload contract. If an incompatible payload is ever needed, publish a new version rather than silently changing the old one.

### 2.2 Partition

A topic is split into partitions. Each partition is an ordered log.

The producer sends `orderId` as the Kafka message key:

```ts
await producer.send({
  topic: row.topic,
  acks: -1,
  messages: [{
    key: row.orderId,
    value: JSON.stringify(row.payloadJson),
  }],
});
```

Kafka hashes the key and consistently chooses a partition. Events for one order therefore travel through the same partition and retain their partition order. Different orders can be distributed across partitions and processed concurrently.

Important limit: Kafka only guarantees order inside one partition. It does not globally order every event in every partition.

### 2.3 Producer

Conceptually, the API produces the business event by writing the outbox row. Physically, the short-lived worker owns the KafkaJS producer and flushes that row to Kafka.

This separation is intentional. An HTTP API process should not claim success for a Kafka send that is unrelated to its database transaction.

Producer settings:

```ts
const producer = kafka.producer({
  allowAutoTopicCreation: false,
  idempotent: true,
  maxInFlightRequests: 5,
  retry: { retries: 10 },
});
```

Each send also sets `acks: -1`, KafkaJS notation for `acks=all`.

### 2.4 Consumer

The consumer reads the main and retry topics as group:

```ts
const consumer = kafka.consumer({
  groupId: "order-email-notification-worker-v1",
  allowAutoTopicCreation: false,
});

await consumer.subscribe({
  topics: ["order-emails.v1", "order-emails.retry.v1"],
  fromBeginning: false,
});
```

Kafka assigns each partition to at most one active consumer in the group. A second consumer in another group would independently receive the same records.

### 2.5 Offset

An offset is a monotonically increasing position inside one partition. It is like writing "tickets through number 58 are complete" on the kitchen clipboard.

Kafka expects the committed offset to be the next record to read. If the current record has offset `58`, successful processing commits `59`.

### 2.6 Why automatic commits are disabled

With automatic commits enabled, the consumer may save its bookmark before Resend and PostgreSQL are safely updated. If the process dies at that moment, Kafka starts after that message next time, and the email can disappear.

This worker uses:

```ts
await consumer.run({
  autoCommit: false,
  eachMessage: async ({ topic, partition, message }) => {
    await processAndPersistResult(message);
    await consumer.commitOffsets([{
      topic,
      partition,
      offset: (BigInt(message.offset) + 1n).toString(),
    }]);
  },
});
```

An offset is committed only after one of these durable outcomes:

- `NotificationDelivery` is marked `SENT`.
- A retry outbox row is committed in PostgreSQL.
- A DLQ outbox row is committed in PostgreSQL.
- An invalid payload is acknowledged by the Kafka DLQ topic.
- A previous durable result proves the message is a duplicate.

### 2.7 Why `acks=all` is used

`acks=all` asks the partition leader to wait for all in-sync replicas required by the broker configuration before acknowledging the write. It is Kafka's strongest producer acknowledgment mode.

This is stronger than:

- `acks=0`: do not wait for the broker.
- `acks=1`: wait for the leader only.

Producer idempotence also requires `acks=all`, retries greater than zero, and at most five in-flight requests per connection. This prevents the Kafka producer's own retry from appending duplicate records in the partition.

It does not make the complete database-to-email workflow exactly once. The complete workflow uses multiple dedupe layers described later.

## 3. Architectural Trade-offs And Dodged Drawbacks

| Question | Path A: synchronous Resend call | Path B: always-on consumer | Path C: five-minute cron batch |
| --- | --- | --- | --- |
| Checkout/KDS waits for email provider | Yes | No | No |
| Resend outage affects KDS request | Can fail or delay it | No | No |
| Kafka outage affects KDS request | Not applicable | No with outbox | No with outbox |
| Typical email latency | Seconds | Seconds | Zero to several minutes |
| Idle worker process | None | 24/7 | None between runs |
| Operational complexity | Low | Medium | Highest of the three |
| Retry durability | Must be built into request path | Strong | Strong |
| Best fit | Non-critical email where dropped sends are acceptable | High-volume real-time workloads | Low-volume shop with a strict compute budget |

### Path A: direct Resend inside checkout or KDS

```text
KDS accept -> update database -> call Resend -> return HTTP response
```

Problems:

- A slow email API makes the KDS feel slow.
- A network timeout creates ambiguity: Resend may have accepted the email while the API thinks it failed.
- Retrying the entire HTTP request can repeat unrelated work.
- The restaurant operation and the marketing side effect become coupled.

### Path B: always-on long-polling consumer

```text
Kafka -> worker process waiting continuously -> Resend
```

Benefits:

- Low latency.
- Natural Kafka consumption model.
- Good for sustained traffic.

Costs:

- A process and its memory remain active while the restaurant is closed.
- The cost is dominated by waiting rather than useful work at this shop's volume.
- Operational care is still required for retries and dedupe.

### Path C: chosen short-lived cron batch

```text
Every five minutes -> connect -> flush -> drain -> clean -> disconnect -> exit
```

Benefits:

- The KDS path remains fast and independent of Kafka/Resend outages.
- Durable PostgreSQL rows bridge long periods when the worker is stopped.
- The worker pays for active batch time instead of idle listening time.

Constraint:

- Email is not immediate. A zero-to-five-minute scheduling delay, plus possible Railway drift, is accepted by product design.

### Why Redis is not the source of truth

Redis can help with caches, rate limits, or short-lived locks, but it is not used as the authoritative event store here. PostgreSQL already owns the order transaction. Keeping the event promise in the same database transaction gives a stronger and simpler consistency boundary.

## 4. Transactional Outbox Pattern And Concurrency Tracking

### 4.1 The dual-write problem

Suppose the API does two separate operations:

```text
1. UPDATE order status to ACCEPTED
2. publish ORDER_ACCEPTED to Kafka
```

The process can crash between them. Then the kitchen sees an accepted order, but no email event exists.

Reversing the order is also wrong:

```text
1. publish ORDER_ACCEPTED to Kafka
2. UPDATE order status to ACCEPTED
```

The database update can fail after Kafka succeeds. The customer receives an acceptance for an order that is still `PLACED`.

### 4.2 One atomic restaurant decision

The outbox solves this by putting both writes in one PostgreSQL transaction:

```ts
await prisma.$transaction(async (tx) => {
  await tx.order.update({
    where: { id: orderId },
    data: { status: "ACCEPTED", acceptedAt: occurredAt },
  });

  await tx.notificationOutbox.create({
    data: preparedEvent,
  });
});
```

ACID means:

- Atomicity: both writes commit or neither commits.
- Consistency: constraints remain true.
- Isolation: concurrent transactions do not observe a half-finished change.
- Durability: committed records survive process failure.

Restaurant analogy: the manager stamps "accepted" on the order and places the customer-notification slip in the outgoing tray with one indivisible action. There is no valid state where only half of that action happened.

### 4.3 Why the worker does not need to run continuously

Pending outbox rows are ordinary durable PostgreSQL records. They do not expire when the Node.js process exits. A worker can be stopped for an hour and later continue from the pending rows.

### 4.4 Overlapping cron executions

Overlaps can happen because:

- a run slows down near the next five-minute boundary;
- an operator launches a manual worker while cron is active;
- a deployment briefly starts another copy;
- a scheduler retries after an uncertain launch.

Without coordination, two workers can read the same pending row and both publish it.

Railway currently skips a new scheduled invocation when the previous cron execution is still active, but application-level locking is still valuable for manual runs, provider behavior changes, and defense in depth.

### 4.5 PostgreSQL advisory lock

The worker opens a dedicated `pg.Client` session and executes:

```sql
SELECT pg_try_advisory_lock(
  hashtext('wings4u-order-email-notification-batch-v1')
) AS acquired;
```

Only the session that receives `true` proceeds. The lock belongs to that PostgreSQL connection. The worker explicitly unlocks and closes the session in `finally`; PostgreSQL also releases the lock automatically if the connection dies.

This is the outer gate: one complete notification batch owns the publisher/consumer cycle.

### 4.6 `FOR UPDATE SKIP LOCKED`

The publisher also claims rows atomically:

```sql
WITH candidates AS (
  SELECT id
  FROM notification_outbox
  WHERE status = 'PENDING'
    AND available_at <= NOW()
  ORDER BY available_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 100
)
UPDATE notification_outbox AS outbox
SET status = 'PROCESSING',
    processing_at = NOW(),
    publish_attempts = publish_attempts + 1,
    updated_at = NOW()
FROM candidates
WHERE outbox.id = candidates.id
RETURNING outbox.*;
```

`FOR UPDATE` locks candidate rows. `SKIP LOCKED` tells another claimant not to wait on already claimed rows; it moves to different available work. The update and return happen in one transaction, so no gap exists between "read" and "claimed."

The advisory lock controls the whole batch. `SKIP LOCKED` controls individual rows and keeps manual or future parallel publishers safe.

### 4.7 Processing leases

A process can die after changing a row to `PROCESSING`. The next run recovers leases older than ten minutes:

```text
PROCESSING + processingAt older than 10 minutes -> PENDING
```

The row can then be published again. This is why Kafka producer idempotence, consumer dedupe, and Resend idempotency are all still necessary.

### 4.8 Delivery semantics

This system is best described as at-least-once transport with effectively-once customer email behavior inside the designed retry window.

The layers are:

1. Outbox unique constraints stop duplicate event/attempt/topic rows.
2. Kafka idempotent producer stops duplicates caused by KafkaJS producer retries.
3. `NotificationDelivery.eventId` stops a consumed event from being processed twice after its durable result.
4. Resend's stable key stops duplicate sends within Resend's 24-hour idempotency window.

No distributed transaction spans PostgreSQL, Kafka, and Resend. Absolute mathematical exactly-once delivery is not claimed.

## 5. Prisma Schema Blueprint

### 5.1 Enums

```prisma
enum NotificationOutboxStatus {
  PENDING
  PROCESSING
  PUBLISHED

  @@map("notification_outbox_status")
}

enum NotificationDeliveryStatus {
  PENDING
  TEMPORARY_FAILURE
  SENT
  DEAD_LETTER

  @@map("notification_delivery_status")
}
```

### 5.2 `NotificationOutbox`

```prisma
model NotificationOutbox {
  id              String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  eventId         String                   @map("event_id") @db.Uuid
  orderId         String                   @map("order_id") @db.Uuid
  eventType       String                   @map("event_type")
  schemaVersion   Int                      @default(1) @map("schema_version")
  deliveryAttempt Int                      @default(0) @map("delivery_attempt")
  topic           String
  payloadJson     Json                     @map("payload_json")
  status          NotificationOutboxStatus @default(PENDING)
  availableAt     DateTime                 @default(now()) @map("available_at") @db.Timestamptz(6)
  processingAt    DateTime?                @map("processing_at") @db.Timestamptz(6)
  publishAttempts Int                      @default(0) @map("publish_attempts")
  publishedAt     DateTime?                @map("published_at") @db.Timestamptz(6)
  lastError       String?                  @map("last_error")
  createdAt       DateTime                 @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime                 @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  order           Order                    @relation(fields: [orderId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@unique([eventId, deliveryAttempt, topic], map: "uq_notification_outbox_event_attempt_topic")
  @@unique([orderId, eventType, deliveryAttempt, topic], map: "uq_notification_outbox_order_event_attempt_topic")
  @@index([status, availableAt], map: "idx_notification_outbox_status_available")
  @@index([status, publishedAt], map: "idx_notification_outbox_status_published")
  @@index([orderId, createdAt], map: "idx_notification_outbox_order_created")
  @@map("notification_outbox")
}
```

### 5.3 `NotificationDelivery`

```prisma
model NotificationDelivery {
  eventId           String                     @id @map("event_id") @db.Uuid
  orderId           String                     @map("order_id") @db.Uuid
  eventType         String                     @map("event_type")
  recipientEmail    String                     @map("recipient_email") @db.Citext
  status            NotificationDeliveryStatus @default(PENDING)
  attemptCount      Int                        @default(0) @map("attempt_count")
  providerMessageId String?                    @map("provider_message_id")
  lastError         String?                    @map("last_error")
  nextRetryAt       DateTime?                  @map("next_retry_at") @db.Timestamptz(6)
  sentAt            DateTime?                  @map("sent_at") @db.Timestamptz(6)
  createdAt         DateTime                   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime                   @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  order             Order                      @relation(fields: [orderId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@index([status, nextRetryAt], map: "idx_notification_deliveries_status_retry")
  @@index([orderId, createdAt], map: "idx_notification_deliveries_order_created")
  @@map("notification_deliveries")
}
```

### 5.4 Why the two requested indexes matter

`(status, availableAt)` supports the hot publisher query:

```sql
WHERE status = 'PENDING' AND available_at <= NOW()
ORDER BY available_at
```

PostgreSQL can seek into the `PENDING` part of the index and scan due rows in time order instead of scanning the entire table.

`(status, publishedAt)` supports retention cleanup:

```sql
WHERE status = 'PUBLISHED' AND published_at < cutoff
ORDER BY published_at
```

The database can find only old successful rows. Pending, processing, retry, and DLQ-bound rows are not selected.

### 5.5 Why `NotificationDelivery` is retained

Published outbox transport records can be deleted after 30 days, but the compact delivery record remains. It provides:

- event-level deduplication;
- provider message ID lookup;
- send and retry audit history;
- permanent failure visibility;
- operator evidence after Kafka retention expires.

## 6. Batch Worker Implementation Skeleton

The repository splits the production implementation into focused Nest services. The following cohesive script shows the same mechanics in one place for learning. Use the repository services for deployment because they include payload validation, templates, metrics-ready logging, replay support, and the complete retry state machine.

```ts
import { Prisma, PrismaClient } from "@prisma/client";
import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
import { Client as PgClient } from "pg";

const prisma = new PrismaClient();
const MAIN_TOPIC = "order-emails.v1";
const RETRY_TOPIC = "order-emails.retry.v1";
const DLQ_TOPIC = "order-emails.dlq.v1";
const GROUP_ID = "order-email-notification-worker-v1";
const MAX_RUNTIME_MS = 220_000;
const BATCH_SIZE = 100;
const IDLE_MS = 5_000;
const STARTUP_GRACE_MS = 8_000;
const LOCK_NAME = "wings4u-order-email-notification-batch-v1";

type EventV1 = {
  schema_version: 1;
  event_id: string;
  event_type: "ORDER_ACCEPTED" | "ORDER_PICKED_UP" | "ORDER_DELIVERED";
  order_id: string;
  order_number: string;
  location_id: string;
  recipient_email: string;
  customer_name: string;
  fulfillment_type: "PICKUP" | "DELIVERY";
  timing_type: "ASAP" | "SCHEDULED";
  scheduled_for: string;
  location_timezone: string;
  estimated_window_min_minutes: number | null;
  estimated_window_max_minutes: number | null;
  occurred_at: string;
  attempt: number;
};

type ClaimedRow = {
  id: string;
  orderId: string;
  topic: string;
  payloadJson: Prisma.JsonValue;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function buildKafka(): Kafka {
  return new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || "wings4u-notifications",
    brokers: requireEnv("KAFKA_BROKERS").split(",").map((x) => x.trim()),
    ssl: process.env.KAFKA_SSL === "true",
    sasl: {
      mechanism: "scram-sha-256",
      username: requireEnv("KAFKA_SASL_USERNAME"),
      password: requireEnv("KAFKA_SASL_PASSWORD"),
    },
    retry: { initialRetryTime: 300, retries: 10 },
    logLevel: logLevel.ERROR,
  });
}

async function claimDueRows(): Promise<ClaimedRow[]> {
  return prisma.$transaction((tx) => tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT "id"
      FROM "notification_outbox"
      WHERE "status" = 'PENDING'
        AND "available_at" <= NOW()
      ORDER BY "available_at", "created_at"
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE "notification_outbox" AS outbox
    SET "status" = 'PROCESSING',
        "processing_at" = NOW(),
        "publish_attempts" = outbox."publish_attempts" + 1,
        "updated_at" = NOW()
    FROM candidates
    WHERE outbox."id" = candidates."id"
    RETURNING outbox."id",
              outbox."order_id" AS "orderId",
              outbox."topic",
              outbox."payload_json" AS "payloadJson"
  `));
}

async function flushOutbox(producer: Producer, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const rows = await claimDueRows();
    if (rows.length === 0) return;

    for (const row of rows) {
      try {
        await producer.send({
          topic: row.topic,
          acks: -1,
          messages: [{
            key: row.orderId,
            value: JSON.stringify(row.payloadJson),
          }],
        });
        await prisma.notificationOutbox.updateMany({
          where: { id: row.id, status: "PROCESSING" },
          data: {
            status: "PUBLISHED",
            processingAt: null,
            publishedAt: new Date(),
            lastError: null,
          },
        });
      } catch (error) {
        await prisma.notificationOutbox.updateMany({
          where: { id: row.id, status: "PROCESSING" },
          data: {
            status: "PENDING",
            processingAt: null,
            availableAt: new Date(Date.now() + 5 * 60_000),
            lastError: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    if (rows.length < BATCH_SIZE) return;
  }
}

async function sendWithResend(event: EventV1, content: {
  subject: string;
  html: string;
  text: string;
}): Promise<string> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `order-email/${event.event_type}/${event.order_id}`,
    },
    body: JSON.stringify({
      from: requireEnv("RESEND_FROM"),
      to: [event.recipient_email],
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const body = await response.text();
  if (!response.ok) {
    const temporary =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500 ||
      (response.status === 409 && /concurrent_idempotent_requests/i.test(body));
    throw Object.assign(new Error(`Resend ${response.status}: ${body}`), {
      temporary,
    });
  }

  return (JSON.parse(body) as { id: string }).id;
}

function renderEmail(event: EventV1): {
  subject: string;
  html: string;
  text: string;
} {
  const order = `Order #${event.order_number}`;
  const timing = event.timing_type === "SCHEDULED"
    ? new Intl.DateTimeFormat("en-CA", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: event.location_timezone,
        timeZoneName: "short",
      }).format(new Date(event.scheduled_for))
    : `${event.estimated_window_min_minutes}-${event.estimated_window_max_minutes} minutes`;

  if (event.event_type === "ORDER_ACCEPTED") {
    const text = `${order} has been accepted. Your ${event.fulfillment_type.toLowerCase()} is expected ${timing}.`;
    return { subject: `${order} accepted`, text, html: `<p>${text}</p>` };
  }
  if (event.event_type === "ORDER_PICKED_UP") {
    const text = `${order} has been picked up. Thank you for choosing Wings 4 U.`;
    return { subject: `${order} picked up`, text, html: `<p>${text}</p>` };
  }
  const text = `${order} has been delivered. We hope everything arrived hot and fresh.`;
  return { subject: `${order} delivered`, text, html: `<p>${text}</p>` };
}

function nextOffset(offset: string): string {
  return (BigInt(offset) + 1n).toString();
}

async function drainKafka(
  consumer: Consumer,
  producer: Producer,
  deadline: number,
): Promise<void> {
  let active = 0;
  let lastActivity = Date.now();
  let runFailure: unknown;
  const started = Date.now();

  const run = consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      active += 1;
      lastActivity = Date.now();
      try {
        const event = JSON.parse(message.value?.toString() || "") as EventV1;

        // Production code performs event validation, durable delivery dedupe,
        // template rendering, send, and retry/DLQ transaction here.
        await processEventDurably(event, producer);

        await heartbeat();
        await consumer.commitOffsets([{
          topic,
          partition,
          offset: nextOffset(message.offset),
        }]);
      } finally {
        active -= 1;
        lastActivity = Date.now();
      }
    },
  });
  void run.catch((error) => { runFailure = error; });

  while (Date.now() < deadline) {
    if (runFailure) throw runFailure;
    const startupComplete = Date.now() - started >= STARTUP_GRACE_MS;
    const idle = active === 0 && Date.now() - lastActivity >= IDLE_MS;
    if (startupComplete && idle) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await consumer.stop();
  await run;
}

async function processEventDurably(event: EventV1, producer: Producer): Promise<void> {
  void producer;
  const existing = await prisma.notificationDelivery.findUnique({
    where: { eventId: event.event_id },
  });
  if (existing?.status === "SENT" || existing?.status === "DEAD_LETTER") return;
  if (
    existing?.status === "TEMPORARY_FAILURE" &&
    existing.attemptCount >= event.attempt + 1
  ) return;

  const attemptCount = event.attempt + 1;
  await prisma.notificationDelivery.upsert({
    where: { eventId: event.event_id },
    create: {
      eventId: event.event_id,
      orderId: event.order_id,
      eventType: event.event_type,
      recipientEmail: event.recipient_email,
      status: "PENDING",
      attemptCount,
    },
    update: {
      status: "PENDING",
      attemptCount,
      nextRetryAt: null,
      lastError: null,
    },
  });

  try {
    const providerMessageId = await sendWithResend(event, renderEmail(event));
    await prisma.notificationDelivery.update({
      where: { eventId: event.event_id },
      data: {
        status: "SENT",
        providerMessageId,
        sentAt: new Date(),
        nextRetryAt: null,
        lastError: null,
      },
    });
  } catch (rawError) {
    const error = rawError as Error & { temporary?: boolean };
    const message = error.message.slice(0, 4_000);
    const delays = [5, 15, 30] as const;
    const delayMinutes = delays[event.attempt];

    if (error.temporary && delayMinutes != null) {
      const retryAt = new Date(Date.now() + delayMinutes * 60_000);
      const retryPayload: EventV1 = { ...event, attempt: event.attempt + 1 };
      await prisma.$transaction(async (tx) => {
        await tx.notificationDelivery.update({
          where: { eventId: event.event_id },
          data: {
            status: "TEMPORARY_FAILURE",
            lastError: message,
            nextRetryAt: retryAt,
          },
        });
        await tx.notificationOutbox.createMany({
          data: [{
            eventId: event.event_id,
            orderId: event.order_id,
            eventType: event.event_type,
            schemaVersion: 1,
            deliveryAttempt: retryPayload.attempt,
            topic: RETRY_TOPIC,
            payloadJson: retryPayload as unknown as Prisma.InputJsonValue,
            availableAt: retryAt,
          }],
          skipDuplicates: true,
        });
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.notificationDelivery.update({
        where: { eventId: event.event_id },
        data: {
          status: "DEAD_LETTER",
          lastError: message,
          nextRetryAt: null,
        },
      });
      await tx.notificationOutbox.createMany({
        data: [{
          eventId: event.event_id,
          orderId: event.order_id,
          eventType: event.event_type,
          schemaVersion: 1,
          deliveryAttempt: event.attempt,
          topic: DLQ_TOPIC,
          payloadJson: {
            ...event,
            failure: { reason: message, failed_at: new Date().toISOString() },
          } as unknown as Prisma.InputJsonValue,
        }],
        skipDuplicates: true,
      });
    });
  }
}

async function purgeOldPublishedRows(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const deleted = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH expired AS (
      SELECT "id"
      FROM "notification_outbox"
      WHERE "status" = 'PUBLISHED'
        AND "published_at" < ${cutoff}
      ORDER BY "published_at"
      LIMIT ${BATCH_SIZE}
    )
    DELETE FROM "notification_outbox" AS outbox
    USING expired
    WHERE outbox."id" = expired."id"
    RETURNING outbox."id"
  `);
  return deleted.length;
}

async function main(): Promise<void> {
  const deadline = Date.now() + MAX_RUNTIME_MS;
  const lockClient = new PgClient({
    connectionString: process.env.DIRECT_URL || requireEnv("DATABASE_URL"),
  });
  const kafka = buildKafka();
  const producer = kafka.producer({
    allowAutoTopicCreation: false,
    idempotent: true,
    maxInFlightRequests: 5,
    retry: { retries: 10 },
  });
  const consumer = kafka.consumer({
    groupId: GROUP_ID,
    allowAutoTopicCreation: false,
    retry: { retries: 10 },
  });
  let lockAcquired = false;

  try {
    await lockClient.connect();
    const result = await lockClient.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [LOCK_NAME],
    );
    lockAcquired = result.rows[0]?.acquired === true;
    if (!lockAcquired) return;

    await Promise.all([producer.connect(), consumer.connect()]);
    await consumer.subscribe({ topics: [MAIN_TOPIC, RETRY_TOPIC] });

    // Start the consumer before publishing so this short-lived run can consume
    // records it just appended without waiting for the next cron invocation.
    const drain = drainKafka(consumer, producer, deadline);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await flushOutbox(producer, deadline);
    await drain;
  } finally {
    try {
      await purgeOldPublishedRows();
    } catch (error) {
      console.warn("Outbox cleanup failed", error);
    }

    await Promise.allSettled([
      consumer.disconnect(),
      producer.disconnect(),
      prisma.$disconnect(),
    ]);
    if (lockAcquired) {
      await lockClient.query(
        "SELECT pg_advisory_unlock(hashtext($1))",
        [LOCK_NAME],
      ).catch(() => undefined);
    }
    await lockClient.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

The repository version additionally validates every payload and sends malformed records directly to the DLQ after Kafka acknowledges that diagnostic record.

### 6.1 Actual Railway entrypoint

```bash
npm run notifications:worker
```

The config-as-code file contains:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "RAILPACK" },
  "deploy": {
    "startCommand": "npm run notifications:worker",
    "cronSchedule": "*/5 * * * *",
    "restartPolicyType": "NEVER"
  }
}
```

Railway must be configured to use `railway.notification-worker.json` for the dedicated cron service because its non-default filename prevents it from affecting the API service.

### 6.2 Environment variables

```dotenv
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

KAFKA_BROKERS=broker.example.com:9092
KAFKA_CLIENT_ID=wings4u-order-email-worker
KAFKA_SSL=true
KAFKA_SASL_MECHANISM=scram-sha-256
KAFKA_SASL_USERNAME=...
KAFKA_SASL_PASSWORD=...
KAFKA_ORDER_EMAIL_TOPIC=order-emails.v1
KAFKA_ORDER_EMAIL_RETRY_TOPIC=order-emails.retry.v1
KAFKA_ORDER_EMAIL_DLQ_TOPIC=order-emails.dlq.v1
KAFKA_ORDER_EMAIL_GROUP_ID=order-email-notification-worker-v1

RESEND_API_KEY=re_...
RESEND_FROM=Wings 4 U <no-reply@verified-domain.example>
ORDER_EMAIL_MODE=resend

NOTIFICATION_WORKER_BATCH_SIZE=100
NOTIFICATION_WORKER_MAX_RUNTIME_MS=220000
NOTIFICATION_WORKER_IDLE_MS=3000
NOTIFICATION_WORKER_STARTUP_GRACE_MS=8000
```

Secrets must be Railway variables, not committed files.

### 6.3 Topic provisioning

Auto topic creation is disabled deliberately. Create all three topics before enabling publication.

Provider-neutral target settings:

```text
order-emails.v1
  partitions: enough for expected concurrency, often 3 for a small deployment
  retention: 7 days

order-emails.retry.v1
  partitions: same key strategy as main
  retention: 7 days

order-emails.dlq.v1
  partitions: operational choice, often 1-3
  retention: at least 30 days
```

Set ACLs so the worker principal can:

- produce to all three topics;
- consume main and retry;
- read/write offsets for its consumer group;
- fetch topic metadata.

The API service itself does not require Kafka credentials because it only writes PostgreSQL outbox records.

## 7. Comprehensive Failure Scenario Matrix And Management

### 7.1 Failure matrix

| Failure | Classification | Durable action | Offset commit? | Next action |
| --- | --- | --- | --- | --- |
| DNS/network error calling Resend | Temporary | Create delayed retry outbox row | Yes, after transaction | Retry at 5/15/30 min |
| Request timeout | Temporary | Create delayed retry outbox row | Yes, after transaction | Retry |
| Resend HTTP 408 | Temporary | Create delayed retry outbox row | Yes | Retry |
| Resend HTTP 429 | Temporary | Create delayed retry outbox row | Yes | Retry |
| Resend HTTP 5xx | Temporary | Create delayed retry outbox row | Yes | Retry |
| Resend 409 `concurrent_idempotent_requests` | Temporary | Create delayed retry outbox row | Yes | Retry same payload/key |
| Invalid recipient | Permanent | Mark delivery dead; create DLQ outbox | Yes | Correct data and replay |
| Invalid API key | Permanent | Mark delivery dead; create DLQ outbox | Yes | Correct secret and replay |
| Unverified sender | Permanent | Mark delivery dead; create DLQ outbox | Yes | Verify sender and replay |
| Resend 409 `invalid_idempotent_request` | Permanent | DLQ | Yes | Investigate payload/key mismatch |
| Kafka publish outage | Transport retry | Return row to `PENDING`, +5 min | Not applicable | Next cron republishes |
| Database failure during result update | Unknown/incomplete | Transaction rolls back | No | Kafka redelivers |
| Process dies after Resend accepted, before DB update | Unknown send result | No offset commit | No | Kafka redelivers; Resend key dedupes within 24h |
| Invalid Kafka payload | Permanent | Publish diagnostic record to DLQ | Yes, after DLQ ack | Operator investigation |
| Duplicate Kafka delivery | Duplicate | Read durable `NotificationDelivery` | Yes | No second send |
| Worker lock unavailable | Benign overlap | No mutation | No records consumed | Exit; active worker owns batch |
| Cleanup failure | Non-blocking maintenance | Log warning | Email flow unaffected | Try again next cron |

### 7.2 Retry timeline

The event starts with `attempt: 0`.

```text
Attempt 0 fails temporarily -> retry available in 5 minutes
Attempt 1 fails temporarily -> retry available in 15 minutes
Attempt 2 fails temporarily -> retry available in 30 minutes
Attempt 3 fails             -> no automatic delay remains -> DLQ
```

This entire automatic retry schedule fits within Resend's documented 24-hour idempotency retention.

### 7.3 Why retry is another outbox row

Kafka does not natively delay an individual record until a wall-clock time. The worker stores a retry row in PostgreSQL with a future `availableAt`. A future cron invocation only claims it after that time and publishes it to `order-emails.retry.v1`.

This works even when no worker is running between attempts.

### 7.4 Permanent failures

A permanent error means repeating the same request cannot succeed without a human or configuration change.

Examples:

- malformed recipient address;
- revoked or invalid Resend credential;
- sender domain not verified;
- invalid event schema;
- an idempotency key reused with a different request body.

Retrying these forever wastes API quota, hides the underlying issue, and grows the outbox. They go directly to the DLQ path.

### 7.5 DLQ meaning

`order-emails.dlq.v1` is the quarantine rail. It keeps failed tickets away from healthy order traffic while preserving enough context to diagnose them.

A DLQ record is not "fixed." It means automatic handling stopped and an operator must act.

### 7.6 Operator investigation

Find recent dead deliveries:

```sql
SELECT
  nd.event_id,
  nd.order_id,
  nd.event_type,
  nd.recipient_email,
  nd.attempt_count,
  nd.last_error,
  nd.updated_at
FROM notification_deliveries AS nd
WHERE nd.status = 'DEAD_LETTER'
ORDER BY nd.updated_at DESC
LIMIT 100;
```

Inspect all transport records for one event:

```sql
SELECT
  id,
  event_id,
  delivery_attempt,
  topic,
  status,
  available_at,
  publish_attempts,
  published_at,
  last_error,
  payload_json
FROM notification_outbox
WHERE event_id = '00000000-0000-0000-0000-000000000000'
ORDER BY delivery_attempt, created_at;
```

After correcting the recipient/configuration/provider issue, replay with the supplied command:

```bash
npm run notifications:replay -- 00000000-0000-0000-0000-000000000000
```

The replay service:

1. finds the latest payload for the event;
2. increments the delivery attempt;
3. resets the durable delivery state to `TEMPORARY_FAILURE`;
4. inserts an immediately available retry-topic outbox row;
5. lets the normal worker publish and consume it.

Do not directly edit `status = 'PENDING'` without understanding the unique constraints and attempt number. The command preserves those invariants.

### 7.7 Resend idempotency behavior

Every attempt uses:

```text
order-email/{eventType}/{orderId}
```

Examples:

```text
order-email/ORDER_ACCEPTED/8f...e2
order-email/ORDER_PICKED_UP/8f...e2
order-email/ORDER_DELIVERED/8f...e2
```

The key is stable across retries for one event type and order. Different lifecycle emails use different event types and therefore different keys.

Resend retains keys for 24 hours and checks both the key and request payload. Retry the exact same email content. A changed payload with the same key returns `invalid_idempotent_request` and is treated as permanent.

### 7.8 Cleanup and retention

Every worker run attempts one bounded cleanup batch:

```sql
WHERE status = 'PUBLISHED'
  AND published_at < NOW() - INTERVAL '30 days'
LIMIT 100
```

Only successful published rows are deleted. The cleanup never targets:

- `PENDING` rows;
- `PROCESSING` rows;
- unpublished rows;
- rows still needed to publish a retry or DLQ record.

Cleanup errors are warnings. They do not fail email processing. A later cron invocation tries again.

### 7.9 Monitoring checklist

Track at least:

| Metric | Why it matters | Initial alert idea |
| --- | --- | --- |
| Pending outbox count | Shows transport backlog | Non-zero across several cron runs |
| Oldest pending age | Detects stuck publisher | Older than 15 minutes |
| Processing lease age | Detects killed publisher | Older than 10 minutes |
| Kafka consumer lag | Shows records not consumed | Growing over multiple runs |
| Send latency | Customer experience | P95 exceeds expected cron delay |
| Temporary failure count | Provider/network health | Sudden sustained increase |
| Dead-letter count | Human action needed | Any new DLQ record |
| Cleanup count/error | Database retention health | No cleanup despite eligible rows |
| Worker duration | Risk of overlap/timeout | Near 220 seconds |

Useful health queries:

```sql
SELECT status, COUNT(*)
FROM notification_outbox
GROUP BY status;

SELECT MIN(available_at) AS oldest_due
FROM notification_outbox
WHERE status = 'PENDING' AND available_at <= NOW();

SELECT status, COUNT(*)
FROM notification_deliveries
GROUP BY status;
```

## 8. Customer Timing Rules

The event payload snapshots customer-facing timing at the lifecycle moment. Later Admin changes cannot rewrite an already emitted email.

| Fulfillment | Timing type | Accepted email timing |
| --- | --- | --- |
| Pickup | ASAP | Always 15-20 minutes |
| Pickup | Scheduled | Full scheduled local date and time |
| Delivery | ASAP + KDS ETA override | Order-level ETA window |
| Delivery | ASAP without override | Latest location delivery window at acceptance |
| Delivery | Scheduled | Full scheduled local date and time |

The order's real PostgreSQL `orderNumber` is converted to a string. This avoids JavaScript precision loss for `BigInt` values and prevents hard-coded template numbers.

The scheduled timestamp is stored as UTC, while the event also carries the location's IANA timezone, for example `America/Toronto`. Rendering uses `Intl.DateTimeFormat` with that timezone and includes the full weekday, date, time, and timezone abbreviation.

Pickup settings are migrated, seeded, served, and displayed as 15 and 20. Admin shows them as disabled fields, and the API rejects an attempted non-15/20 update.

## 9. Deployment And Rollout Runbook

### Phase 1: database first

1. Back up production PostgreSQL.
2. Deploy migration `20260716120000_scheduled_order_email_notifications`.
3. Verify `orders.timing_type` exists and existing orders defaulted to `ASAP`.
4. Correct any active scheduled orders before notification activation.
5. Verify both notification tables and indexes exist.

### Phase 2: Kafka infrastructure

1. Select an actively supported Kafka-compatible provider.
2. Create main, retry, and DLQ topics.
3. Configure 7-day main/retry retention and at least 30-day DLQ retention.
4. Create least-privilege worker credentials and consumer-group ACLs.
5. Store credentials in the Railway cron service variables.

### Phase 3: deploy worker safely

1. Create a dedicated Railway service from the same repository.
2. Point its config file at `railway.notification-worker.json`.
3. Set the cron schedule to `*/5 * * * *`.
4. Set `ORDER_EMAIL_MODE=disabled` for the first dry run.
5. Create a test online order with an email snapshot.
6. Accept it in KDS and verify an outbox row appears.
7. Run the worker and verify Kafka publication plus a `SENT` delivery record in dry-run mode.
8. Change to `ORDER_EMAIL_MODE=resend` only after sender domain verification.

### Phase 4: failure drills

1. Temporarily use an unreachable Kafka broker and verify KDS acceptance still succeeds.
2. Restore Kafka and verify the pending outbox publishes.
3. Simulate Resend 429/5xx and verify retry times.
4. Simulate a permanent sender error and verify DLQ creation.
5. Correct it and run the replay command.
6. Terminate the worker after claiming rows and verify stale lease recovery.
7. Launch two workers and verify only one acquires the advisory lock.

### Phase 5: cleanup verification

1. Insert or stage a `PUBLISHED` row just older than 30 days.
2. Insert a `PUBLISHED` row exactly/newer than the boundary.
3. Insert old `PENDING` and `PROCESSING` rows.
4. Run the worker.
5. Verify only the eligible old published row is deleted.

## 10. Test Coverage And Remaining Integration Tests

The repository includes unit tests for:

- actual order number rendering;
- fixed ASAP pickup timing;
- scheduled timezone rendering;
- picked-up and delivered copy;
- HTML escaping;
- current Admin delivery ETA fallback;
- KDS ETA precedence;
- scheduled timing snapshot;
- exclusion of orders without online email snapshots;
- V1 payload validation;
- stable Resend idempotency key;
- temporary/permanent Resend status classification.

Production rollout should also run integration tests against disposable PostgreSQL and Kafka instances for:

- status transition and outbox row atomicity;
- `FOR UPDATE SKIP LOCKED` with two concurrent claimants;
- advisory-lock exclusion;
- process termination before Kafka ack;
- process termination after Resend response but before offset commit;
- all three delayed retry intervals;
- DLQ replay;
- 30-day cleanup boundaries;
- consumer-group lag and idle shutdown.

## 11. Mental Model Summary

Remember the system as five promises:

1. PostgreSQL promises the restaurant fact and notification intent are committed together.
2. The outbox promises work can wait while no worker is running.
3. Kafka promises durable ordered transport within each order's partition.
4. The consumer promises it moves its bookmark only after a durable outcome.
5. Resend idempotency promises a retry inside 24 hours does not send the same lifecycle email twice.

In restaurant language: write the ticket atomically, pin it to a durable rail, clear it only after the task is recorded, and keep the receipt that proves it was already done.
