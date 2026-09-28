package seurat.codec;

import java.util.Random;
import seurat.kit.TestKit;

/**
 * Spec 2.1 and 7.2: parents with E = 0 are in no band, a band without members is 0 bytes, and a
 * brush whose parents all have E = 0 is empty (every band end 0). The members that remain decode to
 * their residuals.
 */
public final class BrushEncoderTest {
    private static final int N = Bands.PARENTS;
    private static final int SIDE = 128;

    public static void main(String[] args) {
        Random rnd = new Random(5);
        brush("empty", new int[0], rnd);
        brush("one band", pick(rnd, 300), rnd);
        brush("two bands", pick(rnd, 3000), rnd);
        brush("all four", pick(rnd, 12000), rnd);
        System.out.println("BrushEncoderTest OK");
    }

    private static int[] pick(Random rnd, int k) {
        return rnd.ints(0, N).distinct().limit(k).toArray();
    }

    /** Flat parents (no prediction) and quantizer 1: residuals are the details themselves. */
    private static void brush(String what, int[] live, Random rnd) {
        int[][][][] det = new int[3][3][1][N]; // detail H/V/D, channel, plane
        for (int i : live) {
            for (int d = 0; d < 3; d++) {
                for (int c = 0; c < 3; c++) {
                    det[d][c][0][i] = rnd.nextInt(41) - 20;
                }
            }
            det[0][0][0][i] |= 1; // odd, so never zero: E > 0
        }
        var out = BrushEncoder.encode(new int[3][N], det[0], det[1], det[2], N, SIDE, 1, 1);
        int[] seen = new int[N];
        for (int b = 0; b < 4; b++) {
            boolean used = live.length > Bands.CUTS[b];
            byte[] band = out.bands()[b];
            TestKit.check(used == (band.length > 0), what + ": band " + b + " is " + band.length + " bytes");
            TestKit.check(used || out.crcs()[b] == 0, what + ": empty band " + b + " CRC-32C 0");
            int[][][] vals = new int[3][3][N];
            int[] members = Bands.unpack(band, N, vals);
            for (int i = 0; i < N; i++) {
                seen[i] += members[i];
                for (int c = 0; c < 3; c++) {
                    for (int d = 0; d < 3; d++) {
                        TestKit.check(members[i] == 0 || vals[c][d][i] == det[d][c][0][i],
                                what + ": residual of parent " + i);
                    }
                }
            }
        }
        int[] want = new int[N];
        for (int i : live) want[i] = 1;
        TestKit.check(java.util.Arrays.equals(seen, want), what + ": exactly the parents with E > 0, once");
    }
}
