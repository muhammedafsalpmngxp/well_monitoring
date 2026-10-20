# Encryption key for stored secrets

The Tenant API encrypts every secret it stores in the tenant database with one key:

| Stored secret | Table / column |
|---|---|
| AI provider API keys | `core.AiProviders.api_key_encrypted` |
| Database connection passwords | `core.DatabaseConnections.password_hash` |
| Data source credentials | `core.DataSourceConnections.credentials_encrypted` |
| Marketplace secrets | `core.MarketplaceCatalogs.auth_value_encrypted` |
| Power BI client secrets | `core.PowerBiConnections.client_secret_encrypted` |

AES-256-GCM (`ConnectionPasswordHelper`), key derived from the setting `DatabaseConnections:EncryptionKey`
(at least 32 characters).

## The one rule

**Every Tenant API that uses the same tenant database must have the same `DatabaseConnections:EncryptionKey`.**
A secret saved by an API with another key cannot be read: the screen shows
*"This secret was saved with encryption key 1a2b3c4d5e6f, but this server has key …"* (or, for values saved
before key IDs existed, *"cannot be decrypted with key …: it was saved by a server with a different
DatabaseConnections:EncryptionKey"*).

## Which key does my PC use?

```
powershell -ExecutionPolicy Bypass -File smartops\scripts\check-encryption-key.ps1
```

It prints where the key comes from and a 12-character **fingerprint** (never the key). The API logs the same
fingerprint at startup: `Encryption key fingerprint 46f0fb5b0be1; …`. Same fingerprint = same key.

## Setting the key

| Where | How |
|---|---|
| Developer PC | `dotnet user-secrets set "DatabaseConnections:EncryptionKey" "<team key>" --project smartops/services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.API` (stored in your Windows profile, never in Git; overrides `appsettings.json`) |
| Server / container | environment variable `DatabaseConnections__EncryptionKey` (or the platform's secret store) |

Never commit a real key. `appsettings.json` in Git holds a `CHANGE_ME` placeholder; an API running on it logs a
warning, because anyone with the code could read what it encrypts.

Get the team key from the person who owns the environment, privately (not in chat, e-mail or Git).

## Changing the key (or moving everyone to one key)

1. Set the new key as `DatabaseConnections:EncryptionKey`.
2. Put the old key in `DatabaseConnections:PreviousEncryptionKeys` (a list):
   `dotnet user-secrets set "DatabaseConnections:PreviousEncryptionKeys:0" "<old key>" --project …`
   (environment variable: `DatabaseConnections__PreviousEncryptionKeys__0`).
3. Restart. Everything saved with the old key is still read; everything saved from now on uses the new key.
4. When every secret has been saved again (or after re-entering the remaining ones), remove the old key.

## Stored format

New values: `v2.{keyId}.{nonce}.{ciphertext}.{tag}` — `keyId` is the key's fingerprint, so the error names the key a
value needs. Values saved before this change (`{nonce}.{ciphertext}.{tag}`, and the legacy AES-CBC
`{iv}.{ciphertext}`) are still read: every configured key is tried.
