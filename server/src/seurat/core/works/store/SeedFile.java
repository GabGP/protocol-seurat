package seurat.core.works.store;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import seurat.core.shared.codec.BrushId;

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

    /** The seed's one band, or none when its CRC no longer holds. */
    static byte[][] read(Path storeDir, BrushId p) throws IOException {
        byte[] seed = Files.readAllBytes(storeDir.resolve(StoreFiles.SEED));
        byte[] band = Arrays.copyOfRange(seed, CRC_BYTES, seed.length);
        long crc = Integer.toUnsignedLong(ByteBuffer.wrap(seed).getInt());
        return BandReader.valid(p, 0, band, crc) ? new byte[][]{band} : new byte[0][];
    }

    /** Stored size of the band, without the CRC. */
    static long bandBytes(Path storeDir) throws IOException {
        return Files.size(storeDir.resolve(StoreFiles.SEED)) - CRC_BYTES;
    }
}
