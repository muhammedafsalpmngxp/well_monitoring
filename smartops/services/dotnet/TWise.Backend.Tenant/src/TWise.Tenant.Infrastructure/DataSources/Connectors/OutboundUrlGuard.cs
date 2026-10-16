using System.Net;
using System.Net.Sockets;

namespace TWise.Tenant.Infrastructure.DataSources.Connectors;

/// <summary>
/// Blocks server-side request forgery on tenant-supplied URLs.
///
/// A REST data source lets a tenant choose a URL that this server then fetches, which without
/// a guard is a direct path into the private network the API runs in — including the cloud
/// instance metadata endpoint. Every destination is therefore checked twice: once on the literal
/// host, and again on each resolved IP, because a public hostname can resolve to a private
/// address (DNS rebinding).
///
/// Used by <see cref="RestApiConnector"/> before every outbound call, including each redirect hop.
/// </summary>
public static class OutboundUrlGuard
{
    /// <summary>Cloud instance metadata services — the highest-value SSRF target.</summary>
    private static readonly HashSet<string> BlockedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "metadata.google.internal",
        "metadata.goog",
        "instance-data",
    };

    private static readonly string[] BlockedHostSuffixes = [".localhost", ".internal", ".local"];

    /// <summary>
    /// Throws <see cref="InvalidOperationException"/> when the URL must not be fetched.
    /// The message is safe to show a user — it never echoes internal topology.
    /// </summary>
    public static async Task EnsureAllowedAsync(Uri uri, CancellationToken cancellationToken = default)
    {
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException($"Only http and https URLs are allowed (got '{uri.Scheme}').");

        var host = uri.DnsSafeHost;

        if (string.IsNullOrWhiteSpace(host))
            throw new InvalidOperationException("The request URL has no host.");

        if (BlockedHosts.Contains(host) || BlockedHostSuffixes.Any(s => host.EndsWith(s, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException($"The host '{host}' is not an allowed destination.");

        // A literal IP never reaches DNS, so check it directly.
        if (IPAddress.TryParse(host, out var literal))
        {
            EnsurePublic(literal, host);
            return;
        }

        IPAddress[] resolved;
        try
        {
            resolved = await Dns.GetHostAddressesAsync(host, cancellationToken);
        }
        catch (SocketException ex)
        {
            throw new InvalidOperationException($"The host '{host}' could not be resolved.", ex);
        }

        if (resolved.Length == 0)
            throw new InvalidOperationException($"The host '{host}' could not be resolved.");

        // Every resolved address must be public — one private answer is enough to reject.
        foreach (var address in resolved)
            EnsurePublic(address, host);
    }

    private static void EnsurePublic(IPAddress address, string host)
    {
        if (IsPrivate(address))
            throw new InvalidOperationException(
                $"The host '{host}' resolves to a private or reserved address, which is not an allowed destination.");
    }

    /// <summary>True for loopback, link-local, private, multicast, broadcast and otherwise reserved ranges.</summary>
    private static bool IsPrivate(IPAddress address)
    {
        if (IPAddress.IsLoopback(address)) return true;

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast) return true;

            // Unique local addresses (fc00::/7).
            var v6 = address.GetAddressBytes();
            if ((v6[0] & 0xFE) == 0xFC) return true;

            // An IPv4-mapped address (::ffff:a.b.c.d) must be judged on the embedded IPv4.
            if (address.IsIPv4MappedToIPv6) return IsPrivate(address.MapToIPv4());

            return false;
        }

        if (address.AddressFamily != AddressFamily.InterNetwork) return true;

        var b = address.GetAddressBytes();

        return b[0] switch
        {
            0 => true,                                     // 0.0.0.0/8  "this network"
            10 => true,                                    // 10.0.0.0/8 private
            127 => true,                                   // loopback
            169 when b[1] == 254 => true,                  // 169.254.0.0/16 link-local (cloud metadata)
            172 when b[1] >= 16 && b[1] <= 31 => true,     // 172.16.0.0/12 private
            192 when b[1] == 168 => true,                  // 192.168.0.0/16 private
            192 when b[1] == 0 && b[2] == 0 => true,       // 192.0.0.0/24 IETF protocol assignments
            100 when b[1] >= 64 && b[1] <= 127 => true,    // 100.64.0.0/10 carrier-grade NAT
            198 when b[1] == 18 || b[1] == 19 => true,     // 198.18.0.0/15 benchmarking
            >= 224 => true,                                // multicast + reserved + broadcast
            _ => false
        };
    }
}
