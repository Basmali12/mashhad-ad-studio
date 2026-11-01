param(
 [Parameter(Mandatory=$true)][ValidateSet('flux2-klein-4b','qwen-image-edit-2511','wan22-i2v-a14b','habibi-msa')][string]$ModelId,
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]{1,70}$')][string]$LeaseTag,
 [Parameter(Mandatory=$true)][long]$ProviderBudgetVerifiedAt
)
$ErrorActionPreference='Stop'
$filmRepo=Split-Path -Parent $PSScriptRoot
$filmWork=[System.IO.Path]::GetFullPath((Join-Path $filmRepo '../../work/afterlife-film-20261101'))
$filmNow=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if($ProviderBudgetVerifiedAt -gt $filmNow -or $filmNow-$ProviderBudgetVerifiedAt -gt 300000){throw 'PROVIDER_PROOF_STALE'}
$filmEnd=[DateTimeOffset]::Parse('2026-11-01T08:15:00Z').ToUnixTimeMilliseconds()
if($filmNow -ge $filmEnd){throw 'FILM_WINDOW_EXPIRED'}
$filmManifest=Join-Path $filmWork ($ModelId+'-manifest.json')
$filmData=Get-Content -LiteralPath $filmManifest -Raw|ConvertFrom-Json
if($filmData.filmId -ne 'afterlife-20261101' -or $filmData.workspace -ne 'basm1998ali' -or $filmData.modelId -ne $ModelId){throw 'FILM_SCOPE_INVALID'}
$filmStatePath=Join-Path $filmWork ($ModelId+'-'+$LeaseTag+'-watchdog.json')
if(Test-Path -LiteralPath $filmStatePath){throw 'FILM_LEASE_EXISTS'}
foreach($filmOldFile in Get-ChildItem -LiteralPath $filmWork -Filter '*-watchdog.json'){
 $filmOld=Get-Content -LiteralPath $filmOldFile.FullName -Raw|ConvertFrom-Json
 if($filmOld.cloudStopped -ne $true){throw 'PREVIOUS_FILM_LEASE_NOT_STOPPED'}
}
$filmState=@{approved=$true;sequentialGpuTestsApproved=$true;filmTrialApproved=$true;filmId='afterlife-20261101';filmApprovedAt=([DateTimeOffset]::Parse('2026-11-01T04:26:00Z').ToUnixTimeMilliseconds());account='basm1998ali';profile='basm1998ali';env='main';environment='main';appName=$filmData.appName;modelId=$ModelId;engineId=$filmData.engineId;accountId=$filmData.accountId;appId=$null;createdAt=$filmNow;providerBudgetVerifiedAt=$ProviderBudgetVerifiedAt;deadline=[Math]::Min($filmNow+2700000,$filmEnd);globalDeadlineISO='2026-11-01T08:15:00Z';baselineGrossUSD=0;currentGrossUSD='0.12';usageLimitUSD=15;spendLimitUSD=0;trialMaxUSD=15;periodStartISO='2026-11-01T00:00:00Z';periodEndISO='2026-12-01T00:00:00Z';storageGiBUpperBound=450;freeStorageGiB=1024;status='armed';cloudStopped=$false}
$filmState|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $filmStatePath -Encoding utf8NoBOM
$filmWatcher=Start-Process -FilePath (Get-Command python).Source -ArgumentList @('-X','utf8','scripts/flux-trial-watchdog.py',('"'+$filmStatePath+'"')) -WorkingDirectory $filmRepo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $filmWork ($ModelId+'-'+$LeaseTag+'-watchdog-out.log')) -RedirectStandardError (Join-Path $filmWork ($ModelId+'-'+$LeaseTag+'-watchdog-err.log'))
@{watchdogPID=$filmWatcher.Id;statePath=$filmStatePath;manifestPath=$filmManifest}|ConvertTo-Json
