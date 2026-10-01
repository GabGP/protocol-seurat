package seurat.core.works.store;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import seurat.core.shared.codec.BrushId;

/**
 * E{stratum}.pinc (append-only) + E{stratum}.idx (40B). Bytes first, index = commit.
 * Writes use persistent channels; close() fsyncs. On open, .pinc is
 * truncated to the max indexed end (crash rule). Reads live in {@link BandReader}.
 */
public final class FileBrushStore implements BrushStore {
    private final Path dir;
    private final WorkMeta meta;
    private final StoreWriter writer;
    private final BandReader reader;
    /** Quant table the bands were encoded with: the "quant" marker, 1 for stores older than it. */
    public final int quantTable;

    public FileBrushStore(Path dir, WorkMeta meta, int[] nx, int[] ny) throws IOException {
        this.dir = dir;
        this.meta = meta;
        Path q = dir.resolve(StoreFiles.QUANT);
        quantTable = Files.exists(q) ? Integer.parseInt(Files.readString(q).trim()) : 1;
        Files.createDirectories(dir);
        StoreWriter.recover(dir, nx);
        writer = new StoreWriter(dir, nx);
        reader = new BandReader(dir, nx.clone());
    }

    public Path dir() {
        return dir;
    }

    /** Append path for ingest: bytes then index entry. */
    public void append(int stratum, int bx, int by, byte[][] bands,
            long[] crcs) throws IOException {
        writer.append(stratum, bx, by, bands, crcs);
    }

    public void close() throws IOException {
        writer.close();
    }

    @Override
    public byte[][] bands(BrushId p, int b0, int b1) throws IOException {
        byte[][] out = reader.read(p, b0, b1);
        if (out.length < b1 - b0) {
            throw new IOException("CRC band " + (b0 + out.length) + " de " + p);
        }
        return out;
    }

    /** Spec 8: the prefix of valid bands (a corrupt one is alerted and ends it). */
    @Override
    public byte[][] servable(BrushId p, int b0, int b1) throws IOException {
        return reader.read(p, b0, b1);
    }

    @Override
    public int validBands(BrushId p) {
        return reader.validBands(p);
    }

    @Override
    public void copy(BrushId p, int b0, int b1, OutputStream out) throws IOException {
        for (byte[] band : bands(p, b0, b1)) {
            out.write(band);
        }
    }

    @Override
    public long bytes(BrushId p, int b0, int b1) throws IOException {
        return reader.bytes(p, b0, b1);
    }

    @Override
    public WorkMeta meta() {
        return meta;
    }
}
