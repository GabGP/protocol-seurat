package seurat.store;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.concurrent.atomic.AtomicLongArray;
import seurat.config.Units;

/**
 * Ingest write path: persistent channels per stratum, bytes first and the
 * index entry as the commit. Each brush reserves its own .pinc span, so
 * positional writes need no locks. close() fsyncs everything.
 */
final class StoreWriter {
    private final Path dir;
    private final int[] nx;
    private FileChannel[] pincChannels;
    private FileChannel[] idxChannels;
    private AtomicLongArray pincEnds;

    StoreWriter(Path dir, int[] nx) {
        this.dir = dir;
        this.nx = nx.clone();
    }

    /** Crash rule: truncate every .pinc to the max indexed end. */
    static void recover(Path dir, int[] nx) throws IOException {
        for (int stratum = 0; stratum < nx.length; stratum++) {
            Path pi = StoreFiles.idx(dir, stratum);
            Path pp = StoreFiles.pinc(dir, stratum);
            if (!java.nio.file.Files.exists(pi) || !java.nio.file.Files.exists(pp)) {
                continue;
            }
            long max = 0;
            try (FileChannel ch = FileChannel.open(pi, StandardOpenOption.READ)) {
                ByteBuffer b = ByteBuffer.allocate(Units.BYTES_PER_KIB * 64);
                while (ch.read(b) > 0) {
                    b.flip();
                    while (b.remaining() >= IndexEntry.BYTES) {
                        IndexEntry e = IndexEntry.decode(b);
                        if (!e.isMissing()) {
                            max = Math.max(max, e.offset() + e.ends()[3]);
                        }
                    }
                    b.compact();
                }
            }
            try (FileChannel ch = FileChannel.open(pp, StandardOpenOption.WRITE)) {
                if (ch.size() > max) {
                    ch.truncate(max);
                }
            }
        }
    }

    private synchronized void channels(int stratum) throws IOException {
        if (pincChannels == null) {
            pincChannels = new FileChannel[nx.length];
            idxChannels = new FileChannel[nx.length];
            pincEnds = new AtomicLongArray(nx.length);
        }
        if (pincChannels[stratum] == null) {
            FileChannel pinc = FileChannel.open(StoreFiles.pinc(dir, stratum),
                    StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                    StandardOpenOption.READ);
            pincEnds.set(stratum, pinc.size());
            pincChannels[stratum] = pinc;
            idxChannels[stratum] = FileChannel.open(StoreFiles.idx(dir, stratum),
                    StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                    StandardOpenOption.READ);
        }
    }

    void append(int stratum, int bx, int by, byte[][] bands,
            long[] crcs) throws IOException {
        channels(stratum);
        long slot = (long) by * nx[stratum] + bx;
        long[] ends = new long[4];
        int total = 0;
        for (int i = 0; i < bands.length; i++) {
            byte[] band = bands[i];
            total += band == null ? 0 : band.length;
            ends[i] = total;
        }
        long off = pincEnds.getAndAdd(stratum, total);
        if (total > 0) {
            ByteBuffer blob = ByteBuffer.allocate(total);
            for (byte[] band : bands) {
                if (band != null && band.length > 0) blob.put(band);
            }
            blob.flip();
            writeFully(pincChannels[stratum], blob, off);
        }
        ByteBuffer idx = ByteBuffer.allocate(IndexEntry.BYTES);
        idx.putLong(off);
        for (int i = 0; i < 4; i++) {
            idx.putInt((int) ends[i]);
        }
        for (int i = 0; i < 4; i++) {
            idx.putInt((int) (i < crcs.length ? crcs[i] : 0));
        }
        idx.flip();
        writeFully(idxChannels[stratum], idx, slot * IndexEntry.BYTES);
    }

    private static void writeFully(FileChannel ch, ByteBuffer buf, long pos) throws IOException {
        while (buf.hasRemaining()) {
            pos += ch.write(buf, pos);
        }
    }

    synchronized void close() throws IOException {
        if (pincChannels != null) {
            for (int stratum = 0; stratum < pincChannels.length; stratum++) {
                if (pincChannels[stratum] != null) {
                    pincChannels[stratum].force(true);
                    idxChannels[stratum].force(true);
                    pincChannels[stratum].close();
                    idxChannels[stratum].close();
                }
            }
            pincChannels = null;
            idxChannels = null;
        }
    }
}
