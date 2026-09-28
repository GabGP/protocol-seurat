package seurat.budget;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import seurat.codec.BrushId;
import seurat.codec.Geometry;
import seurat.store.WorkMeta;

/** Persistent coverage: 4 bits per E0/E1 brush (max bands delivered), mmap. Redelivery is free. */
final class Coverage {
    private final ByteBuffer table;
    private final int[] total = new int[2];
    private final int[] covered = new int[2];
    private final int w0;
    private final int w1;

    Coverage(Path path, WorkMeta meta) throws IOException {
        w0 = Geometry.tiles(meta.width());
        w1 = Geometry.tiles(meta.width() / 2);
        total[0] = w0 * Geometry.tiles(meta.height());
        total[1] = w1 * Geometry.tiles(meta.height() / 2);
        long bytes = (4L * (total[0] + total[1]) + 1) / 2;
        boolean fresh = !Files.exists(path);
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.CREATE,
                StandardOpenOption.READ, StandardOpenOption.WRITE)) {
            if (fresh) {
                channel.position(bytes - 1);
                channel.write(ByteBuffer.wrap(new byte[1]));
            }
            table = channel.map(FileChannel.MapMode.READ_WRITE, 0, bytes);
        }
        for (int i = 0; i < total[0] + total[1]; i++) {
            if (nibble(i) > 0) {
                covered[i < total[0] ? 0 : 1]++;
            }
        }
    }

    private int index(BrushId p) {
        return p.stratum() == 0 ? p.by() * w0 + p.bx() : total[0] + p.by() * w1 + p.bx();
    }

    private int nibble(int i) {
        int b = table.get(i / 2) & 0xFF;
        return (i % 2 == 0) ? b & 0xF : (b >>> 4) & 0xF;
    }

    synchronized int get(BrushId p) {
        return nibble(index(p));
    }

    /** Fraction of the stratum's brushes with any band delivered (the spec 9.2 cap). */
    synchronized double fraction(int stratum) {
        return total[stratum] == 0 ? 1 : (double) covered[stratum] / total[stratum];
    }

    synchronized void set(BrushId p, int through) {
        int i = index(p);
        if (nibble(i) == 0 && through > 0) {
            covered[p.stratum()]++;
        }
        int at = i / 2;
        int b = table.get(at) & 0xFF;
        b = (i % 2 == 0) ? (b & 0xF0) | (through & 0xF) : (b & 0xF) | ((through & 0xF) << 4);
        table.put(at, (byte) b); // mapped: the OS writes it back; no fsync per band
    }

    int totalBrushes(int stratum) {
        return total[stratum];
    }

    int width(int stratum) {
        return stratum == 0 ? w0 : w1;
    }
}
