export const connectionPlatforms=['tiktok','facebook','instagram','youtube'] as const;
export interface DisplayChannel {id:string;service:string;name:string;avatar?:string;isDisconnected?:boolean;isLocked?:boolean}
export function channelConnected(channel:DisplayChannel,blocked=false){return !blocked&&!channel.isDisconnected&&!channel.isLocked;}
export function platformChannels<T extends DisplayChannel>(channels:T[],platform:string){return channels.filter(c=>c.service===platform);}
