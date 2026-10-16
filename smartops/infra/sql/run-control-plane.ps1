<#
.SYNOPSIS
  Creates / updates the SmartOps Control Plane database from init-control-plane.sql.

.DESCRIPTION
  Reads connection details from a dedicated config file (controlplane.env) - they are
  NOT hard-coded in the SQL. The database name is substituted for the $(ControlPlaneDb)
  scripting variable; server/user/password build the connection. Existing service
  configs (.env, appsettings.json, Default connection) are untouched.

  Executes via the built-in .NET SqlClient (no sqlcmd / module install required).
  The script is also plain-sqlcmd compatible if you have sqlcmd:
     sqlcmd -S <server> -U <user> -P <pwd> -C -b -v ControlPlaneDb="<db>" -i init-control-plane.sql

.EXAMPLE
  ./run-control-plane.ps1
  ./run-control-plane.ps1 -EnvFile ./controlplane.env -SqlFile ./init-control-plane.sql
#>
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot 'controlplane.env'),
    [string]$SqlFile = (Join-Path $PSScriptRoot 'init-control-plane.sql')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $EnvFile)) {
    throw "Config file not found: $EnvFile  (copy controlplane.env.example to controlplane.env and fill it in)"
}
if (-not (Test-Path $SqlFile)) { throw "SQL file not found: $SqlFile" }

# Parse the env file (KEY=VALUE, ignore blanks/comments)
$cfg = @{}
foreach ($line in Get-Content $EnvFile) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $cfg[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
}
foreach ($k in 'CONTROLPLANE_SERVER','CONTROLPLANE_DATABASE','CONTROLPLANE_USER','CONTROLPLANE_PASSWORD') {
    if ([string]::IsNullOrWhiteSpace($cfg[$k])) { throw "Missing required key '$k' in $EnvFile" }
}
$server = $cfg['CONTROLPLANE_SERVER']
$db     = $cfg['CONTROLPLANE_DATABASE']
$user   = $cfg['CONTROLPLANE_USER']
$pass   = $cfg['CONTROLPLANE_PASSWORD']

Write-Host "Control Plane target -> Server=$server  Database=$db  User=$user" -ForegroundColor Cyan

# Load SQL, substitute the $(ControlPlaneDb) scripting variable
$sql = Get-Content -Raw -Path $SqlFile
$sql = $sql -replace '\$\(ControlPlaneDb\)', $db

# Split into batches on standalone GO lines
$batches = [regex]::Split($sql, '(?im)^[ \t]*GO[ \t]*$')

# Connect to [master] so CREATE DATABASE works; USE switches context afterward.
$connStr = "Server=$server;Database=master;User ID=$user;Password=$pass;TrustServerCertificate=True;Encrypt=False;Connect Timeout=30"
$conn = New-Object System.Data.SqlClient.SqlConnection $connStr
$conn.add_InfoMessage({ param($s, $e) Write-Host ("  " + $e.Message) -ForegroundColor DarkGray })
$conn.FireInfoMessageEventOnUserErrors = $false

$batchNo = 0
try {
    $conn.Open()
    foreach ($b in $batches) {
        if ([string]::IsNullOrWhiteSpace($b)) { continue }
        $batchNo++
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $b
        $cmd.CommandTimeout = 120
        $reader = $cmd.ExecuteReader()
        try {
            do {
                if ($reader.FieldCount -gt 0) {
                    $rows = @()
                    while ($reader.Read()) {
                        $o = [ordered]@{}
                        for ($c = 0; $c -lt $reader.FieldCount; $c++) {
                            $o[$reader.GetName($c)] = $reader.GetValue($c)
                        }
                        $rows += [pscustomobject]$o
                    }
                    if ($rows.Count -gt 0) { $rows | Format-Table -AutoSize | Out-String | Write-Host }
                }
            } while ($reader.NextResult())
        } finally { $reader.Dispose() }
    }
}
catch {
    Write-Host "FAILED on batch #$batchNo" -ForegroundColor Red
    throw
}
finally {
    if ($conn.State -ne 'Closed') { $conn.Close() }
    $conn.Dispose()
}

Write-Host "Done - control-plane database ready." -ForegroundColor Green
