package seurat.ingest;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;

/**
 * Where the merged image data of a Photoshop file sits (Adobe Photoshop File Formats Specification:
 * header, color mode data, image resources, layer and mask information, image data), for the files
 * {@link PsbReader} streams: PSD or PSB, 8-bit RGB or gray, raw or RLE. {@code rowStart[c][y]} is
 * where row y of used channel c starts; raw data needs only row 0, RLE has one extra entry, the end.
 */
record PsbLayout(int width, int height, long[][] rowStart, boolean rle) {
    private static final int SIGNATURE = 0x38425053; // "8BPS"
    static final int HEADER = 26;
    private static final int PSD = 1;
    private static final int PSB = 2;
    private static final int GRAY = 1;
    private static final int RGB = 3;
    private static final int RGB_CHANNELS = 3;
    private static final int DEPTH = 8;
    private static final int RAW = 0;
    private static final int RLE = 1;
    private static final long U32 = 0xFFFFFFFFL;

    /** The layout, or null when the file is not a Photoshop file {@link PsbReader} handles. */
    static PsbLayout of(FileChannel ch) throws IOException {
        ByteBuffer hd = read(ch, 0, HEADER);
        int version = hd.getShort(4);
        int channels = hd.getShort(12);
        int h = hd.getInt(14);
        int w = hd.getInt(18);
        int mode = hd.getShort(24);
        int used = mode == RGB ? RGB_CHANNELS : 1;
        if (hd.getInt(0) != SIGNATURE || (version != PSD && version != PSB) || hd.getShort(22) != DEPTH
                || !(mode == RGB || mode == GRAY) || channels < used || w <= 0 || h <= 0) {
            return null;
        }
        long pos = HEADER;
        pos += Integer.BYTES + (read(ch, pos, Integer.BYTES).getInt(0) & U32); // color mode data
        pos += Integer.BYTES + (read(ch, pos, Integer.BYTES).getInt(0) & U32); // image resources
        pos += version == PSB ? Long.BYTES + read(ch, pos, Long.BYTES).getLong(0)
                : Integer.BYTES + (read(ch, pos, Integer.BYTES).getInt(0) & U32); // layer and mask info
        int compression = read(ch, pos, Short.BYTES).getShort(0);
        pos += Short.BYTES;
        long[][] starts = new long[used][];
        if (compression == RAW) {
            for (int c = 0; c < used; c++) starts[c] = new long[] {pos + (long) c * h * w};
            return new PsbLayout(w, h, starts, false);
        }
        if (compression != RLE) return null;
        int entry = version == PSB ? Integer.BYTES : Short.BYTES;
        ByteBuffer counts = read(ch, pos, Math.toIntExact((long) channels * h * entry));
        long at = pos + counts.capacity();
        for (int c = 0; c < used; c++) {
            starts[c] = new long[h + 1];
            starts[c][0] = at;
            for (int y = 0; y < h; y++) {
                int i = (c * h + y) * entry;
                at += entry == Short.BYTES ? counts.getShort(i) & 0xFFFF : counts.getInt(i) & U32;
                starts[c][y + 1] = at;
            }
        }
        return new PsbLayout(w, h, starts, true);
    }

    /** One past the last byte of the channels read. */
    long end() {
        long e = 0;
        for (long[] s : rowStart) e = Math.max(e, rle ? s[height] : s[0] + (long) width * height);
        return e;
    }

    static ByteBuffer read(FileChannel ch, long pos, int len) throws IOException {
        return read(ch, pos, ByteBuffer.allocate(len));
    }

    /** Fills {@code b} from {@code pos} on; positional, so bands and threads may share the channel. */
    static ByteBuffer read(FileChannel ch, long pos, ByteBuffer b) throws IOException {
        while (b.hasRemaining()) {
            if (ch.read(b, pos + b.position()) < 0) throw new IOException("Photoshop file truncated at " + pos);
        }
        return b.flip();
    }
}
