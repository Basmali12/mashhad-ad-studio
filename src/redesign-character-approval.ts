import {approveLatestImage} from './redesign-image-approval';
import {approveVisual,removeCharacterBackground} from './redesign-visual';
import type {SeriesProject} from './redesign-data';
export async function approveChatCharacter(project:SeriesProject,remove=removeCharacterBackground):Promise<SeriesProject>{
 if(project.kind==='conversation')return project;
 const upload=[...(project.messages??[])].reverse().find(m=>m.image),generated=[...(project.visualRequests??[])].reverse().find(r=>r.file&&r.status==='ready');
 if(generated&&(!upload||upload.createdAt<(generated.createdAt??0))){if(generated.kind!=='character')return project;if(generated.count!==1)throw new Error('اختار شخصية منفردة من الخيارات قبل حفظها.');const ready=generated.transparent?project:{...project,visualRequests:project.visualRequests?.map(r=>r.id===generated.id?{...r,file:undefined}:r)};const file=generated.transparent?generated.file!:await remove(generated.file!);return approveVisual({...ready,visualRequests:project.visualRequests?.map(r=>r.id===generated.id?{...r,file,transparent:true}:r)},generated.id);}
 if(upload?.imageDetails?.kind==='character')return approveLatestImage(project);return project;
}
