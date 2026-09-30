package seurat.ingest.decode;

/** Packed 0xRRGGBB pixels and 8-bit clamping: the one place every raster path builds a pixel. */
public final class Pixels {
    private Pixels() {}

    public static final int MAX = 255;
    public static final int OPAQUE = 0xFF000000;

    /** Packs three 0..255 samples; the caller has already masked bytes. */
    public static int rgb(int r, int g, int b) {
        return r << 16 | g << 8 | b;
    }

    /** Packs three signed bytes as their unsigned values. */
    public static int rgbBytes(byte r, byte g, byte b) {
        return rgb(r & MAX, g & MAX, b & MAX);
    }

    public static int gray(int v) {
        return rgb(v, v, v);
    }

    public static int clampByte(int v) {
        return Math.max(0, Math.min(MAX, v));
    }
}
