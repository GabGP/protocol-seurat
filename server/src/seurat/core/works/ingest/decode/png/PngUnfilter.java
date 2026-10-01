package seurat.core.works.ingest.decode.png;
import seurat.core.works.ingest.decode.Pixels;

/** PNG scanline unfiltering and RGB decoding. Pure, no IO. */
final class PngUnfilter {
    private PngUnfilter() {}

    static void unfilter(int filter, byte[] cur, byte[] prev, int bpp, int len) {
        switch (filter) {
            case 1 -> {
                for (int i = bpp; i < len; i++) {
                    cur[i] = (byte) ((cur[i] & 0xFF) + (cur[i - bpp] & 0xFF));
                }
            }
            case 2 -> {
                for (int i = 0; i < len; i++) {
                    cur[i] = (byte) ((cur[i] & 0xFF) + (prev[i] & 0xFF));
                }
            }
            case 3 -> {
                for (int i = 0; i < bpp; i++) {
                    cur[i] = (byte) ((cur[i] & 0xFF) + ((prev[i] & 0xFF) >> 1));
                }
                for (int i = bpp; i < len; i++) {
                    int a = cur[i - bpp] & 0xFF;
                    int b = prev[i] & 0xFF;
                    cur[i] = (byte) ((cur[i] & 0xFF) + ((a + b) >> 1));
                }
            }
            case 4 -> {
                for (int i = 0; i < bpp; i++) {
                    cur[i] = (byte) ((cur[i] & 0xFF) + (prev[i] & 0xFF));
                }
                for (int i = bpp; i < len; i++) {
                    int a = cur[i - bpp] & 0xFF;
                    int b = prev[i] & 0xFF;
                    int c = prev[i - bpp] & 0xFF;
                    int p = a + b - c;
                    int pa = Math.abs(p - a);
                    int pb = Math.abs(p - b);
                    int pc = Math.abs(p - c);
                    cur[i] = (byte) ((cur[i] & 0xFF) + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)));
                }
            }
            default -> {}
        }
    }

    static void decodeRgb(byte[] raw, int[] out, int ct, int w) {
        if (ct == 2) {
            for (int x = 0; x < w; x++) {
                out[x] = Pixels.OPAQUE | Pixels.rgbBytes(raw[x * 3], raw[x * 3 + 1], raw[x * 3 + 2]);
            }
        } else if (ct == 6) {
            for (int x = 0; x < w; x++) {
                out[x] = ((raw[x * 4 + 3] & Pixels.MAX) << 24) | Pixels.rgbBytes(raw[x * 4], raw[x * 4 + 1], raw[x * 4 + 2]);
            }
        } else {
            for (int x = 0; x < w; x++) {
                out[x] = Pixels.OPAQUE | Pixels.gray(raw[x] & Pixels.MAX);
            }
        }
    }
}
