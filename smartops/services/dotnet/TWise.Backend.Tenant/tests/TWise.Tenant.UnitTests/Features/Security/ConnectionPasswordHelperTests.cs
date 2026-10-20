using System.Security.Cryptography;
using System.Text;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Security;

/// <summary>
/// The secrets cipher: the key ring (current + previous keys), the key ID in new values, values written by the
/// previous code (3-part AES-GCM and 2-part AES-CBC), and errors that say which key a value needs.
/// One class on purpose: the helper holds its keys in static state, and xUnit runs a class's tests one at a time.
/// </summary>
public class ConnectionPasswordHelperTests
{
    private const string KeyA = "team-key-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private const string KeyB = "laptop-key-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    private const string KeyC = "other-key-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

    private static byte[] Derive(string secret) => Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(secret),
        "SmartOps.DatabaseConnections.Salt"u8.ToArray(), 100_000, HashAlgorithmName.SHA256, 32);

    /// <summary>A value exactly as the previous code wrote it: Base64(nonce).Base64(ciphertext).Base64(tag).</summary>
    private static string OldGcm(string secret, string plain)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var bytes = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[bytes.Length];
        var tag = new byte[16];
        using var gcm = new AesGcm(Derive(secret), 16);
        gcm.Encrypt(nonce, bytes, cipher, tag);
        return $"{Convert.ToBase64String(nonce)}.{Convert.ToBase64String(cipher)}.{Convert.ToBase64String(tag)}";
    }

    /// <summary>A legacy AES-CBC value: Base64(iv).Base64(ciphertext).</summary>
    private static string OldCbc(string secret, string plain)
    {
        using var aes = Aes.Create();
        aes.Key = Derive(secret);
        aes.GenerateIV();
        using var enc = aes.CreateEncryptor();
        var bytes = Encoding.UTF8.GetBytes(plain);
        return $"{Convert.ToBase64String(aes.IV)}.{Convert.ToBase64String(enc.TransformFinalBlock(bytes, 0, bytes.Length))}";
    }

    [Fact]
    public void New_values_name_their_key_and_round_trip()
    {
        ConnectionPasswordHelper.Initialize(KeyA);
        var stored = ConnectionPasswordHelper.Encrypt("sk-secret");
        var parts = stored.Split('.');
        parts.Should().HaveCount(5);
        parts[0].Should().Be("v2");
        parts[1].Should().Be(ConnectionPasswordHelper.Fingerprint(KeyA)).And.HaveLength(12);
        stored.Should().NotContain(KeyA);
        ConnectionPasswordHelper.Decrypt(stored).Should().Be("sk-secret");
        ConnectionPasswordHelper.KeyId.Should().Be(ConnectionPasswordHelper.Fingerprint(KeyA));
    }

    [Fact]
    public void The_fingerprint_is_the_one_the_check_script_prints()
    {
        // check-encryption-key.ps1: first 12 hex of SHA-256 over the UTF-8 value, lower case.
        var expected = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(KeyA)))[..12].ToLowerInvariant();
        ConnectionPasswordHelper.Fingerprint(KeyA).Should().Be(expected);
    }

    [Fact]
    public void Values_written_by_the_previous_code_still_read()
    {
        ConnectionPasswordHelper.Initialize(KeyA);
        ConnectionPasswordHelper.Decrypt(OldGcm(KeyA, "db-password")).Should().Be("db-password");
        ConnectionPasswordHelper.Decrypt(OldCbc(KeyA, "legacy-password")).Should().Be("legacy-password");
    }

    [Fact]
    public void A_previous_key_still_reads_old_and_new_values_and_new_saves_use_the_current_key()
    {
        ConnectionPasswordHelper.Initialize(KeyB);
        var savedWithB = ConnectionPasswordHelper.Encrypt("from-b");
        var oldWithB = OldGcm(KeyB, "old-from-b");

        ConnectionPasswordHelper.Initialize(KeyA, [KeyB]);   // the team moves to key A, B stays readable
        ConnectionPasswordHelper.Decrypt(savedWithB).Should().Be("from-b");
        ConnectionPasswordHelper.Decrypt(oldWithB).Should().Be("old-from-b");
        ConnectionPasswordHelper.Decrypt(OldCbc(KeyB, "cbc-from-b")).Should().Be("cbc-from-b");
        ConnectionPasswordHelper.Encrypt("x").Split('.')[1].Should().Be(ConnectionPasswordHelper.Fingerprint(KeyA));
        ConnectionPasswordHelper.PreviousKeyIds.Should().Equal(ConnectionPasswordHelper.Fingerprint(KeyB));
    }

    [Fact]
    public void A_value_saved_with_another_key_says_which_key_it_needs()
    {
        ConnectionPasswordHelper.Initialize(KeyB);
        var savedWithB = ConnectionPasswordHelper.Encrypt("from-b");

        ConnectionPasswordHelper.Initialize(KeyA);
        var act = () => ConnectionPasswordHelper.Decrypt(savedWithB);
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"*saved with encryption key {ConnectionPasswordHelper.Fingerprint(KeyB)}*this server has key {ConnectionPasswordHelper.Fingerprint(KeyA)}*")
            .Where(e => !e.Message.Contains(KeyA) && !e.Message.Contains(KeyB));
    }

    [Fact]
    public void An_old_value_from_another_key_explains_the_key_mismatch()
    {
        ConnectionPasswordHelper.Initialize(KeyA, [KeyC]);
        var act = () => ConnectionPasswordHelper.Decrypt(OldGcm(KeyB, "x"));
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"*cannot be decrypted with keys {ConnectionPasswordHelper.Fingerprint(KeyA)}, {ConnectionPasswordHelper.Fingerprint(KeyC)}*different*EncryptionKey*");
    }

    [Fact]
    public void A_changed_value_fails_its_integrity_check()
    {
        ConnectionPasswordHelper.Initialize(KeyA);
        var parts = ConnectionPasswordHelper.Encrypt("secret").Split('.');
        var cipher = Convert.FromBase64String(parts[3]);
        cipher[0] ^= 0xFF;
        parts[3] = Convert.ToBase64String(cipher);
        var act = () => ConnectionPasswordHelper.Decrypt(string.Join('.', parts));
        act.Should().Throw<InvalidOperationException>().WithMessage("*integrity check*");
    }

    [Theory]
    [InlineData("not-a-secret")]
    [InlineData("a.b.c.d")]
    [InlineData("")]
    public void Unknown_formats_are_refused(string value)
    {
        ConnectionPasswordHelper.Initialize(KeyA);
        var act = () => ConnectionPasswordHelper.Decrypt(value);
        act.Should().Throw<InvalidOperationException>().WithMessage("*unsupported format*");
    }

    [Fact]
    public void Corrupted_base64_is_reported()
    {
        ConnectionPasswordHelper.Initialize(KeyA);
        var act = () => ConnectionPasswordHelper.Decrypt("v2." + ConnectionPasswordHelper.Fingerprint(KeyA) + ".!!.!!.!!");
        act.Should().Throw<InvalidOperationException>().WithMessage("*corrupted*");
    }

    [Theory]
    [InlineData("short")]
    [InlineData("")]
    public void Keys_shorter_than_32_characters_are_refused(string key)
    {
        var current = () => ConnectionPasswordHelper.Initialize(key);
        current.Should().Throw<InvalidOperationException>().WithMessage("*EncryptionKey*at least 32*");
        var previous = () => ConnectionPasswordHelper.Initialize(KeyA, ["too-short"]);
        previous.Should().Throw<InvalidOperationException>().WithMessage("*PreviousEncryptionKeys*at least 32*");
    }

    [Fact]
    public void Blank_and_repeated_previous_keys_are_ignored()
    {
        ConnectionPasswordHelper.Initialize(KeyA, [null, " ", KeyA, KeyB, KeyB]);
        ConnectionPasswordHelper.PreviousKeyIds.Should().Equal(ConnectionPasswordHelper.Fingerprint(KeyB));
    }
}
