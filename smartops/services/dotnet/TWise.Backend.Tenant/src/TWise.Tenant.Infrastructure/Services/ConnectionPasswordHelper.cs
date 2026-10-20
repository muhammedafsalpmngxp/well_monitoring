using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// AES-256-GCM authenticated encryption for every secret the tenant database stores (connection passwords, data
/// source credentials, AI provider keys, Marketplace and Power BI secrets). Tampered ciphertext is always detected.
///
/// Keys: DatabaseConnections:EncryptionKey encrypts; DatabaseConnections:PreviousEncryptionKeys (optional) are only
/// tried for reading, so the key can be changed without breaking what is already stored. Every server that shares a
/// tenant database must use the same key. A key's ID is the first 12 hex digits of SHA-256 of the configured value —
/// the same fingerprint smartops/scripts/check-encryption-key.ps1 prints — and never reveals the key.
///
/// Storage formats (all Base64 parts, dot-separated):
///   v2.{keyId}.{nonce}.{ciphertext}.{tag}   written now: names the key it needs
///   {nonce}.{ciphertext}.{tag}              older AES-GCM values: every configured key is tried
///   {iv}.{ciphertext}                       legacy AES-CBC values: every configured key is tried
/// </summary>
public static class ConnectionPasswordHelper
{
    private const int NonceSize = 12; // AES-GCM standard nonce size
    private const int TagSize = 16;   // 128-bit authentication tag
    private const string V2 = "v2";

    private sealed record RingKey(string Id, byte[] Key);

    /// <summary>The current key first, then the previous ones.</summary>
    private static RingKey[] _ring = [];

    /// <summary>The fingerprint of the key new values are encrypted with (empty before Initialize).</summary>
    public static string KeyId => _ring.Length > 0 ? _ring[0].Id : "";

    /// <summary>Fingerprints of the older keys that are still tried when reading.</summary>
    public static IReadOnlyList<string> PreviousKeyIds => _ring.Skip(1).Select(k => k.Id).ToList();

    /// <summary>
    /// Must be called at startup with the app's encryption key (min 32 chars). <paramref name="previousKeys"/> are older
    /// keys still accepted for reading (blank entries and repeats of the current key are ignored).
    /// </summary>
    public static void Initialize(string encryptionKey, IEnumerable<string?>? previousKeys = null)
    {
        Require(encryptionKey, "DatabaseConnections:EncryptionKey");
        var ring = new List<RingKey> { new(Fingerprint(encryptionKey), DeriveKey(encryptionKey)) };
        foreach (var old in previousKeys ?? [])
        {
            if (string.IsNullOrWhiteSpace(old)) continue;
            Require(old, "DatabaseConnections:PreviousEncryptionKeys");
            var id = Fingerprint(old);
            if (ring.All(k => k.Id != id)) ring.Add(new RingKey(id, DeriveKey(old)));
        }
        _ring = [.. ring];
    }

    /// <summary>A key's ID: first 12 hex digits of SHA-256 of the configured value (as check-encryption-key.ps1 prints).</summary>
    public static string Fingerprint(string secret) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret)))[..12].ToLowerInvariant();

    public static string Encrypt(string plainText)
    {
        EnsureInitialized();
        var current = _ring[0];

        var nonce = new byte[NonceSize];
        RandomNumberGenerator.Fill(nonce);

        var plainBytes = Encoding.UTF8.GetBytes(plainText);
        var cipherBytes = new byte[plainBytes.Length];
        var tag = new byte[TagSize];

        using var aesGcm = new AesGcm(current.Key, TagSize);
        aesGcm.Encrypt(nonce, plainBytes, cipherBytes, tag);

        return $"{V2}.{current.Id}.{Convert.ToBase64String(nonce)}.{Convert.ToBase64String(cipherBytes)}.{Convert.ToBase64String(tag)}";
    }

    public static string Decrypt(string encrypted)
    {
        EnsureInitialized();

        var parts = (encrypted ?? "").Split('.');

        if (parts.Length == 5 && parts[0] == V2)
        {
            var key = _ring.FirstOrDefault(k => k.Id == parts[1]) ?? throw new InvalidOperationException(
                $"This secret was saved with encryption key {parts[1]}, but this server has {Describe()}. " +
                "Every server that shares this database must use the same DatabaseConnections:EncryptionKey " +
                "(compare with smartops/scripts/check-encryption-key.ps1), or add the old key to " +
                "DatabaseConnections:PreviousEncryptionKeys. Otherwise enter the secret again.");
            return DecryptGcm(key, parts[2], parts[3], parts[4], tampered: true);
        }

        // Older values carry no key ID: try every configured key, the current one first.
        if (parts.Length == 3)
        {
            foreach (var key in _ring)
            {
                try { return DecryptGcm(key, parts[0], parts[1], parts[2], tampered: false); }
                catch (WrongKeyException) { /* next key */ }
            }
            throw new InvalidOperationException(
                $"This secret cannot be decrypted with {Describe()}: it was saved by a server with a different " +
                "DatabaseConnections:EncryptionKey. Use the same key on every server that shares this database " +
                "(compare with smartops/scripts/check-encryption-key.ps1), or enter the secret again.");
        }

        // Support legacy 2-part format (AES-CBC without authentication) — prompt re-encryption
        if (parts.Length == 2)
        {
            foreach (var key in _ring)
            {
                try { return DecryptLegacyCbc(key.Key, parts[0], parts[1]); }
                catch (WrongKeyException) { /* next key */ }
            }
            throw new InvalidOperationException(
                "Connection password cannot be decrypted. It may have been stored with a different key or legacy format. " +
                "Please update the connection with a new password.");
        }

        throw new InvalidOperationException(
            "Connection password is in an unsupported format. Please update the connection with a new password.");
    }

    /// <summary>Thrown inside Decrypt when a key does not open a value, so the next key can be tried.</summary>
    private sealed class WrongKeyException : Exception;

    private static string DecryptGcm(RingKey key, string nonceB64, string cipherB64, string tagB64, bool tampered)
    {
        byte[] nonce, cipherBytes, tag;
        try
        {
            nonce = Convert.FromBase64String(nonceB64);
            cipherBytes = Convert.FromBase64String(cipherB64);
            tag = Convert.FromBase64String(tagB64);
        }
        catch (FormatException)
        {
            throw new InvalidOperationException("Connection password is corrupted. Please update the connection with a new password.");
        }

        if (nonce.Length != NonceSize || tag.Length != TagSize)
            throw new InvalidOperationException(
                "Connection password was stored with a legacy format. Please update the connection with a new password.");

        var plainBytes = new byte[cipherBytes.Length];
        try
        {
            using var aesGcm = new AesGcm(key.Key, TagSize);
            aesGcm.Decrypt(nonce, cipherBytes, tag, plainBytes);
            return Encoding.UTF8.GetString(plainBytes);
        }
        catch (CryptographicException) when (!tampered)
        {
            throw new WrongKeyException();
        }
        catch (CryptographicException)
        {
            // The value names this key, so a failure means the value itself was changed.
            throw new InvalidOperationException(
                "This secret failed its integrity check: it was changed after it was saved. Please enter it again.");
        }
    }

    /// <summary>
    /// Backward-compatible decryption for values encrypted with the previous AES-CBC format.
    /// Once decrypted, the service re-encrypts with AES-GCM on the next update.
    /// </summary>
    private static string DecryptLegacyCbc(byte[] key, string ivBase64, string cipherBase64)
    {
        byte[] iv, cipherBytes;
        try
        {
            iv = Convert.FromBase64String(ivBase64);
            cipherBytes = Convert.FromBase64String(cipherBase64);
        }
        catch (FormatException)
        {
            throw new InvalidOperationException("Connection password is corrupted. Please update the connection with a new password.");
        }

        if (iv.Length != 16)
            throw new InvalidOperationException(
                "Connection password was stored with a legacy format. Please update the connection with a new password.");

        try
        {
            using var aes = Aes.Create();
            aes.Key = key;
            aes.IV = iv;
            using var decryptor = aes.CreateDecryptor();
            var plainBytes = decryptor.TransformFinalBlock(cipherBytes, 0, cipherBytes.Length);
            return Encoding.UTF8.GetString(plainBytes);
        }
        catch (CryptographicException)
        {
            throw new WrongKeyException();
        }
    }

    private static string Describe() =>
        _ring.Length == 1 ? $"key {_ring[0].Id}" : $"keys {string.Join(", ", _ring.Select(k => k.Id))}";

    private static void Require(string secret, string setting)
    {
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32)
            throw new InvalidOperationException($"{setting}: an encryption key must be at least 32 characters.");
    }

    private static byte[] DeriveKey(string secret)
    {
        return Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(secret),
            "SmartOps.DatabaseConnections.Salt"u8.ToArray(),
            100_000,
            HashAlgorithmName.SHA256,
            32);
    }

    private static void EnsureInitialized()
    {
        if (_ring.Length == 0)
            throw new InvalidOperationException("ConnectionPasswordHelper not initialized. Call Initialize() at startup.");
    }

    public static string BuildConnectionString(DatabaseConnection conn) =>
        new SqlConnectionStringBuilder
        {
            DataSource = conn.Port == 1433 ? conn.Server : $"{conn.Server},{conn.Port}",
            InitialCatalog = conn.DatabaseName,
            UserID = conn.Username,
            Password = Decrypt(conn.PasswordHash),
            TrustServerCertificate = conn.TrustServerCertificate,
            ConnectTimeout = 30
        }.ConnectionString;
}
