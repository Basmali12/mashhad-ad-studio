import {useState} from 'react';
import {useQuery,useMutation} from 'convex/react';
import {api} from '../../../convex/_generated/api';
export function CloudInsights() { const runs = useQuery(api.reelsInsights.state, {}), analyze = useMutation(api.reelsInsights.rules), [message, setMessage] = useState(''); return <section><h2>توصيات الأسبوع</h2><p>قواعد آمنة أولًا؛ لا استدعاءات نماذج مدفوعة ولا تعديل تلقائي للمواعيد. إحصائيات التفاعل الخارجية لم تُربط بعد.</p><button onClick={() => void analyze({}).catch(e => setMessage((e as Error).message))}>تحليل الأسبوع بالقواعد</button>{message && <p>{message}</p>}{runs?.map(r => <article key={r._id}>{r.recommendations.map((s, i) => <p key={i}>{s}</p>)}</article>)}</section>; }
