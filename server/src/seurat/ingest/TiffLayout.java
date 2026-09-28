package seurat.ingest;

import java.util.Map;
import java.util.Set;
import seurat.config.SeuratConstants;

/**
 * Where the pixels of a TIFF are and how to decode them, for the files {@link TiffReader} streams:
 * 8-bit unsigned samples, chunky, RGB(A) or gray, uncompressed, LZW, Deflate or PackBits, with or
 * without horizontal differencing, in strips or tiles. Uncompressed strips are split into one-row
 * chunks, so a single-strip file still streams. Anything else (JPEG or YCbCr data, palette, CMYK,
 * 1/16-bit or float samples, planar, reversed bit order, strips too tall to hold) is left to ImageIO.
 */
record TiffLayout(int width, int height, int spp, int compression, boolean predictor, int photometric,
        boolean tiled, int chunkW, int chunkH, int across, long[] offsets, long[] counts) {
    static final int NONE = 1;
    static final int LZW = 5;
    static final int DEFLATE = 8;
    static final int DEFLATE_OLD = 32946;
    static final int PACKBITS = 32773;
    private static final int WIDTH = 256;
    private static final int HEIGHT = 257;
    private static final int BITS = 258;
    private static final int COMPRESSION = 259;
    private static final int PHOTOMETRIC = 262;
    private static final int FILL_ORDER = 266;
    private static final int STRIP_OFFSETS = 273;
    private static final int SAMPLES = 277;
    private static final int ROWS_PER_STRIP = 278;
    private static final int STRIP_COUNTS = 279;
    private static final int PLANAR = 284;
    private static final int PREDICTOR = 317;
    private static final int TILE_WIDTH = 322;
    private static final int TILE_HEIGHT = 323;
    private static final int TILE_OFFSETS = 324;
    private static final int TILE_COUNTS = 325;
    private static final int SAMPLE_FORMAT = 339;
    static final Set<Integer> TAGS = Set.of(WIDTH, HEIGHT, BITS, COMPRESSION, PHOTOMETRIC, FILL_ORDER,
            STRIP_OFFSETS, SAMPLES, ROWS_PER_STRIP, STRIP_COUNTS, PLANAR, PREDICTOR, TILE_WIDTH, TILE_HEIGHT,
            TILE_OFFSETS, TILE_COUNTS, SAMPLE_FORMAT);
    static final int WHITE_IS_ZERO = 0;
    static final int BLACK_IS_ZERO = 1;
    static final int RGB = 2;
    private static final int HORIZONTAL = 2;
    private static final int BITS_PER_SAMPLE = 8;
    private static final int ARGB_BYTES = 4;

    /** The layout, or null when this reader does not stream the file. */
    static TiffLayout of(Map<Integer, long[]> t) {
        long w = first(t, WIDTH, 0);
        long h = first(t, HEIGHT, 0);
        int spp = (int) first(t, SAMPLES, 1);
        long comp = first(t, COMPRESSION, NONE);
        long photo = first(t, PHOTOMETRIC, -1);
        long pred = first(t, PREDICTOR, 1);
        boolean tiled = t.containsKey(TILE_OFFSETS);
        long cw = tiled ? first(t, TILE_WIDTH, 0) : w;
        long ch = tiled ? first(t, TILE_HEIGHT, 0) : Math.min(h, first(t, ROWS_PER_STRIP, h));
        long[] offs = t.get(tiled ? TILE_OFFSETS : STRIP_OFFSETS);
        long[] counts = t.get(tiled ? TILE_COUNTS : STRIP_COUNTS);
        boolean colors = photo == RGB && spp >= 3 || (photo == WHITE_IS_ZERO || photo == BLACK_IS_ZERO) && spp >= 1;
        if (w <= 0 || h <= 0 || w > Integer.MAX_VALUE || h > Integer.MAX_VALUE || cw <= 0 || ch <= 0 || !colors
                || !t.containsKey(BITS) || !all(t, BITS, BITS_PER_SAMPLE) || !all(t, SAMPLE_FORMAT, 1) || first(t, FILL_ORDER, 1) != 1
                || (spp > 1 && first(t, PLANAR, 1) != 1) || (pred != 1 && pred != HORIZONTAL)
                || !(comp == NONE || comp == LZW || comp == DEFLATE || comp == DEFLATE_OLD || comp == PACKBITS)
                || offs == null || counts == null || offs.length != counts.length
                || ch * cw * spp > Integer.MAX_VALUE || ch * w * ARGB_BYTES > SeuratConstants.INGEST_CHUNK_BYTES) {
            return null;
        }
        int across = (int) ((w + cw - 1) / cw);
        long chunks = across * ((h + ch - 1) / ch);
        if (offs.length != chunks) return null;
        if (comp == NONE && !tiled && ch > 1) {
            return rows((int) w, (int) h, spp, pred == HORIZONTAL, (int) photo, (int) ch, offs);
        }
        return new TiffLayout((int) w, (int) h, spp, (int) comp, pred == HORIZONTAL, (int) photo,
                tiled, (int) cw, (int) ch, across, offs, counts);
    }

    /** Uncompressed strips as one-row chunks: row y sits {@code y % rps} lines into strip {@code y / rps}. */
    private static TiffLayout rows(int w, int h, int spp, boolean pred, int photo, int rps, long[] strips) {
        long line = (long) w * spp;
        long[] offs = new long[h];
        long[] counts = new long[h];
        for (int y = 0; y < h; y++) {
            offs[y] = strips[y / rps] + y % rps * line;
            counts[y] = line;
        }
        return new TiffLayout(w, h, spp, NONE, pred, photo, false, w, 1, 1, offs, counts);
    }

    /** Rows a chunk of chunk row {@code cy} decodes to: tiles are always whole, the last strip is short. */
    int rowsIn(int cy) { return tiled ? chunkH : Math.min(chunkH, height - cy * chunkH); }

    /** One past the last byte any chunk occupies. */
    long end() {
        long e = 0;
        for (int i = 0; i < offsets.length; i++) e = Math.max(e, offsets[i] + counts[i]);
        return e;
    }

    int chunkRows() { return (height + chunkH - 1) / chunkH; }

    private static long first(Map<Integer, long[]> t, int tag, long absent) {
        long[] v = t.get(tag);
        return v == null || v.length == 0 ? absent : v[0];
    }

    private static boolean all(Map<Integer, long[]> t, int tag, long want) {
        for (long v : t.getOrDefault(tag, new long[0])) {
            if (v != want) return false;
        }
        return true;
    }
}
