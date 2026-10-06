package seurat.adapters.in.net.h3;

import seurat.core.shared.proto.VarInt;

/** The stream types, frame types and SETTINGS a WebTransport server sends (RFC 9114, RFC 9220, RFC 9297). */
public final class H3Settings {
    public static final long STREAM_CONTROL = 0x00;
    public static final long STREAM_QPACK_ENCODER = 0x02;
    public static final long STREAM_QPACK_DECODER = 0x03;
    public static final long FRAME_HEADERS = 0x01;
    public static final long FRAME_SETTINGS = 0x04;
    /** WebTransport stream headers (draft-ietf-webtrans-http3): unidirectional stream type, bidirectional frame type. */
    public static final long WT_UNI_STREAM = 0x54;
    public static final long WT_BIDI_STREAM = 0x41;
    /** HTTP/3 error codes (RFC 9114 §8.1). */
    public static final long H3_NO_ERROR = 0x100;
    public static final long H3_GENERAL_PROTOCOL_ERROR = 0x101;
    public static final long H3_STREAM_CREATION_ERROR = 0x103;
    public static final long H3_REQUEST_REJECTED = 0x10b;
    /** RESET_STREAM code of a cancelled WebTransport stream: application error 0 in the reserved range. */
    public static final long WT_STREAM_CANCELLED = 0x52e4a40fa8dbL;
    static final long QPACK_MAX_TABLE_CAPACITY = 0x01;
    static final long QPACK_BLOCKED_STREAMS = 0x07;
    static final long ENABLE_CONNECT_PROTOCOL = 0x08;
    static final long H3_DATAGRAM = 0x33;
    /** One setting per WebTransport draft browsers still speak: draft-02, draft-07, draft-13. */
    static final long WT_ENABLE_DRAFT02 = 0x2b603742L;
    static final long WT_MAX_SESSIONS_DRAFT07 = 0xc671706aL;
    static final long WT_MAX_SESSIONS_DRAFT13 = 0x14e9cd29L;

    private static final byte[] CONTROL_PREFACE = buildControlPreface();

    private H3Settings() {}

    private static byte[] buildControlPreface() {
        byte[] payload = H3Wire.concat(
            VarInt.encode(QPACK_MAX_TABLE_CAPACITY), VarInt.encode(0),
            VarInt.encode(QPACK_BLOCKED_STREAMS), VarInt.encode(0),
            VarInt.encode(ENABLE_CONNECT_PROTOCOL), VarInt.encode(1),
            VarInt.encode(H3_DATAGRAM), VarInt.encode(1),
            VarInt.encode(WT_ENABLE_DRAFT02), VarInt.encode(1),
            VarInt.encode(WT_MAX_SESSIONS_DRAFT07), VarInt.encode(1),
            VarInt.encode(WT_MAX_SESSIONS_DRAFT13), VarInt.encode(1)
        );
        byte[] frame = H3Wire.frame(FRAME_SETTINGS, payload);
        return H3Wire.concat(VarInt.encode(STREAM_CONTROL), frame);
    }

    /** What opens the server control stream: its type, then one SETTINGS frame. */
    public static byte[] controlPreface() {
        return CONTROL_PREFACE.clone();
    }
}
