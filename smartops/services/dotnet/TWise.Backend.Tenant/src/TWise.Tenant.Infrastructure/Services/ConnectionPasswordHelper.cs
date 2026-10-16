using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.SqlClient;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// AES-256-GCM authenticated encryption for database connection passwords.
/// Uses AEAD (Authenticated Encryption with Associated Data) which provides
/// both confidentiality and integrity — tampered ciphertext is always detected.
/// The encryption key is derived from the application's configured secret via PBKDF2.
/// Storage format: Base64(nonce).Base64(ciphertext).Base64(tag)
/// </summary>
public static class ConnectionPasswordHelper
{
    private const int NonceSize = 12; // AES-GCM standard nonce size
    private const int TagSize = 16;   // 128-bit authentication tag

    private static byte[]? _key;

    /// <summary>Must be called at startup with the app's encryption key (min 32 chars).</summary>
    public static void Initialize(string encryptionKey)
    {
        if (string.IsNullOrWhiteSpace(encryptionKey) || encryptionKey.Length < 32)
            throw new InvalidOperationException("Encryption key must be at least 32 characters.");

        _key = DeriveKey(encryptionKey);
    }

    public static string Encrypt(string plainText)
    {
        EnsureInitialized();

        var nonce = new byte[NonceSize];
        RandomNumberGenerator.Fill(nonce);

        var plainBytes = Encoding.UTF8.GetBytes(plainText);
        var cipherBytes = new byte[plainBytes.Length];
        var tag = new byte[TagSize];

        using var aesGcm = new AesGcm(_key!, TagSize);
        aesGcm.Encrypt(nonce, plainBytes, cipherBytes, tag);

        // Store as Nonce.CipherText.Tag (all Base64)
        return $"{Convert.ToBase64String(nonce)}.{Convert.ToBase64String(cipherBytes)}.{Convert.ToBase64String(tag)}";
    }

    public static string Decrypt(string encrypted)
    {
        EnsureInitialized();

        var parts = encrypted.Split('.');

        // Support legacy 2-part format (AES-CBC without authentication) — prompt re-encryption
        if (parts.Length == 2)
            return DecryptLegacyCbc(parts[0], parts[1]);

        if (parts.Length != 3)
            throw new InvalidOperationException(
                "Connection password is in an unsupported format. Please update the connection with a new password.");

        try
        {
            var nonce = Convert.FromBase64String(parts[0]);
            var cipherBytes = Convert.FromBase64String(parts[1]);
            var tag = Convert.FromBase64String(parts[2]);

            if (nonce.Length != NonceSize)
                throw new InvalidOperationException(
                    "Connection password was stored with a legacy format. Please update the connection with a new password.");

            var plainBytes = new byte[cipherBytes.Length];

            using var aesGcm = new AesGcm(_key!, TagSize);
            aesGcm.Decrypt(nonce, cipherBytes, tag, plainBytes);

            return Encoding.UTF8.GetString(plainBytes);
        }
        catch (CryptographicException)
        {
            throw new InvalidOperationException(
                "Connection password cannot be decrypted — authentication failed. " +
                "The data may have been tampered with or stored with a different key. " +
                "Please update the connection with a new password.");
        }
        catch (FormatException)
        {
            throw new InvalidOperationException(
                "Connection password is corrupted. Please update the connection with a new password.");
        }
    }

    /// <summary>
    /// Backward-compatible decryption for values encrypted with the previous AES-CBC format.
    /// Once decrypted, the service re-encrypts with AES-GCM on the next update.
    /// </summary>
    private static string DecryptLegacyCbc(string ivBase64, string cipherBase64)
    {
        try
        {
            var iv = Convert.FromBase64String(ivBase64);
            var cipherBytes = Convert.FromBase64String(cipherBase64);

            if (iv.Length != 16)
                throw new InvalidOperationException(
                    "Connection password was stored with a legacy format. Please update the connection with a new password.");

            using var aes = Aes.Create();
            aes.Key = _key!;
            aes.IV = iv;

            using var decryptor = aes.CreateDecryptor();
            var plainBytes = decryptor.TransformFinalBlock(cipherBytes, 0, cipherBytes.Length);
            return Encoding.UTF8.GetString(plainBytes);
        }
        catch (CryptographicException)
        {
            throw new InvalidOperationException(
                "Connection password cannot be decrypted. It may have been stored with a different key or legacy format. " +
                "Please update the connection with a new password.");
        }
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
        if (_key is null)
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
