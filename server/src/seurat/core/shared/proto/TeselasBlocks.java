package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import seurat.core.shared.config.SeuratConstants;

/** Block-form decode for Teselas sets (ADR-09). */
final class TeselasBlocks {
    private static final long LIMIT = 1L << 62;

    private TeselasBlocks() {}

    static Ranges decode(ByteBuffer b, long menor) {
        if (menor < 1 || menor >= LIMIT) {
            throw new IllegalArgumentException("block menor: " + menor);
        }
        long nPiezas = VarInt.get(b);
        if (nPiezas < 0 || nPiezas > SeuratConstants.TESELAS_MAX_NUMBERS) {
            throw new IllegalArgumentException("invalid nPiezas: " + nPiezas);
        }
        Ranges.Builder out = new Ranges.Builder();
        long bRel = 0, countTotal = 0;
        for (long p = 0; p < nPiezas; p++) {
            long cab = VarInt.get(b), count = cab >>> 2;
            int kind = (int) (cab & 3);
            if (kind <= 1) {
                if (count < 0 || bRel < 0 || (LIMIT - 1 - menor) / 64L - bRel < count) {
                    throw new IllegalArgumentException("number >= 2^62");
                }
                if (kind == 1) {
                    if (count > (SeuratConstants.TESELAS_MAX_NUMBERS - countTotal) / 64) {
                        throw new IllegalArgumentException("LLENO exceeds max numbers");
                    }
                    out.addRange(menor + bRel * 64L, menor + (bRel + count) * 64L - 1);
                    countTotal += count * 64;
                }
                bRel += count;
            } else {
                if (bRel < 0 || bRel > (LIMIT - 1 - menor) / 64L) {
                    throw new IllegalArgumentException("number >= 2^62");
                }
                long base = menor + bRel * 64L;
                if (kind == 2) {
                    if (b.remaining() < 8) {
                        throw new IllegalArgumentException("truncated MAPA");
                    }
                    long word = 0;
                    for (int i = 0; i < 8; i++) {
                        word |= Byte.toUnsignedLong(b.get()) << (i * 8);
                    }
                    while (word != 0) {
                        int s = Long.numberOfTrailingZeros(word);
                        int len = Long.numberOfTrailingZeros(~(word >>> s));
                        if (countTotal + len > SeuratConstants.TESELAS_MAX_NUMBERS) {
                            throw new IllegalArgumentException("exceeds max numbers");
                        }
                        out.addRange(base + s, base + s + len - 1);
                        countTotal += len;
                        word = (s + len == 64) ? 0L : (word & (-1L << (s + len)));
                    }
                } else {
                    if (count < 0 || b.remaining() < count * 2) {
                        throw new IllegalArgumentException("truncated TRAMOS");
                    }
                    for (int i = 0; i < count; i++) {
                        int desde = Byte.toUnsignedInt(b.get());
                        int largo = Byte.toUnsignedInt(b.get()) + 1;
                        if (desde + largo > 64) {
                            throw new IllegalArgumentException("TRAMOS run leaves its block");
                        }
                        long hi = base + desde + largo - 1;
                        if (hi >= LIMIT) {
                            throw new IllegalArgumentException("number >= 2^62");
                        }
                        if (countTotal + largo > SeuratConstants.TESELAS_MAX_NUMBERS) {
                            throw new IllegalArgumentException("exceeds max numbers");
                        }
                        out.addRange(base + desde, hi);
                        countTotal += largo;
                    }
                }
                bRel++;
            }
        }
        return out.build();
    }
}
