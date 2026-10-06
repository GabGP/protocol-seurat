package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.core.shared.config.SeuratConstants;

/** The datagram form of MIRADA (spec 3.4.3): vi tipo · payload, delimited by the datagram itself. */
public final class Datagrams {
    private Datagrams() {}

    /** The control frame for the datagram in data[from..], or null when it is not a MIRADA or is malformed. */
    public static byte[] gazeFrame(byte[] data, int from) {
        if (data == null || from < 0 || from >= data.length) {
            return null;
        }
        int len = data.length - from;
        if (len > SeuratConstants.DATAGRAM_MAX) {
            return null;
        }
        try {
            ByteBuffer b = ByteBuffer.wrap(data, from, len);
            long type = VarInt.get(b);
            return type != FrameType.MIRADA ? null
                    : new Frame(type, Arrays.copyOfRange(data, b.position(), data.length)).encode();
        } catch (RuntimeException ex) {
            return null;
        }
    }
}
