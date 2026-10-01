package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import seurat.core.shared.config.SeuratConstants;

/** Control frame: type/length/payload. >64KiB is fail. */
public record Frame(long type, byte[] payload) {
    public byte[] encode() {
        byte[] t = VarInt.encode(type);
        byte[] canvas = VarInt.encode(payload.length);
        byte[] out = new byte[t.length + canvas.length + payload.length];
        System.arraycopy(t, 0, out, 0, t.length);
        System.arraycopy(canvas, 0, out, t.length, canvas.length);
        System.arraycopy(payload, 0, out, t.length + canvas.length, payload.length);
        return out;
    }

    public static Frame decode(ByteBuffer b) {
        long type = VarInt.get(b);
        long length = VarInt.get(b);
        if (length > SeuratConstants.FRAME_MAX) {
            throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, type, "trama >64KiB");
        }
        return new Frame(type, Buf.bytes(b, length));
    }

    /** One message = exactly one frame (WS channel 0): bytes past `largo` are malformed. */
    public static Frame decodeExact(byte[] raw) {
        ByteBuffer b = ByteBuffer.wrap(raw);
        Frame f = decode(b);
        if (b.hasRemaining()) {
            throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, f.type(), "bytes past largo");
        }
        return f;
    }

    public static boolean mandatory(long type) {
        return type < 0x40;
    }
}
