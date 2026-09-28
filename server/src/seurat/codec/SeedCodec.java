package seurat.codec;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.zip.Deflater;
import java.util.zip.CRC32C;
import seurat.proto.Leb128;

/** Seed (E10, lossless): DPCM left-neighbor + zigzag + LEB128 + deflate-raw. */
public final class SeedCodec {
    private static final int SCRATCH_BYTES = 8192;

    private SeedCodec() {}

    public static byte[] encode(int[][] planos, int w, int h) {
        ByteBuffer b = ByteBuffer.allocate(16 + w * h * 3 * 3);
        for (int[] pl : planos) {
            for (int y = 0; y < h; y++) {
                int izq = 0;
                for (int x = 0; x < w; x++) {
                    int v = pl[y * w + x];
                    Leb128.putU(b, Leb128.zigzagEncode(v - izq));
                    izq = v;
                }
            }
        }
        byte[] raw = Arrays.copyOf(b.array(), b.position());
        Deflater d = new Deflater(Deflater.BEST_COMPRESSION, true);
        byte[] comp = Deflate.compress(d, raw, raw.length, new byte[SCRATCH_BYTES]);
        d.end();
        CRC32C crc = new CRC32C();
        crc.update(comp);
        ByteBuffer f = ByteBuffer.allocate(4 + comp.length);
        f.putInt((int) crc.getValue());
        f.put(comp);
        return f.array();
    }

    public static int[][] decode(byte[] seed, int w, int h) {
        ByteBuffer f = ByteBuffer.wrap(seed);
        long crc = Integer.toUnsignedLong(f.getInt());
        byte[] comp = new byte[f.remaining()];
        f.get(comp);
        CRC32C c = new CRC32C();
        c.update(comp);
        if (c.getValue() != crc) {
            throw new IllegalArgumentException("seed CRC");
        }
        ByteBuffer b = ByteBuffer.wrap(Deflate.inflate(comp, "seed deflate"));
        int[][] planos = new int[3][w * h];
        for (int[] pl : planos) {
            for (int y = 0; y < h; y++) {
                int izq = 0;
                for (int x = 0; x < w; x++) {
                    izq += Leb128.zigzagDecode(Leb128.getU(b));
                    pl[y * w + x] = izq;
                }
            }
        }
        return planos;
    }
}
