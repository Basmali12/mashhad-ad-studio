// Profile metadata only: never send an OAuth credential to an image element.
export function accountAvatar(value:unknown):string|undefined{
 if(typeof value!=='string'||value.length>4096)return undefined;
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||[...url.searchParams.keys()].some(k=>/^(?:access_token|authorization|client_secret|api_key)$/i.test(k)))return undefined;return url.href;}catch{return undefined;}
}
