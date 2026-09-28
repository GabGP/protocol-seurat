package seurat.net.http;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Static root: client/dist. No CDN. */
final class StaticFiles {
    private final Path root;

    StaticFiles(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    byte[] get(String path) throws IOException {
        String clean = path.startsWith("/") ? path.substring(1) : path;
        String rel = clean.isEmpty() ? "index.html" : clean;
        Path file = root.resolve(rel).normalize();
        if (!file.startsWith(root) || !Files.isRegularFile(file)) {
            file = fallback(rel);
            if (file == null) {
                if (rel.equals("favicon.ico")) {
                    return DefaultFavicon.ICO;
                }
                if (rel.equals("favicon.svg")) {
                    return DefaultFavicon.SVG;
                }
                return null;
            }
        }
        return Files.readAllBytes(file);
    }

    /** A build asset served under its own name: its name changes with its content, so it may be cached. */
    boolean hashed(String path) {
        String rel = path.startsWith("/") ? path.substring(1) : path;
        Path file = root.resolve(rel).normalize();
        return rel.startsWith("assets/") && file.startsWith(root) && Files.isRegularFile(file);
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
            return "text/html; charset=utf-8";
        }
        if (path.endsWith(".js")) {
            return "text/javascript; charset=utf-8";
        }
        if (path.endsWith(".css")) {
            return "text/css; charset=utf-8";
        }
        if (path.endsWith(".json")) {
            return "application/json";
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
        return "application/octet-stream";
    }
}
