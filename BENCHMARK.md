# Cart Read-Path Caching Benchmark

Measuring the effect of a Caffeine cache layer on the `GET /cart` read path
under concurrent load.

---

## Motivation

`CartService.getCart(customerId)` is the hottest read in the application and,
before caching, cost **7 database round-trips per call**:

| Query | Source |
|---|---|
| 1 | `cartRepository.getByCustomerId(customerId)` |
| 1 | `orderItemRepository.getAllByCartId(cartId)` |
| 5 | `menuItemRepository.findById(...)` — **one per order item (N+1)** |

The N+1 in `getOrderItemDtos()` is a known limitation (see
[Known Issues](#known-issues)). Caching the assembled `CartDto` collapses all
seven queries into a single in-memory lookup on a hit, which is what this
benchmark quantifies.

---

## Setup

| | |
|---|---|
| Hardware | MacBook Air (Apple silicon, 8 cores) |
| Runtime | Java 21 (Temurin 21.0.7), Spring Boot 3.5.3 |
| Database | PostgreSQL 15.2 in Docker, `localhost:5432` |
| Cache | Caffeine 3.2.4, `maximumSize=10000, expireAfterWrite=60s, recordStats` |
| Load generator | k6, `ramping-vus` 0 → 50 → 200 → 0 over 100 s |
| Fixture | one customer, cart containing 5 distinct menu items |
| Logging | `WARN` — verbose `TRACE` HTTP logging was disabled, see [Methodology](#methodology) |

The only variable between the two runs is `spring.cache.type`:

```bash
# control — cache disabled
SPRING_CACHE_TYPE=none ./gradlew bootRun

# treatment — Caffeine enabled
./gradlew bootRun
```

`database-init.sql` runs `DROP TABLE IF EXISTS` on every boot with
`spring.sql.init.mode=always`, so both runs start from a byte-identical
database state without any manual reset.

Reproduce with:

```bash
./gradlew bootRun                 # (or with SPRING_CACHE_TYPE=none)
./seed.sh                         # log in, put 5 items in the cart
k6 run -e EMAIL=foo@mail.com -e PASSWORD=123456 bench.js
```

---

## Results

200 concurrent virtual users, 100 s, 0 % error rate in both runs.

| Metric | No cache | Caffeine | Change |
|---|---:|---:|---:|
| **p95 latency** | **1.27 s** | **27.2 ms** | **47× lower** |
| p90 latency | 254 ms | 18.9 ms | 13× lower |
| Median latency | 40.9 ms | 5.0 ms | 8× lower |
| Mean latency | 164 ms | 8.8 ms | 19× lower |
| **Throughput** | **601 req/s** | **10,530 req/s** | **17× higher** |
| Successful requests | 60,276 | 1,052,856 | — |
| Error rate | 0 % | 0 % | — |

### Interpretation

The tail moves far more than the median, which is the expected shape. At 200
concurrent users the uncached path saturates the HikariCP connection pool:
requests spend most of their wall-clock time queued for a connection rather
than executing SQL. A cache hit needs no connection at all, so the queue never
forms and p95 collapses by roughly two orders of magnitude while the median —
already cheap when a connection happens to be free — improves only 8×.

---

## Limitations

**These numbers are an upper bound, not a production estimate.**

- **Single hot key.** The benchmark reads one customer's cart, so the hit rate
  is ~100 % after the first request. Real traffic spreads across many
  `customerId` values and the effective speedup depends on the access
  distribution. A more faithful test would generate keys from a Zipf
  distribution and report the hit rate from Caffeine's `recordStats()`.
- **Read-only workload.** No concurrent writes, so `@CacheEvict` invalidation
  is never exercised under load.
- **Local single-node setup.** App and database on one laptop; no network
  latency between tiers, and the load generator competes with the application
  for CPU.
- **In-process cache.** Caffeine is per-instance. Horizontally scaled
  deployments would need a shared cache (Redis) or would tolerate per-node
  divergence within the 60 s TTL.

---

## Known Issues

**N+1 query in `CartService.getOrderItemDtos()`** — the method calls
`menuItemRepository.findById()` once per order item inside a loop. The cache
hides this on the read path but does not fix it. Proper fixes, in order of
preference:

1. A single join returning order items with their menu items.
2. Batch fetch via `findAllById(menuItemIds)` — one query instead of N.
3. A separate long-lived cache on `menu_items`, which are near-immutable.

---

## Methodology notes

Two things had to be corrected before the measurement was meaningful:

**Logging.** `application.yml` originally set
`org.apache.coyote.http11.Http11InputBuffer: TRACE` and
`org.springframework.jdbc.core: DEBUG`. At 200 concurrent users, console I/O
dominated the measurement — the benchmark would have reported how fast the
terminal renders, not how fast the cache is. Both are now `WARN` by default and
overridable per-run via environment variables:

```bash
SQL_LOG_LEVEL=DEBUG ./gradlew bootRun   # turn SQL logging back on for debugging
```

**Cookie handling in k6.** k6 clears the per-VU cookie jar between iterations by
default, so every request after the first returned `401` and the run recorded
26,000 req/s of rejected requests. Setting `noCookiesReset: true` keeps the
session alive across iterations.

Login cost is excluded from the reported latency: each VU authenticates once,
and the `cart_latency` custom metric records only `GET /cart`. BCrypt
verification takes ~100 ms by design and would otherwise swamp the signal.
