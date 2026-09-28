package seurat.ingest;

import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.InflaterInputStream;
import seurat.codec.Geometry;

/**
 * Sequential streaming PNG reader (O(1) memory, zero rewind) for 8-bit gray, RGB and RGBA
 * non-interlaced files; {@link MasterReaders} leaves every other PNG to ImageIO.
 */
final class PngReader implements MasterReader {
    private final int width;
    private final int height;
    private final int bpp;
    private final int colorType;
    private final DataInputStream scanlines;
    private final java.util.zip.Inflater inf;
    private final InputStream rawStream;
    private byte[] curRow;
    private byte[] prevRow;
    private int row;
    private int[][] bandBuffer;

    private PngReader(StreamHeader hdr) {
        this.width = hdr.w;
        this.height = hdr.h;
        this.bpp = hdr.bp;
        this.colorType = hdr.ct;
        this.rawStream = hdr.is;
        this.scanlines = hdr.sl;
        this.inf = hdr.inf;
        this.curRow = new byte[hdr.w * hdr.bp];
        this.prevRow = new byte[hdr.w * hdr.bp];
    }

    /** A streaming reader, or null when the file is not a PNG this reader streams. */
    static PngReader open(Path source) {
        StreamHeader hdr = tryStream(source);
        return hdr == null ? null : new PngReader(hdr);
    }

    private record StreamHeader(int w, int h, int bp, int ct, InputStream is,
            DataInputStream sl, java.util.zip.Inflater inf) {}

    private static StreamHeader tryStream(Path source) {
        try {
            InputStream is = new BufferedInputStream(Files.newInputStream(source), 65536);
            DataInputStream dis = new DataInputStream(is);
            byte[] sig = new byte[8];
            dis.readFully(sig);
            if (!FormatMarkers.isPng(sig) || dis.readInt() < 13 || dis.readInt() != FormatMarkers.PNG_IHDR) {
                is.close();
                return null;
            }
            int w = dis.readInt(), h = dis.readInt();
            int depth = dis.readByte(), ct = dis.readByte();
            dis.readByte(); dis.readByte();
            int interlace = dis.readByte(); dis.readInt();
            if (depth != 8 || (ct != 0 && ct != 2 && ct != 6) || interlace != 0) {
                is.close();
                return null;
            }
            int bp = ct == 6 ? 4 : (ct == 2 ? 3 : 1);
            var inf = new java.util.zip.Inflater();
            DataInputStream sl = new DataInputStream(new InflaterInputStream(new IdatInputStream(dis), inf, 65536));
            return new StreamHeader(w, h, bp, ct, is, sl, inf);
        } catch (Exception ex) {
            return null;
        }
    }

    @Override
    public int width() { return width; }

    @Override
    public int height() { return height; }

    @Override
    public int[][] next() throws IOException {
        if (row >= height) return null;
        int n = Math.min(Geometry.SIDE, height - row);
        if (bandBuffer == null) bandBuffer = new int[Geometry.SIDE][width];
        int[][] band = (n == Geometry.SIDE) ? bandBuffer : java.util.Arrays.copyOf(bandBuffer, n);
        int rowBytes = width * bpp;
        for (int y = 0; y < n; y++) {
            int filter = scanlines.readUnsignedByte();
            scanlines.readFully(curRow);
            PngUnfilter.unfilter(filter, curRow, prevRow, bpp, rowBytes);
            PngUnfilter.decodeRgb(curRow, band[y], colorType, width);
            byte[] tmp = prevRow; prevRow = curRow; curRow = tmp;
        }
        row += n;
        return band;
    }

    @Override
    public double fraction() {
        return (double) row / Math.max(1, height);
    }

    @Override
    public void close() throws IOException {
        scanlines.close();
        inf.end();
        rawStream.close();
    }
}
