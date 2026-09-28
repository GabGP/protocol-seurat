package seurat.codec;

import seurat.kit.TestKit;

/** Bands: energy order, splits, pack/unpack round-trip, browser deflate. */
public final class BandsTest {
    public static void main(String[] args) {
        splits();
        ordering();
        roundTrip();
        emptyBand();
        System.out.println("BandsTest OK");
    }

    private static void splits() {
        TestKit.check(Bands.bandOf(0) == 0 && Bands.bandOf(2047) == 0, "band 0");
        TestKit.check(Bands.bandOf(2048) == 1 && Bands.bandOf(4095) == 1, "band 1");
        TestKit.check(Bands.bandOf(4096) == 2 && Bands.bandOf(8191) == 2, "band 2");
        TestKit.check(Bands.bandOf(8192) == 3 && Bands.bandOf(16383) == 3, "band 3");
    }

    private static void ordering() {
        ordering(256);
        ordering(Geometry.PARENTS);
    }

    private static void ordering(int n) {
        int[] energy = new int[n];
        java.util.Random rnd = new java.util.Random(3);
        for (int i = 0; i < n; i++) {
            energy[i] = rnd.nextInt(100) - 50;
        }
        int[] rank = Bands.order(energy, n);
        int[] byRank = new int[n];
        for (int i = 0; i < n; i++) {
            byRank[rank[i]] = i;
        }
        for (int r = 1; r < n; r++) {
            int prev = energy[byRank[r - 1]];
            int cur = energy[byRank[r]];
            TestKit.check(prev > cur || (prev == cur
                    && morton(byRank[r - 1], n) <= morton(byRank[r], n)),
                    "E-desc morton-asc at rank " + r);
        }
    }

    private static int morton(int i, int n) {
        int side = (int) Math.sqrt(n);
        return (int) Morton.encode(i % side, i / side);
    }

    private static void roundTrip() {
        int n = 1024;
        java.util.Random rnd = new java.util.Random(11);
        int[][] members = new int[4][n];
        for (int i = 0; i < n; i++) {
            members[rnd.nextInt(4)][i] = 1;
        }
        for (int b = 0; b < 4; b++) {
            int[][][] vals = new int[3][3][n];
            for (int c = 0; c < 3; c++) {
                for (int d = 0; d < 3; d++) {
                    for (int i = 0; i < n; i++) {
                        vals[c][d][i] = rnd.nextInt(2001) - 1000;
                    }
                }
            }
            byte[] packed = Bands.pack(members[b], vals);
            int[][][] back = new int[3][3][n];
            int[] got = Bands.unpack(packed, n, back);
            TestKit.check(java.util.Arrays.equals(got, members[b]), "members band " + b);
            for (int c = 0; c < 3; c++) {
                for (int d = 0; d < 3; d++) {
                    for (int i = 0; i < n; i++) {
                        int want = members[b][i] != 0 ? vals[c][d][i] : 0;
                        TestKit.check(back[c][d][i] == want, "value band " + b);
                    }
                }
            }
        }
    }

    private static void emptyBand() {
        int n = 64;
        byte[] packed = Bands.pack(new int[n], new int[3][3][n]);
        int[][][] back = new int[3][3][n];
        int[] got = Bands.unpack(packed, n, back);
        for (int v : got) {
            TestKit.check(v == 0, "empty members");
        }
    }
}
