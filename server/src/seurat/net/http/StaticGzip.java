package seurat.net.http;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Locale;
import java.util.Map;
import java.util.zip.Deflater;
import java.util.zip.GZIPOutputStream;

/**
 * The gzip representation of a static body (RFC 9110 §8.4.1.3), built once per file version,
 * and the Accept-Encoding check that picks it (§12.5.3). Plain HTTP, outside Seurat/1.
 */
final class StaticGzip {
    private static final String TEXT_TYPES = "text/";
    private static final String ANY_CODING = "*";
    private static final String QUALITY_PARAM = "q=";
    /** A coding listed without `q` is fully acceptable. */
    private static final double DEFAULT_QUALITY = 1.0;
    private static final double REJECTED = 0.0;
    /** Below any real weight: the coding was not listed. */
    private static final double ABSENT = -1.0;

    private StaticGzip() {}

    /** Text-like types that shrink under deflate; images and fonts are already compressed. */
    static boolean compressible(String type) {
        return type.startsWith(TEXT_TYPES) || type.equals(HttpConstants.JSON) || type.equals(HttpConstants.SVG);
    }

    /** The gzip of body at best compression, or null when the type does not compress, it is small, or no smaller. */
    static byte[] encode(byte[] body, String type) {
        if (!compressible(type) || body.length < HttpConstants.GZIP_MIN_BYTES) {
            return null;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(body.length);
        try (GZIPOutputStream gzip = new GZIPOutputStream(out) {
            {
                def.setLevel(Deflater.BEST_COMPRESSION);
            }
        }) {
            gzip.write(body);
        } catch (IOException ex) {
            throw new UncheckedIOException(ex); // a memory stream never fails
        }
        byte[] packed = out.toByteArray();
        return packed.length < body.length ? packed : null;
    }

    /** `"abc"` becomes `"abc-gz"`: each representation keeps its own strong validator. */
    static String etag(String identity) {
        return identity.substring(0, identity.length() - 1) + HttpConstants.GZIP_ETAG_SUFFIX + "\"";
    }

    /** True when Accept-Encoding lists gzip (or `*` without gzip) with a quality above zero. */
    static boolean accepted(Map<String, String> headers) {
        String header = ETags.header(headers, HttpConstants.ACCEPT_ENCODING);
        if (header == null) {
            return false;
        }
        double gzip = ABSENT;
        double any = ABSENT;
        for (String part : header.split(",")) {
            String[] fields = part.split(";");
            String coding = fields[0].trim().toLowerCase(Locale.ROOT);
            if (coding.equals(HttpConstants.GZIP)) {
                gzip = quality(fields);
            } else if (coding.equals(ANY_CODING)) {
                any = quality(fields);
            }
        }
        return (gzip != ABSENT ? gzip : any) > REJECTED;
    }

    /** The `q` weight of one Accept-Encoding member; a malformed one counts as a refusal. */
    private static double quality(String[] fields) {
        for (int i = 1; i < fields.length; i++) {
            String param = fields[i].trim().toLowerCase(Locale.ROOT);
            if (param.startsWith(QUALITY_PARAM)) {
                try {
                    return Double.parseDouble(param.substring(QUALITY_PARAM.length()).trim());
                } catch (NumberFormatException ex) {
                    return REJECTED;
                }
            }
        }
        return DEFAULT_QUALITY;
    }
}
