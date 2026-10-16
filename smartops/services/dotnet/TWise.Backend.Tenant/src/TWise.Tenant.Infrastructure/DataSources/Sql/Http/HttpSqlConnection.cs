using System.Collections;
using System.Data;
using System.Data.Common;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace TWise.Tenant.Infrastructure.DataSources.Sql.Http;

/// <summary>One result set returned by an HTTP SQL engine.</summary>
public sealed record HttpSqlResult(IReadOnlyList<string> Columns, IReadOnlyList<string> Types, IReadOnlyList<object?[]> Rows)
{
    public static readonly HttpSqlResult Empty = new([], [], []);
}

/// <summary>Raised for engine errors and transport failures of the HTTP providers.</summary>
public sealed class HttpSqlException(string message, Exception? inner = null) : DbException(message, inner);

/// <summary>
/// Minimal ADO.NET shell over an HTTP query API (ClickHouse, Trino/Presto). The callers only
/// need Open, a transaction they can roll back, CreateCommand, ExecuteReader and a forward-only
/// reader, so that is all this implements. Subclasses turn one SQL text into a result set.
/// Connection strings are plain "key=value;" pairs: Server, Port, Database, Username, Password,
/// TrustServerCertificate, Timeout.
/// </summary>
public abstract class HttpSqlConnection : DbConnection
{
    // Two shared clients: one validating TLS certificates, one accepting any (the connection's
    // TrustServerCertificate flag). Redirects are never followed; the engine URL is used as given.
    private static readonly HttpClient Secure = Create(false);
    private static readonly HttpClient Insecure = Create(true);

    private static HttpClient Create(bool trustAnyCertificate)
    {
        var handler = new SocketsHttpHandler { AllowAutoRedirect = false };
        if (trustAnyCertificate)
            handler.SslOptions.RemoteCertificateValidationCallback = (_, _, _, _) => true;
        return new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }

    private readonly DbConnectionStringBuilder _settings;
    private ConnectionState _state = ConnectionState.Closed;

    protected HttpSqlConnection(string connectionString)
    {
        ConnectionString = connectionString;
        _settings = new DbConnectionStringBuilder { ConnectionString = connectionString };
    }

    protected string Setting(string key) => _settings.TryGetValue(key, out var v) ? v?.ToString() ?? "" : "";
    protected int IntSetting(string key, int fallback) => int.TryParse(Setting(key), out var v) ? v : fallback;
    protected bool BoolSetting(string key) => bool.TryParse(Setting(key), out var v) && v;

    protected HttpClient Http => BoolSetting("TrustServerCertificate") ? Insecure : Secure;

    /// <summary>Server may be a host name or a full http(s) URL; the port picks https for 443/8443.</summary>
    protected Uri BaseUri
    {
        get
        {
            var server = Setting("Server").Trim();
            var port = IntSetting("Port", 0);
            if (server.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                server.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                var fromUrl = new UriBuilder(server);
                if (port > 0 && fromUrl.Uri.IsDefaultPort) fromUrl.Port = port;
                return fromUrl.Uri;
            }
            var scheme = port is 443 or 8443 ? "https" : "http";
            return new UriBuilder(scheme, server, port).Uri;
        }
    }

    protected static AuthenticationHeaderValue BasicAuth(string user, string password) =>
        new("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user}:{password}")));

    /// <summary>Runs one statement. Statements that return nothing yield <see cref="HttpSqlResult.Empty"/>.</summary>
    public abstract Task<HttpSqlResult> ExecuteAsync(string sql, int timeoutSeconds, CancellationToken cancellationToken);

    protected static async Task<HttpResponseMessage> SendAsync(
        HttpClient client, HttpRequestMessage request, int timeoutSeconds, CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        if (timeoutSeconds > 0) cts.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
        try
        {
            return await client.SendAsync(request, HttpCompletionOption.ResponseContentRead, cts.Token);
        }
        catch (HttpRequestException ex)
        {
            throw new HttpSqlException($"Could not reach {request.RequestUri?.Host}: {ex.Message}", ex);
        }
        catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            throw new HttpSqlException($"The query did not complete within {timeoutSeconds}s.", ex);
        }
    }

    /// <summary>JSON cell to a CLR value. Engines quote 64-bit integers, so the type name breaks the tie.</summary>
    protected static object? ToValue(JsonElement cell, string typeName)
    {
        switch (cell.ValueKind)
        {
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return DBNull.Value;
            case JsonValueKind.True:
                return true;
            case JsonValueKind.False:
                return false;
            case JsonValueKind.Number:
                if (cell.TryGetInt64(out var l)) return l;
                if (cell.TryGetDecimal(out var d)) return d;
                return cell.GetDouble();
            case JsonValueKind.String:
                var s = cell.GetString()!;
                if (typeName.Contains("Int", StringComparison.OrdinalIgnoreCase) && long.TryParse(s, out var parsed)) return parsed;
                return s;
            default:
                return cell.GetRawText();
        }
    }

    // ── DbConnection surface ────────────────────────────────────────────────
    [System.Diagnostics.CodeAnalysis.AllowNull]
    public override string ConnectionString { get; set; }
    public override string Database => Setting("Database");
    public override string DataSource => Setting("Server");
    public override string ServerVersion => string.Empty;
    public override ConnectionState State => _state;
    public override void ChangeDatabase(string databaseName) => throw new NotSupportedException();
    public override void Open() => _state = ConnectionState.Open;
    public override Task OpenAsync(CancellationToken cancellationToken) { Open(); return Task.CompletedTask; }
    public override void Close() => _state = ConnectionState.Closed;
    protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) => new NoOpTransaction(this, isolationLevel);
    protected override DbCommand CreateDbCommand() => new HttpSqlCommand(this);

    /// <summary>Queries are read-only over HTTP; the transaction the preview wraps them in has nothing to undo.</summary>
    private sealed class NoOpTransaction(HttpSqlConnection connection, IsolationLevel isolationLevel) : DbTransaction
    {
        protected override DbConnection DbConnection => connection;
        public override IsolationLevel IsolationLevel => isolationLevel;
        public override void Commit() { }
        public override void Rollback() { }
    }
}

/// <summary>Command that hands its text to <see cref="HttpSqlConnection.ExecuteAsync"/>. Parameters are not supported.</summary>
public sealed class HttpSqlCommand(HttpSqlConnection connection) : DbCommand
{
    private HttpSqlConnection _connection = connection;

    [System.Diagnostics.CodeAnalysis.AllowNull]
    public override string CommandText { get; set; } = string.Empty;
    public override int CommandTimeout { get; set; } = 30;
    public override CommandType CommandType { get; set; } = CommandType.Text;
    public override bool DesignTimeVisible { get; set; }
    public override UpdateRowSource UpdatedRowSource { get; set; }
    protected override DbConnection? DbConnection
    {
        get => _connection;
        set => _connection = value as HttpSqlConnection ?? throw new ArgumentException("Connection must be an HttpSqlConnection.");
    }
    protected override DbParameterCollection DbParameterCollection { get; } = new NoParameters();
    protected override DbTransaction? DbTransaction { get; set; }

    public override void Cancel() { }
    public override void Prepare() { }
    protected override DbParameter CreateDbParameter() => throw new NotSupportedException("Parameters are not supported over HTTP.");

    protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior) =>
        ExecuteDbDataReaderAsync(behavior, CancellationToken.None).GetAwaiter().GetResult();

    protected override async Task<DbDataReader> ExecuteDbDataReaderAsync(CommandBehavior behavior, CancellationToken cancellationToken) =>
        new HttpSqlDataReader(await _connection.ExecuteAsync(CommandText, CommandTimeout, cancellationToken));

    public override int ExecuteNonQuery() => ExecuteNonQueryAsync(CancellationToken.None).GetAwaiter().GetResult();

    public override async Task<int> ExecuteNonQueryAsync(CancellationToken cancellationToken)
    {
        await _connection.ExecuteAsync(CommandText, CommandTimeout, cancellationToken);
        return -1;
    }

    public override object? ExecuteScalar() => ExecuteScalarAsync(CancellationToken.None).GetAwaiter().GetResult();

    public override async Task<object?> ExecuteScalarAsync(CancellationToken cancellationToken)
    {
        var result = await _connection.ExecuteAsync(CommandText, CommandTimeout, cancellationToken);
        return result.Rows.Count > 0 && result.Rows[0].Length > 0 ? result.Rows[0][0] : null;
    }

    private sealed class NoParameters : DbParameterCollection
    {
        private static NotSupportedException Unsupported() => new("Parameters are not supported over HTTP.");
        public override int Count => 0;
        public override object SyncRoot { get; } = new();
        public override int Add(object value) => throw Unsupported();
        public override void AddRange(Array values) => throw Unsupported();
        public override void Clear() { }
        public override bool Contains(object value) => false;
        public override bool Contains(string value) => false;
        public override void CopyTo(Array array, int index) { }
        public override IEnumerator GetEnumerator() => Array.Empty<DbParameter>().GetEnumerator();
        protected override DbParameter GetParameter(int index) => throw Unsupported();
        protected override DbParameter GetParameter(string parameterName) => throw Unsupported();
        public override int IndexOf(object value) => -1;
        public override int IndexOf(string parameterName) => -1;
        public override void Insert(int index, object value) => throw Unsupported();
        public override void Remove(object value) => throw Unsupported();
        public override void RemoveAt(int index) => throw Unsupported();
        public override void RemoveAt(string parameterName) => throw Unsupported();
        protected override void SetParameter(int index, DbParameter value) => throw Unsupported();
        protected override void SetParameter(string parameterName, DbParameter value) => throw Unsupported();
    }
}

/// <summary>Forward-only reader over one buffered <see cref="HttpSqlResult"/>.</summary>
public sealed class HttpSqlDataReader(HttpSqlResult result) : DbDataReader
{
    private int _row = -1;
    private bool _closed;

    private object?[] Current => _row >= 0 && _row < result.Rows.Count
        ? result.Rows[_row]
        : throw new InvalidOperationException("No current row.");

    public override int FieldCount => result.Columns.Count;
    public override bool HasRows => result.Rows.Count > 0;
    public override bool IsClosed => _closed;
    public override int Depth => 0;
    public override int RecordsAffected => -1;

    public override bool Read() => ++_row < result.Rows.Count;
    public override Task<bool> ReadAsync(CancellationToken cancellationToken) => Task.FromResult(Read());
    public override bool NextResult() => false;
    public override Task<bool> NextResultAsync(CancellationToken cancellationToken) => Task.FromResult(false);
    public override void Close() => _closed = true;

    public override string GetName(int ordinal) => result.Columns[ordinal];
    public override string GetDataTypeName(int ordinal) => result.Types[ordinal];
    public override int GetOrdinal(string name)
    {
        for (var i = 0; i < result.Columns.Count; i++)
            if (string.Equals(result.Columns[i], name, StringComparison.OrdinalIgnoreCase)) return i;
        throw new IndexOutOfRangeException(name);
    }

    public override object GetValue(int ordinal) => Current[ordinal] ?? DBNull.Value;
    public override bool IsDBNull(int ordinal) => Current[ordinal] is null or DBNull;
    public override Type GetFieldType(int ordinal)
    {
        // Buffered rows: use the first non-null value's type, else string.
        foreach (var row in result.Rows)
            if (row[ordinal] is { } v && v is not DBNull) return v.GetType();
        return typeof(string);
    }

    public override int GetValues(object[] values)
    {
        var n = Math.Min(values.Length, FieldCount);
        for (var i = 0; i < n; i++) values[i] = GetValue(i);
        return n;
    }

    public override object this[int ordinal] => GetValue(ordinal);
    public override object this[string name] => GetValue(GetOrdinal(name));

    public override bool GetBoolean(int ordinal) => Convert.ToBoolean(GetValue(ordinal));
    public override byte GetByte(int ordinal) => Convert.ToByte(GetValue(ordinal));
    public override char GetChar(int ordinal) => Convert.ToChar(GetValue(ordinal));
    public override DateTime GetDateTime(int ordinal) => Convert.ToDateTime(GetValue(ordinal));
    public override decimal GetDecimal(int ordinal) => Convert.ToDecimal(GetValue(ordinal));
    public override double GetDouble(int ordinal) => Convert.ToDouble(GetValue(ordinal));
    public override float GetFloat(int ordinal) => Convert.ToSingle(GetValue(ordinal));
    public override Guid GetGuid(int ordinal) => Guid.Parse(GetString(ordinal));
    public override short GetInt16(int ordinal) => Convert.ToInt16(GetValue(ordinal));
    public override int GetInt32(int ordinal) => Convert.ToInt32(GetValue(ordinal));
    public override long GetInt64(int ordinal) => Convert.ToInt64(GetValue(ordinal));
    public override string GetString(int ordinal) => Convert.ToString(GetValue(ordinal)) ?? string.Empty;
    public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length) => throw new NotSupportedException();
    public override long GetChars(int ordinal, long dataOffset, char[]? buffer, int bufferOffset, int length) => throw new NotSupportedException();
    public override IEnumerator GetEnumerator() => new DbEnumerator(this);
}
