package seurat.core.works.ingest.decode.jpeg;

/**
 * Subsampled JPEG components back to full resolution the way libjpeg 6b does it (jdsample.c, the
 * library ImageIO bundles), so both paths agree to the sample: the triangle filter for 2:1
 * horizontal and 2:1 both ways when a row has more than two samples, plain replication for every
 * other integral factor. Samples past the component's real width or height are never read: the
 * edges repeat the last real sample, as libjpeg's context rows do.
 */
final class JpegUpsample {
    private JpegUpsample() {}

    static final int FULL = 0;
    static final int BOX = 1;
    static final int H2V1 = 2;
    static final int H2V2 = 3;
    /** libjpeg filters only rows wider than this; narrower ones are replicated. */
    private static final int FANCY_MIN_WIDTH = 2;

    /** The method for a component upsampled {@code sx} by {@code sy} with {@code dw} real samples a row. */
    static int mode(int sx, int sy, int dw) {
        if (sx == 1 && sy == 1) return FULL;
        if (sx == 2 && sy == 1 && dw > FANCY_MIN_WIDTH) return H2V1;
        if (sx == 2 && sy == 2 && dw > FANCY_MIN_WIDTH) return H2V2;
        return BOX;
    }

    /** {@code dst[x * nc + c] = s[o + x / sx]} for x below {@code w}. */
    static void box(int[] s, int o, int sx, int w, int[] dst, int c, int nc) {
        for (int x = 0; x < w; x++) {
            dst[x * nc + c] = s[o + x / sx];
        }
    }

    /** 3/4 of the nearer sample plus 1/4 of the further one (h2v1_fancy_upsample). */
    static void h2v1(int[] s, int o, int dw, int w, int[] dst, int c, int nc) {
        for (int i = 0; i < dw; i++) {
            int near = 3 * s[o + i];
            int x = 2 * i;
            dst[x * nc + c] = (near + s[o + Math.max(0, i - 1)] + 1) >> 2;
            if (x + 1 < w) {
                dst[(x + 1) * nc + c] = (near + s[o + Math.min(dw - 1, i + 1)] + 2) >> 2;
            }
        }
    }

    /** The same filter on column sums 3 near + far of two rows (h2v2_fancy_upsample). */
    static void h2v2(int[] near, int no, int[] far, int fo, int dw, int w, int[] dst, int c, int nc) {
        int last = 3 * near[no] + far[fo];
        int cur = last;
        for (int i = 0; i < dw; i++) {
            int next = i + 1 < dw ? 3 * near[no + i + 1] + far[fo + i + 1] : cur;
            int x = 2 * i;
            dst[x * nc + c] = (3 * cur + last + 8) >> 4;
            if (x + 1 < w) {
                dst[(x + 1) * nc + c] = (3 * cur + next + 7) >> 4;
            }
            last = cur;
            cur = next;
        }
    }
}
