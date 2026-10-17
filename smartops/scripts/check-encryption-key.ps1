# Shows which configuration source the Tenant API takes DatabaseConnections:EncryptionKey from on this PC,
# and a short fingerprint of the value (never the value itself), so two machines can compare keys safely.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File smartops\scripts\check-encryption-key.ps1

$key  = 'DatabaseConnections:EncryptionKey'
$env_ = 'DatabaseConnections__EncryptionKey'
$api  = Join-Path $PSScriptRoot '..\services\dotnet\TWise.Backend.Tenant\src\TWise.Tenant.API'
$secretsId = '802e2bc3-224a-4c21-839b-8ae314e545d0'

function Read-JsonKey($path) {
    if (-not (Test-Path $path)) { return $null }
    $json = Get-Content $path -Raw | ConvertFrom-Json
    $flat = $json.PSObject.Properties[$key]
    if ($flat) { return $flat.Value }
    return $json.DatabaseConnections.EncryptionKey
}

function Fingerprint($value) {
    $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($value))
    return ([BitConverter]::ToString($hash) -replace '-', '').Substring(0, 12).ToLower()
}

# Lowest to highest precedence (Development environment): the last one found wins.
$sources = [ordered]@{
    'appsettings.json'             = Read-JsonKey (Join-Path $api 'appsettings.json')
    'appsettings.Development.json' = Read-JsonKey (Join-Path $api 'appsettings.Development.json')
    'user-secrets'                 = Read-JsonKey "$env:APPDATA\Microsoft\UserSecrets\$secretsId\secrets.json"
    'env var (Machine)'            = [Environment]::GetEnvironmentVariable($env_, 'Machine')
    'env var (User)'               = [Environment]::GetEnvironmentVariable($env_, 'User')
}

$winner = $null
foreach ($name in $sources.Keys) {
    $value = $sources[$name]
    if ($value) {
        $winner = $name
        $tag = if ($value.StartsWith('CHANGE_ME')) { ' (CHANGE_ME placeholder)' } else { '' }
        '{0,-30} set   fingerprint {1}{2}' -f $name, (Fingerprint $value), $tag
    } else {
        '{0,-30} -' -f $name
    }
}
''
if ($winner) { "Tenant API uses: $winner  ->  fingerprint $(Fingerprint $sources[$winner])" }
else { 'No EncryptionKey found: the Tenant API will not start.' }
'Same fingerprint on both PCs = same key. Different = encrypted settings saved on one PC fail on the other.'
'(A launch profile in an IDE can also set the env var; check launchSettings.json / the run configuration if this does not match.)'
