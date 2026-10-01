package seurat.core.shared.codec;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.zip.DataFormatException;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

/** deflate-raw both ways: one place drains a Deflater past its first buffer and reads an Inflater to the end. */
final class Deflate {
    private Deflate() {}

    /**
     * Compresses raw[0..len) with d (reset first). scratch takes the output; it is also the
     * drain buffer when the output outgrows it, so the usual case allocates only the result.
     */
    static byte[] compress(Deflater d, byte[] raw, int len, byte[] scratch) {
        d.reset();
        d.setInput(raw, 0, len);
        d.finish();
        int first = d.deflate(scratch);
        if (d.finished()) {
            return Arrays.copyOf(scratch, first);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(len);
        out.write(scratch, 0, first);
        while (!d.finished()) {
            out.write(scratch, 0, d.deflate(scratch));
        }
        return out.toByteArray();
    }

    /** The whole inflated payload of a deflate-raw stream; what names it in the failure. */
    static byte[] inflate(byte[] comp, String what) {
        Inflater inf = new Inflater(true);
        inf.setInput(comp);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] tmp = new byte[8192];
        try {
            while (!inf.finished()) {
                int k = inf.inflate(tmp);
                if (k == 0) {
                    break;
                }
                out.write(tmp, 0, k);
            }
        } catch (DataFormatException ex) {
            throw new IllegalArgumentException(what, ex);
        } finally {
            inf.end();
        }
        return out.toByteArray();
    }
}
