package seurat.ingest;

/** Packed 0xRRGGBB pixels and 8-bit clamping: the one place every raster path builds a pixel. */
final class Pixels {
    private Pixels() {}

    static final int MAX = 255;
    static final int OPAQUE = 0xFF000000;

    /** Packs three 0..255 samples; the caller has already masked bytes. */
    static int rgb(int r, int g, int b) {
        return r << 16 | g << 8 | b;
    }

    /** Packs three signed bytes as their unsigned values. */
    static int rgbBytes(byte r, byte g, byte b) {
        return rgb(r & MAX, g & MAX, b & MAX);
    }

    static int gray(int v) {
        return rgb(v, v, v);
    }

    static int clampByte(int v) {
        return Math.max(0, Math.min(MAX, v));
    }
}
