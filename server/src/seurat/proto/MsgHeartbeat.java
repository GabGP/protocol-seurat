package seurat.proto;

import java.nio.ByteBuffer;

/** LATIDO / ECO: the 8-byte nonce both directions. Factory of records. */
public final class MsgHeartbeat {
    private MsgHeartbeat() {}

    public record Heartbeat(long nonce) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(8);
            b.putLong(nonce);
            return b.array();
        }

        public static Heartbeat parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            Heartbeat h = new Heartbeat(b.getLong());
            Buf.tail(b);
            return h;
        }
    }
}
