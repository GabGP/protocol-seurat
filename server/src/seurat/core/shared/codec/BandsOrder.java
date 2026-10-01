package seurat.core.shared.codec;

import java.util.Arrays;

/**
 * Energy ordering with Morton tie-breaker.
 * Uses primitive long packing and dual-pivot quicksort for zero object allocation.
 */
public final class BandsOrder {
    private BandsOrder() {}

    public static int[] order(int[] energy, int n) {
        long[] packed = new long[n];
        boolean is16k = (n == Geometry.PARENTS);
        int side = is16k ? Geometry.HALF : (int) Math.sqrt(n);
        for (int i = 0; i < n; i++) {
            int morton = is16k ? Morton.PARENTS_16K[i] : (int) Morton.encode(i % side, i / side);
            // ~E is descending for every int; an offset key sets bit 63 for E < 0 and sorts it first.
            packed[i] = ((long) ~energy[i] << 32) | ((long) (morton & 0xFFFF) << 16) | (i & 0xFFFF);
        }
        Arrays.sort(packed);
        int[] rank = new int[n];
        for (int r = 0; r < n; r++) {
            int originalIdx = (int) (packed[r] & 0xFFFF);
            rank[originalIdx] = r;
        }
        return rank;
    }
}
