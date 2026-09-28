package seurat.ingest;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.stream.IntStream;
import seurat.codec.Geometry;

/**
 * Streaming Photoshop master, PSB or PSD ({@link PsbLayout} says which): the merged image data,
 * the composite every Photoshop reader shows. Channels are planar, so each band reads its rows of
 * every channel positionally; RLE rows are PackBits and decode in parallel. ImageIO has no
 * Photoshop plugin, so files this reader rejects (ZIP data, 16/32-bit, CMYK, Lab, indexed) fail.
 */
final class PsbReader implements MasterReader {

    private final FileChannel ch;
    private final PsbLayout l;
    private final int w;
    private final byte[][] planes;
    private int[][] bandBuffer;
    private int row;

    private PsbReader(FileChannel ch, PsbLayout l) {
        this.ch = ch;
        this.l = l;
        this.w = l.width();
        this.planes = new byte[l.rowStart().length][];
    }

    /** A streaming reader, or null when the file is not a Photoshop file this reader handles. */
    static PsbReader open(Path source) throws IOException {
        FileChannel ch = FileChannel.open(source, StandardOpenOption.READ);
        try {
            PsbLayout l = ch.size() >= PsbLayout.HEADER ? PsbLayout.of(ch) : null;
            if (l != null) return new PsbReader(ch, l);
        } catch (IOException | RuntimeException ex) {
            // malformed sections: not ours
        }
        ch.close();
        return null;
    }

    @Override
    public int width() { return w; }

    @Override
    public int height() { return l.height(); }

    @Override
    public int[][] next() throws IOException {
        if (row >= l.height()) return null;
        int n = Math.min(Geometry.SIDE, l.height() - row);
        if (bandBuffer == null) bandBuffer = new int[Geometry.SIDE][w];
        for (int c = 0; c < planes.length; c++) {
            if (planes[c] == null) planes[c] = new byte[Geometry.SIDE * w];
            channel(c, n);
        }
        int[][] band = n == Geometry.SIDE ? bandBuffer : Arrays.copyOf(bandBuffer, n);
        byte[] r = planes[0];
        byte[] g = planes[planes.length / 2];
        byte[] b = planes[planes.length - 1];
        IntStream.range(0, n).parallel().forEach(y -> {
            int[] out = band[y];
            for (int x = 0, i = y * w; x < w; x++, i++) {
                out[x] = Pixels.rgbBytes(r[i], g[i], b[i]);
            }
        });
        row += n;
        return band;
    }

    /** Rows [row, row + n) of used channel c into its plane. */
    private void channel(int c, int n) throws IOException {
        long[] s = l.rowStart()[c];
        if (!l.rle()) {
            PsbLayout.read(ch, s[0] + (long) row * w, ByteBuffer.wrap(planes[c], 0, n * w).slice());
            return;
        }
        int y0 = row;
        long base = s[y0];
        byte[] packed = PsbLayout.read(ch, base, Math.toIntExact(s[y0 + n] - base)).array();
        byte[] plane = planes[c];
        IntStream.range(0, n).parallel().forEach(y ->
                PackBits.decode(packed, (int) (s[y0 + y] - base), (int) (s[y0 + y + 1] - base), plane, y * w, w));
    }

    /** One past the last byte this reader decodes. */
    long end() { return l.end(); }

    @Override
    public double fraction() { return (double) row / Math.max(1, l.height()); }

    @Override
    public void close() throws IOException { ch.close(); }
}
