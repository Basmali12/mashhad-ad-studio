// Remove only a uniform background connected to the image edge. Enclosed
// foreground colors (for example a white letter inside an icon) stay intact.
export function clearLogoBackground(data:Uint8ClampedArray,width:number,height:number){
 const pixels=width*height;
 if(width<3||height<3||pixels>4096*4096||data.length!==pixels*4)throw new Error('استخدم شعارًا بين 3 و4096 بكسل لكل ضلع.');
 if(data.some((v,i)=>i%4===3&&v<255))return {changed:false,transparent:true};
 const edge:number[]=[];
 for(let x=0;x<width;x++){edge.push(x,(height-1)*width+x);}
 for(let y=1;y<height-1;y++){edge.push(y*width,y*width+width-1);}
 const color=[0,1,2].map(c=>{const values=edge.map(p=>data[p*4+c]).sort((a,b)=>a-b);return values[Math.floor(values.length/2)];});
 const matches=(p:number)=>color.every((v,c)=>Math.abs(data[p*4+c]-v)<=24);
 // Refuse photos, gradients and backgrounds without a clear edge consensus.
 if(edge.filter(matches).length/edge.length<0.96)return {changed:false,transparent:false};
 const seen=new Uint8Array(pixels),queue=new Int32Array(pixels);let head=0,tail=0;
 const add=(p:number)=>{if(!seen[p]&&matches(p)){seen[p]=1;queue[tail++]=p;}};
 edge.forEach(add);
 while(head<tail){const p=queue[head++],x=p%width;if(x>0)add(p-1);if(x<width-1)add(p+1);if(p>=width)add(p-width);if(p<pixels-width)add(p+width);}
 if(tail<pixels*0.01||tail>pixels*0.95)return {changed:false,transparent:false};
 for(let n=0;n<tail;n++)data[queue[n]*4+3]=0;
 return {changed:true,transparent:true};
}

export async function prepareLogo(file:File){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('اختر PNG أو JPG أو WebP حتى 10 MB.');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;await image.decode();
  if(image.width*image.height>4096*4096||image.width>4096||image.height>4096)throw new Error('استخدم شعارًا لا يتجاوز 4096×4096.');
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('تعذرت معالجة الشعار.');
  context.drawImage(image,0,0);const pixels=context.getImageData(0,0,image.width,image.height);
  const result=clearLogoBackground(pixels.data,image.width,image.height);
  if(!result.changed)return {file,...result};
  context.putImageData(pixels,0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('تعذر حفظ الشعار الشفاف.')),'image/png'));
  return {file:new File([blob],file.name.replace(/\.[^.]+$/,'')+'-transparent.png',{type:'image/png'}),...result};
 }finally{URL.revokeObjectURL(url);}
}
