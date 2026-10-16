using System.Text;
using System.Text.RegularExpressions;

namespace TWise.Tenant.Application.Common;

/// <summary>
/// Lets an outer query read a saved view's SQL as a row source.
///
/// A single SELECT is wrapped as a derived table: <c>FROM ( sql ) alias</c>. A WITH query cannot be
/// (SQL Server rejects a CTE inside a subquery), so its final SELECT becomes one more CTE named
/// <c>alias</c> and the outer query reads from that. Anything else — DECLARE, temp tables, several
/// statements — is a batch and returns null; callers run it as written instead.
/// </summary>
public static partial class ViewSqlWrapper
{
    /// <param name="head">Text to put before the outer SELECT ("" or "WITH ..., alias AS (...)").</param>
    /// <param name="relation">What the outer query selects FROM.</param>
    public sealed record Wrapped(string Head, string Relation);

    [GeneratedRegex(@"\b(DECLARE|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|INTO|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|DENY|USE|GO|OPENROWSET|OPENQUERY|OPENDATASOURCE|WAITFOR)\b|#", RegexOptions.IgnoreCase)]
    private static partial Regex NotASingleSelect();

    [GeneratedRegex(@"^CREATE\s+(OR\s+(REPLACE|ALTER)\s+)?VIEW\s+\S+\s+AS\s+", RegexOptions.IgnoreCase)]
    private static partial Regex CreateViewPrefix();

    /// <param name="stripOrderBy">
    /// A top-level ORDER BY is not allowed in a derived table without TOP/OFFSET. When true it is
    /// dropped (the outer query orders); when false such SQL is not wrapped, so its order is kept.
    /// </param>
    public static Wrapped? Wrap(string sql, string alias, bool stripOrderBy)
    {
        var text = CreateViewPrefix().Replace(StripLeadingNoise(sql ?? ""), "").Trim();
        while (text.EndsWith(';')) text = text[..^1].TrimEnd();
        if (text.Length == 0) return null;

        var code = CodeOnly(text);
        if (code.Contains(';') || NotASingleSelect().IsMatch(code)) return null;

        if (StartsWithWord(code, "SELECT"))
        {
            var body = HandleOrderBy(text, code, stripOrderBy);
            return body is null ? null : new Wrapped("", $"({body}) AS {alias}");
        }
        if (StartsWithWord(code, "WITH"))
        {
            var mainStart = MainQueryStart(code);
            if (mainStart < 0) return null;
            var main = text[mainStart..];
            var mainCode = code[mainStart..];
            if (!StartsWithWord(mainCode, "SELECT")) return null;
            var body = HandleOrderBy(main, mainCode, stripOrderBy);
            if (body is null) return null;
            return new Wrapped($"{text[..mainStart].TrimEnd()},\n{alias} AS (\n{body}\n)\n", alias);
        }
        return null;
    }

    /// <summary>Leading whitespace, comments and the ";" people put before WITH.</summary>
    private static string StripLeadingNoise(string sql)
    {
        var s = sql.TrimStart();
        while (true)
        {
            if (s.StartsWith(';')) s = s[1..].TrimStart();
            else if (s.StartsWith("--")) { var nl = s.IndexOf('\n'); s = nl < 0 ? "" : s[(nl + 1)..].TrimStart(); }
            else if (s.StartsWith("/*")) { var end = s.IndexOf("*/", StringComparison.Ordinal); s = end < 0 ? "" : s[(end + 2)..].TrimStart(); }
            else return s;
        }
    }

    /// <summary>
    /// The SQL with string literals, [identifiers] and comments blanked out (same length, so
    /// positions line up), and everything inside parentheses replaced by spaces: what remains is
    /// the top level, where keywords and separators can be found safely.
    /// </summary>
    private static string CodeOnly(string sql)
    {
        var sb = new StringBuilder(sql.Length);
        var depth = 0;
        for (var i = 0; i < sql.Length; i++)
        {
            var c = sql[i];
            if (c == '\'' || c == '[' || c == '"')
            {
                var close = c == '[' ? ']' : c;
                sb.Append(' ');
                for (i++; i < sql.Length; i++)
                {
                    if (sql[i] == close)
                    {
                        if (i + 1 < sql.Length && sql[i + 1] == close) { sb.Append("  "); i++; continue; }
                        sb.Append(' ');
                        break;
                    }
                    sb.Append(sql[i] == '\n' ? '\n' : ' ');
                }
                continue;
            }
            if (c == '-' && i + 1 < sql.Length && sql[i + 1] == '-')
            {
                for (; i < sql.Length && sql[i] != '\n'; i++) sb.Append(' ');
                if (i < sql.Length) sb.Append('\n');
                continue;
            }
            if (c == '/' && i + 1 < sql.Length && sql[i + 1] == '*')
            {
                var end = sql.IndexOf("*/", i + 2, StringComparison.Ordinal);
                var stop = end < 0 ? sql.Length : end + 2;
                for (; i < stop; i++) sb.Append(' ');
                i--;
                continue;
            }
            // Only the outermost parentheses are kept, so a "(" here always pairs with the next ")".
            if (c == '(') { sb.Append(depth == 0 ? '(' : ' '); depth++; continue; }
            if (c == ')') { depth = Math.Max(0, depth - 1); sb.Append(depth == 0 ? ')' : ' '); continue; }
            sb.Append(depth > 0 ? ' ' : c);
        }
        return sb.ToString();
    }

    private static bool StartsWithWord(string code, string word)
    {
        var t = code.TrimStart();
        return t.StartsWith(word, StringComparison.OrdinalIgnoreCase) && (t.Length == word.Length || !char.IsLetterOrDigit(t[word.Length]));
    }

    /// <summary>Position of the SELECT after the CTE list: "WITH a AS (...), b (x, y) AS (...) SELECT ...".</summary>
    private static int MainQueryStart(string code)
    {
        var i = code.IndexOf("WITH", StringComparison.OrdinalIgnoreCase) + 4;
        while (i < code.Length)
        {
            var open = code.IndexOf('(', i);
            if (open < 0) return -1;
            var close = code.IndexOf(')', open);
            if (close < 0) return -1;
            var next = close + 1;
            while (next < code.Length && char.IsWhiteSpace(code[next])) next++;
            if (next >= code.Length) return -1;
            if (code[next] == ',') { i = next + 1; continue; }
            // "name (columns) AS (body)": the closed group was a column list, the body follows.
            if (code.Length - next >= 2 && code.Substring(next, 2).Equals("AS", StringComparison.OrdinalIgnoreCase)
                && (next + 2 == code.Length || !char.IsLetterOrDigit(code[next + 2]))) { i = next + 2; continue; }
            return next;
        }
        return -1;
    }

    private static string? HandleOrderBy(string select, string code, bool strip)
    {
        var m = Regex.Matches(code, @"\bORDER\s+BY\b", RegexOptions.IgnoreCase);
        if (m.Count == 0) return select;
        var at = m[^1].Index;
        // TOP or OFFSET makes ORDER BY legal inside a derived table, and part of the meaning.
        var hasTop = Regex.IsMatch(code, @"^\s*SELECT\s+(DISTINCT\s+)?TOP\b", RegexOptions.IgnoreCase);
        var hasOffset = Regex.IsMatch(code[at..], @"\bOFFSET\b", RegexOptions.IgnoreCase);
        if (hasTop || hasOffset) return select;
        return strip ? select[..at].TrimEnd() : null;
    }
}
