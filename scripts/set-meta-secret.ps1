$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if ((Get-Content -LiteralPath '.env.local' -Raw) -notmatch '(?m)^CONVEX_DEPLOYMENT=dev:capable-cuttlefish-575(?:\s|$)') { throw 'This script only supports the existing Mashhad Development deployment.' }
$taskSecret = Read-Host 'Paste Mashhad Meta App Secret (input hidden)' -AsSecureString
$taskSecretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
try {
  $env:MASHHAD_META_SECRET_INPUT = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskSecretPtr)
  if ($env:MASHHAD_META_SECRET_INPUT -notmatch '^[a-fA-F0-9]{32}$') { throw 'Invalid Meta App Secret format.' }
  node --input-type=module -e "import {spawnSync} from 'node:child_process'; const value=process.env.MASHHAD_META_SECRET_INPUT; delete process.env.MASHHAD_META_SECRET_INPUT; const r=spawnSync(process.execPath,['node_modules/convex/bin/main.js','env','set','META_APP_SECRET',value],{encoding:'utf8'}); if(r.status!==0){console.error('Save failed. Check the Mashhad Convex connection.');process.exit(1)} console.log('Meta App Secret saved in the configured Mashhad deployment.');"
  if ($LASTEXITCODE -ne 0) { throw 'Secret was not saved.' }
} finally {
  Remove-Item Env:MASHHAD_META_SECRET_INPUT -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskSecretPtr)
  $taskSecret.Dispose()
}
