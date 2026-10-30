import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
export async function fileDigest(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
