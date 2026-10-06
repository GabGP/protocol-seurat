package seurat.adapters.in.net.ws;

import java.util.Arrays;
import seurat.core.shared.proto.Datagrams;

/**
 * The WS mapping's message layout (spec 3.1): u8 channel + content.
 * 0 = one control frame, 1 = one delivery (S->C only), 2 = one MIRADA datagram (C->S).
 */
final class WsChannels {
    private WsChannels() {}

    static final int CONTROL = 0;
    static final int DELIVERY = 1;
    static final int GAZE = 2;

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
        if (d[0] != GAZE) {
            return null;
        }
        return Datagrams.gazeFrame(d, 1);
    }
}
