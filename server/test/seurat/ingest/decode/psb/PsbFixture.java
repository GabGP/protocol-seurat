package seurat.ingest.decode.psb;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Hand-written Photoshop files: PSD (version 1) or PSB (version 2), planar 8-bit channels, raw or
 * RLE (PackBits rows behind a byte-count table), with non-empty color mode, resource and layer
 * sections so the reader has to skip each one.
 */
public final class PsbFixture {
    private PsbFixture() {}

    public static final int RAW = 0;
    public static final int RLE = 1;

    /** {@code planes[c]} holds channel c, {@code w * h} bytes. */
    public static Path write(Path file, boolean psb, int mode, int depth, int compression, int w, int h, byte[][] planes)
            throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeBytes("8BPS");
        out.writeShort(psb ? 2 : 1);
        out.write(new byte[6]);
        out.writeShort(planes.length);
        out.writeInt(h);
        out.writeInt(w);
        out.writeShort(depth);
        out.writeShort(mode);
        out.writeInt(3);
        out.write(new byte[] {1, 2, 3}); // color mode data
        out.writeInt(5);
        out.write(new byte[] {'8', 'B', 'I', 'M', 0}); // image resources
        if (psb) out.writeLong(7);
        else out.writeInt(7);
        out.write(new byte[7]); // layer and mask information
        out.writeShort(compression);
        if (compression != RLE) {
            for (byte[] p : planes) out.write(p);
            return Files.write(file, bytes.toByteArray());
        }
        ByteArrayOutputStream rows = new ByteArrayOutputStream();
        for (byte[] p : planes) {
            for (int y = 0; y < h; y++) {
                byte[] packed = pack(p, y * w, w);
                if (psb) out.writeInt(packed.length);
                else out.writeShort(packed.length);
                rows.write(packed);
            }
        }
        out.write(rows.toByteArray());
        return Files.write(file, bytes.toByteArray());
    }

    /** PackBits: runs of 3+ equal bytes as repeats (up to 128), everything else as literals. */
    static byte[] pack(byte[] in, int at, int n) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int end = at + n;
        int i = at;
        while (i < end) {
            int run = 1;
            while (i + run < end && run < 128 && in[i + run] == in[i]) run++;
            if (run >= 3) {
                out.write(1 - run);
                out.write(in[i]);
                i += run;
                continue;
            }
            int lit = i;
            while (lit < end && lit - i < 128
                    && !(lit + 2 < end && in[lit] == in[lit + 1] && in[lit] == in[lit + 2])) {
                lit++;
            }
            out.write(lit - i - 1);
            out.write(in, i, lit - i);
            i = lit;
        }
        return out.toByteArray();
    }
}
