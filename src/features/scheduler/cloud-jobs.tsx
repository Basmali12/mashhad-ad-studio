import {useState} from 'react';
import {useQuery,useMutation,usePaginatedQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import type {PublishingCollection} from '../library/collection-store';
export function CloudJobs({ collections }: {
    collections: PublishingCollection[];
}) {
    const { results: jobs, status: jobPageStatus, loadMore } = usePaginatedQuery(api.reelsJobs.page, {}, { initialNumItems: 25 }), personal = useQuery(api.publishingBufferPersonal.state, {}), oauth = useQuery(api.publishingBuffer.state, {}), create = useMutation(api.reelsJobs.create), cancel = useMutation(api.reelsJobs.cancel);
    const [video, setVideo] = useState(''), [method, setMethod] = useState<'personal' | 'oauth'>('personal'), [due, setDue] = useState(() => new Date(Date.now() + 3 * 3600000 + 60000).toISOString().slice(0, 16)), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    const choices = collections.flatMap(c => (c.libraryVideos ?? []).map(v => ({ collection: c.id, video: v.id, title: c.name + ' · ' + v.title,channelIds:v.channelIds })));
    const connection = method === 'personal' ? personal : oauth;
    async function schedule() { setBusy(true); setMessage(''); try {
        const choice = choices.find(c => c.collection + ':' + c.video === video);
        if (!choice)
            throw Error('اختر فيديو من قائمة النشر.');
        const ids = choice.channelIds??connection?.selectedChannelIds ?? [];
        if (!ids.length)
            throw Error('راجع القنوات المختارة في الحسابات.');
        await create({ collectionId: choice.collection, videoId: choice.video, channelIds: ids, authMode: method, dueAt: Date.parse(due + ':00+03:00'), dryRun: true });
        setMessage('حُفظ اختبار الجدولة دون إرسال؛ لا خصم ولا نشر.');
    }
    catch (e) {
        setMessage((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    return <section className="reels-page"><h1>مهام الجدولة</h1><p>النشر الحقيقي مغلق. هذه مهام اختبار للعامل فقط، ولا ترسل فيديو إلى المنصات.</p><form onSubmit={e => { e.preventDefault(); void schedule(); }}><label>الفيديو<select required value={video} onChange={e => setVideo(e.target.value)}><option value="">اختر الفيديو</option>{choices.map(c => <option key={c.collection + ':' + c.video} value={c.collection + ':' + c.video}>{c.title}</option>)}</select></label><label>طريقة الربط<select value={method} onChange={e => setMethod(e.target.value as 'personal' | 'oauth')}><option value="personal">مفتاح الزبون الشخصي · تجريبي</option><option value="oauth">OAuth الرسمي</option></select></label><label>الموعد · بغداد<input type="datetime-local" required value={due} onChange={e => setDue(e.target.value)}/></label><button disabled={busy}>حفظ اختبار الجدولة</button></form>{message && <p role="status">{message}</p>}{jobs?.map(job => <article key={job._id}><h2>{job.videoId}</h2><p>{new Date(job.dueAt).toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' })} · {job.dryRun ? 'اختبار دون نشر' : 'نشر معتمد'}</p>{job.deliveries.map(d => <p key={d._id}>{d.platform}: {d.phase} {d.error ?? ''}</p>)}<button disabled={job.cancelled || job.deliveries.some(d => !['queued', 'retry'].includes(d.phase))} onClick={() => void cancel({ id: job._id }).catch(e => setMessage((e as Error).message))}>إلغاء الموعد</button></article>)}{jobPageStatus === 'CanLoadMore' && <button onClick={() => loadMore(25)}>عرض مواعيد أقدم</button>}</section>;
}
