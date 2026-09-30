package seurat.net.http;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ConcurrentHashMap;

/** Static root: client/dist. No CDN. */
final class StaticFiles {
    record Entry(byte[] body, String etag) {}
    private record CacheRecord(long mtime, Entry entry) {}

    private static final Entry FAVICON_ICO = new Entry(DefaultFavicon.ICO, ETags.of(DefaultFavicon.ICO));
    private static final Entry FAVICON_SVG = new Entry(DefaultFavicon.SVG, ETags.of(DefaultFavicon.SVG));

    private final Path root;
    private final ConcurrentHashMap<Path, CacheRecord> cache = new ConcurrentHashMap<>();

    StaticFiles(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    Entry get(String path) throws IOException {
        String clean = path.startsWith("/") ? path.substring(1) : path;
        String rel = clean.isEmpty() ? "index.html" : clean;
        Path file = root.resolve(rel).normalize();
        if (!file.startsWith(root) || !Files.isRegularFile(file)) {
            file = fallback(rel);
            if (file == null) {
                if (rel.equals("favicon.ico")) {
                    return FAVICON_ICO;
                }
                if (rel.equals("favicon.svg")) {
                    return FAVICON_SVG;
                }
                return null;
            }
        }
        return readCached(file);
    }

    private Entry readCached(Path file) throws IOException {
        long mtime = Files.getLastModifiedTime(file).toMillis();
        CacheRecord rec = cache.get(file);
        if (rec != null && rec.mtime == mtime) {
            return rec.entry;
        }
        byte[] body = Files.readAllBytes(file);
        Entry entry = new Entry(body, ETags.of(body));
        cache.put(file, new CacheRecord(mtime, entry));
        return entry;
    }

    private Path fallback(String rel) {
        if (rel.equals("favicon.ico") || rel.equals("favicon.svg")) {
            Path pub = root.resolveSibling("public").resolve(rel);
            if (Files.isRegularFile(pub)) {
                return pub;
            }
        }
        if (!rel.startsWith("assets/synthesis.worker-") || !rel.endsWith(".js")) {
            return null;
        }
        Path assets = root.resolve("assets");
        if (!Files.isDirectory(assets)) {
            return null;
        }
        try (var stream = Files.list(assets)) {
            return stream
                    .filter(p -> p.getFileName().toString().startsWith("synthesis.worker-")
                            && p.getFileName().toString().endsWith(".js"))
                    .findFirst()
                    .orElse(null);
        } catch (IOException ignored) {
            return null;
        }
    }

    static String contentType(String path) {
        if (path.endsWith(".html")) {
            return HttpConstants.HTML;
        }
        if (path.endsWith(".js")) {
            return HttpConstants.JAVASCRIPT;
        }
        if (path.endsWith(".css")) {
            return HttpConstants.CSS;
        }
        if (path.endsWith(".json")) {
            return HttpConstants.JSON;
        }
        if (path.endsWith(".png")) {
            return "image/png";
        }
        if (path.endsWith(".svg")) {
            return "image/svg+xml";
        }
        if (path.endsWith(".ico")) {
            return "image/x-icon";
        }
        if (path.endsWith(".woff2")) {
            return "font/woff2";
        }
        return HttpConstants.BINARY;
    }
}
