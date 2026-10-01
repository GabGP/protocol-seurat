package seurat.core.works.store;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.CRC32C;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.observe.AuditLog;

/** Reads the bands of one edition's store back from E{s}.pinc through E{s}.idx, checking each CRC-32C. */
final class BandReader {
    /** Test seam: sees each band as read (attempt 0, then 1 on the re-read) and may return other bytes. */
    interface Tap {
        byte[] after(BrushId p, int band, int attempt, byte[] raw);
    }

    private final Path dir;
    private final int[] nx;
    private final Tap tap;
    private final BadBands bad = new BadBands();

    BandReader(Path dir, int[] nx) {
        this(dir, nx, (p, band, attempt, raw) -> raw);
    }

    BandReader(Path dir, int[] nx, Tap tap) {
        this.dir = dir;
        this.nx = nx;
        this.tap = tap;
    }

    private long slot(BrushId p) {
        return (long) p.by() * nx[p.stratum()] + p.bx();
    }

    private IndexEntry entry(BrushId p) throws IOException {
        int stratum = p.stratum();
        IndexEntry e = stratum >= nx.length ? IndexEntry.missing() : IndexEntry.read(StoreFiles.idx(dir, stratum), slot(p));
        if (e.isMissing()) {
            throw new IOException("brush ausente " + p);
        }
        return e;
    }

    /** Bands 0..n-1 of the brush are known good; large until a band failed its CRC-32C on two reads. */
    int validBands(BrushId p) {
        return p.stratum() >= nx.length ? Integer.MAX_VALUE : bad.valid(p, slot(p));
    }

    /**
     * Spec 8: the prefix of valid bands b0..b1. A band that fails its CRC is read once more; if it is still
     * bad it is remembered, alerted once, and ends the prefix (later reads stop there without alerting).
     */
    byte[][] read(BrushId p, int b0, int b1) throws IOException {
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            return SeedFile.read(dir, p);
        }
        IndexEntry e = entry(p);
        if (e.isEmpty()) {
            return new byte[b1 - b0][0];
        }
        List<byte[]> out = new ArrayList<>();
        int limit = Math.min(b1, validBands(p));
        try (FileChannel ch = FileChannel.open(StoreFiles.pinc(dir, p.stratum()), StandardOpenOption.READ)) {
            for (int i = b0; i < limit; i++) {
                byte[] raw = band(ch, p, e, i);
                if (raw == null) {
                    break;
                }
                out.add(raw);
            }
        }
        return out.toArray(new byte[0][]);
    }

    private byte[] band(FileChannel ch, BrushId p, IndexEntry e, int i) throws IOException {
        long crc = e.crcs()[i];
        for (int attempt = 0; attempt < 2; attempt++) {
            byte[] raw = tap.after(p, i, attempt, fill(ch, e, i));
            if (matches(raw, crc)) {
                return raw;
            }
        }
        if (bad.remember(p, slot(p), i)) {
            AuditLog.alert("brush=" + p + " band=" + i + " corrupt: serving the valid prefix");
        }
        return null;
    }

    /** The whole band: a positional read may return fewer bytes than asked, so it goes on until full or EOF. */
    private static byte[] fill(FileChannel ch, IndexEntry e, int i) throws IOException {
        long from = i == 0 ? 0 : e.ends()[i - 1];
        ByteBuffer buf = ByteBuffer.allocate((int) (e.ends()[i] - from));
        long at = e.offset() + from;
        while (buf.hasRemaining()) {
            int n = ch.read(buf, at);
            if (n < 0) {
                break; // short file: the zeroed tail fails the CRC
            }
            at += n;
        }
        return buf.array();
    }

    /** Byte length of bands b0..b1 as stored. */
    long bytes(BrushId p, int b0, int b1) throws IOException {
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            return SeedFile.bandBytes(dir);
        }
        IndexEntry e = entry(p);
        return e.ends()[b1 - 1] - (b0 == 0 ? 0 : e.ends()[b0 - 1]);
    }

    private static boolean matches(byte[] raw, long crc) {
        CRC32C c = new CRC32C();
        c.update(raw);
        return c.getValue() == crc;
    }

    /** Spec 8, invariant 6: the CRC-32C written at ingest must still hold; a failure alerts the operator. */
    static boolean valid(BrushId p, int band, byte[] raw, long crc) {
        if (matches(raw, crc)) {
            return true;
        }
        AuditLog.alert("brush=" + p + " band=" + band + " corrupt: serving the valid prefix");
        return false;
    }
}
