import {createModelModalTransport} from './flux-modal-transport.mjs';
const MODELS=new Set(['habibi-irq','habibi-egy','habibi-msa','audar-tts-v1-flash']);
export function createSpeechModalTransport(options={}){if(!MODELS.has(options.modelId))throw Error('SPEECH_MODEL_UNSUPPORTED');return createModelModalTransport(options);}
