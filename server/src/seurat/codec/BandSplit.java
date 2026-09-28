package seurat.codec;

/**
 * Band of each parent of a 128x128 brush (spec: E descending, Morton ascending), without a full
 * sort: parents start in Morton order and a stable LSD radix pass per digit of E orders them by
 * energy, so ties keep Morton order. Same bands as ranking with {@link BandsOrder}, a fraction of
 * the cost; a brush whose energies are all zero takes no pass at all.
 */
final class BandSplit {
    private BandSplit() {}

    static final int DIGIT_BITS = 11;
    private static final int DIGIT_MASK = (1 << DIGIT_BITS) - 1;
    private static final int[] BY_MORTON = new int[BrushWorkspace.N];

    static {
        for (int i = 0; i < BrushWorkspace.N; i++) {
            BY_MORTON[BrushWorkspace.MORTON_16K[i]] = i;
        }
    }

    /** Fills {@code band[i]} with the band of parent {@code i}, per {@link Bands#CUTS}. */
    static void split(int[] energy, byte[] band, int[] order, int[] spare, int[] count) {
        int n = BrushWorkspace.N;
        int max = 0;
        for (int i = 0; i < n; i++) {
            max = Math.max(max, energy[i]);
        }
        int[] src = order;
        int[] dst = spare;
        System.arraycopy(BY_MORTON, 0, src, 0, n);
        for (int shift = 0; shift < Integer.SIZE && (max >>> shift) != 0; shift += DIGIT_BITS) {
            java.util.Arrays.fill(count, 0);
            for (int k = 0; k < n; k++) {
                count[((max - energy[src[k]]) >>> shift) & DIGIT_MASK]++;
            }
            int sum = 0;
            for (int d = 0; d <= DIGIT_MASK; d++) {
                int c = count[d];
                count[d] = sum;
                sum += c;
            }
            for (int k = 0; k < n; k++) {
                int i = src[k];
                dst[count[((max - energy[i]) >>> shift) & DIGIT_MASK]++] = i;
            }
            int[] t = src;
            src = dst;
            dst = t;
        }
        int b = 0;
        for (int r = 0; r < n; r++) {
            while (r >= Bands.CUTS[b + 1]) {
                b++;
            }
            band[src[r]] = (byte) b;
        }
    }
}
