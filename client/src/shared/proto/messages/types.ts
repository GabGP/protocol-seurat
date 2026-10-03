export const T = {
  SALUDO: 0x01, BIENVENIDA: 0x02, LATIDO: 0x03, ECO: 0x04, ERROR: 0x05, ADIOS: 0x06,
  CATALOGO: 0x10, OBRA: 0x11, ABRIR: 0x12, ABIERTA: 0x13, CERRAR: 0x14,
  MIRADA: 0x20, CONCESION: 0x21, PLAN: 0x23, RASPAR: 0x24, RASPADO: 0x25,
  RECIBO: 0x26, SOLTAR: 0x27, RENOVAR: 0x28, AUDITAR: 0x2a, INVENTARIO: 0x2b,
  REGULACION: 0x40,
} as const;

export const CAP_DATAGRAMAS = 0x01;
export const CAP_REANUDAR = 0x02;
/** ADR-07: the client reads REGULACION. */
export const CAP_REGULACION = 0x04;

/** MIRADA mflags (spec 3.3): bit 0 OCULTA, bit 1 QUIETA. */
export const MFLAGS_HIDDEN = 0x01;
export const MFLAGS_STILL = 0x02;
