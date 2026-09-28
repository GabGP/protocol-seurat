package seurat.ingest;

import java.io.IOException;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

/**
 * One strip or tile of a {@link TiffLayout} into packed RGB rows: read, decompress, undo the
 * horizontal predictor, convert. Chunks are independent, so any number decode at once. Samples
 * are taken as stored: an embedded ICC profile is ignored, as on every ingest path.
 */
final class TiffChunk {
    private TiffChunk() {}

    /** Chunk (cy, cx) into {@code rows[0..]}, columns from {@code cx * chunkW}; rows past the image are dropped. */
    static void paint(TiffFile f, TiffLayout l, int cy, int cx, int[][] rows) throws IOException {
        int spp = l.spp();
        int line = l.chunkW() * spp;
        int index = cy * l.across() + cx;
        byte[] raw = new byte[l.rowsIn(cy) * line];
        int count = (int) Math.min(l.counts()[index], Integer.MAX_VALUE);
        if (count > 0) {
            inflate(l.compression(), f.read(l.offsets()[index], count).array(), raw);
        }
        int x0 = cx * l.chunkW();
        int n = Math.min(l.chunkW(), l.width() - x0);
        int visible = Math.min(l.rowsIn(cy), l.height() - cy * l.chunkH());
        for (int r = 0; r < visible; r++) {
            int o = r * line;
            if (l.predictor()) {
                for (int i = o + spp; i < o + line; i++) raw[i] += raw[i - spp];
            }
            int[] out = rows[r];
            if (l.photometric() == TiffLayout.RGB) {
                for (int x = 0; x < n; x++, o += spp) {
                    out[x0 + x] = Pixels.rgbBytes(raw[o], raw[o + 1], raw[o + 2]);
                }
            } else {
                int flip = l.photometric() == TiffLayout.WHITE_IS_ZERO ? Pixels.MAX : 0;
                for (int x = 0; x < n; x++, o += spp) {
                    out[x0 + x] = Pixels.gray((raw[o] & Pixels.MAX) ^ flip);
                }
            }
        }
    }

    private static void inflate(int compression, byte[] in, byte[] raw) throws IOException {
        switch (compression) {
            case TiffLayout.LZW -> TiffLzw.decode(in, raw);
            case TiffLayout.PACKBITS -> PackBits.decode(in, 0, in.length, raw, 0, raw.length);
            case TiffLayout.DEFLATE, TiffLayout.DEFLATE_OLD -> deflate(in, raw);
            default -> System.arraycopy(in, 0, raw, 0, Math.min(in.length, raw.length));
        }
    }

    private static void deflate(byte[] in, byte[] raw) throws IOException {
        Inflater inf = new Inflater();
        try {
            inf.setInput(in);
            int n = 0;
            for (int k = 1; n < raw.length && k > 0; n += k) {
                k = inf.inflate(raw, n, raw.length - n);
            }
        } catch (DataFormatException ex) {
            throw new IOException("TIFF Deflate chunk", ex);
        } finally {
            inf.end();
        }
    }
}
