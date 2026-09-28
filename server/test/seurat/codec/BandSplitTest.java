package seurat.codec;

import java.util.Random;
import seurat.kit.TestKit;

/** BandSplit: the same bands as ranking every parent with BandsOrder (E desc, Morton asc); E = 0 in none. */
public final class BandSplitTest {
    private static final int N = Geometry.PARENTS;

    public static void main(String[] args) {
        Random rnd = new Random(7);
        same("all zero", new int[N]);
        same("few values, many ties", fill(rnd, 4));
        same("one digit", fill(rnd, 2000));
        same("two digits", fill(rnd, 1 << 20));
        same("three digits", fill(rnd, Integer.MAX_VALUE));
        int[] sparse = new int[N];
        for (int i = 0; i < 300; i++) sparse[rnd.nextInt(N)] = 1 + rnd.nextInt(50);
        same("mostly zero", sparse);
        System.out.println("BandSplitTest OK");
    }

    private static int[] fill(Random rnd, int bound) {
        int[] e = new int[N];
        for (int i = 0; i < N; i++) e[i] = rnd.nextInt(bound);
        return e;
    }

    private static void same(String what, int[] energy) {
        int[] rank = BandsOrder.order(energy, N);
        byte[] band = new byte[N];
        BandSplit.split(energy.clone(), band, new int[N], new int[N], new int[1 << BandSplit.DIGIT_BITS]);
        for (int i = 0; i < N; i++) {
            int want = energy[i] == 0 ? Bands.NONE : Bands.bandOf(rank[i]);
            TestKit.check(band[i] == want, what + ": parent " + i + " band " + band[i] + " != " + want);
        }
    }
}
