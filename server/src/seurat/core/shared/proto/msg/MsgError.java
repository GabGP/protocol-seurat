package seurat.core.shared.proto.msg;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.core.shared.proto.Buf;
import seurat.core.shared.proto.VarInt;

/** ERROR: code, fatal flag, offending type and text. Factory of records. */
public final class MsgError {
    private MsgError() {}

    public record ProtocolError(long code, int fail, long refType, String msg) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(64 + msg.length() * 3);
            VarInt.put(b, code);
            Buf.u8(b, fail);
            VarInt.put(b, refType);
            Buf.viStr(b, msg);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static ProtocolError parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            long c = VarInt.get(b);
            int f = Buf.u8(b);
            long r = VarInt.get(b);
            return new ProtocolError(c, f, r, Buf.viStr(b));
        }
    }
}
