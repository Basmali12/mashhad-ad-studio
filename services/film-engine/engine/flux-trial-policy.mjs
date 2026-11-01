/** Fixed, private 2026-10-31 owner-approved FLUX trial; never an HTTP grant.
 * Provider cap is the money boundary; heartbeat/deadline adds local fail-closure.
 * This does not invent a guarantee for unverified or changed provider settings.
 */
const fail=()=>{throw Error('PRIVATE_TRIAL_BUDGET_GUARD_CLOSED');};
export function assertFluxTrialBudget(state,manifest,packet,now=Date.now(),control={}){
 const s=state,m=manifest;
 const validation=s?.gpuValidationApproved===true&&s?.twoPeriodCapApproved===true&&s?.usageLimitUSD===7;
 if(s?.gpuValidationApproved===true&&!validation)fail();
 if(!s||!m||!packet||s.approved!==true||s.account!=='basm1998ali'||s.profile!==s.account||(s.env??s.environment)!=='main'||(!validation&&s.usageLimitUSD!==26)||s.spendLimitUSD!==0||s.trialMaxUSD!==20)fail();
 if(!Number.isFinite(s.baselineGrossUSD)||s.baselineGrossUSD<6.30||s.baselineGrossUSD>6.40||s.usageLimitUSD-s.baselineGrossUSD>20||!Number.isFinite(Number(s.currentGrossUSD))||Number(s.currentGrossUSD)<s.baselineGrossUSD-0.01||Number(s.currentGrossUSD)-s.baselineGrossUSD>=18)fail();
 if(validation&&2*s.usageLimitUSD-s.baselineGrossUSD>20)fail();
 if(!Number.isFinite(s.storageGiBUpperBound)||s.storageGiBUpperBound<15||s.storageGiBUpperBound>(validation?500:128)||s.freeStorageGiB!==1024)fail();
 if(s.cloudStopped||(s.status!=='watching'&&!(s.status==='armed'&&packet.trialAction==='prepare'))||!Number.isSafeInteger(s.heartbeatAt)||now-s.heartbeatAt>20000||s.heartbeatAt>now+1000)fail();
 if(!Number.isSafeInteger(s.createdAt)||s.createdAt>now||!Number.isSafeInteger(s.deadline)||s.deadline-s.createdAt>(validation?600000:2700000)||s.deadline<=now||(!validation&&s.deadline>Date.parse('2026-10-31T21:00:00Z')-1200000)||s.deadline>=Date.parse(s.periodEndISO)-1200000||s.periodStartISO!=='2026-10-01T00:00:00Z'||s.periodEndISO!=='2026-11-01T00:00:00Z')fail();
 if(!Number.isSafeInteger(s.providerBudgetVerifiedAt)||s.providerBudgetVerifiedAt>s.createdAt||s.createdAt-s.providerBudgetVerifiedAt>300000)fail();
 const d=packet.definition;
 if(d?.modelId!=='flux2-klein-4b'||d.accountId!==m.accountId||d.id!==m.engineId||packet.appName!==s.appName||s.appName!==m.appName||packet.credentials?.expectedWorkspace!=='basm1998ali'||d.gpu!=='L40S'||d.cpu!==4||d.ramGiB!==64||d.timeout!==300||d.startupTimeout!==180||d.idleSeconds!==(validation?60:2))throw Error('PRIVATE_TRIAL_SCOPE_INVALID');
 if(control.stopRequested||['completed','failed'].includes(control.mainStatus))throw Error('PRIVATE_TRIAL_STOP_REQUESTED');
 return true;
}
