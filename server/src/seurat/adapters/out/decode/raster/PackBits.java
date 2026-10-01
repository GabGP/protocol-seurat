package seurat.adapters.out.decode.raster;

/**
 * PackBits run-length decoding (Apple TN1023, TIFF compression 32773, Photoshop RLE): a header byte
 * n in 0..127 copies the next n + 1 bytes, -127..-1 repeats the next byte 1 - n times, -128 is a
 * no-op.
 */
public final class PackBits {
    private PackBits() {}

    private static final int NOOP = -128;

    /** Decodes {@code in[at..end)} into {@code out[o..o + n)}; a short input leaves the rest untouched. */
    public static void decode(byte[] in, int at, int end, byte[] out, int o, int n) {
        int stop = o + n;
        while (at < end && o < stop) {
            int h = in[at++];
            if (h >= 0) {
                int k = Math.min(Math.min(h + 1, stop - o), end - at);
                System.arraycopy(in, at, out, o, k);
                at += h + 1;
                o += k;
            } else if (h != NOOP && at < end) {
                int k = Math.min(1 - h, stop - o);
                java.util.Arrays.fill(out, o, o + k, in[at++]);
                o += k;
            }
        }
    }
}
