package seurat.ingest;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The file names intake takes as masters, and whether a transfer has landed whole. The name only
 * admits a file: {@link MasterReaders} picks the reader by content.
 */
public final class MasterFormats {
    private MasterFormats() {}

    public static final List<String> EXTENSIONS = List.of("png", "jpg", "jpeg", "tif", "tiff", "psb", "psd");
    private static final Pattern SUFFIX =
            Pattern.compile("(?i)\\.(" + String.join("|", EXTENSIONS) + ")$");

    public static boolean isMaster(String name) {
        return SUFFIX.matcher(name).find();
    }

    /** A name intake admits: a master or a zip of masters, in any letter case. */
    public static boolean isAdmitted(String name) {
        return isMaster(name) || FormatMarkers.isZip(name);
    }

    /** The file's own name in lower case, for extension checks. */
    public static String lowerName(Path file) {
        return file.getFileName().toString().toLowerCase(Locale.ROOT);
    }

    /** The name without its master extension. */
    public static String stem(String name) {
        return SUFFIX.matcher(name).replaceFirst("");
    }

    /** TIFF and Photoshop: whole once every byte the streaming reader needs is on disk. */
    public static boolean isWhole(Path file, long size) {
        String lower = lowerName(file);
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
