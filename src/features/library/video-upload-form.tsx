import { useState } from 'react';
import { uploadBunnyFile } from '../media/bunny-media';
import { requireVideoText } from '../scheduler/schedule-input';
import { addLibraryVideo, manualPublishAt } from '../scheduler/schedule-model';
import type { PublishingCollection } from './collection-store';
import type { PublishMetadata } from '../../../shared/library-publishing';
export function VideoUploadForm({ project, general, taskId, busy, hidden, onSave, onComplete, onError }: {
    project: PublishingCollection;
    general: boolean;
    taskId: string;
    busy: boolean;
    hidden: boolean;
    onSave: (c: PublishingCollection) => Promise<boolean>;
    onComplete: () => void;
    onError: (message: string) => void;
}) {
    const [uploading, setUploading] = useState(false), [progress, setProgress] = useState(''), [files, setFiles] = useState<File[]>([]), [drafts, setDrafts] = useState<{
        title: string;
        description: string;
        date: string;
    }[]>([]);
    async function upload() { if (uploading)
        return; setUploading(true); try {
        if (!files.length || files.some(f => f.type !== 'video/mp4' || f.size > 1024 * 1024 * 1024))
            throw Error('اختار MP4 ضمن الحد المسموح (1 GB).');
        for (const draft of drafts)
            requireVideoText(draft.title, draft.description);
        const schedule = project.publishTasks?.find(t => t.id === taskId) ?? project.publishTasks?.[0] ?? project.publishSchedule;
        if (!general && schedule?.mode === 'manual') {
            const reserved = [...(project.libraryVideos ?? [])];
            for (const draft of drafts) {
                const publishAt = manualPublishAt(draft.date, reserved);
                reserved.push({ id: draft.date, title: draft.title, createdAt: 0, publishAt });
            }
        }
        let next = project;
        for (const [index, file] of files.entries()) {
            const bunny = await uploadBunnyFile(file, setProgress);
            const metadata: PublishMetadata = { title: drafts[index].title.trim(), description: drafts[index].description.trim(), hashtags: [], categoryId: '22', madeForKids: false, privacy: 'public', isAiGenerated: false }, v = { id: crypto.randomUUID(), title: metadata.title, file, bunnyAssetId: bunny?.id, createdAt: Date.now(), taskId: taskId || project.publishTasks?.[0]?.id, metadata, metadataReviewed: true };
            next = general ? { ...next, libraryVideos: [...(next.libraryVideos ?? []), { ...v, publishAt: '' }] } : addLibraryVideo(next, v, schedule?.mode === 'manual' ? drafts[index].date : undefined);
        }
        if (await onSave(next)) {
            onComplete();
            setFiles([]);
            setDrafts([]);
        }
    }
    catch (e) {
        onError((e as Error).message);
    }
    finally {
        setUploading(false);
        setProgress('');
    } }
    return hidden ? null : (<form className="library-add" onSubmit={e => { e.preventDefault(); void upload(); }}><h2>رفع الريلز</h2><label>الفيديوهات<input type="file" multiple accept="video/mp4" required onChange={e => { const selected = Array.from(e.target.files ?? []); setFiles(selected); setDrafts(selected.map(f => ({ title: f.name.replace(/\.mp4$/i, '').slice(0, 100), description: '', date: '' }))); }}/></label><p role="status">{progress}</p><p>{files.length} فيديو؛ تحفظ الملفات الأصلية دون إعادة ترميز.</p>{drafts.map((draft, index) => <fieldset key={index}><legend>فيديو {index + 1} · {files[index]?.name}</legend><label>عنوان الريلز<input required maxLength={100} value={draft.title} onChange={e => setDrafts(drafts.map((d, i) => i === index ? { ...d, title: e.target.value } : d))}/></label><label>وصف الريلز<textarea required rows={3} maxLength={4500} value={draft.description} onChange={e => setDrafts(drafts.map((d, i) => i === index ? { ...d, description: e.target.value } : d))}/></label>{(project.publishTasks?.find(t => t.id === taskId) ?? project.publishTasks?.[0] ?? project.publishSchedule)?.mode === 'manual' && <label>موعد الفيديو · بغداد<input required type="datetime-local" value={draft.date} onInput={e => { const date = e.currentTarget.value; setDrafts(drafts.map((d, i) => i === index ? { ...d, date } : d)); }} onChange={e => setDrafts(drafts.map((d, i) => i === index ? { ...d, date: e.target.value } : d))}/></label>}</fieldset>)}<p>{taskId ? 'إذا المهمة مفعّلة، الحفظ يجهز النشر بالمواعيد المحددة.' : 'اختار مهمة لاحقاً لتفعيل النشر.'}</p><button className="series-primary" disabled={busy || uploading}>حفظ الفيديوهات</button><button type="button" className="series-secondary" onClick={() => onComplete()}>إلغاء</button></form>);
}
