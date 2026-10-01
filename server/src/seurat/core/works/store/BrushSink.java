package seurat.core.works.store;

import java.io.IOException;

/** A store one ingest pass writes: brushes appended, then the seed, then closed (spec 7.1). */
public interface BrushSink extends BrushStore {
    /** Append path for ingest: bytes then index entry. */
    void append(int stratum, int bx, int by, byte[][] bands, long[] crcs) throws IOException;

    /** The seed brush file, as SeedCodec encodes it. */
    void writeSeed(byte[] file) throws IOException;

    /** Flushes and syncs what was written; reads stay valid. */
    void close() throws IOException;
}
