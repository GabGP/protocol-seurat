package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import seurat.core.shared.config.SeuratConstants;

/** Teselas set codec (ADR-09): run form or block form, whichever is shorter; replaces the v1.0 Rangos layout. */
public final class TeselasCodec {
    private static final long LIMIT = 1L << 62;

    private TeselasCodec() {}

    public static byte[] encode(Ranges r) {
        if (r.isEmpty()) {
            return new byte[]{0x00, 0x00};
        }
        TeselasRunWalker run = new TeselasRunWalker();
        TeselasBlockWalker block = new TeselasBlockWalker();
        run.prepareMeasure();
        block.prepareMeasure(run);
        r.forEachSpan(block);
        block.finish();
        run.finish();

        int runLen = run.length();
        int blockLen = block.length();
        if (blockLen < runLen) {
            ByteBuffer buf = ByteBuffer.allocate(blockLen);
            block.prepareWrite(buf);
            r.forEachSpan(block);
            block.finish();
            return buf.array();
        }
        ByteBuffer buf = ByteBuffer.allocate(runLen);
        run.prepareWrite(buf);
        r.forEachSpan(run);
        run.finish();
        return buf.array();
    }

    public static Ranges decode(ByteBuffer b) {
        long first = VarInt.get(b);
        if (first == 0) {
            long second = VarInt.get(b);
            if (second == 0) {
                return Ranges.empty();
            }
            return TeselasBlocks.decode(b, second);
        }
        return decodeRunForm(b, first);
    }

    private static Ranges decodeRunForm(ByteBuffer b, long menor) {
        if (menor < 1 || menor >= LIMIT) {
            throw new IllegalArgumentException("run form: menor < 1 or >= 2^62: " + menor);
        }
        long nSaltos = VarInt.get(b);
        if (nSaltos < 0 || nSaltos > SeuratConstants.TESELAS_MAX_NUMBERS) {
            throw new IllegalArgumentException("invalid nSaltos: " + nSaltos);
        }
        long primerLargo = VarInt.get(b);
        if (primerLargo < 0 || primerLargo + 1 > SeuratConstants.TESELAS_MAX_NUMBERS) {
            throw new IllegalArgumentException("run exceeds max numbers: " + primerLargo);
        }
        long firstHi = menor + primerLargo;
        if (firstHi < menor || firstHi >= LIMIT) {
            throw new IllegalArgumentException("number >= 2^62: " + firstHi);
        }
        Ranges.Builder builder = new Ranges.Builder();
        builder.addRange(menor, firstHi);
        long countTotal = primerLargo + 1;
        long prevLast = firstHi;

        for (long i = 0; i < nSaltos; i++) {
            long salto = VarInt.get(b);
            long largo = VarInt.get(b);
            if (salto < 0 || largo < 0) {
                throw new IllegalArgumentException("negative salto or largo");
            }
            long count = largo + 1;
            if (countTotal + count > SeuratConstants.TESELAS_MAX_NUMBERS) {
                throw new IllegalArgumentException("run exceeds max numbers");
            }
            if (LIMIT - 2 - prevLast < salto) {
                throw new IllegalArgumentException("number >= 2^62");
            }
            long start = prevLast + salto + 2;
            if (LIMIT - start <= largo) {
                throw new IllegalArgumentException("number >= 2^62");
            }
            long last = start + largo;
            builder.addRange(start, last);
            countTotal += count;
            prevLast = last;
        }
        return builder.build();
    }
}
