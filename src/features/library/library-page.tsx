import { Player } from '../media/video-player';
import { Metadata } from './video-metadata';
import { VideoUploadForm } from './video-upload-form';
import { LibraryTaskEditor } from '../scheduler/library-task-editor';
import { useState } from 'react';
import { publishingSaasMode } from '../../shared/api/publishing-session';
import type { PublishingCollection } from './collection-store';
import { reorderLibraryVideo, nextPublishAt, taskStart, defaultSchedule, manualPublishAt, baghdadInput, type LibraryVideo } from '../scheduler/schedule-model';
import {TaskPublishingSettings} from '../publishing/task-settings';
import {LibraryPublicationStatus} from '../publishing/publication-status';
export function SeriesLibrary({ project, projects, busy, onSelect, onSave, queueMode = false }: {
    project: PublishingCollection;
    projects: PublishingCollection[];
    busy: boolean;
    onSelect: (id: string) => void;
    onSave: (p: PublishingCollection) => Promise<void>;
    queueMode?: boolean;
}) {
    const [adding, setAdding] = useState(false), [taskId, setTaskId] = useState(queueMode ? project.publishTasks?.[0]?.id ?? '' : ''), [editing, setEditing] = useState(false), [error, setError] = useState(''), [moveId, setMoveId] = useState(''), [destination, setDestination] = useState(''), [destinationTask, setDestinationTask] = useState(''), [dateId, setDateId] = useState(''), [date, setDate] = useState('');
    const general = project.id === '__general' && !queueMode, rows = (project.libraryVideos ?? []).filter(v => !v.movedTo && (queueMode || !taskId || v.taskId === taskId)).sort((a, b) => a.publishAt.localeCompare(b.publishAt)), next = rows.find(v => !v.publishedAt && v.publishAt), nextDate = next ? baghdadInput(next.publishAt).slice(0, 10) : '';
    async function change(p: PublishingCollection) { setError(''); try {
        await onSave(p);
        return true;
    }
    catch (e) {
        setError((e as Error).message);
        return false;
    } }
    async function move(video: LibraryVideo) { const target = projects.find(p => p.id === destination); if (!target || target.id === project.id || target.libraryVideos?.some(v => v.id === video.id && !v.movedTo)) {
        setError('اختار حافظة أخرى لا تحتوي الفيديو.');
        return;
    } const task = target.publishTasks?.find(t => t.id === destinationTask), publishAt = target.id === '__general' ? '' : nextPublishAt(task ?? target.publishSchedule ?? defaultSchedule, (target.libraryVideos ?? []).filter(v => !task || v.taskId === task.id), taskStart(task)), moved = { ...video, movedTo: undefined, taskId: task?.id, publishAt }; if (await change({ ...target, libraryVideos: [...(target.libraryVideos ?? []).filter(v => v.id !== video.id), moved] })) {
        await change({ ...project, libraryVideos: project.libraryVideos?.map(v => v.id === video.id ? { ...v, movedTo: target.id } : v) });
        setMoveId('');
    } }
    function reorder(id: string, target: string) { try {
        void change(reorderLibraryVideo(project, id, target));
    }
    catch (e) {
        setError((e as Error).message);
    } }
    return <section className="series-library" aria-label={queueMode ? 'قائمة فيديوهات النشر' : 'حافظات الفيديو'}><header><div><h1>{queueMode ? 'قائمة النشر' : project.name}</h1>{!queueMode && <label>الحافظة<select value={project.id} disabled={busy} onChange={e => onSelect(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}</div><button className="series-primary" disabled={busy} onClick={() => setAdding(v => !v)}>رفع فيديوهات</button></header>
 {!general && <div className="library-toolbar queue-toolbar">{(!queueMode || (project.publishTasks?.length ?? 0) > 1) && <label>{queueMode ? 'جدول الرفع' : 'المهمة'}<select value={taskId} onChange={e => setTaskId(e.target.value)}><option value="">كل الفيديوهات</option>{project.publishTasks?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}<button className="series-secondary" disabled={busy} onClick={() => setEditing(true)}>{queueMode ? 'إعداد الجدول اليومي' : taskId ? 'تعديل المهمة' : 'مهمة جديدة'}</button>{queueMode && <p>ضبط التلقائي واليدوي وفاصل الأيام من تبويبة «الجدول».</p>}</div>}
 <p className="library-note">توقيت بغداد · {publishingSaasMode ? 'قائمة النشر محفوظة بحسابك.' : 'قائمة النشر محفوظة على هذا المتصفح.'} النشر يحتاج مراجعة الحسابات والمواعيد؛ لا حذف تلقائي.</p>
 {editing && <LibraryTaskEditor project={project} taskId={taskId} queueMode={queueMode} busy={busy} onSave={change} onDone={id => { setTaskId(id); setEditing(false); }} onCancel={() => setEditing(false)} onError={setError}/>}
 {taskId && !publishingSaasMode && !queueMode && <TaskPublishingSettings key={taskId} project={project} taskId={taskId} onSave={onSave} busy={busy}/>}
 {taskId && (publishingSaasMode || queueMode) && <p className="library-note">هذه خطة مواعيد للفيديوهات. اعتماد القنوات وتنفيذ الإرسال من الجدول؛ تغيير الخطة لا يلغي مواعيد سبق حفظها على السيرفر.</p>}
 <VideoUploadForm project={project} general={general} taskId={taskId} busy={busy} hidden={!adding} onSave={change} onComplete={() => setAdding(false)} onError={setError}/>
 {error && <p role="alert" className="series-error">{error}</p>}
 <div className="library-grid">{rows.map((v, i) => <article key={v.id} draggable={!general && !busy && !v.publishedAt && !v.publicationId} onDragStart={e => e.dataTransfer.setData('text/plain', v.id)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id !== v.id)
            reorder(id, v.id); }} className={'library-video' + (v.publishedAt ? ' is-published' : '') + (!v.publishedAt && v.publishAt && baghdadInput(v.publishAt).slice(0, 10) === nextDate ? ' is-next' : '')}><Player video={v}/><h2>{v.title}</h2>{v.publishAt && <p>{new Intl.DateTimeFormat('ar-IQ', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v.publishAt))}</p>}
 {!publishingSaasMode && <LibraryPublicationStatus video={v} busy={busy} onPublished={async () => { await change({ ...project, libraryVideos: project.libraryVideos?.map(r => r.id === v.id ? { ...r, publishedAt: new Date().toISOString() } : r) }); }} onCancel={async () => { await change({ ...project, libraryVideos: project.libraryVideos?.map(r => r.id === v.id ? { ...r, publicationId: undefined, publishingError: 'الموعد ملغي؛ راجع الموعد والحقول.' } : r) }); }}/>}
 <Metadata video={v} busy={busy} onSave={async (metadata) => { await change({ ...project, libraryVideos: project.libraryVideos?.map(r => r.id === v.id ? { ...r, title: metadata.title, metadata, metadataReviewed: true, publishingError: undefined } : r) }); }}/>
 <div className="series-form-actions">{!general && !v.publicationId && !v.publishedAt && <><button className="series-secondary" aria-label={'تقديم ' + v.title} disabled={busy || i === 0} onClick={() => i > 0 && reorder(v.id, rows[i - 1].id)}>↑</button><button className="series-secondary" aria-label={'تأخير ' + v.title} disabled={busy || i === rows.length - 1} onClick={() => i < rows.length - 1 && reorder(v.id, rows[i + 1].id)}>↓</button><button className="series-secondary" disabled={busy} onClick={() => { setDateId(v.id); setDate(baghdadInput(v.publishAt)); }}>تعديل الموعد</button></>}{!queueMode && !v.publicationId && !v.publishedAt && <button className="series-secondary" disabled={busy} onClick={() => setMoveId(v.id)}>نقل لحافظة</button>}</div>
 {dateId === v.id && <form onSubmit={e => { e.preventDefault(); try {
            const publishAt = manualPublishAt(date, (project.libraryVideos ?? []).filter(r => r.id !== v.id));
            void change({ ...project, libraryVideos: project.libraryVideos?.map(r => r.id === v.id ? { ...r, publishAt, publishingError: undefined } : r) }).then(ok => { if (ok)
                setDateId(''); });
        }
        catch (e) {
            setError((e as Error).message);
        } }}><label>الموعد بتوقيت بغداد<input required type="datetime-local" value={date} onChange={e => setDate(e.target.value)}/></label><button className="series-primary" disabled={busy}>حفظ الموعد</button></form>}
 {moveId === v.id && <div><label>الحافظة المستقبلة<select value={destination} onChange={e => { setDestination(e.target.value); setDestinationTask(''); }}><option value="">اختار الحافظة</option>{projects.filter(p => p.id !== project.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>المهمة<select value={destinationTask} onChange={e => setDestinationTask(e.target.value)}><option value="">الجدول العام</option>{projects.find(p => p.id === destination)?.publishTasks?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button className="series-primary" disabled={busy} onClick={() => void move(v)}>نقل</button><button className="series-secondary" onClick={() => setMoveId('')}>إلغاء</button></div>}{v.publishedAt && <strong>منشور؛ السجل محفوظ</strong>}</article>)}</div>{!rows.length && <div className="reels-empty"><h2>قائمتك جاهزة للفيديوهات</h2><p>ارفع الريلز، اضبط الجدول اليومي، وتابع أيامك من التقويم.</p></div>}
 </section>;
}
