package seurat.adapters.in.inbox;

import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/** Resolves an admitted inbox file name from HTTP response URI, headers and MIME type. */
final class DownloadName {
    private static final Map<String, String> MIME_EXTENSIONS = Map.of(
            "image/png", ".png",
            "image/jpeg", ".jpg",
            "image/tiff", ".tif",
            "application/zip", ".zip",
            "application/x-zip-compressed", ".zip"
    );

    private DownloadName() {}

    static String resolve(HttpResponse<?> response) {
        String segment = extractSegment(response.uri());
        if (!segment.isEmpty() && ZipNames.isAdmitted(segment)) return segment;
        String cd = extractCdFilename(response);
        if (cd != null && ZipNames.isAdmitted(cd)) return cd;
        Optional<String> ct = response.headers().firstValue("Content-Type");
        if (ct.isPresent()) {
            String mime = ct.get().split(";")[0].trim().toLowerCase(Locale.ROOT);
            String ext = MIME_EXTENSIONS.get(mime);
            if (ext != null) {
                int dot = segment.lastIndexOf('.');
                String stem = dot > 0 ? segment.substring(0, dot) : segment;
                return (stem.isEmpty() ? IntakeConstants.DEFAULT_DOWNLOAD_STEM : stem) + ext;
            }
        }
        return segment.isEmpty() ? IntakeConstants.DEFAULT_DOWNLOAD_STEM : segment;
    }

    private static String extractSegment(URI uri) {
        String path = uri.getPath();
        if (path == null || path.isEmpty()) return "";
        String[] parts = path.split("/");
        for (int i = parts.length - 1; i >= 0; i--) {
            if (!parts[i].isEmpty()) return URLDecoder.decode(parts[i], StandardCharsets.UTF_8);
        }
        return "";
    }

    private static String extractCdFilename(HttpResponse<?> response) {
        Optional<String> cd = response.headers().firstValue("Content-Disposition");
        if (cd.isEmpty()) return null;
        for (String part : cd.get().split(";")) {
            String trimmed = part.trim();
            int eq = trimmed.indexOf('=');
            if (eq > 0 && IntakeConstants.CONTENT_DISPOSITION_FILENAME.equalsIgnoreCase(trimmed.substring(0, eq).trim())) {
                String val = trimmed.substring(eq + 1).trim();
                if (val.startsWith("\"") && val.endsWith("\"") && val.length() >= IntakeConstants.SURROUNDING_QUOTES) {
                    val = val.substring(1, val.length() - 1);
                }
                return URLDecoder.decode(val, StandardCharsets.UTF_8);
            }
        }
        return null;
    }
}
