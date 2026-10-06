package seurat.adapters.in.net.h3;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.Map;
import tech.kwik.qpack.Decoder;
import tech.kwik.qpack.Encoder;

/** QPACK header blocks (RFC 9204) with the static table only, through the vendored qpack library. */
public final class H3Headers {
    public static final String HEADER_STATUS = ":status";
    public static final String HEADER_DRAFT = "sec-webtransport-http3-draft";
    public static final String VALUE_DRAFT02 = "draft02";
    public static final String STATUS_OK = "200";

    private H3Headers() {}

    public static List<Map.Entry<String, String>> decode(byte[] block) throws IOException {
        return Decoder.newBuilder().build().decodeStream(new ByteArrayInputStream(block));
    }

    public static byte[] encode(List<Map.Entry<String, String>> headers) {
        ByteBuffer b = Encoder.newBuilder().build().compressHeaders(headers);
        b.flip();
        byte[] out = new byte[b.remaining()];
        b.get(out);
        return out;
    }

    /** HEADERS frame answering a WebTransport CONNECT: 200, and the draft-02 marker Chrome expects. */
    public static byte[] accepted() {
        byte[] block = encode(List.of(
            Map.entry(HEADER_STATUS, STATUS_OK),
            Map.entry(HEADER_DRAFT, VALUE_DRAFT02)
        ));
        return H3Wire.frame(H3Settings.FRAME_HEADERS, block);
    }

    /** HEADERS frame with only a status (a refusal). */
    public static byte[] status(int code) {
        byte[] block = encode(List.of(
            Map.entry(HEADER_STATUS, Integer.toString(code))
        ));
        return H3Wire.frame(H3Settings.FRAME_HEADERS, block);
    }
}
