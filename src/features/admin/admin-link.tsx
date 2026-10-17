import {useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
export function ReelsAdminLink({ onOpen }: {
    onOpen: () => void;
}) { const profile = useQuery(api.publishingUsers.profile, {}); return profile?.role === 'super-admin' ? <button onClick={onOpen}>لوحة الإدارة</button> : null; }
