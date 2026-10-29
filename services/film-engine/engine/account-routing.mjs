/** Missing legacy account identity remains conservatively global. No provider calls. */
export function touchesAccount(job, accountId, sourceId) {
 const ids=[job.accountId,job.sourceId].filter(Boolean);
 return !ids.length||!accountId||ids.some(id=>id===accountId||id===sourceId);
}
export function blocksScope(job, scope, accountId, sourceId) {
 return touchesAccount(job,accountId,sourceId)&&(!scope||!job.engineSlotId||job.engineSlotId===scope.engineSlotId);
}
