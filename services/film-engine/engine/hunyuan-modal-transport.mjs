import {createModelModalTransport,createFluxPythonRunner} from './flux-modal-transport.mjs';
export function createHunyuanModalTransport(options={}){return createModelModalTransport({runner:createFluxPythonRunner({timeoutMs:2400000}),...options,modelId:'hunyuanvideo15'});}
