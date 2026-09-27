package seurat.proto;

import java.nio.ByteBuffer;
import java.util.Arrays;

/** ADIOS (spec 3.3): orderly close, either way. */
public record MsgGoodbye(long code, String msg) {
    public byte[] encode() {
        ByteBuffer b = ByteBuffer.allocate(32 + msg.length() * 3);
        VarInt.put(b, code);
        Buf.viStr(b, msg);
        return Arrays.copyOf(b.array(), b.position());
    }
}
