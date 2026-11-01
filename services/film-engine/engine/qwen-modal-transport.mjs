import {createModelModalTransport} from './flux-modal-transport.mjs';

// Trusted server selection only; no alternate manifest, endpoint or model fallback.
export function createQwenModalTransport(options={}){return createModelModalTransport({...options,modelId:'qwen-image-edit-2511'});}
