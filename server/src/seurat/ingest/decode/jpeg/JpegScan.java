package seurat.ingest.decode.jpeg;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/**
 * The entropy-coded scan of a {@link JpegHeader}, one MCU row at a time (T.81 F.2.2): Huffman
 * decode and dequantize into coefficient blocks, restart intervals honored. This is the only
 * sequential part of a decode; {@link JpegMcuRow} turns the blocks into samples.
 */
final class JpegScan {
    private final JpegHeader j;
    private final JpegBits bits;
    private final int nc;
    private final int mcusX;
    /** Blocks per row of component c in an MCU row. */
    final int[] blocksPerRow;
    private final int[] pred;
    private long mcus;

    JpegScan(JpegHeader j, InputStream in) {
        this.j = j;
        this.bits = new JpegBits(in);
        this.nc = j.id.length;
        this.mcusX = (j.width + 8 * j.hMax - 1) / (8 * j.hMax);
        this.blocksPerRow = new int[nc];
        for (int c = 0; c < nc; c++) {
            blocksPerRow[c] = mcusX * j.h[c];
        }
        this.pred = new int[nc];
    }

    /** The next MCU row: block (by, bx) of component c at {@code coef[c][(by * blocksPerRow[c] + bx) * 64]}. */
    void decode(int[][] coef) throws IOException {
        for (int mx = 0; mx < mcusX; mx++) {
            if (j.restartInterval > 0 && mcus > 0 && mcus % j.restartInterval == 0) {
                bits.restart();
                Arrays.fill(pred, 0);
            }
            for (int c = 0; c < nc; c++) {
                for (int by = 0; by < j.v[c]; by++) {
                    for (int bx = 0; bx < j.h[c]; bx++) {
                        block(c, coef[c], (by * blocksPerRow[c] + mx * j.h[c] + bx) * 64);
                    }
                }
            }
            mcus++;
        }
    }

    /** One 8x8 block of component {@code c}, dequantized, natural order, at {@code out[off]}. */
    private void block(int c, int[] out, int off) {
        Arrays.fill(out, off, off + 64, 0);
        int[] q = j.qt[j.tq[c]];
        pred[c] += bits.receiveExtend(bits.decode(j.dc[j.td[c]]));
        out[off] = pred[c] * q[0];
        JpegHuffman ac = j.ac[j.ta[c]];
        for (int k = 1; k < 64; k++) {
            int rs = bits.decode(ac);
            int s = rs & 15;
            k += rs >> 4;
            if (s == 0) {
                if (rs >> 4 != 15) break;
                continue;
            }
            if (k > 63) break;
            int z = JpegTables.natural(k);
            out[off + z] = bits.receiveExtend(s) * q[z];
        }
    }
}
