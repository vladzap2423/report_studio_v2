param(
  [string]$IpAddress = "10.3.28.138",
  [string]$OutputDir = "docker/certs"
)

$ErrorActionPreference = "Stop"

$opensslCandidates = @(
  "C:\Program Files\Git\mingw64\bin\openssl.exe",
  "C:\Program Files\Git\usr\bin\openssl.exe",
  "openssl"
)

$openssl = $null
foreach ($candidate in $opensslCandidates) {
  try {
    if ($candidate -eq "openssl") {
      $null = & $candidate version 2>$null
      if ($LASTEXITCODE -eq 0) {
        $openssl = $candidate
        break
      }
    } elseif (Test-Path $candidate) {
      $openssl = $candidate
      break
    }
  } catch {
  }
}

if (-not $openssl) {
  throw "OpenSSL was not found. Install Git for Windows or OpenSSL and try again."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$configPath = Join-Path $OutputDir "openssl-ip.cnf"
$keyPath = Join-Path $OutputDir "server.key"
$crtPath = Join-Path $OutputDir "server.crt"

@"
[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
CN = $IpAddress

[v3_req]
subjectAltName = @alt_names
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
IP.1 = $IpAddress
"@ | Set-Content -Path $configPath -Encoding UTF8

& $openssl req -x509 -nodes -days 825 -newkey rsa:2048 `
  -keyout $keyPath `
  -out $crtPath `
  -config $configPath

if ($LASTEXITCODE -ne 0) {
  throw "Failed to generate certificate."
}

Write-Host "Certificate created:"
Write-Host "  $crtPath"
Write-Host "  $keyPath"
