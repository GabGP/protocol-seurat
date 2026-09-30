package seurat.ingest.decode.tiff;

/**
 * TIFF LZW (TIFF 6.0 section 13): MSB-first codes of 9 to 12 bits, Clear 256, EndOfInformation 257,
 * and the code width growing one entry early. A table entry is a slice of the output already
 * written, so decoding copies instead of chasing prefix chains.
 */
final class TiffLzw {
    private TiffLzw() {}

    private static final int CLEAR = 256;
    private static final int EOI = 257;
    private static final int FIRST = 258;
    private static final int TABLE = 4096;
    private static final int MIN_WIDTH = 9;
    private static final int MAX_WIDTH = 12;

    /** Decodes {@code in} into {@code out} until EOI, the end of the input or a full output. */
    static void decode(byte[] in, byte[] out) {
        int[] start = new int[TABLE];
        int[] len = new int[TABLE];
        int next = FIRST;
        int width = MIN_WIDTH;
        int bits = 0;
        int ip = 0;
        int op = 0;
        int prevS = -1;
        int prevL = 0;
        long acc = 0;
        while (op < out.length) {
            while (bits < width) {
                if (ip >= in.length) return;
                acc = acc << 8 | in[ip++] & 0xFF;
                bits += 8;
            }
            int code = (int) (acc >>> (bits - width)) & ((1 << width) - 1);
            bits -= width;
            if (code == EOI) return;
            if (code == CLEAR) {
                next = FIRST;
                width = MIN_WIDTH;
                prevS = -1;
                continue;
            }
            int s = op;
            int l;
            if (code < CLEAR) {
                out[op++] = (byte) code;
                l = 1;
            } else if (code < next) {
                l = Math.min(len[code], out.length - op);
                System.arraycopy(out, start[code], out, op, l);
                op += l;
            } else if (prevS >= 0) { // KwKwK: the entry being defined, previous string plus its own first byte
                l = Math.min(prevL + 1, out.length - op);
                System.arraycopy(out, prevS, out, op, Math.min(prevL, l));
                if (l > prevL) out[op + prevL] = out[prevS];
                op += l;
            } else {
                return; // corrupt: a code not yet in the table
            }
            if (prevS >= 0 && next < TABLE) {
                start[next] = prevS;
                len[next] = prevL + 1;
                next++;
                if (next >= (1 << width) - 1 && width < MAX_WIDTH) width++;
            }
            prevS = s;
            prevL = l;
        }
    }
}
