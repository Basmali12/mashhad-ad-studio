import { useEffect, useState } from 'react';
import { bunnyMedia,downloadBunnyFile } from './bunny-media';
import type { LibraryVideo } from '../scheduler/schedule-model';
export function Player({ video,thumbnail=false }: {
    video: LibraryVideo;
    thumbnail?:boolean;
}) {
    const remoteDownload=!!video.bunnyAssetId&&!video.file;
    const [url, setUrl] = useState(video.url ?? '');
    const [expiresAt,setExpiresAt]=useState<number>();
    const [unavailable,setUnavailable]=useState(false);
    useEffect(() => {
        let active = true;
        setUrl(video.url??'');setUnavailable(false);setExpiresAt(undefined);
        if (!video.file) {
            if (video.bunnyAssetId)
                void bunnyMedia(video.bunnyAssetId).then(u => {
                    if (active)
                        {setUrl(u.url);setExpiresAt(u.retentionDeleteAt);}
                }).catch(() => {if(active){setUrl('');setUnavailable(true);}});
            return () => { active = false; };
        }
        const object = URL.createObjectURL(video.file);
        setUrl(object);
        return () => { active = false; URL.revokeObjectURL(object); };
    }, [video.file, video.bunnyAssetId,video.url]);
    return url ? <><video src={url} controls={!thumbnail} muted={thumbnail} tabIndex={thumbnail?-1:undefined} aria-label={thumbnail?undefined:video.title} preload="metadata"/>{!thumbnail&&<a href={remoteDownload?url+'&download=1':url} download rel="noreferrer" onClick={remoteDownload?e=>{e.preventDefault();void downloadBunnyFile(video.bunnyAssetId!).catch(()=>{setUrl('');setUnavailable(true);});}:undefined}>تحميل الفيديو</a>}{!thumbnail&&expiresAt&&<small>متاح للتنزيل حتى {new Date(expiresAt).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})} · يُحذف الملف بعد يومين من نجاح النشر.</small>}</> : thumbnail?<span aria-label="معاينة الفيديو">▶</span>:<p>{unavailable?'الملف غير متاح للتنزيل؛ قد تكون انتهت مدة الاحتفاظ. سجل النشر محفوظ.':'جارٍ تحميل المعاينة…'}</p>;
}
