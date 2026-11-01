import {createModelModalTransport,createFluxPythonRunner} from './flux-modal-transport.mjs';
export function createWanModalTransport(options={}){return createModelModalTransport({runner:createFluxPythonRunner({timeoutMs:2400000}),...options,modelId:'wan22-i2v-a14b'});}
