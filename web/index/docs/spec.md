# Nova Index — Build Spec

**For:** Claude Code
**Goal:** Build one shared memory engine for the Nova Suite, plus **Nova Index** — a browsable app that is the human face of that memory. Every Suite app (Nova Bot, Nova Agent, Nova Club, Nova Hub) feeds facts *into* it and reads context *out of* it, so everything the suite knows about people, the studio and ongoing work lives in one place.

This must be highly optimised, very performant: fast reads, tiny prompts, memory that never bloats, and extraction that never makes a person wait.

---

## 0. The core idea

Store the **distilled juice, not the transcript.** Conversations go in; a tiny set of tagged, one-line facts comes out, split into small files by subject. Apps load only the files a given turn needs. Files stay small because new learning **edits existing facts in place** rather than appending contradictions.

The test for every stored fact: **"Would this still be true/useful in three months?"** If no, don't store it.

### Two layers

1. **The engine (quiet):** a shared memory store + extraction/retrieval service on Nova Bot's Worker. Every app talks to it over HTTP. No app owns the data; they all share one brain.
2. **Nova Index (the app):** a browsable window onto that brain. Scroll people, topics and studio facts; watch memory grow; edit a line; approve a pending fact. Like Nova Observatory is a dashboard you look *into*, Nova Index is the dashboard you look into the suite's **memory** through. It is fed by every app and read by every app — one place for everything the suite knows.

**Shared store, per-app behaviour.** The store is one brain, but each app only sees and writes its own slice, enforced server-side by scope: `studio` (shared facts), `staff` (per staff member), `customer` (per client). Nova Agent pulls a staff member's rhythm + studio facts; the website chat only sees customer-facing facts; Nova Club is read-only and member-facing; Nova Hub + Nova Index can see and edit across scopes for the people running the studio.

---

## 1. Architecture

```
            ┌──────────────────────────────────────────┐
            │   Nova Bot Worker + D1  =  the engine     │
            │   memory store · extraction · retrieval   │
            └──────────────────────────────────────────┘
               ▲        ▲          ▲           ▲      ▲
   reads/writes│        │          │           │      │
      context  │        │          │           │      │
      ┌────────┘   ┌────┘     ┌────┘      ┌────┘   ┌──┘
 Nova Agent   Website chat  Nova Hub   Nova Club   NOVA INDEX
 (staff+studio) (customer)  (all,edit) (read-only) (browse all, edit, approve)
```

Every app does two things: **feeds in** (after a conversation, hand it over for extraction) and **reads out** (before replying, pull the relevant context). Nova Index adds a third: **present** — the browsable, editable view of the whole store.

### Data model (D1)

```sql
CREATE TABLE memory_files (
  id          TEXT PRIMARY KEY,         -- uuid
  scope       TEXT NOT NULL,            -- 'studio' | 'staff' | 'customer'
  owner_id    TEXT,                     -- staff/customer id; NULL for studio-wide
  path        TEXT NOT NULL,            -- 'profile' | 'people/kai' | 'topics/pricing' | 'areas/ep-release'
  name        TEXT NOT NULL,            -- slug, matches path stem
  description TEXT NOT NULL,            -- one line: what's inside + when to read it (this is the INDEX)
  aliases     TEXT NOT NULL DEFAULT '[]',
  body        TEXT NOT NULL,            -- the facts, one '- [tag] ...' line each
  version     TEXT NOT NULL,            -- opaque token for optimistic concurrency
  source_app  TEXT,                     -- which app last wrote (for the Index view)
  updated_at  INTEGER NOT NULL,
  UNIQUE (scope, owner_id, path)
);

CREATE INDEX idx_mem_lookup ON memory_files (scope, owner_id);

CREATE TABLE memory_pending (          -- facts awaiting human approval
  id         TEXT PRIMARY KEY,
  target     TEXT NOT NULL,            -- intended path
  fact       TEXT NOT NULL,
  source_app TEXT NOT NULL,
  source_ref TEXT,                     -- conversation id
  created_at INTEGER NOT NULL
);
```

### File body format (keep it dead simple)

```
---
name: kai
description: Regular artist — session prefs, projects, how they book
aliases: [Kai M, K]
---

- [stated] prefers evening sessions (after 6pm)
- [stated] working on an EP, booked 4 mixing sessions since Sept
- [observed] usually books the Live Room, not the Booth
```

**Tags:** `[stated]` (said directly), `[observed]` (seen in bookings/behaviour), `[inferred]` (a pattern across observations). Store **facts only** — never advice the model invented, never re-queryable live data (what's booked next Tuesday), never a running log.

---

## 2. The engine API (on the Worker)

Four endpoints. All auth'd with the existing agent/staff key; scope enforced server-side.

| Method | Route | Purpose |
|---|---|---|
| `GET`  | `/memory/context?scope=&owner_id=&q=` | The files relevant to this turn (see §4). Cheap, edge-cached. |
| `GET`  | `/memory/file?scope=&owner_id=&path=` | One full file + its version token. |
| `PUT`  | `/memory/file` | Create/replace a file. Body carries `if_version` (`"new"` or the token). On mismatch returns `409` + current body so the caller merges and retries once. |
| `POST` | `/memory/extract` | Hand in a finished/chunked conversation; queues async extraction (§3). |

Plus, for Nova Index specifically:

| `GET` | `/memory/index?scope=` | The full listing (path + description + updated_at + source_app, **no bodies**) to render the browsable view fast. |
| `GET` | `/memory/pending` / `POST /memory/pending/:id` | List and approve/reject pending facts. |

---

## 3. Extraction (the profiler brain)

Runs **async, off the critical path** — never blocks a reply.

**Trigger:** on `/memory/extract`, or a timer that batches recent conversations. For long chats, **chunk every ~20 turns** so the model never sees a 10k-line blob.

1. **Distil.** One small, cheap model call (low effort, strict JSON out). Returns an array of `{ path, tag, fact }` — durable facts only, one clause each, phrased to outlast specifics ("meeting-heavy mornings", not "10:15 standup"). Prompt rules: apply the three-month test; no transient state; no live/queryable data; no model-invented advice; one short line per fact; refuse PII it shouldn't keep (card/account numbers, government IDs).
2. **Merge, don't pile up.** For each fact: load the target file; if a line already covers the *same subject*, **rewrite that line** (this is what keeps files flat); only append if genuinely new. Write back with `if_version`; on `409`, re-read and retry once.
3. **Human gate (customer/sensitive):** drop into `memory_pending` for one-tap approve/reject in Nova Index/Hub instead of auto-writing.

**Keep files small:** cap each file (~2–4 KB). On overflow, run a one-shot **condense** pass that merges related lines. Small files = cheap reads = fast prompts.

---

## 4. Retrieval (what goes into the prompt)

Per chat turn:
1. Always load the **studio** file + the **current person's profile** — tiny and stable → **prompt-cache these**.
2. Load the **index** (path + description only). Pick the 1–3 files whose description/aliases match the turn. Load **only those bodies** (lazy loading — descriptions are the index, bodies load on demand).
3. Inject a compact block into the system prompt. Never dump every file.

**Performance musts (the "incredible" part):**
- **Prompt caching** on the stable prefix (studio + persona) — biggest latency/cost win.
- **Lazy body loading** via the index.
- **Token budget** per turn (~800 tokens of memory max); drop lowest-relevance first.
- **Edge-cache** `/memory/context` with short TTL, busted on write.
- Extraction **always async + chunked** — never blocks a reply.
- **One file per subject** → reads are O(subject), not O(everything).

---

## 5. Nova Index — the app

The browsable face. Built as a PWA in the shared Suite style (Archivo/Saira, the six themes), served by the Worker like Nova Notes/Calendar.

- **Browse:** people, topics, areas, studio — each file as a card showing its description and facts. Filter by scope, search by alias.
- **Live:** shows what was learned recently and which app wrote it (`source_app`), so you can watch the memory grow across the whole suite in one place.
- **Edit:** fix or delete any fact line inline (writes back through the engine with `if_version`).
- **Approve:** the pending-facts queue — one tap to accept or reject what extraction proposed.
- **Novelty-but-useful:** it makes the invisible brain tangible — "here is everything the suite knows," in one window.

---

## 6. Privacy & safety (non-negotiable)

- Memory holds client PII → store it like the agent's session data: **out of git**, scoped access, ZDR-friendly.
- Scope isolation enforced server-side: a customer token can never read `staff`/`studio` files.
- Never store payment-card/account numbers, government IDs, or anything a customer wouldn't expect kept. Extraction must refuse these.
- Audit columns (`updated_at`, `source_app`) so any fact is traceable and deletable on request.

---

## 7. Build order

1. D1 schema + engine API on the Worker (with `if_version` concurrency).
2. Retrieval + prompt-cache wiring in Nova Bot and Nova Agent (**read-only first — ship value immediately**). Replace Nova Agent's single-person `homeBase`/rhythm with the retrieved profile so multi-staff plans stop mixing.
3. Async extraction + merge-not-append logic.
4. **Nova Index app** — browse, edit, approve — plus the same memory screen surfaced inside Nova Hub.
5. Condense pass + token budgets + edge caching (the optimisation pass).

**Definition of done:** a fact learned in a website chat on Monday shapes Nova Agent's reply on Wednesday; the person's file is still under a page after a month; no reply ever waits on extraction; and Nova Index shows the whole suite's memory, growing live, in one browsable place.
