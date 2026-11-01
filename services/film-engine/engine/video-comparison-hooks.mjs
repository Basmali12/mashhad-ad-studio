/** Observability only: it reads the existing confirmed-stop receipt, never settles a wallet. */
export function createVideoComparisonHooks({store,comparisons,requestEntity}){
 return {
  afterSave:async({record,saved,generated})=>comparisons.record({customerId:record.customerId,projectId:record.projectId,attemptId:record.id,stageId:record.stageId,assetId:saved.assetId,metrics:{inferenceSeconds:generated.inferenceSeconds??generated.metadata?.inferenceSeconds??null}}),
  onStopped:async({scope,stage,result,history})=>{
   const record=await store.get(requestEntity,scope.attemptId);if(!record?.assetId)return;
   if(record.customerId!==scope.customerId||record.projectId!==scope.projectId||history?.cloudStopped!==true||history.runId!==record.runId||history.accountId!==record.accountId||!Number.isSafeInteger(result.actualMicroUSD))throw Error('VIDEO_COMPARISON_BINDING_INVALID');
   return comparisons.record({customerId:scope.customerId,projectId:scope.projectId,attemptId:scope.attemptId,stageId:stage.stageId,assetId:result.result.assetIds[0],metrics:{runtimeMs:Math.max(0,history.stoppedAt-history.startedAt),customerChargeUSD:result.actualMicroUSD/1e6,recordedProviderUSD:history.recordedProviderUSD??null}});
  }
 };
}
