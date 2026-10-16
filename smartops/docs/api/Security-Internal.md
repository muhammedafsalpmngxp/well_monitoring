# Security Hardening — Internal Notes

Companion to [Security-UserGuide.md](./Security-UserGuide.md). Branch `balu-security`.

## Why

A comparison with open-source BI platforms (LingxiBI, DataTeaCup, OpenBI) showed TWise had the
SSRF guard, AES-256-GCM at rest and a SQL allowlist, but no login brute-force protection, no
request rate limiting, no password policy, no login audit and no hardening headers. This branch
adds those five without new packages: everything is in ASP.NET Core 8 already.

## Files

| File | Role |
|---|---|
| `shared/dotnet/SmartOps.Shared/Middleware/SecurityHeadersMiddleware.cs` + `MiddlewareExtensions.UseSmartOpsSecurityHeaders` | Headers; wired first in `UseSmartOpsDefaults`, so every service using the shared defaults (ControlPlane, Auth, Finance…) gets them |
| `TWise.Tenant.API/Program.cs` | Same headers inline (the Tenant API does not reference SmartOps.Shared), `AddRateLimiter` global 600/min per address, `UseHsts` outside Development |
| `TWise.ControlPlane.Application/Common/PasswordPolicy.cs` | The one policy check; used by validators and by the hasher's generator |
| `TWise.ControlPlane.Application/Features/Access/Post/Validators.cs` | `CreateUserValidator` enforces the policy when a password is supplied |
| `TWise.ControlPlane.Infrastructure/Services/PasswordHelper.cs` | Versioned hash `pbkdf2$iter$salt$hash`, 600k iterations, legacy `salt.hash` still verifies, `NeedsRehash` |
| `TWise.ControlPlane.Application/Abstractions/Services/ILoginProtectionService.cs` | Lockout contract + `AccountLockedException` |
| `TWise.ControlPlane.Infrastructure/Services/LoginProtectionService.cs` | In-memory 5-failures-in-15-min → 15-min lock |
| `TWise.ControlPlane.Infrastructure/Services/AuthService.cs` | Lock check first, uniform failure path, reset + rehash on success, audit rows via `IGenericRepository<AuditEvent>` with the remote address |
| `TWise.ControlPlane.Application/Features/Auth/Post/CommandHandlers.cs` | Maps `AccountLockedException` to a 401 with the message |
| `TWise.ControlPlane.API/Program.cs`, `Controllers/AuthController.cs` | `AddRateLimiter` ("auth" 10/min per address + global 600/min), `UseRateLimiter`, `[EnableRateLimiting("auth")]`, `UseHsts` |

## Design decisions

* **Lockout is per account, rate limit is per address.** They cover different attacks: a
  password spray from many addresses against one account trips the lockout; a single client
  hammering login trips the limiter. The lock is checked before any hashing so a locked account
  also costs no CPU.
* **Uniform failure path.** Unknown email, empty hash and wrong password all fall through the same
  branch, record a failure and return the same 401 text, so the API does not enumerate accounts.
* **Memory, not database, for the counters.** Login is the hot path and the ControlPlane runs as
  one instance today. `IMemoryCache` with sliding expiry is enough; swap the two cache keys for
  `IDistributedCache` if it is scaled out. Audit rows do go to the database because they are the
  record.
* **Versioned hash format instead of bcrypt.** PBKDF2-SHA256 is already there and NIST/OWASP
  approved; adding BCrypt.Net would be a new dependency for no security gain. The iteration count
  was raised from 100k to 600k, and because the count is now stored in the hash it can be raised
  again later. Old rows are upgraded on the next successful login, when the clear-text password
  is available; no forced resets.
* **Headers are conservative.** `X-Frame-Options: SAMEORIGIN` rather than `DENY` because
  dashboards are shared and previewed inside the app's own origin; a CSP was not added because
  the API serves JSON and the SPA's CSP belongs to the web host.
* **Rate limiter partitions by `RemoteIpAddress`.** If a reverse proxy sits in front, configure
  `ForwardedHeaders` so this is the client address, not the proxy's, or every user shares one
  bucket.

## Verification

* ControlPlane and Tenant APIs build with 0 errors.
* Manual checks to run after restart: 6 wrong passwords → 6th answers "Too many failed
  attempts"; 11 rapid logins from one address → 429 with `Retry-After`; correct login on a legacy
  `salt.hash` user rewrites the row to `pbkdf2$600000$…`; create user with `abc` → 400 policy
  message; any response carries `X-Content-Type-Options: nosniff`.
