package seurat.ingest;

/** JPEG-raster YCbCr to packed RGB, one row at a time. Shared by all raster paths. */
final class RasterRgb {
    private RasterRgb() {}

    static void row(int[] samples, int bands, int[] rgb, int n) {
        if (bands >= 3) {
            for (int x = 0; x < n; x++) {
                int y = samples[x * bands];
                int cb = samples[x * bands + 1] - 128;
                int cr = samples[x * bands + 2] - 128;
                rgb[x] = (clamp(y + 1.402 * cr) << 16)
                        | (clamp(y - 0.344136 * cb - 0.714136 * cr) << 8)
                        | clamp(y + 1.772 * cb);
            }
        } else {
            for (int x = 0; x < n; x++) {
                int v = samples[x];
                rgb[x] = (v << 16) | (v << 8) | v;
            }
        }
    }

    private static int clamp(double v) {
        return Math.max(0, Math.min(255, (int) Math.round(v)));
    }
}
