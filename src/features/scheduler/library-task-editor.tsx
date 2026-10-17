import { useState } from 'react';
import { validateSchedule, tomorrowBaghdad } from './schedule-model';
import { planQueue } from './queue-plan';
import type { PublishingCollection } from '../library/collection-store';
export function LibraryTaskEditor({ project, taskId, queueMode, busy, onSave, onDone, onCancel, onError }: {
    project: PublishingCollection;
    taskId: string;
    queueMode: boolean;
    busy: boolean;
    onSave: (c: PublishingCollection) => Promise<boolean>;
    onDone: (id: string) => void;
    onCancel: () => void;
    onError: (message: string) => void;
}) {
    const task = project.publishTasks?.find(t => t.id === taskId);
    const [taskName, setTaskName] = useState(task?.name ?? (queueMode ? 'النشر اليومي' : '')), [times, setTimes] = useState(task?.times ?? ['09:00']), [startDate, setStartDate] = useState(task?.startDate ?? tomorrowBaghdad());
    return (<form className="library-schedule" onSubmit={e => { e.preventDefault(); try {
        validateSchedule({ times, timezone: 'Asia/Baghdad' });
        if (!taskName.trim())
            throw Error('اكتب اسم المهمة.');
        const old = project.publishTasks?.find(t => t.id === taskId);
        if (old?.automaticPublishing)
            throw Error('أوقف تجهيز المهمة قبل تغييرها؛ المواعيد المحفوظة تحتاج إلغاء مستقل.');
        const t = { ...old, id: old?.id ?? crypto.randomUUID(), name: taskName.trim(), times, timezone: 'Asia/Baghdad' as const, startDate, createdAt: old?.createdAt ?? Date.now() };
        const updated = { ...project, publishTasks: old ? project.publishTasks?.map(r => r.id === t.id ? t : r) : [...(project.publishTasks ?? []), t] };
        void onSave(queueMode ? planQueue(updated, t) : updated).then(ok => { if (ok) {
            onDone(t.id);
        } });
    }
    catch (e) {
        onError((e as Error).message);
    } }}><h2>{queueMode ? 'إعداد النشر اليومي' : 'إعدادات المهمة'}</h2>{!queueMode && <label>اسم المهمة<input required value={taskName} onChange={e => setTaskName(e.target.value)}/></label>}<label>بداية النشر<input required type="date" value={startDate} onInput={e => setStartDate(e.currentTarget.value)} onChange={e => setStartDate(e.target.value)}/></label><label>عدد الفيديوهات يومياً<select value={times.length} onChange={e => setTimes(Array.from({ length: Number(e.target.value) }, (_, i) => times[i] ?? `${String(9 + i).padStart(2, '0')}:00`))}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></label>{times.map((t, i) => <label key={i}>وقت الفيديو {i + 1}<input required type="time" value={t} onChange={e => setTimes(times.map((v, n) => n === i ? e.target.value : v))}/></label>)}<button className="series-primary" disabled={busy}>حفظ المهمة</button><button type="button" className="series-secondary" onClick={() => onCancel()}>إلغاء</button></form>);
}
