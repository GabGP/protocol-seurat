package seurat.core.shared.proto.msg;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.core.shared.proto.Buf;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.VarInt;

/** RENEW / AUDIT / INVENTORY: lease renewal and exact-set auditing. */
public final class MsgAudit {
    private MsgAudit() {}

    public record Renew(long handle, long order, long leaseS, Ranges ranges) {
        public byte[] encode() {
            byte[] r = ranges.encode();
            ByteBuffer b = ByteBuffer.allocate(16 + r.length);
            VarInt.put(b, handle);
            VarInt.put(b, order);
            VarInt.put(b, leaseS);
            b.put(r);
            return Arrays.copyOf(b.array(), b.position());
        }
    }

    public record Audit(long handle, long order, long through) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(24);
            VarInt.put(b, handle);
            VarInt.put(b, order);
            VarInt.put(b, through);
            return Arrays.copyOf(b.array(), b.position());
        }
    }

    public record Inventory(long handle, long order, long through, long brushCount,
            long kib, Ranges ranges) {
        public byte[] encode() {
            byte[] r = ranges.encode();
            ByteBuffer b = ByteBuffer.allocate(32 + r.length);
            VarInt.put(b, handle);
            VarInt.put(b, order);
            VarInt.put(b, through);
            VarInt.put(b, brushCount);
            VarInt.put(b, kib);
            b.put(r);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static Inventory parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            long h = VarInt.get(b);
            long o = VarInt.get(b);
            long ha = VarInt.get(b);
            long pi = VarInt.get(b);
            long k = VarInt.get(b);
            Ranges r = Ranges.decode(b);
            Buf.tail(b);
            return new Inventory(h, o, ha, pi, k, r);
        }
    }
}
