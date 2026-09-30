package seurat.net.http;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import seurat.kit.TestKit;

/** Tests strong CRC32C ETag generation and RFC 9110 weak comparison. */
public final class ETagsTest {
    public static void main(String[] args) {
        byte[] b1 = "hello world".getBytes(StandardCharsets.UTF_8);
        byte[] b2 = "hello world!".getBytes(StandardCharsets.UTF_8);
        String etag1 = ETags.of(b1);
        String etag2 = ETags.of(b2);

        TestKit.check(etag1.startsWith("\"") && etag1.endsWith("\""), "quoted etag");
        TestKit.check(etag1.equals(ETags.of(b1)), "deterministic etag");
        TestKit.check(!etag1.equals(etag2), "distinct content yields distinct etags");

        TestKit.check(ETags.matches(etag1, etag1), "exact match");
        TestKit.check(ETags.matches("*", etag1), "wildcard match");
        TestKit.check(ETags.matches("\"other\", " + etag1, etag1), "comma list match");
        TestKit.check(ETags.matches("W/" + etag1, etag1), "weak tag matches strong target");
        TestKit.check(!ETags.matches("\"other\"", etag1), "different tag rejected");
        TestKit.check(!ETags.matches((String) null, etag1), "null string rejected");
        TestKit.check(!ETags.matches((Map<String, String>) null, etag1), "null headers rejected");
        TestKit.check(!ETags.matches("", etag1), "empty header rejected");

        TestKit.check(ETags.matches(Map.of("if-none-match", etag1), etag1), "lowercase header");
        TestKit.check(ETags.matches(Map.of("If-None-Match", etag1), etag1), "canonical header");
        TestKit.check(ETags.matches(Map.of("IF-NONE-MATCH", etag1), etag1), "uppercase header");
        TestKit.check(!ETags.matches(Map.of("If-None-Match", "\"stale\""), etag1), "stale header");

        System.out.println("ETagsTest OK");
    }
}
