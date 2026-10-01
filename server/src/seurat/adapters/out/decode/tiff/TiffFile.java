package seurat.adapters.out.decode.tiff;

import java.io.Closeable;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * A classic TIFF or BigTIFF file (TIFF 6.0, BigTIFF: magic 43, 8-byte offsets and counts): its byte
 * order, positional reads that any number of threads may issue at once, and the values of the
 * first IFD's tags a reader asks for. Every other tag, the ICC profile included, is never read.
 */
public final class TiffFile implements Closeable {
    private static final int HEADER = 16;
    private static final int MAGIC = 42;
    private static final int MAGIC_BIG = 43;
    private static final int ENTRY = 12;
    private static final int ENTRY_BIG = 20;
    private static final long U32 = 0xFFFFFFFFL;

    private final FileChannel ch;
    private final ByteOrder order;
    private final boolean big;

    private TiffFile(FileChannel ch, ByteOrder order, boolean big) {
        this.ch = ch;
        this.order = order;
        this.big = big;
    }

    /** The file, or null when it does not start with a TIFF or BigTIFF header. */
    public static TiffFile open(Path source) throws IOException {
        FileChannel ch = FileChannel.open(source, StandardOpenOption.READ);
        try {
            if (ch.size() >= HEADER) {
                TiffFile probe = new TiffFile(ch, ByteOrder.BIG_ENDIAN, false);
                ByteBuffer hd = probe.read(0, HEADER);
                byte b = hd.get(0);
                if (b == hd.get(1) && (b == 'I' || b == 'M')) {
                    ByteOrder o = b == 'I' ? ByteOrder.LITTLE_ENDIAN : ByteOrder.BIG_ENDIAN;
                    int magic = hd.order(o).getShort(2) & 0xFFFF;
                    if (magic == MAGIC || magic == MAGIC_BIG) return new TiffFile(ch, o, magic == MAGIC_BIG);
                }
            }
        } catch (IOException | RuntimeException ex) {
            // unreadable header: not ours
        }
        ch.close();
        return null;
    }

    /** Values of the {@code wanted} tags of the first IFD, widened to long. */
    public Map<Integer, long[]> firstIfd(Set<Integer> wanted) throws IOException {
        ByteBuffer hd = read(0, HEADER);
        long ifd = big ? hd.getLong(8) : hd.getInt(4) & U32;
        long n = big ? read(ifd, Long.BYTES).getLong(0) : read(ifd, Short.BYTES).getShort(0) & 0xFFFF;
        int es = big ? ENTRY_BIG : ENTRY;
        ByteBuffer e = read(ifd + (big ? Long.BYTES : Short.BYTES), Math.toIntExact(n * es));
        Map<Integer, long[]> tags = new HashMap<>();
        for (int i = 0; i < n; i++) {
            int b = i * es;
            int tag = e.getShort(b) & 0xFFFF;
            if (wanted.contains(tag)) {
                int size = size(e.getShort(b + 2) & 0xFFFF);
                long count = big ? e.getLong(b + 4) : e.getInt(b + 4) & U32;
                tags.put(tag, values(e, b + (big ? 12 : 8), size, Math.toIntExact(count)));
            }
        }
        return tags;
    }

    /** Bytes per value of a field type (TIFF 6.0 section 2, BigTIFF types 16-18). */
    private static int size(int type) throws IOException {
        return switch (type) {
            case 1, 2, 6, 7 -> 1;
            case 3, 8 -> 2;
            case 4, 9, 11, 13 -> 4;
            case 5, 10, 12, 16, 17, 18 -> 8;
            default -> throw new IOException("TIFF field type " + type);
        };
    }

    private long[] values(ByteBuffer e, int at, int size, int count) throws IOException {
        long bytes = (long) size * count;
        ByteBuffer src = bytes <= (big ? Long.BYTES : Integer.BYTES)
                ? e.duplicate().position(at).slice().order(order)
                : read(big ? e.getLong(at) : e.getInt(at) & U32, Math.toIntExact(bytes));
        long[] v = new long[count];
        for (int i = 0; i < count; i++) {
            v[i] = switch (size) {
                case 1 -> src.get(i) & 0xFF;
                case 2 -> src.getShort(i * 2) & 0xFFFF;
                case 4 -> src.getInt(i * 4) & U32;
                default -> src.getLong(i * 8);
            };
        }
        return v;
    }

    /** {@code len} bytes at {@code pos}, in the file's byte order. */
    ByteBuffer read(long pos, int len) throws IOException {
        ByteBuffer b = ByteBuffer.allocate(len);
        while (b.hasRemaining()) {
            if (ch.read(b, pos + b.position()) < 0) throw new IOException("TIFF truncated at " + pos);
        }
        return b.flip().order(order);
    }

    @Override
    public void close() throws IOException { ch.close(); }
}
