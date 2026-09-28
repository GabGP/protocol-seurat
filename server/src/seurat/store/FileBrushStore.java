package seurat.store;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.CRC32C;
import seurat.codec.BrushId;
import seurat.config.SeuratConstants;
import seurat.observe.AuditLog;

/**
 * E{stratum}.pinc (append-only) + E{stratum}.idx (40B). Bytes first, index = commit.
 * Writes use persistent channels; close() fsyncs. On open, .pinc is
 * truncated to the max indexed end (crash rule).
 */
public final class FileBrushStore implements BrushStore {
    private final Path dir;
    private final WorkMeta meta;
    private final int[] nx;
    private final StoreWriter writer;
    /** Quant table the bands were encoded with: the "quant" marker, 1 for stores older than it. */
    public final int quantTable;

    public FileBrushStore(Path dir, WorkMeta meta, int[] nx, int[] ny) throws IOException {
        this.dir = dir;
        this.meta = meta;
        this.nx = nx.clone();
        Path q = dir.resolve("quant");
        quantTable = Files.exists(q) ? Integer.parseInt(Files.readString(q).trim()) : 1;
        Files.createDirectories(dir);
        StoreWriter.recover(dir, nx);
        writer = new StoreWriter(dir, nx);
    }

    public Path dir() {
        return dir;
    }

    private Path pincPath(int stratum) {
        return dir.resolve("E" + stratum + ".pinc");
    }

    private Path idxPath(int stratum) {
        return dir.resolve("E" + stratum + ".idx");
    }

    /** Append path for ingest: bytes then index entry. */
    public void append(int stratum, int bx, int by, byte[][] bands,
            long[] crcs) throws IOException {
        writer.append(stratum, bx, by, bands, crcs);
    }

    public void close() throws IOException {
        writer.close();
    }

    private IndexEntry entry(BrushId p) throws IOException {
        int stratum = p.stratum();
        return stratum >= nx.length ? IndexEntry.missing()
                : IndexEntry.read(idxPath(stratum), (long) p.by() * nx[stratum] + p.bx());
    }

    private Path seedPath() {
        return dir.resolve("semilla.bin");
    }

    @Override
    public byte[][] bands(BrushId p, int b0, int b1) throws IOException {
        byte[][] out = read(p, b0, b1);
        if (out.length < b1 - b0) {
            throw new IOException("CRC band " + (b0 + out.length) + " de " + p);
        }
        return out;
    }

    /** Spec 8: the prefix of valid bands (a corrupt one is alerted and ends it). */
    @Override
    public byte[][] servable(BrushId p, int b0, int b1) throws IOException {
        return read(p, b0, b1);
    }

    private byte[][] read(BrushId p, int b0, int b1) throws IOException {
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            byte[] seed = Files.readAllBytes(seedPath()); // u32 CRC-32C, then the one band
            byte[] band = java.util.Arrays.copyOfRange(seed, 4, seed.length);
            return valid(p, 0, band, Integer.toUnsignedLong(ByteBuffer.wrap(seed).getInt()))
                    ? new byte[][]{band} : new byte[0][];
        }
        IndexEntry e = entry(p);
        if (e.isMissing()) {
            throw new IOException("brush ausente " + p);
        }
        if (e.isEmpty()) {
            return new byte[b1 - b0][0];
        }
        java.util.List<byte[]> out = new java.util.ArrayList<>();
        try (FileChannel ch = FileChannel.open(pincPath(p.stratum()), StandardOpenOption.READ)) {
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

    /** Spec 8, invariant 6: the CRC-32C written at ingest must still hold; a failure alerts the operator. */
    private static boolean valid(BrushId p, int band, byte[] raw, long crc) {
        CRC32C c = new CRC32C();
        c.update(raw);
        if (c.getValue() == crc) {
            return true;
        }
        AuditLog.alert("band corrupta " + p + " band=" + band + ": prefijo valido");
        return false;
    }

    @Override
    public void copy(BrushId p, int b0, int b1, OutputStream out) throws IOException {
        for (byte[] band : bands(p, b0, b1)) {
            out.write(band);
        }
    }

    @Override
    public long bytes(BrushId p, int b0, int b1) throws IOException {
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            return Files.size(seedPath()) - 4;
        }
        IndexEntry e = entry(p);
        if (e.isMissing()) {
            throw new IOException("brush ausente " + p);
        }
        return e.ends()[b1 - 1] - (b0 == 0 ? 0 : e.ends()[b0 - 1]);
    }

    @Override
    public WorkMeta meta() {
        return meta;
    }
}
