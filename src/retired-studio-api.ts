// Compatibility for archived logic and its regression tests. No generator API calls.
export async function studioChat(_request:unknown):Promise<never>{void _request;throw Error('الدردشة غير متاحة في منصة الريلز.');}
export async function studioImage(_request:object):Promise<never>{void _request;throw Error('توليد الصور غير متاح في منصة الريلز.');}
