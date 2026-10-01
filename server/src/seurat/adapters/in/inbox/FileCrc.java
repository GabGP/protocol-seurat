package seurat.adapters.in.inbox;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.CRC32;
import seurat.core.shared.config.Units;

/** CRC-32 of a file read back from disk, to compare with the checksum a zip entry declares. */
final class FileCrc {
    private static final int BUFFER_SIZE = Units.BYTES_PER_MIB;

    private FileCrc() {}

    static long of(Path file) throws IOException {
        CRC32 crc = new CRC32();
        byte[] buf = new byte[BUFFER_SIZE];
        try (InputStream in = Files.newInputStream(file)) {
            int read;
            while ((read = in.read(buf)) != -1) {
                crc.update(buf, 0, read);
            }
        }
        return crc.getValue();
    }
}
