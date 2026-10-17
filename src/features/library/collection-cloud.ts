import {api} from '../../../convex/_generated/api';
import {publishingConnection} from '../../shared/api/publishing-session';
import type {PublishingCollection} from './collection-store';
export async function cloudCollections() { const client = publishingConnection().client, rows: PublishingCollection[] = []; let cursor: string | null = null; for (;;) {
    const page: {
        page: PublishingCollection[];
        isDone: boolean;
        continueCursor: string;
    } = await client.query(api.publishingCollections.page, { paginationOpts: { cursor, numItems: 10 } });
    rows.push(...page.page as PublishingCollection[]);
    if (page.isDone)
        return rows;
    if (page.continueCursor === cursor)
        throw Error('تعذر إكمال صفحات الحافظات.');
    cursor = page.continueCursor;
} }
export async function cloudSaveCollection(p: PublishingCollection) {
    const clean = { id: p.id, name: p.name, kind: p.kind, publishSchedule: p.publishSchedule, publishTasks: p.publishTasks, libraryVideos: p.libraryVideos?.map(({ id, title, createdAt, bunnyAssetId, storageId, taskId, publishAt, publishedAt, publicationId, metadata, metadataReviewed, channelIds, movedTo, publishingError }) => ({ id, title, createdAt, bunnyAssetId, storageId, taskId, publishAt, publishedAt, publicationId, metadata, metadataReviewed, channelIds, movedTo, publishingError })) };
    return await publishingConnection().client.mutation(api.publishingCollections.save, { collection: clean as import('convex/server').FunctionArgs<typeof api.publishingCollections.save>['collection'], expectedVersion: p.version ?? 0 }) as PublishingCollection;
}
