/* global process, fetch, console */
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';
const client=new ConvexHttpClient(process.env.VITE_CONVEX_URL);
let denied=false;
try{await client.query(api.requests.list,{});}catch{denied=true;}
if(!denied)throw new Error('Anonymous data access was unexpectedly allowed');
const response=await fetch(`${process.env.VITE_CONVEX_SITE_URL}/files?id=invalid`);
if(response.status!==401)throw new Error(`Expected 401, got ${response.status}`);
console.log('PASS: deployed Development rejects anonymous request listing and file access (HTTP 401).');

