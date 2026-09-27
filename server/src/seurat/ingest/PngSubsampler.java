package seurat.ingest;

import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.InflaterInputStream;
import seurat.codec.YCoCgR;

/** Streams and subsamples a PNG scanline-by-scanline in O(1) memory. */
final class PngSubsampler {
    private PngSubsampler() {}

    record Subsampled(int[][] e, int sw, int sh) {}

    static Subsampled subsample(Path source, int q) throws IOException {
        try (InputStream is = new BufferedInputStream(Files.newInputStream(source), 65536);
             DataInputStream dis = new DataInputStream(is)) {
            byte[] sig = new byte[8];
            dis.readFully(sig);
            if (!isPng(sig) || dis.readInt() < 13 || dis.readInt() != 0x49484452) {
                return null;
            }
            int w = dis.readInt();
            int h = dis.readInt();
            int depth = dis.readByte();
            int ct = dis.readByte();
            dis.readByte();
            dis.readByte();
            int interlace = dis.readByte();
            dis.readInt(); // CRC
            if (depth != 8 || (ct != 0 && ct != 2 && ct != 6) || interlace != 0) {
                return null;
            }
            int bp = ct == 6 ? 4 : (ct == 2 ? 3 : 1);
            int sw = (w + q - 1) / q;
            int sh = (h + q - 1) / q;
            int[][] e = new int[3][sw * sh];
            byte[] cur = new byte[w * bp];
            byte[] prev = new byte[w * bp];
            int rowBytes = w * bp;
            var inf = new java.util.zip.Inflater();
            try (DataInputStream sl = new DataInputStream(new InflaterInputStream(new IdatInputStream(dis), inf, 65536))) {
                for (int y = 0; y < h; y++) {
                    int filter = sl.readUnsignedByte();
                    sl.readFully(cur);
                    PngUnfilter.unfilter(filter, cur, prev, bp, rowBytes);
                    if (y % q == 0) {
                        int sy = y / q;
                        sampleRow(cur, e, sy, sw, q, ct, bp);
                    }
                    byte[] tmp = prev;
                    prev = cur;
                    cur = tmp;
                }
                return new Subsampled(e, sw, sh);
            } finally {
                inf.end();
            }
        } catch (Exception ex) {
            return null;
        }
    }

    private static void sampleRow(byte[] cur, int[][] e, int sy, int sw, int q, int ct, int bp) {
        int off = sy * sw;
        for (int sx = 0; sx < sw; sx++) {
            int p = sx * q * bp;
            int r, g, b;
            if (ct == 2 || ct == 6) {
                r = cur[p] & 0xFF;
                g = cur[p + 1] & 0xFF;
                b = cur[p + 2] & 0xFF;
            } else {
                r = cur[p] & 0xFF;
                g = r;
                b = r;
            }
            int[] v = YCoCgR.forward(r, g, b);
            e[0][off + sx] = v[0];
            e[1][off + sx] = v[1];
            e[2][off + sx] = v[2];
        }
    }

    private static boolean isPng(byte[] s) {
        return (s[0] & 0xFF) == 0x89 && s[1] == 0x50 && s[2] == 0x4E && s[3] == 0x47
                && s[4] == 0x0D && s[5] == 0x0A && s[6] == 0x1A && s[7] == 0x0A;
    }
}
