/** Private owner-approved sequential trial only; never an HTTP/admin grant.
 * Actual provider Usage21/Spend0 proof and fixed UTC stop bound the whole round.
 */
const MODELS=Object.freeze({'flux2-klein-4b':'flux','qwen-image-edit-2511':'qwen','wan22-i2v-a14b':'wan','hunyuanvideo15':'hunyuan','habibi-irq':'speech-habibi-irq','habibi-egy':'speech-habibi-egy','habibi-msa':'speech-habibi-msa'});
const STOP=Date.parse('2026-10-31T23:30:00Z'),BASE=6.34874585;
const fail=()=>{throw Error('PRIVATE_TRIAL_BUDGET_GUARD_CLOSED');};
const scopeFail=()=>{throw Error('PRIVATE_TRIAL_SCOPE_INVALID');};
export function assertPrivateModelTrialBudget(s,m,packet,now=Date.now(),control={}){
 const continuation=s?.speechContinuationApproved===true,film=s?.filmTrialApproved===true;
 if(film&&(continuation||s.filmId!=='afterlife-20261101'||m?.filmId!==s.filmId||!['flux2-klein-4b','qwen-image-edit-2511','wan22-i2v-a14b','habibi-msa'].includes(s.modelId)||!Number.isSafeInteger(s.filmApprovedAt)||s.filmApprovedAt>s.createdAt||s.createdAt-s.filmApprovedAt>14400000))fail();
 const baseline=film||continuation?0:BASE,limit=film?15:continuation?5:21,maximum=film?15:20;
 const stopISO=film?'2026-11-01T08:15:00Z':continuation?'2026-11-01T02:00:00Z':'2026-10-31T23:30:00Z';
 const startISO=film||continuation?'2026-11-01T00:00:00Z':'2026-10-01T00:00:00Z',endISO=film||continuation?'2026-12-01T00:00:00Z':'2026-11-01T00:00:00Z';
 // Carry the entire previous provider cap, not a potentially delayed invoice.
 if(continuation&&(!['habibi-irq','habibi-egy','habibi-msa'].includes(s.modelId)||s.previousPeriodExposureUSD!==21-BASE||s.previousPeriodExposureUSD+limit>20))fail();
 if(!s||!m||!packet||s.approved!==true||s.sequentialGpuTestsApproved!==true||s.account!=='basm1998ali'||s.profile!==s.account||s.env!=='main'||s.usageLimitUSD!==limit||s.spendLimitUSD!==0||s.trialMaxUSD!==maximum||s.baselineGrossUSD!==baseline)fail();
 const gross=Number(s.currentGrossUSD);
 if(s.currentGrossUSD==null||s.currentGrossUSD===''||!Number.isFinite(gross)||gross<baseline||gross-baseline>=18||s.usageLimitUSD-baseline>maximum||gross>=s.usageLimitUSD)fail();
 if(!Number.isFinite(s.storageGiBUpperBound)||s.storageGiBUpperBound<1||s.storageGiBUpperBound>500||s.freeStorageGiB!==1024)fail();
 if(s.cloudStopped===true||!['watching','armed'].includes(s.status)||(s.status==='armed'&&packet.trialAction!=='prepare')||!Number.isSafeInteger(s.heartbeatAt)||s.heartbeatAt>now+1000||now-s.heartbeatAt>20000||s.stopReason)fail();
 const stop=film||continuation?Date.parse(stopISO):STOP;
 if(film&&(stop>s.filmApprovedAt+14400000||now<s.filmApprovedAt))fail();
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(s.createdAt)||s.createdAt>now||!Number.isSafeInteger(s.deadline)||s.deadline<=now||s.deadline-s.createdAt>2700000||s.globalDeadlineISO!==stopISO||s.deadline>stop||now>=stop||now<Date.parse(startISO)||s.periodStartISO!==startISO||s.periodEndISO!==endISO||s.deadline>Date.parse(s.periodEndISO)-1200000)fail();
 if(!Number.isSafeInteger(s.providerBudgetVerifiedAt)||s.providerBudgetVerifiedAt>s.createdAt||s.createdAt-s.providerBudgetVerifiedAt>300000)fail();
 const d=packet.definition,prefix=MODELS[s.modelId],id=s.engineId;
 if(!prefix||(!film&&s.modelId==='flux2-klein-4b')||typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)||typeof s.accountId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(s.accountId)||s.appName!=='mashhad-'+prefix+'-'+id.replaceAll('-','').slice(0,12)||m.appName!==s.appName||packet.appName!==s.appName||m.engineId!==id||d?.id!==id||m.modelId!==s.modelId||d.modelId!==s.modelId||m.accountId!==s.accountId||d.accountId!==s.accountId||packet.credentials?.expectedWorkspace!==s.account)scopeFail();
 const resources=m.resources;if(!resources||['gpu','cpu','ramGiB','timeout','startupTimeout','idleSeconds'].some(k=>d[k]!==resources[k]))scopeFail();
 if(film){
  const approved={'flux2-klein-4b':{gpu:'L40S',cpu:4,ramGiB:64,timeout:300,startupTimeout:180,idleSeconds:60},'qwen-image-edit-2511':{gpu:'RTX-PRO-6000',cpu:4,ramGiB:128,timeout:600,startupTimeout:300,idleSeconds:60},'wan22-i2v-a14b':{gpu:'RTX-PRO-6000',cpu:8,ramGiB:256,timeout:1800,startupTimeout:300,idleSeconds:60},'habibi-msa':{gpu:'L40S',cpu:2,ramGiB:16,timeout:600,startupTimeout:300,idleSeconds:60}}[s.modelId];
  if(!approved||Object.keys(approved).some(k=>d[k]!==approved[k]))scopeFail();
 }else{
  const speech=s.modelId.startsWith('habibi-');
  if(speech?(d.gpu!=='L40S'||![2,4].includes(d.cpu)||![16,32].includes(d.ramGiB)):(d.gpu!=='RTX-PRO-6000'||![4,8].includes(d.cpu)||![128,256].includes(d.ramGiB)))scopeFail();
 }
 if(!Number.isSafeInteger(d.timeout)||d.timeout<60||d.timeout>1800||!Number.isSafeInteger(d.startupTimeout)||d.startupTimeout<60||d.startupTimeout>300||!Number.isSafeInteger(d.idleSeconds)||d.idleSeconds<2||d.idleSeconds>60)scopeFail();
 if(control.stopRequested===true||['completed','failed'].includes(control.mainStatus))throw Error('PRIVATE_TRIAL_STOP_REQUESTED');
 return true;
}
