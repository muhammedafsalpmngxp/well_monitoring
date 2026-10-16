using System.Text.RegularExpressions;

namespace TWise.Backend.ControlPlane.Application.Common;

/// <summary>The one password policy, used by validators and by the hasher's generator. Returns null when acceptable.</summary>
public static partial class PasswordPolicy
{
    public static string? Check(string? password)
    {
        if (string.IsNullOrEmpty(password) || password.Length < 10) return "Password must be at least 10 characters.";
        if (password.Length > 128) return "Password must not exceed 128 characters.";
        if (!Upper().IsMatch(password) || !Lower().IsMatch(password) || !Digit().IsMatch(password))
            return "Password must contain an upper-case letter, a lower-case letter and a digit.";
        return null;
    }

    [GeneratedRegex("[A-Z]")] private static partial Regex Upper();
    [GeneratedRegex("[a-z]")] private static partial Regex Lower();
    [GeneratedRegex("[0-9]")] private static partial Regex Digit();
}
