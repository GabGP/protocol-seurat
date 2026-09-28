package seurat.store;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.CRC32C;
import seurat.codec.BrushId;
import seurat.config.SeuratConstants;
import seurat.observe.AuditLog;

/** Reads the bands of one edition's store back from E{s}.pinc through E{s}.idx, checking each CRC-32C. */
final class BandReader {
    private final Path dir;
    private final int[] nx;

    BandReader(Path dir, int[] nx) {
        this.dir = dir;
        this.nx = nx;
    }

    private IndexEntry entry(BrushId p) throws IOException {
        int stratum = p.stratum();
        IndexEntry e = stratum >= nx.length ? IndexEntry.missing()
                : IndexEntry.read(StoreFiles.idx(dir, stratum), (long) p.by() * nx[stratum] + p.bx());
        if (e.isMissing()) {
            throw new IOException("brush ausente " + p);
        }
        return e;
    }

    /** Spec 8: the prefix of valid bands b0..b1 (a corrupt one is alerted and ends it). */
    byte[][] read(BrushId p, int b0, int b1) throws IOException {
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            return SeedFile.read(dir, p);
        }
        IndexEntry e = entry(p);
        if (e.isEmpty()) {
            return new byte[b1 - b0][0];
        }
        List<byte[]> out = new ArrayList<>();
        try (FileChannel ch = FileChannel.open(StoreFiles.pinc(dir, p.stratum()), StandardOpenOption.READ)) {
            for (int i = b0; i < b1; i++) {
                long from = i == 0 ? 0 : e.ends()[i - 1];
                byte[] raw = new byte[(int) (e.ends()[i] - from)];
                ch.read(ByteBuffer.wrap(raw), e.offset() + from);
                if (!valid(p, i, raw, e.crcs()[i])) {
                    break;
                }
                out.add(raw);
            }
        }
        return out.toArray(new byte[0][]);
    }

    /** Byte length of bands b0..b1 as stored. */
    long bytes(BrushId p, int b0, int b1) throws IOException {
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            return SeedFile.bandBytes(dir);
        }
        IndexEntry e = entry(p);
        return e.ends()[b1 - 1] - (b0 == 0 ? 0 : e.ends()[b0 - 1]);
    }

    /** Spec 8, invariant 6: the CRC-32C written at ingest must still hold; a failure alerts the operator. */
    static boolean valid(BrushId p, int band, byte[] raw, long crc) {
        CRC32C c = new CRC32C();
        c.update(raw);
        if (c.getValue() == crc) {
            return true;
        }
        AuditLog.alert("brush=" + p + " band=" + band + " corrupt: serving the valid prefix");
        return false;
    }
}
