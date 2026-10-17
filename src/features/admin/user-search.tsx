import {useState} from 'react';
import {useConvex} from 'convex/react';
import {Search} from 'lucide-react';
import {api} from '../../../convex/_generated/api';
export type AdminUser={subject:string;name:string;email?:string;disabled:boolean};
export function AdminUserSearch({onSelect}:{onSelect:(user:AdminUser)=>void}){
 const client=useConvex(),[email,setEmail]=useState(''),[rows,setRows]=useState<AdminUser[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function search(){if(busy)return;setBusy(true);setRows([]);setMessage('');try{const found=await client.query(api.reelsAdmin.findUserByEmail,{email});setRows(found);if(!found.length)setMessage('لم نجد حساباً بهذا البريد. يجب أن يكون الزبون قد سجّل الدخول، وأن يصل بريده الموثق من Clerk.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <section className="admin-user-search" aria-label="البحث عن حساب بالبريد الإلكتروني"><form onSubmit={e=>{e.preventDefault();void search();}}><label>البحث عبر الإيميل<input type="email" required maxLength={254} autoComplete="off" dir="ltr" placeholder="name@example.com" value={email} onChange={e=>{setEmail(e.target.value);setRows([]);setMessage('');}}/></label><button className="series-primary" disabled={busy}><Search size={17}/>{busy?'جارٍ البحث…':'بحث'}</button></form>{message&&<p role="status">{message}</p>}{rows.map(user=><button type="button" className="admin-user-result" key={user.subject} onClick={()=>onSelect(user)}><strong>{user.name}</strong><span dir="ltr">{user.email}</span><small>{user.disabled?'محظور':'مفعّل'} · {user.subject}</small><span>اختيار الحساب</span></button>)}</section>;
}
