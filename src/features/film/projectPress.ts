export function projectPress(open:()=>void,delay=550){
 let timer:ReturnType<typeof setTimeout>|undefined,origin:{x:number;y:number}|undefined,held=false;
 const cancel=()=>{clearTimeout(timer);timer=undefined;};
 return {
  start(x:number,y:number){cancel();held=false;origin={x,y};timer=setTimeout(()=>{timer=undefined;held=true;open();},delay);},
  move(x:number,y:number){if(origin&&Math.hypot(x-origin.x,y-origin.y)>10)cancel();},
  cancel,
  consume(){const value=held;held=false;return value;},
  context(){cancel();held=true;open();},
 };
}
