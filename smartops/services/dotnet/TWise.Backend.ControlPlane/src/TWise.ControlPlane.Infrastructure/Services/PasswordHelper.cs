using System.Security.Cryptography;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

/// <summary>
/// PBKDF2-SHA256 password hashing, no third-party libs. Stored format is versioned so the work
/// factor can be raised without invalidating existing users: a legacy "salt.hash" (100k
/// iterations) still verifies, and <see cref="NeedsRehash"/> lets the login path upgrade it.
///   v2 format: pbkdf2$&lt;iterations&gt;$&lt;salt&gt;$&lt;hash&gt;
/// </summary>
public static class PasswordHelper
{
    private const int SaltSize = 16;
    private const int HashSize = 32;
    /// <summary>OWASP 2023 guidance for PBKDF2-HMAC-SHA256.</summary>
    private const int Iterations = 600_000;
    private const int LegacyIterations = 100_000;
    private const string Prefix = "pbkdf2";

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashSize);
        return $"{Prefix}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string storedHash)
    {
        byte[] salt, expected;
        int iterations;
        var parts = storedHash.Split('$');
        if (parts.Length == 4 && parts[0] == Prefix)
        {
            if (!int.TryParse(parts[1], out iterations)) return false;
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        else
        {
            // Legacy "salt.hash" rows written before the format was versioned.
            var legacy = storedHash.Split('.');
            if (legacy.Length != 2) return false;
            iterations = LegacyIterations;
            salt = Convert.FromBase64String(legacy[0]);
            expected = Convert.FromBase64String(legacy[1]);
        }
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, HashSize);
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }

    /// <summary>True when the stored hash uses an older format or fewer iterations than current policy.</summary>
    public static bool NeedsRehash(string storedHash)
    {
        var parts = storedHash.Split('$');
        return parts.Length != 4 || parts[0] != Prefix || !int.TryParse(parts[1], out var it) || it < Iterations;
    }

    /// <summary>Password policy shared with the validators; see Application.Common.PasswordPolicy.</summary>
    public static string? CheckPolicy(string? password) => Application.Common.PasswordPolicy.Check(password);

    // Excludes visually ambiguous characters (0/O, 1/l/I) to keep manually shared passwords readable.
    private const string PasswordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";

    /// <summary>Generates a cryptographically strong random password that satisfies <see cref="CheckPolicy"/>.</summary>
    public static string Generate(int length = 12)
    {
        if (length < 10) length = 10;
        while (true)
        {
            var chars = new char[length];
            for (var i = 0; i < length; i++)
                chars[i] = PasswordAlphabet[RandomNumberGenerator.GetInt32(PasswordAlphabet.Length)];
            var candidate = new string(chars);
            if (CheckPolicy(candidate) is null) return candidate;
        }
    }
}
