package seurat.core.shared.proto.msg;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.List;
import seurat.core.shared.proto.Tlv;
import seurat.core.shared.proto.VarInt;

/** BIENVENIDA: the server welcome, its ticket and the resumed handles. Factory of records. */
public final class MsgWelcome {
    private MsgWelcome() {}

    public record Welcome(long version, long caps, long sessionId, long side,
            long leaseS, long heartbeatS, long maxInFlight, long sessionMaxBrushes,
            byte[] ticket, List<Long> resumed) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(256);
            VarInt.put(b, version);
            VarInt.put(b, caps);
            b.putLong(sessionId);
            VarInt.put(b, side);
            VarInt.put(b, leaseS);
            VarInt.put(b, heartbeatS);
            VarInt.put(b, maxInFlight);
            VarInt.put(b, sessionMaxBrushes);
            b.put(new Tlv(Tlv.FICHA, ticket).encode());
            if (!resumed.isEmpty()) {
                ByteBuffer r = ByteBuffer.allocate(16 * resumed.size() + 8);
                VarInt.put(r, resumed.size());
                resumed.forEach(h -> VarInt.put(r, h));
                b.put(new Tlv(Tlv.REANUDADA, Arrays.copyOf(r.array(), r.position())).encode());
            }
            return Arrays.copyOf(b.array(), b.position());
        }
    }
}
