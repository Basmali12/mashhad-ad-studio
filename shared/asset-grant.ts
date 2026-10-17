import {sealToken,openToken} from './meta';
export interface AssetGrant {subject:string;key:string;expiresAt:number}
export async function assetGrant(value:AssetGrant,secret:string){return sealToken(JSON.stringify(value),secret,'reels-preview-v1');}
export async function readAssetGrant(token:string,secret:string):Promise<AssetGrant>{const value=JSON.parse(await openToken(token,secret,'reels-preview-v1')) as AssetGrant;if(!value.subject||!/^[a-f0-9]{64}$/.test(value.key)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<Date.now()||value.expiresAt>Date.now()+3600000)throw Error('Expired preview');return value;}
