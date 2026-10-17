import {api} from '../../../convex/_generated/api';
import {publishingConnection} from '../../shared/api/publishing-session';
export async function cloudUploadTicket(file: File) { return await publishingConnection().client.mutation(api.publishingUploadTickets.begin, { size: file.size, type: file.type }); }

export async function cancelUploadTicket(id:import('../../../convex/_generated/dataModel').Id<'publishingUploadTickets'>){await publishingConnection().client.mutation(api.publishingUploadTickets.cancel,{id});}
