package seurat.adapters.in.net.http;

import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * GET/HEAD of the viewer files (client/dist): revalidated by strong ETag (no-cache, 304),
 * cross-origin isolated, and gzip-encoded when the browser accepts it. Each representation
 * has its own ETag and compressible types say `Vary: Accept-Encoding`, so no cache mixes them.
 */
final class StaticRoute {
    private static final byte[] EMPTY_BODY = new byte[0];
    private static final String ROOT = "/";
    private static final char EXTENSION = '.';
    private static final char QUERY = '?';

    private final StaticFiles files;

    StaticRoute(Path root) {
        this.files = new StaticFiles(root);
    }

    HttpSurface.Response get(HttpSurface.Request req) throws IOException {
        int query = req.path().indexOf(QUERY);
        String path = query < 0 ? req.path() : req.path().substring(0, query); // `?` names no file
        StaticFiles.Entry file = files.get(path);
        if (file == null) {
            return HttpSurface.json(HttpConstants.NOT_FOUND, HttpConstants.NOT_FOUND_BODY);
        }
        String type = (path.indexOf(EXTENSION) < 0 || path.equals(ROOT))
                ? HttpConstants.HTML
                : StaticFiles.contentType(path);
        boolean gzip = file.gzip() != null && StaticGzip.accepted(req.headers());
        String etag = gzip ? file.gzipEtag() : file.etag();
        Map<String, String> headers = headers(etag, StaticGzip.compressible(type));
        if (ETags.matches(req.headers(), etag)) {
            return new HttpSurface.Response(HttpConstants.NOT_MODIFIED, "", EMPTY_BODY, headers);
        }
        if (gzip) {
            headers.put(HttpConstants.CONTENT_ENCODING, HttpConstants.GZIP);
        }
        return new HttpSurface.Response(HttpConstants.OK, type, gzip ? file.gzip() : file.body(), headers);
    }

    private static Map<String, String> headers(String etag, boolean varies) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put(HttpConstants.CACHE_CONTROL, HttpConstants.NO_CACHE);
        headers.put(HttpConstants.ETAG, etag);
        headers.put(HttpConstants.COOP, HttpConstants.COOP_VALUE);
        headers.put(HttpConstants.COEP, HttpConstants.COEP_VALUE);
        if (varies) {
            headers.put(HttpConstants.VARY, HttpConstants.ACCEPT_ENCODING);
        }
        return headers;
    }
}
