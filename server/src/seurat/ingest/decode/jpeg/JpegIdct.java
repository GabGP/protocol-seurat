package seurat.ingest.decode.jpeg;
import seurat.ingest.decode.Pixels;

/**
 * libjpeg's accurate integer IDCT (jidctint.c, "islow", the ImageIO default): same arithmetic,
 * so a 4:4:4 or gray JPEG decodes to the same samples as the ImageIO path.
 */
final class JpegIdct {
    private JpegIdct() {}

    private static final int CONST_BITS = 13;
    private static final int PASS1_BITS = 2;
    private static final int F_0_298 = 2446;
    private static final int F_0_390 = 3196;
    private static final int F_0_541 = 4433;
    private static final int F_0_765 = 6270;
    private static final int F_0_899 = 7373;
    private static final int F_1_175 = 9633;
    private static final int F_1_501 = 12299;
    private static final int F_1_847 = 15137;
    private static final int F_1_961 = 16069;
    private static final int F_2_053 = 16819;
    private static final int F_2_562 = 20995;
    private static final int F_3_072 = 25172;
    private static final int CENTER = 128;

    /** Dequantized coefficients at {@code in[inOff]}, natural order, to 8x8 samples at {@code out[off + y * stride + x]}. */
    static void idct(int[] in, int inOff, int[] ws, int[] out, int off, int stride) {
        for (int c = 0; c < 8; c++) {
            int i = inOff + c;
            if ((in[i + 8] | in[i + 16] | in[i + 24] | in[i + 32] | in[i + 40] | in[i + 48] | in[i + 56]) == 0) {
                int dc = in[i] << PASS1_BITS;
                for (int r = 0; r < 8; r++) {
                    ws[r * 8 + c] = dc;
                }
                continue;
            }
            pass(in, i, 8, ws, c, 8, CONST_BITS - PASS1_BITS, 0);
        }
        for (int r = 0; r < 8; r++) {
            int o = off + r * stride;
            pass(ws, r * 8, 1, out, o, 1, CONST_BITS + PASS1_BITS + 3, CENTER);
        }
    }

    /** One 1-D pass over 8 values {@code src[s + i * ss]} into {@code dst[d + i * ds]}. */
    private static void pass(int[] src, int s, int ss, int[] dst, int d, int ds, int shift, int center) {
        int z2 = src[s + 2 * ss];
        int z3 = src[s + 6 * ss];
        int z1 = (z2 + z3) * F_0_541;
        int tmp2 = z1 - z3 * F_1_847;
        int tmp3 = z1 + z2 * F_0_765;
        z2 = src[s];
        z3 = src[s + 4 * ss];
        int tmp0 = (z2 + z3) << CONST_BITS;
        int tmp1 = (z2 - z3) << CONST_BITS;
        int tmp10 = tmp0 + tmp3;
        int tmp13 = tmp0 - tmp3;
        int tmp11 = tmp1 + tmp2;
        int tmp12 = tmp1 - tmp2;

        tmp0 = src[s + 7 * ss];
        tmp1 = src[s + 5 * ss];
        tmp2 = src[s + 3 * ss];
        tmp3 = src[s + ss];
        z1 = tmp0 + tmp3;
        z2 = tmp1 + tmp2;
        z3 = tmp0 + tmp2;
        int z4 = tmp1 + tmp3;
        int z5 = (z3 + z4) * F_1_175;
        tmp0 *= F_0_298;
        tmp1 *= F_2_053;
        tmp2 *= F_3_072;
        tmp3 *= F_1_501;
        z1 *= -F_0_899;
        z2 *= -F_2_562;
        z3 = z3 * -F_1_961 + z5;
        z4 = z4 * -F_0_390 + z5;
        tmp0 += z1 + z3;
        tmp1 += z2 + z4;
        tmp2 += z2 + z3;
        tmp3 += z1 + z4;

        int round = 1 << (shift - 1);
        dst[d] = out(tmp10 + tmp3 + round, shift, center);
        dst[d + 7 * ds] = out(tmp10 - tmp3 + round, shift, center);
        dst[d + ds] = out(tmp11 + tmp2 + round, shift, center);
        dst[d + 6 * ds] = out(tmp11 - tmp2 + round, shift, center);
        dst[d + 2 * ds] = out(tmp12 + tmp1 + round, shift, center);
        dst[d + 5 * ds] = out(tmp12 - tmp1 + round, shift, center);
        dst[d + 3 * ds] = out(tmp13 + tmp0 + round, shift, center);
        dst[d + 4 * ds] = out(tmp13 - tmp0 + round, shift, center);
    }

    /** Pass 1 keeps the scaled value; pass 2 recenters and clamps to a sample. */
    private static int out(int v, int shift, int center) {
        v >>= shift;
        return center == 0 ? v : Pixels.clampByte(v + center);
    }
}
