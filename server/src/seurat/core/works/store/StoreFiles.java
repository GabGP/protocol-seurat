package seurat.core.works.store;

import java.nio.file.Path;

/** On-disk names of a work (spec 7): its meta, the seed, the quant marker, the sketch edition dir and E{s} files. */
public final class StoreFiles {
    public static final String META = "meta.json";
    public static final String SEED = "semilla.bin";
    public static final String QUANT = "quant";
    /** Sub-directory holding the edition 1 sketch while edition 2 paints next to it. */
    public static final String SKETCH_DIR = "ed1";

    private StoreFiles() {}

    public static Path pinc(Path dir, int stratum) {
        return dir.resolve("E" + stratum + ".pinc");
    }

    public static Path idx(Path dir, int stratum) {
        return dir.resolve("E" + stratum + ".idx");
    }
}
