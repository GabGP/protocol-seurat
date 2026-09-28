package seurat.ingest;

import java.io.DataInputStream;
import java.io.IOException;

/** DHT and DQT segments (T.81 B.2.4) into the header's tables; quantizers stored in natural order. */
final class JpegTables {
    private JpegTables() {}

    /** Zigzag position k to natural (row-major) position. */
    private static final int[] ZIGZAG = {
        0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
        28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
        54, 47, 55, 62, 63};

    static int natural(int k) {
        return ZIGZAG[k];
    }

    static void huffman(DataInputStream in, int len, JpegHuffman[] dc, JpegHuffman[] ac) throws IOException {
        while (len > 0) {
            int tc = in.readUnsignedByte();
            int[] counts = new int[16];
            int total = 0;
            for (int i = 0; i < 16; i++) {
                counts[i] = in.readUnsignedByte();
                total += counts[i];
            }
            int[] symbols = new int[total];
            for (int i = 0; i < total; i++) {
                symbols[i] = in.readUnsignedByte();
            }
            (tc >> 4 == 0 ? dc : ac)[tc & 3] = new JpegHuffman(counts, symbols);
            len -= 17 + total;
        }
    }

    static void quant(DataInputStream in, int len, int[][] qt) throws IOException {
        while (len > 0) {
            int pq = in.readUnsignedByte();
            boolean wide = (pq >> 4) != 0;
            int[] t = new int[64];
            for (int k = 0; k < 64; k++) {
                t[ZIGZAG[k]] = wide ? in.readUnsignedShort() : in.readUnsignedByte();
            }
            qt[pq & 3] = t;
            len -= 1 + (wide ? 128 : 64);
        }
    }
}
