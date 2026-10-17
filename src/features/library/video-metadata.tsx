import { useState } from 'react';
import { requireVideoText } from '../scheduler/schedule-input';
import type { LibraryVideo } from '../scheduler/schedule-model';
import { validatePublishMetadata, type PublishMetadata } from '../../../shared/library-publishing';
export function Metadata({ video, busy, onSave }: {
    video: LibraryVideo;
    busy: boolean;
    onSave: (m: PublishMetadata) => Promise<void>;
}) {
    const [m, setM] = useState<PublishMetadata>(video.metadata ?? { title: video.title.slice(0, 100), description: '', hashtags: [], categoryId: '22', madeForKids: false, privacy: 'public', isAiGenerated: false }), [tags, setTags] = useState(video.metadata?.hashtags.join(' ') ?? ''), [error, setError] = useState('');
    return <details><summary>مراجعة حقول النشر</summary><form onSubmit={e => {
            e.preventDefault();
            setError('');
            try {
                requireVideoText(m.title, m.description);
                const next = validatePublishMetadata({ ...m, hashtags: tags.trim() ? tags.trim().split(/\s+/) : [] });
                void onSave(next).catch(e => setError((e as Error).message));
            }
            catch (e) {
                setError((e as Error).message);
            }
        }}><label>العنوان<input required maxLength={100} value={m.title} onChange={e => setM({ ...m, title: e.target.value })}/></label><label>الوصف<textarea required rows={3} maxLength={4500} value={m.description} onChange={e => setM({ ...m, description: e.target.value })}/></label><label>الوسوم<input value={tags} onChange={e => setTags(e.target.value)} placeholder="#ريلز #بغداد"/></label><label>فئة يوتيوب<select value={m.categoryId} onChange={e => setM({ ...m, categoryId: e.target.value })}>{[['22', 'أشخاص ومدونات'], ['24', 'ترفيه'], ['27', 'تعليم'], ['28', 'علوم وتقنية'], ['10', 'موسيقى']].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><button className="series-primary" disabled={busy || !!video.publicationId}>حفظ الحقول والموافقة عليها</button>{error && <p role="alert" className="series-error">{error}</p>}</form></details>;
}
