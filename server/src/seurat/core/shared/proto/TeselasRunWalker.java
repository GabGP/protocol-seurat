package seurat.core.shared.proto;

import java.nio.ByteBuffer;

/** Run-form measurement and write walker for Teselas sets (ADR-09). */
final class TeselasRunWalker implements Ranges.SpanConsumer {
    private ByteBuffer out;
    private long menor = -1;
    private long primerLargo;
    private long prevHi;
    private long nSaltos;
    private long savedNSaltos;
    private int length;

    void prepareMeasure() {
        this.out = null;
        this.menor = -1;
        this.primerLargo = 0;
        this.prevHi = -1;
        this.nSaltos = 0;
        this.savedNSaltos = 0;
        this.length = 0;
    }

    void prepareWrite(ByteBuffer buf) {
        this.out = buf;
        this.menor = -1;
        this.primerLargo = 0;
        this.prevHi = -1;
        this.nSaltos = 0;
    }

    @Override
    public void accept(long lo, long hi) {
        if (menor == -1) {
            menor = lo;
            primerLargo = hi - lo;
            prevHi = hi;
            if (out != null) {
                VarInt.put(out, menor);
                VarInt.put(out, savedNSaltos);
                VarInt.put(out, primerLargo);
            }
        } else {
            long salto = lo - prevHi - 2;
            long largo = hi - lo;
            prevHi = hi;
            nSaltos++;
            if (out == null) {
                length += VarInt.encodedLength(salto) + VarInt.encodedLength(largo);
            } else {
                VarInt.put(out, salto);
                VarInt.put(out, largo);
            }
        }
    }

    void finish() {
        if (out == null) {
            savedNSaltos = nSaltos;
            if (menor != -1) {
                length += VarInt.encodedLength(menor)
                        + VarInt.encodedLength(savedNSaltos)
                        + VarInt.encodedLength(primerLargo);
            }
        }
    }

    int length() {
        return length;
    }
}
