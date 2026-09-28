export const ENDPOINTS = {
  session: '/seurat/v1/sesion',
} as const;

export const LIMITS = {
  wtReadyMs: 3000,
  gazePerSec: 20,
  quietIdleMs: 300,
  receiptMs: 100,
  receiptBatch: 8,
  memMibFallback: 128,
} as const;
