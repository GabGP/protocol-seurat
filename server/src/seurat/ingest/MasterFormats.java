package seurat.ingest;

import java.io.IOException;
import java.nio.file.Path;
import seurat.store.MasterNames;

/**
 * The file names intake takes as masters, and whether a transfer has landed whole. The name only
 * admits a file: {@link MasterReaders} picks the reader by content.
 */
public final class MasterFormats {
    private MasterFormats() {}

    /** A name intake admits: a master or a zip of masters, in any letter case. */
    public static boolean isAdmitted(String name) {
        return MasterNames.isMaster(name) || FormatMarkers.isZip(name);
    }

    /** TIFF and Photoshop: whole once every byte the streaming reader needs is on disk. */
    public static boolean isWhole(Path file, long size) {
        String lower = MasterNames.lowerName(file);
        try {
            if (lower.endsWith(".tif") || lower.endsWith(".tiff")) {
                try (TiffFile f = TiffFile.open(file)) {
                    TiffLayout l = f == null ? null : TiffLayout.of(f.firstIfd(TiffLayout.TAGS));
                    return f == null ? size > 0 : l == null || l.end() <= size; // a cut directory throws
                }
            }
            if (lower.endsWith(".psb") || lower.endsWith(".psd")) {
                try (PsbReader p = PsbReader.open(file)) {
                    return p != null && p.end() <= size;
                }
            }
        } catch (IOException | RuntimeException ex) {
            return false;
        }
        return size > 0;
    }
}
