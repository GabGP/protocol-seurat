package seurat.net.ws;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.config.SeuratConstants;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.VarInt;

/**
 * The WS mapping's message layout (spec 3.1): u8 channel + content.
 * 0 = one control frame, 1 = one delivery (S->C only), 2 = one MIRADA datagram (C->S).
 */
final class WsChannels {
    private WsChannels() {}

    static final int CONTROL = 0;
    static final int DELIVERY = 1;
    static final int GAZE = 2;
    /** A torn frame (a 2-byte varint cut short): the Easel's parser turns it into fatal ERROR 1. */
    static final byte[] MALFORMED = {0x40};

    static byte[] wrap(int channel, byte[] content) {
        byte[] msg = new byte[content.length + 1];
        msg[0] = (byte) channel;
        System.arraycopy(content, 0, msg, 1, content.length);
        return msg;
    }

    /** The control frame the Easel reads, or null for a message the mapping forbids (fatal, 1002). */
    static byte[] inbound(WsFraming.Msg m) {
        byte[] d = m.data();
        if (m.opcode() != WsFraming.BINARY || d.length == 0) {
            return null;
        }
        if (d[0] == CONTROL) {
            return Arrays.copyOfRange(d, 1, d.length);
        }
        if (d[0] != GAZE || d.length - 1 > SeuratConstants.DATAGRAM_MAX) {
            return null;
        }
        try {
            ByteBuffer b = ByteBuffer.wrap(d, 1, d.length - 1);
            long type = VarInt.get(b); // datagram form: vi tipo · payload, the message delimits it
            return type != FrameType.MIRADA ? null
                    : new Frame(type, Arrays.copyOfRange(d, b.position(), d.length)).encode();
        } catch (RuntimeException ex) {
            return null;
        }
    }
}
