# OnlineOrder

A full-stack food ordering platform — Java 21 / Spring Boot REST backend over
PostgreSQL, with a React frontend, containerized and deployed on AWS.

The cart read path is fronted by a Caffeine cache; both paths were load-tested
with k6. See **[BENCHMARK.md](BENCHMARK.md)** for methodology, results, and
limitations.

---

## Results at a glance

`GET /cart` under 200 concurrent virtual users, 0 % error rate in both runs:

| Metric | No cache | Caffeine | Change |
|---|---:|---:|---:|
| p95 latency | 1.27 s | 27.2 ms | **47× lower** |
| Throughput | 601 req/s | 10,530 req/s | **17× higher** |

These are upper-bound numbers measured on a single hot cache key —
[BENCHMARK.md](BENCHMARK.md#limitations) explains why and what a more faithful
test would look like.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Persistence | PostgreSQL + Spring Data JDBC | Cart totals demand strong consistency, so relational over document storage. JDBC rather than JPA keeps the SQL explicit and avoids lazy-loading surprises. |
| Transactions | `@Transactional` services | Item insert and total recalculation must commit atomically or the displayed total drifts. |
| Cache | Caffeine, `maximumSize=10000`, `expireAfterWrite=60s` | Bounded — an unbounded `ConcurrentHashMap` is a memory leak in a long-running service. Write-expiry rather than access-expiry so a hot key can't outlive a missed eviction. |
| Invalidation | `@CacheEvict` on every mutation | Writes evict rather than update, so the cache can never disagree with the database. |
| Auth | Spring Security, session-based, BCrypt | `JdbcUserDetailsManager` against the existing `customers` table. |
| Frontend | React + Ant Design | Served as static resources from the same Spring Boot jar. |
| Deployment | Docker → AWS ECR / ECS, database on RDS | |

---

## Running locally

Requires Docker and JDK 21.

```bash
docker compose up -d          # PostgreSQL on :5432
./gradlew bootRun             # app on :8080
```

The schema is recreated on every boot (`database-init.sql` +
`spring.sql.init.mode=always`), and `DevRunner` seeds a demo account:

```
foo@mail.com / 123456
```

Open http://localhost:8080.

### Reproducing the benchmark

```bash
# control
SPRING_CACHE_TYPE=none ./gradlew bootRun
./seed.sh
k6 run -e EMAIL=foo@mail.com -e PASSWORD=123456 bench.js

# treatment — identical except the cache is enabled
./gradlew bootRun
./seed.sh
k6 run -e EMAIL=foo@mail.com -e PASSWORD=123456 bench.js
```

---

## API

| Method | Path | Auth | |
|---|---|---|---|
| POST | `/signup` | — | Create an account |
| POST | `/login` | — | Form login, returns 200 and sets `JSESSIONID` |
| POST | `/logout` | — | |
| GET | `/restaurants` | — | List restaurants |
| GET | `/restaurant/{id}/menu` | — | Menu for one restaurant |
| GET | `/cart` | ✔ | Current user's cart — **the cached read path** |
| POST | `/cart` | ✔ | Add an item. Body: `{"menu_id": 1}` |
| POST | `/cart/checkout` | ✔ | Clear the cart |

Request and response bodies are snake_case
(`spring.jackson.property-naming-strategy: SNAKE_CASE`) — note this applies to
incoming bodies too, so it is `menu_id`, not `menuId`.

---

## Known issues

`CartService.getOrderItemDtos()` issues an N+1 query — one
`menuItemRepository.findById()` per order item inside a loop, so a five-item
cart costs seven queries. The cache hides this on the read path but does not
fix it. See [BENCHMARK.md](BENCHMARK.md#known-issues) for the three candidate
fixes.
