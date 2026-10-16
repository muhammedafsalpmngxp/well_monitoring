# Security Hardening — User Guide

Applies to the ControlPlane API (`/auth`, users) and the Tenant API. Nothing here changes how
you call the APIs day to day; it changes what happens when something abusive or careless does.

---

## Login protection

* **Account lockout.** Five failed logins for the same email within 15 minutes lock that account
  for 15 minutes. The response is `401` with
  `{ "message": "Too many failed attempts. Try again in 15 minutes." }`. A successful login clears
  the counter. Unknown emails are treated exactly like wrong passwords, so the response does not
  reveal which accounts exist.
* **Request rate limit on `/auth/*`.** At most 10 login or refresh requests per minute per client
  address. Beyond that the API answers `429 Too Many Requests` with a `Retry-After: 60` header.
* **Audit trail.** Every login attempt is written to the audit log with the outcome
  (`auth.login.success`, `auth.login.failed`, `auth.login.locked`), the email and the caller's
  address. Admins read it through the existing audit events endpoint.

## Passwords

* **Policy** for any password set through the API (user creation, reset): at least 10 characters,
  at most 128, with an upper-case letter, a lower-case letter and a digit. Generated temporary
  passwords satisfy it automatically. A create request with a weak password fails validation with
  the reason in the message.
* **Hashing** is PBKDF2-HMAC-SHA256 with 600,000 iterations (OWASP 2023 guidance), salted per
  user. Existing users keep working: an older hash is verified as before and silently upgraded the
  next time the user logs in, so no reset is needed.

## Request limits (both APIs)

* A general limit of 600 requests per minute per client address on every endpoint, returning
  `429` when exceeded. Normal interactive use stays far below this; it exists to stop runaway
  scripts. AI calls additionally count against the per-tenant daily quota set under Settings → AI.

## Response headers (both APIs)

Every response carries:

| Header | Value | Why |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Browsers must not guess content types |
| `X-Frame-Options` | `SAMEORIGIN` | No clickjacking of API-served pages from other sites |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | No URL leakage to third parties |
| `Permissions-Policy` | camera, microphone, geolocation, payment off | Features the app never uses |
| `Strict-Transport-Security` | set outside Development | Browsers keep using HTTPS |

## Already in place (unchanged)

* Database view previews accept read-only `SELECT` batches only: DDL, DML, `EXEC`, `GO` and
  comment-hidden statements are rejected server-side.
* Outbound URLs (REST imports, marketplaces) pass an SSRF guard that blocks private and loopback
  addresses.
* Connection passwords and AI provider keys are encrypted at rest with AES-256-GCM.
