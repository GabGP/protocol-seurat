package seurat.core.shared.proto;

import java.nio.ByteBuffer;

/** Block-form measurement and write walker for Teselas sets (ADR-09). */
final class TeselasBlockWalker implements Ranges.SpanConsumer {
    private ByteBuffer out;
    private TeselasRunWalker run;
    private long menor = -1;
    private long curB = -1;
    private long curW = 0L;
    private int nPiezas = 0;
    private int savedNPiezas = 0;
    private int pendingKind = 0;
    private long pendingCount = 0;
    private int bodyLength = 0;

    void prepareMeasure(TeselasRunWalker run) {
        this.out = null;
        this.run = run;
        this.menor = -1;
        this.curB = -1;
        this.curW = 0L;
        this.nPiezas = 0;
        this.savedNPiezas = 0;
        this.pendingKind = 0;
        this.pendingCount = 0;
        this.bodyLength = 0;
    }

    void prepareWrite(ByteBuffer buf) {
        this.out = buf;
        this.run = null;
        VarInt.put(buf, 0);
        VarInt.put(buf, menor);
        VarInt.put(buf, savedNPiezas);
        this.curB = -1;
        this.curW = 0L;
        this.nPiezas = 0;
        this.pendingKind = 0;
        this.pendingCount = 0;
    }

    @Override
    public void accept(long lo, long hi) {
        if (run != null) run.accept(lo, hi);
        if (menor == -1) menor = lo;
        long relLo = lo - menor, relHi = hi - menor;
        long blkLo = relLo >>> 6, blkHi = relHi >>> 6;
        if (blkLo == blkHi) { // the common span: a few numbers inside one block
            or(blkLo, (-1L >>> (63 - (int) (relHi & 63))) & (-1L << (int) (relLo & 63)));
            return;
        }
        for (long b = blkLo; b <= blkHi; b++) {
            int a = (b == blkLo) ? (int) (relLo & 63) : 0;
            int z = (b == blkHi) ? (int) (relHi & 63) : 63;
            or(b, (-1L >>> (63 - z)) & (-1L << a));
        }
    }

    /** ORs `mask` into relative block `b`, emitting the previous block (and a SALTO for any skipped) when `b` is new. */
    private void or(long b, long mask) {
        if (b == curB) {
            curW |= mask;
            return;
        }
        if (curB != -1) {
            emit(curW);
            if (b - curB > 1) {
                addSalto(b - curB - 1);
            }
        }
        curB = b;
        curW = mask;
    }

    void finish() {
        if (curB != -1) emit(curW);
        flush();
        if (out == null) savedNPiezas = nPiezas;
        run = null;
    }

    int length() {
        return 1 + VarInt.encodedLength(menor) + VarInt.encodedLength(savedNPiezas) + bodyLength;
    }

    private void flush() {
        if (pendingKind != 0) {
            long cab = (pendingCount << 2) | (pendingKind == 1 ? 0 : 1);
            if (out == null) bodyLength += VarInt.encodedLength(cab);
            else VarInt.put(out, cab);
            nPiezas++;
            pendingKind = 0;
            pendingCount = 0;
        }
    }

    private void addSalto(long count) {
        if (pendingKind != 1) flush();
        pendingKind = 1;
        pendingCount += count;
    }

    private void emit(long w) {
        if (w == -1L) {
            if (pendingKind != 2) flush();
            pendingKind = 2;
            pendingCount++;
            return;
        }
        flush();
        int runs = Long.bitCount(w & ~(w << 1));
        if (runs <= 3) {
            long cab = ((long) runs << 2) | 3;
            if (out == null) {
                bodyLength += 1 + runs * 2;
            } else {
                VarInt.put(out, cab);
                for (long t = w; t != 0; ) {
                    int d = Long.numberOfTrailingZeros(t), len = Long.numberOfTrailingZeros(~(t >>> d));
                    out.put((byte) d);
                    out.put((byte) (len - 1));
                    t = (d + len == 64) ? 0L : (t & (-1L << (d + len)));
                }
            }
        } else {
            if (out == null) {
                bodyLength += 9;
            } else {
                VarInt.put(out, 2);
                for (int i = 0; i < 8; i++) out.put((byte) (w >>> (i * 8)));
            }
        }
        nPiezas++;
    }
}
