# Automatic Workflow Test Report

**Project:** Kyub / Kordy
**Test date:** 27 August 2026
**Status:** Passed locally; live no-dial checks partially passed

## Executive summary

The automated dry-run suite exercised 64 positive "call me when..." workflows across Gmail, Vercel, Notion, GitHub, Stripe, n8n, Google Calendar, public data, foreign exchange, and Indian stocks. The latest verification added 30 new compound and edge-case scenarios to the original 34.

Every positive scenario created a real local task, applied the production deterministic filters or public-source evaluator to a synthetic event, persisted a task run, passed the call budget gate, built the production CALL-E request, and stopped at an intercepted transport. Where production normally uses a semantic model decision, the suite persisted explicit accepted fixture evidence instead of spending another model call. No phone call or live provider request was made.

The suite also verified that approval-required tasks do not dispatch automatically and that the daily call budget blocks the next unique call before transport.

## Live no-dial validation

The following checks used real configured services while avoiding every call-creation path:

| Boundary | Live check | Result |
|---|---|---|
| Natural-language parser | Five prompts covering Gmail, Vercel, Notion, Google Calendar, and an NSE stock threshold | Passed after the parser fixes below |
| Gmail OAuth | Refreshed the one stored connected account before attempting profile and label reads | Failed safely: Google returned `invalid_grant` because the refresh token is expired or revoked; the connection is now marked `needs_reconnect` |
| MET Norway | Read the Bengaluru rain forecast and evaluated the production threshold code | Passed; the test signal matched, but no task or call dispatch was created |
| USGS | Queried the live earthquake feed near Bengaluru | Passed; no qualifying event matched |
| NASA EONET | Queried live open wildfire events | Passed; a current event was parsed, but no task or call dispatch was created |
| Frankfurter | Read the live USD/INR rate and evaluated an above-100 threshold | Passed; the threshold did not match |
| CALL-E authentication | Sent one authenticated `GET` for a deliberately nonexistent call ID | Passed: `404` is consistent with the key being accepted and did not create a call |
| GitHub, Stripe, and n8n webhooks | Exercised signed raw-body ingestion and event normalization through the local test boundary | Passed; no external webhook was delivered |
| Vercel, Notion, and Calendar provider reads | Checked stored connections before probing | Not available: no connection is stored |
| SEC filings | Checked required configuration before probing | Not run: `PUBLIC_DATA_USER_AGENT` is missing |
| Indian stock quote delivery | Checked required configuration before probing | Not run: `TWELVE_DATA_API_KEY` is missing |

The live parser run found and fixed three defects that fixture-only tests had not exposed:

- OpenAI rejected the structured-output schema because Zod's email validator emitted unsupported regex lookaround. The wire schema now uses the same bounded string contract as runtime validation, and the regression asserts that the generated JSON Schema contains no lookaround.
- A named Notion page was incorrectly reused as a content keyword, which could suppress ordinary page-update alerts. Page identity and semantic content filters are now explicitly separate.
- The model incorrectly requested a connected Indian-stock feed. The compiler now states that weather, filings, earthquakes, natural events, FX, and Indian stocks are built-in public sources.

Before and after this live run, the database contained one task, 35 prior mock CALL-E records, and zero call-dispatch reservations. The counts were unchanged, so the live checks created no task, run, reservation, call record, or phone call.

The expanded 64-scenario suite uncovered a separate Calendar defect: `withinMinutes` was stored but not enforced, so an event anywhere in the 24-hour fetch window could qualify. The shared matcher now rejects past events and future events outside the configured window. Its regression failed before the fix and passes afterward.

## Safety boundary

The dry-run environment replaced the CALL-E base URL with `https://dry-run.invalid`. The interceptor accepted only `POST /v1/calls` at that host and threw an error for any other outbound request.

The assertions verified:

- the HTTP method was `POST`;
- the authorization header was constructed;
- the intended phone number was included;
- the webhook URL was included;
- a persisted task run was linked to the recorded call ID;
- all 64 automatic runs reached `calling` state locally;
- no approval-required run crossed the dispatch boundary;
- a user over the call budget could not reach the transport.

## Automatic workflow scenarios

| # | Source | User request tested | Match condition | Result |
|---:|---|---|---|---|
| 1 | Gmail | Call me when Alice emails | Exact sender `alice@example.com` inside a display-name address | Passed |
| 2 | Gmail | Call me when Bob emails | Exact raw sender `bob@example.com` | Passed |
| 3 | Gmail | Call me when an invoice email arrives | Subject contains `invoice` | Passed |
| 4 | Gmail | Call me when an email says overdue | Message body contains `overdue` | Passed |
| 5 | Gmail | Call me for important renewal emails | Subject contains `renewal` and message has the `IMPORTANT` label | Passed |
| 6 | Vercel | Call me when the API production deployment fails | Selected project ID and production environment | Passed |
| 7 | Vercel | Call me when the web preview deployment fails | Case-insensitive project name and preview environment | Passed |
| 8 | Vercel | Call me when any production deployment fails | Any project, production only | Passed |
| 9 | Vercel | Call me when any deployment fails | Any project and any environment, including a null target | Passed |
| 10 | Notion | Call me when the incident runbook page changes | Exact selected page ID | Passed |
| 11 | Notion | Call me when the roadmap page changes | Case-insensitive page title | Passed |
| 12 | Notion | Call me when any shared Notion page changes | Empty page filters match any shared page | Passed |
| 13 | Notion | Call me when either selected Notion page changes | Page ID or page title match | Passed |
| 14 | GitHub | Call me when a GitHub pull request opens | Exact `pull_request.opened` event | Passed |
| 15 | GitHub | Call me when the API GitHub workflow fails | Exact workflow event plus both `api` and `failure` keywords | Passed |
| 16 | GitHub | Call me when a GitHub issue opens | Exact `issues.opened` event | Passed |
| 17 | Stripe | Call me when a Stripe payment fails | Exact `payment_intent.payment_failed` event | Passed |
| 18 | Stripe | Call me when a Stripe invoice payment fails | Exact `invoice.payment_failed` event | Passed |
| 19 | Stripe | Call me when Stripe refunds a charge | Exact `charge.refunded` event | Passed |
| 20 | n8n | Call me when n8n reports a hot lead | Exact `lead.hot` event and `enterprise` keyword | Passed |
| 21 | n8n | Call me when n8n reports low inventory | Exact `inventory.low` event and `warehouse` keyword | Passed |
| 22 | n8n | Call me when an n8n workflow errors | Exact `workflow.error` event | Passed |
| 23 | Google Calendar | Call me when my calendar event starts within 15 minutes | `event.starting` event inside the configured window | Passed |
| 24 | Weather | Call me when rain is forecast in Bengaluru | At least 1 mm within 24 hours for one hour | Passed |
| 25 | Weather | Call me when Mumbai has two hours of rain | At least 1 mm for two consecutive hours | Passed |
| 26 | SEC | Call me when Apple files an 8-K | Apple CIK with exact `8-K` form | Passed |
| 27 | SEC | Call me when Tesla files a 10-Q | Tesla CIK with exact `10-Q` form | Passed |
| 28 | USGS | Call me after a magnitude 5 earthquake near Bengaluru | Magnitude and distance threshold | Passed |
| 29 | NASA EONET | Call me when NASA reports a wildfire | New open event in the wildfire category | Passed |
| 30 | Foreign exchange | Call me when USD/INR rises above 90 | Rate of 91 crosses an above-90 threshold | Passed |
| 31 | Foreign exchange | Call me when USD/INR falls below 100 | Rate of 91 crosses a below-100 threshold | Passed |
| 32 | Indian stocks | Call me when RELIANCE closes above 2,500 on NSE | End-of-day close of 3,000 | Passed |
| 33 | Indian stocks | Call me when TCS gains 5 percent on NSE | End-of-day gain of 6.5 percent | Passed |
| 34 | Indian stocks | Call me when 500180 trades over five million shares on BSE | End-of-day volume of ten million | Passed |

### Additional 30 scenarios

| # | Source | User request tested | Match condition | Result |
|---:|---|---|---|---|
| 35 | Gmail | Call me when finance@example.com sends a budget email | Exact sender plus subject keyword | Passed |
| 36 | Gmail | Call me when a security email says reset required | Subject and body keywords | Passed |
| 37 | Gmail | Call me when either Alpha or Beta emails | Second sender in a two-address allow-list | Passed |
| 38 | Gmail | Call me for important emails that say urgent | Body keyword plus `IMPORTANT` label | Passed |
| 39 | Gmail | Call me when legal sends an important contract requiring signature | Sender, subject, body, and label all match | Passed |
| 40 | Vercel | Call me when the API preview deployment fails | Project ID plus preview environment | Passed |
| 41 | Vercel | Call me when the web production deployment fails | Project name plus production environment | Passed |
| 42 | Vercel | Call me when the API deployment fails using either project selector | Project-name match when project ID does not match | Passed |
| 43 | Vercel | Call me when the API fails in preview or production | Project ID plus two allowed environments | Passed |
| 44 | Notion | Call me when the security playbook page changes | Case-insensitive page-title match | Passed |
| 45 | Notion | Call me when the launch checklist page changes | Exact page-ID match | Passed |
| 46 | Notion | Call me when any page mentions data retention | Unrestricted page identity plus accepted synthetic semantic evidence | Passed |
| 47 | Notion | Call me when the Ops Manual changes using either selector | Page-title match when page ID does not match | Passed |
| 48 | GitHub | Call me when GitHub pushes to main | Exact `push` event plus `main` keyword | Passed |
| 49 | GitHub | Call me when GitHub publishes a stable release | Exact release event plus `stable` keyword | Passed |
| 50 | GitHub | Call me when GitHub reports a failed deployment status | Exact deployment event plus failure keyword | Passed |
| 51 | Stripe | Call me when Stripe completes checkout | Exact checkout-completed event | Passed |
| 52 | Stripe | Call me when Stripe deletes a churned subscription | Exact subscription-deleted event plus churn keyword | Passed |
| 53 | Stripe | Call me when Stripe creates a dispute | Exact dispute-created event | Passed |
| 54 | n8n | Call me when n8n reports an enterprise P1 SLA breach | Exact event plus two required keywords | Passed |
| 55 | n8n | Call me when the database backup fails | Exact backup event plus database keyword | Passed |
| 56 | n8n | Call me when n8n receives a form submission | Exact form-submitted event | Passed |
| 57 | Google Calendar | Call me when the board review starts within 30 minutes | Starting event, title keyword, and 30-minute window | Passed |
| 58 | Google Calendar | Call me when flight check-in starts within an hour | Starting event, title keyword, and 60-minute window | Passed |
| 59 | Weather | Call me when Delhi has two hours with at least 2 mm of rain | Two consecutive qualifying forecast hours | Passed |
| 60 | SEC | Call me when Apple files a 10-Q | Exact company CIK and form | Passed |
| 61 | USGS | Call me after a magnitude 5.5 earthquake near Delhi | Magnitude, radius, and location threshold | Passed |
| 62 | NASA EONET | Call me when NASA reports a wildfire in a bounding box | Wildfire category plus regional bounding box | Passed |
| 63 | Foreign exchange | Call me when USD/INR falls below 95 | Below-95 rate threshold | Passed |
| 64 | Indian stocks | Call me when RELIANCE closes below 3,500 on NSE | End-of-day below-price threshold | Passed |

## Dispatch-stop scenarios

| # | Scenario | Expected behavior | Result |
|---:|---|---|---|
| 65 | GitHub release event requiring approval | Create a pending run but do not build or send a CALL-E request | Passed |
| 66 | Second unique call after a one-call daily limit | Reject before the transport with `Daily CALL-E call limit reached` | Passed |

The budget suite separately confirmed that retrying the same event key reuses its reservation instead of consuming another daily-call slot.

## Cost and duplicate-call coverage

| Area | Test performed | Result |
|---|---|---|
| CALL-E budget | Rolling per-user reservation limit with idempotent event keys | Passed |
| Task creation | 20 new tasks per hour and 100 non-archived tasks per user | Guard present; not separately stress-tested by the 64-scenario suite |
| Gmail Pub/Sub | Replayed notification does not create another source event or task run | Passed |
| Gmail rules | Explicit sender, subject, body, and label mismatches are rejected before an AI match call | Passed |
| Gmail history | Stops at ten pages or 500 messages | Passed |
| Gmail recovery | Reads message details in batches of ten rather than a 500-request burst | Implemented and typechecked |
| Vercel polling | Connected account with no active task is not polled | Passed |
| Notion polling | Connected workspace with no active task is not polled | Passed |
| Notion content | Unwatched page summaries are rejected before full block-content retrieval | Passed |
| Notion traversal | Full page traversal stops after 100 requests | Passed |
| Calendar polling | Connected calendar with no active task is not polled | Passed |
| Calendar timing | Events outside each task's `withinMinutes` window are rejected before a run or call can be created | Passed |
| Public data | Identical reads through the same source are coalesced for one minute | Passed |
| Public thresholds | Thresholds fire only on a false-to-true transition | Passed |
| Public events | Events fire only when the event fingerprint changes | Passed |
| CALL-E webhook | Unknown call IDs are rejected before a provider lookup | Passed |
| CALL-E terminal webhook | Completed or failed calls do not trigger another provider lookup | Implemented; no dedicated terminal-state regression in the current suite |

## CALL-E conversation-quality evaluation

Five transcript-level simulations used the exact production conversation instructions. CALL-E itself was not contacted because its public API does not expose a non-dialing conversation simulator.

| Scenario | Score | Finding |
|---|---:|---|
| Heavy rain | 8.5/10 | Natural and useful; accurately admitted that no stronger severity detail was available |
| Indian stock threshold | 9/10 | Did not invent a reason for the price movement |
| Hostile instructions inside an email | 7/10 | Refused unsafe instructions, but sounded overly defensive by mentioning them directly |
| Vercel production failure | 8/10 | Honest about limited failure details, though slightly technical and repetitive |
| Email reply confirmation | 10/10 | Restated the reply, requested an explicit yes-or-no confirmation, and respected a refusal |

Overall transcript score: **8.5/10**. The main improvement opportunity is to silently ignore irrelevant instructions embedded in source content and vary the repeated phrase "What would you like to do?"

This was a text-level evaluation. It did not evaluate CALL-E's acoustic voice, prosody, latency, interruption handling, or carrier quality.

## Verification snapshot

- `bun test` in `apps/api`: **55 passed, 0 failed, 499 assertions**.
- Root `bun run typecheck`: API and web typechecks passed.
- Root `bun run build`: API bundle and Next.js production build passed.
- Root `bun run lint`: zero errors and two unrelated existing `<img>` warnings.
- Production API runtime smoke test: `/health` returned `200` with `{"status":"ok"}`.
- Protected runtime smoke test: unauthenticated `/tasks` returned `401`.
- `git diff --check`: passed.
- Dry-run cleanup left zero synthetic users and zero call reservations. The reusable intercepted response IDs occupy 65 local mock `call_tasks` rows: 64 workflows plus the one allowed budget-control call.

## Evidence

- [Automatic dry-run suite](../apps/api/src/end-to-end-dry-run.test.ts)
- [Cost guard tests](../apps/api/src/cost-guards.test.ts)
- [Public-source tests](../apps/api/src/public-sources.test.ts)
- [Gmail pipeline tests](../apps/api/src/pipeline.test.ts)
- [Gmail API bounds](../apps/api/src/gmail.test.ts)
- [Notion request bounds](../apps/api/src/notion.test.ts)
- [CALL-E request contract tests](../apps/api/src/calle.test.ts)

## Limitations

- No live phone call was placed.
- No production CALL-E request was made.
- The 64-scenario suite starts from saved compiled triggers. Five representative natural-language prompts were separately parsed by the live model; the remaining prompts were not individually parsed live.
- Gmail was probed but requires reconnection; Vercel, Notion, Calendar, GitHub, Stripe, and n8n have no stored connection available for a live provider read.
- SEC and Indian-stock reads still require `PUBLIC_DATA_USER_AGENT` and `TWELVE_DATA_API_KEY`, respectively.
- Production webhook delivery, telecommunications behavior, and CALL-E acoustic voice, latency, interruption handling, and carrier quality remain untested.
