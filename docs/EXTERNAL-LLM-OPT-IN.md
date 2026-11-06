# External AI: disabled by default

Synthetic demonstration only. Do not send real learner, student, patient, client
or confidential data to external providers. Provider output is unverified and does
not establish eligibility, compliance, credentials, placement or financial exposure.

The default is no external LLM call, even when a provider key is already configured.
An operator must explicitly set `TSM_EXTERNAL_LLM_OPT_IN=synthetic-only` before
starting the application to enable the existing server provider calls. The opt-in
is not accepted from a request. Existing provider credential configuration is still
required; no credentials or environment files were read or changed by this work.

The shared fetch wrapper gates provider destinations and completion/message/response
paths in provider-bearing server modules, including all five College departments,
Career Training, the main server, serverless handlers and legacy standalone servers.
The legacy raw HTTPS Groq transport is gated separately. Non-provider server fetches
continue normally. Provider failure handlers may return their existing degraded
answer, with the disabled/synthetic notice from the gate; no provider call occurs.

The main server sends a synthetic-only notice header and, while disabled, a
`connect-src 'self'` CSP. This blocks direct provider requests from legacy browser
pages. It also blocks other cross-origin browser connections until explicit opt-in;
same-origin application APIs remain available. Legacy browser pages may still show
stale optimistic provider labels. This change does not certify their content or
make them governed pilots. Separate static hosting must retain this CSP or disable
provider code independently. New provider transports must use this policy too.

No server was started, no account activated, no real provider request was sent, and
no deployment performed. Tests use stub transports exclusively.

Run: `node --test tests/unit/external-llm-policy.test.cjs`.
