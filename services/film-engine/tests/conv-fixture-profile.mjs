// Existing concurrency/wallet tests intentionally exercise explicit historical
// Conv rollback with strict fake suppliers. This test-only module is never
// imported by production. Default DFR and its gates have a separate suite.
process.env.LTX_INFERENCE_PROFILE='conv-stable';
