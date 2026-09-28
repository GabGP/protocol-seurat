package seurat.store;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** The seed brush file: a u32 CRC-32C then the one band. One place knows what makes it servable. */
public final class SeedFile {
    private SeedFile() {}

    /** Leading CRC-32C, before the band bytes. */
    public static final int CRC_BYTES = 4;

    /** True when the store in dir holds a seed with at least one band byte. */
    public static boolean present(Path storeDir) throws IOException {
        Path seed = storeDir.resolve(StoreFiles.SEED);
        return Files.isRegularFile(seed) && Files.size(seed) > CRC_BYTES;
    }
}
