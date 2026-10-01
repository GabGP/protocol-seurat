package seurat.adapters.out.decode.tiff;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.zip.Deflater;

/**
 * Hand-written striped TIFFs for what ImageIO's writer cannot make: BigTIFF, either byte order,
 * any samples per pixel and photometric, Deflate with the horizontal predictor. Samples are
 * 8-bit chunky; compression is none (1) or Deflate (8).
 */
public final class TiffFixture {
    private TiffFixture() {}

    /** Gradients, noise and hard edges, {@code spp} interleaved samples per pixel. */
    public static byte[] samples(int w, int h, int spp, long seed) {
        Random rnd = new Random(seed);
        byte[] px = new byte[w * h * spp];
        for (int y = 0, i = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                for (int s = 0; s < spp; s++, i++) {
                    int edge = (x / 17 + y / 23 + s) % 2 == 0 ? 180 : 20;
                    px[i] = (byte) (edge + (x * 31 + y * 7 * (s + 1)) % 60 + rnd.nextInt(16));
                }
            }
        }
        return px;
    }

    public static Path write(Path file, boolean big, ByteOrder order, int w, int h, int spp, int photometric,
            int rps, boolean deflate, boolean predictor, byte[] px) throws Exception {
        int line = w * spp;
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        int header = big ? 16 : 8;
        int strips = (h + rps - 1) / rps;
        long[] offs = new long[strips];
        long[] counts = new long[strips];
        for (int s = 0; s < strips; s++) {
            int rows = Math.min(rps, h - s * rps);
            byte[] strip = java.util.Arrays.copyOfRange(px, s * rps * line, (s * rps + rows) * line);
            for (int r = 0; predictor && r < rows; r++) {
                for (int i = r * line + line - 1; i >= r * line + spp; i--) strip[i] -= strip[i - spp];
            }
            if (deflate) strip = deflate(strip);
            offs[s] = header + data.size();
            counts[s] = strip.length;
            data.write(strip);
            if (data.size() % 2 != 0) data.write(0);
        }
        long[] bits = new long[spp];
        java.util.Arrays.fill(bits, 8);
        int wide = big ? 16 : 4; // LONG8 or LONG
        List<long[]> e = new ArrayList<>(); // {tag, type, values...}
        e.add(entry(256, 4, w));
        e.add(entry(257, 4, h));
        e.add(entry(258, 3, bits));
        e.add(entry(259, 3, deflate ? 8 : 1));
        e.add(entry(262, 3, photometric));
        e.add(entry(273, wide, offs));
        e.add(entry(277, 3, spp));
        e.add(entry(278, 4, rps));
        e.add(entry(279, wide, counts));
        e.add(entry(284, 3, 1));
        e.add(entry(317, 3, predictor ? 2 : 1));
        int es = big ? 20 : 12;
        int inline = big ? 8 : 4;
        long ifd = header + data.size();
        long extra = ifd + (big ? 8 : 2) + (long) e.size() * es + (big ? 8 : 4);
        long end = extra;
        for (long[] t : e) {
            long bytes = size((int) t[1]) * (t.length - 2L);
            if (bytes > inline) end += bytes;
        }
        ByteBuffer out = ByteBuffer.allocate((int) end).order(order);
        out.put((byte) (order == ByteOrder.LITTLE_ENDIAN ? 'I' : 'M')).put(out.get(0));
        out.putShort((short) (big ? 43 : 42));
        if (big) out.putShort((short) 8).putShort((short) 0).putLong(ifd);
        else out.putInt((int) ifd);
        out.put(data.toByteArray());
        out.position((int) ifd);
        if (big) out.putLong(e.size());
        else out.putShort((short) e.size());
        long spill = extra;
        for (long[] t : e) {
            int type = (int) t[1];
            int n = t.length - 2;
            out.putShort((short) t[0]).putShort((short) type);
            if (big) out.putLong(n);
            else out.putInt(n);
            int at = out.position();
            long bytes = (long) size(type) * n;
            int to = bytes > inline ? (int) spill : at;
            if (bytes > inline) {
                if (big) out.putLong(spill);
                else out.putInt((int) spill);
                spill += bytes;
            }
            for (int i = 0; i < n; i++, to += size(type)) put(out, to, type, t[i + 2]);
            out.position(at + inline);
        }
        return Files.write(file, out.array());
    }

    private static long[] entry(int tag, int type, long... values) {
        long[] t = new long[values.length + 2];
        t[0] = tag;
        t[1] = type;
        System.arraycopy(values, 0, t, 2, values.length);
        return t;
    }

    private static int size(int type) { return type == 3 ? 2 : type == 4 ? 4 : 8; }

    private static void put(ByteBuffer b, int at, int type, long v) {
        switch (type) {
            case 3 -> b.putShort(at, (short) v);
            case 4 -> b.putInt(at, (int) v);
            default -> b.putLong(at, v);
        }
    }

    private static byte[] deflate(byte[] in) {
        Deflater d = new Deflater();
        d.setInput(in);
        d.finish();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[1 << 16];
        while (!d.finished()) out.write(buf, 0, d.deflate(buf));
        d.end();
        return out.toByteArray();
    }
}
