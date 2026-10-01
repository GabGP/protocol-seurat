package seurat.core.works.ingest.port;

import java.io.IOException;
import java.nio.file.Path;

/** Decoders port: opens a master for the one sequential pass, probes its overview, tells a whole transfer. */
public interface MasterSource {
    /** YCoCg-R planes of {@code sw x sh} samples: sample (x, y) stands for master pixel (x q, y q). */
    record Sampled(int[][] e, int sw, int sh) {}

    /** The reader for this master, chosen by content, never by extension. */
    MasterReader open(Path master) throws IOException;

    /** Spec 7.1 step 2 (SONDEO): the overview the master carries, sampled at 1/q; null when it has none. */
    Sampled overview(Path master, int w, int h, int q) throws IOException;

    /** True once every byte the reader needs is on disk ({@code size}: the current length of the file). */
    boolean isWhole(Path master, long size);
}
