package seurat.core.works.catalog;

import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** The file names intake takes as masters: extensions, the admit rule and the work id a name maps to. */
public final class MasterNames {
    private MasterNames() {}

    public static final List<String> EXTENSIONS = List.of("png", "jpg", "jpeg", "tif", "tiff", "psb", "psd");
    private static final Pattern SUFFIX =
            Pattern.compile("(?i)\\.(" + String.join("|", EXTENSIONS) + ")$");

    public static boolean isMaster(String name) {
        return SUFFIX.matcher(name).find();
    }

    /** The file's own name in lower case, for extension checks. */
    public static String lowerName(Path file) {
        return file.getFileName().toString().toLowerCase(Locale.ROOT);
    }

    /** The name without its master extension. */
    public static String stem(String name) {
        return SUFFIX.matcher(name).replaceFirst("");
    }
}
