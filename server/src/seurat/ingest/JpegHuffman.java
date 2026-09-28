package seurat.ingest;

/**
 * One JPEG Huffman table (ITU T.81 Annex C), decoded through a {@value #LOOK}-bit lookahead
 * table with the canonical max-code walk for longer codes.
 */
final class JpegHuffman {
    static final int LOOK = 9;
    private static final int MAX_LEN = 16;

    /** (length << 8) | symbol for codes of at most LOOK bits, 0 otherwise. */
    final int[] look = new int[1 << LOOK];
    final int[] maxcode = new int[MAX_LEN + 2];
    final int[] valptr = new int[MAX_LEN + 1];
    final int[] vals;

    /** {@code counts[l - 1]} codes of length l, symbols in code order. */
    JpegHuffman(int[] counts, int[] symbols) {
        this.vals = symbols.clone();
        int code = 0;
        int k = 0;
        for (int l = 1; l <= MAX_LEN; l++) {
            valptr[l] = k - code;
            for (int i = 0; i < counts[l - 1]; i++, k++, code++) {
                if (l <= LOOK) {
                    int shift = LOOK - l;
                    for (int pad = 0; pad < (1 << shift); pad++) {
                        look[(code << shift) | pad] = (l << 8) | symbols[k];
                    }
                }
            }
            maxcode[l] = counts[l - 1] > 0 ? code - 1 : -1;
            code <<= 1;
        }
        maxcode[MAX_LEN + 1] = Integer.MAX_VALUE;
    }

    /** Symbol of a code longer than LOOK bits whose first LOOK bits are {@code code}. */
    int slow(int code, JpegBits bits) {
        int l = LOOK;
        while (l <= MAX_LEN && code > maxcode[l]) {
            code = (code << 1) | bits.bits(1);
            l++;
        }
        return l > MAX_LEN ? 0 : vals[valptr[l] + code] & 0xFF; // corrupt data decodes as 0, like libjpeg
    }
}
