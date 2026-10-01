package seurat.adapters.in.net.http;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Map;
import java.util.Random;
import java.util.zip.GZIPInputStream;
import seurat.kit.TestKit;

/** Static files go out gzip-encoded when accepted, with a distinct ETag and Vary; identity otherwise. */
public final class StaticGzipTest {
    private static final String JS = "/assets/index-abc.js";

    public static void main(String[] args) throws Exception {
        negotiation();
        encoding();
        Path web = Files.createTempDirectory("gzip-test");
        Path assets = Files.createDirectories(web.resolve("assets"));
        byte[] js = "export const brush = 'pincelada';\n".repeat(200).getBytes(StandardCharsets.UTF_8);
        Files.write(assets.resolve("index-abc.js"), js);
        Files.writeString(web.resolve("index.html"), "<html>viewer</html>");
        byte[] noise = new byte[4096];
        new Random(7).nextBytes(noise);
        Files.write(assets.resolve("noise.css"), noise);
        StaticRoute route = new StaticRoute(web);

        var identity = get(route, JS, Map.of());
        TestKit.check(identity.code() == 200 && Arrays.equals(identity.body(), js)
                && !identity.headers().containsKey(HttpConstants.CONTENT_ENCODING)
                && identity.headers().get(HttpConstants.VARY).equals(HttpConstants.ACCEPT_ENCODING),
                "no Accept-Encoding: identity bytes, no Content-Encoding, Vary set");
        var packed = get(route, JS, Map.of("accept-encoding", "gzip, deflate, br, zstd"));
        String gzEtag = packed.headers().get(HttpConstants.ETAG);
        TestKit.check(packed.code() == 200 && packed.type().equals(HttpConstants.JAVASCRIPT)
                && packed.headers().get(HttpConstants.CONTENT_ENCODING).equals(HttpConstants.GZIP)
                && packed.headers().get(HttpConstants.VARY).equals(HttpConstants.ACCEPT_ENCODING)
                && packed.body().length < js.length && Arrays.equals(inflate(packed.body()), js),
                "gzip accepted: Content-Encoding gzip, smaller body that inflates byte-for-byte");
        String idEtag = identity.headers().get(HttpConstants.ETAG);
        TestKit.check(gzEtag.equals(StaticGzip.etag(idEtag)) && !gzEtag.equals(idEtag)
                && gzEtag.endsWith(HttpConstants.GZIP_ETAG_SUFFIX + "\""), "each representation has its own ETag");
        TestKit.check(packed.headers().get(HttpConstants.COEP).equals(HttpConstants.COEP_VALUE)
                && packed.headers().get(HttpConstants.COOP).equals(HttpConstants.COOP_VALUE)
                && packed.headers().get(HttpConstants.CACHE_CONTROL).equals(HttpConstants.NO_CACHE),
                "gzip keeps cross-origin isolation and no-cache");
        var refused = get(route, JS, Map.of("Accept-Encoding", "gzip;q=0, identity"));
        TestKit.check(Arrays.equals(refused.body(), js) && !refused.headers().containsKey(HttpConstants.CONTENT_ENCODING)
                && refused.headers().get(HttpConstants.ETAG).equals(idEtag), "gzip;q=0 gets identity");

        var gz304 = get(route, JS, Map.of("accept-encoding", "gzip", "if-none-match", gzEtag));
        TestKit.check(gz304.code() == 304 && gz304.body().length == 0
                && gz304.headers().get(HttpConstants.ETAG).equals(gzEtag)
                && gz304.headers().get(HttpConstants.VARY).equals(HttpConstants.ACCEPT_ENCODING)
                && !gz304.headers().containsKey(HttpConstants.CONTENT_ENCODING), "gzip ETag revalidates to 304");
        var id304 = get(route, JS, Map.of("if-none-match", idEtag));
        TestKit.check(id304.code() == 304 && id304.headers().get(HttpConstants.ETAG).equals(idEtag),
                "identity ETag revalidates to 304");
        var crossed = get(route, JS, Map.of("accept-encoding", "gzip", "if-none-match", idEtag));
        TestKit.check(crossed.code() == 200 && Arrays.equals(inflate(crossed.body()), js),
                "an identity ETag does not validate the gzip representation");
        var crossedBack = get(route, JS, Map.of("if-none-match", gzEtag));
        TestKit.check(crossedBack.code() == 200 && Arrays.equals(crossedBack.body(), js),
                "a gzip ETag does not validate the identity representation");

        var small = get(route, "/", Map.of("accept-encoding", "gzip"));
        TestKit.check(small.code() == 200 && new String(small.body(), StandardCharsets.UTF_8).contains("viewer")
                && !small.headers().containsKey(HttpConstants.CONTENT_ENCODING)
                && small.headers().get(HttpConstants.VARY) != null, "a small html body stays identity");
        var random = get(route, "/assets/noise.css", Map.of("accept-encoding", "gzip"));
        TestKit.check(Arrays.equals(random.body(), noise) && !random.headers().containsKey(HttpConstants.CONTENT_ENCODING),
                "an incompressible body stays identity");
        var icon = get(route, "/favicon.ico", Map.of("accept-encoding", "gzip"));
        TestKit.check(icon.code() == 200 && !icon.headers().containsKey(HttpConstants.CONTENT_ENCODING)
                && !icon.headers().containsKey(HttpConstants.VARY), "an image is neither encoded nor varied");

        byte[] edited = "export const brush = 'raspado';\n".repeat(300).getBytes(StandardCharsets.UTF_8);
        Files.write(assets.resolve("index-abc.js"), edited);
        Files.setLastModifiedTime(assets.resolve("index-abc.js"),
                java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() + 5_000));
        var fresh = get(route, JS, Map.of("accept-encoding", "gzip", "if-none-match", gzEtag));
        TestKit.check(fresh.code() == 200 && Arrays.equals(inflate(fresh.body()), edited)
                && !fresh.headers().get(HttpConstants.ETAG).equals(gzEtag), "a new mtime re-gzips the file");
        System.out.println("StaticGzipTest OK");
    }

    private static void negotiation() {
        TestKit.check(!StaticGzip.accepted(Map.of()), "no header: identity");
        TestKit.check(StaticGzip.accepted(Map.of("Accept-Encoding", "GZip")), "coding is case-insensitive");
        TestKit.check(StaticGzip.accepted(Map.of("accept-encoding", "br;q=1.0, gzip;q=0.8")), "weighted gzip");
        TestKit.check(!StaticGzip.accepted(Map.of("accept-encoding", "gzip;q=0")), "gzip;q=0 rejects");
        TestKit.check(!StaticGzip.accepted(Map.of("accept-encoding", "gzip; q=0.000")), "q=0.000 rejects");
        TestKit.check(!StaticGzip.accepted(Map.of("accept-encoding", "br, deflate")), "gzip absent");
        TestKit.check(StaticGzip.accepted(Map.of("accept-encoding", "*")), "wildcard accepts");
        TestKit.check(!StaticGzip.accepted(Map.of("accept-encoding", "*, gzip;q=0")), "explicit gzip;q=0 beats *");
        TestKit.check(!StaticGzip.accepted(Map.of("accept-encoding", "x-gzip")), "x-gzip is not gzip");
        TestKit.check(!StaticGzip.accepted(Map.of("accept-encoding", "gzip;q=junk")), "malformed q rejects");
    }

    private static void encoding() {
        byte[] text = "a".repeat(HttpConstants.GZIP_MIN_BYTES).getBytes(StandardCharsets.UTF_8);
        TestKit.check(StaticGzip.encode(text, HttpConstants.CSS) != null, "text at the threshold compresses");
        TestKit.check(StaticGzip.encode(Arrays.copyOf(text, HttpConstants.GZIP_MIN_BYTES - 1), HttpConstants.CSS) == null,
                "text below the threshold stays identity");
        TestKit.check(StaticGzip.encode(text, "image/png") == null, "images are never gzipped");
        TestKit.check(StaticGzip.compressible(HttpConstants.SVG) && StaticGzip.compressible(HttpConstants.JSON)
                && StaticGzip.compressible(StaticFiles.contentType("a.mjs"))
                && StaticGzip.compressible(StaticFiles.contentType("a.js.map"))
                && StaticGzip.compressible(StaticFiles.contentType("a.txt"))
                && !StaticGzip.compressible(StaticFiles.contentType("a.woff2")), "compressible types");
        TestKit.check(StaticGzip.etag("\"0badf00d\"").equals("\"0badf00d-gz\""), "variant etag keeps the quotes");
    }

    private static HttpSurface.Response get(StaticRoute route, String path, Map<String, String> headers)
            throws Exception {
        return route.get(new HttpSurface.Request("GET", path, headers, new byte[0], "localhost"));
    }

    private static byte[] inflate(byte[] gzip) throws Exception {
        try (var in = new GZIPInputStream(new ByteArrayInputStream(gzip))) {
            return in.readAllBytes();
        }
    }
}
