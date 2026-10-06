package seurat.adapters.in.net.wt;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/** The few DER encoders (ITU-T X.690) a self-signed X.509 certificate needs. */
final class Der {
    private static final int TAG_INTEGER = 0x02;
    private static final int TAG_BIT_STRING = 0x03;
    private static final int TAG_OCTET_STRING = 0x04;
    private static final int TAG_OID = 0x06;
    private static final int TAG_UTF8_STRING = 0x0C;
    private static final int TAG_UTC_TIME = 0x17;
    private static final int TAG_SEQUENCE = 0x30;
    private static final int TAG_SET = 0x31;

    private static final int LEN_MULTI_1 = 0x81;
    private static final int LEN_MULTI_2 = 0x82;
    private static final int LEN_1_BYTE_LIMIT = 128;
    private static final int LEN_2_BYTE_LIMIT = 256;

    private static final int BITS_PER_BYTE = 8;
    private static final int BITS_PER_7BIT = 7;
    private static final int MASK_7BIT = 0x7F;
    private static final int HIGH_BIT = 0x80;
    private static final int OID_FIRST_ARC_MULTIPLIER = 40;

    private static final DateTimeFormatter UTC_FORMAT =
            DateTimeFormatter.ofPattern("yyMMddHHmmss'Z'").withZone(ZoneOffset.UTC);

    private Der() {}

    static byte[] tlv(int tag, byte[]... content) {
        int length = 0;
        for (byte[] c : content) {
            length += c.length;
        }
        int headerLen = 1;
        if (length < LEN_1_BYTE_LIMIT) {
            headerLen += 1;
        } else if (length < LEN_2_BYTE_LIMIT) {
            headerLen += 2;
        } else {
            headerLen += 3;
        }
        byte[] out = new byte[headerLen + length];
        out[0] = (byte) tag;
        int pos = 1;
        if (length < LEN_1_BYTE_LIMIT) {
            out[pos++] = (byte) length;
        } else if (length < LEN_2_BYTE_LIMIT) {
            out[pos++] = (byte) LEN_MULTI_1;
            out[pos++] = (byte) length;
        } else {
            out[pos++] = (byte) LEN_MULTI_2;
            out[pos++] = (byte) (length >>> BITS_PER_BYTE);
            out[pos++] = (byte) length;
        }
        for (byte[] c : content) {
            System.arraycopy(c, 0, out, pos, c.length);
            pos += c.length;
        }
        return out;
    }

    static byte[] sequence(byte[]... content) {
        return tlv(TAG_SEQUENCE, content);
    }

    static byte[] set(byte[]... content) {
        return tlv(TAG_SET, content);
    }

    static byte[] integer(BigInteger value) {
        return tlv(TAG_INTEGER, value.toByteArray());
    }

    static byte[] oid(String dotted) {
        String[] parts = dotted.split("\\.");
        int a = Integer.parseInt(parts[0]);
        int b = Integer.parseInt(parts[1]);
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write((byte) (OID_FIRST_ARC_MULTIPLIER * a + b));
        for (int i = 2; i < parts.length; i++) {
            long val = Long.parseLong(parts[i]);
            encodeArc(val, body);
        }
        return tlv(TAG_OID, body.toByteArray());
    }

    private static void encodeArc(long val, ByteArrayOutputStream out) {
        if (val == 0) {
            out.write(0);
            return;
        }
        int count = 0;
        long temp = val;
        while (temp > 0) {
            count++;
            temp >>>= BITS_PER_7BIT;
        }
        for (int j = count - 1; j >= 0; j--) {
            int b = (int) ((val >>> (j * BITS_PER_7BIT)) & MASK_7BIT);
            if (j > 0) {
                b |= HIGH_BIT;
            }
            out.write(b);
        }
    }

    static byte[] utf8(String text) {
        return tlv(TAG_UTF8_STRING, text.getBytes(StandardCharsets.UTF_8));
    }

    static byte[] bitString(byte[] bytes) {
        byte[] content = new byte[bytes.length + 1];
        System.arraycopy(bytes, 0, content, 1, bytes.length);
        return tlv(TAG_BIT_STRING, content);
    }

    static byte[] octetString(byte[] bytes) {
        return tlv(TAG_OCTET_STRING, bytes);
    }

    static byte[] utcTime(Instant when) {
        return tlv(TAG_UTC_TIME, UTC_FORMAT.format(when).getBytes(StandardCharsets.US_ASCII));
    }
}
