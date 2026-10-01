package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import java.util.Arrays;

/** PINCELADA stream header (flow type 0x01). Band bytes follow. */
public final class Headers {
    private Headers() {}

    public static final long FLOW_PINCELADA = 0x01;

    public record BrushHead(long handle, long delivery, long brushId, int from,
            int through, long epoch, int qy, int qc, long edition, long[] crcs, long[] lengths) {
        public byte[] encode() {
            int n = through - from;
            ByteBuffer b = ByteBuffer.allocate(64 + 12 * n);
            VarInt.put(b, FLOW_PINCELADA);
            VarInt.put(b, handle);
            VarInt.put(b, delivery);
            b.putLong(brushId);
            Buf.u8(b, (from << 4) | through);
            VarInt.put(b, epoch);
            Buf.u8(b, qy);
            Buf.u8(b, qc);
            VarInt.put(b, edition);
            for (long c : crcs) {
                Buf.u32(b, c);
            }
            for (long canvas : lengths) {
                VarInt.put(b, canvas);
            }
            return Arrays.copyOf(b.array(), b.position());
        }

        public static BrushHead parse(ByteBuffer b) {
            long flow = VarInt.get(b);
            if (flow != FLOW_PINCELADA) {
                throw new FatalProtocol(1, flow, "tipo_flujo != PINCELADA");
            }
            long h = VarInt.get(b);
            long e = VarInt.get(b);
            long id = b.getLong();
            int bands = Buf.u8(b);
            int b0 = (bands >>> 4) & 0xF;
            int b1 = bands & 0xF;
            long ep = VarInt.get(b);
            int qy = Buf.u8(b);
            int qc = Buf.u8(b);
            long ed = VarInt.get(b);
            long[] crcs = new long[b1 - b0];
            long[] lengths = new long[b1 - b0];
            for (int i = 0; i < crcs.length; i++) {
                crcs[i] = Buf.u32(b);
            }
            for (int i = 0; i < lengths.length; i++) {
                lengths[i] = VarInt.get(b);
            }
            return new BrushHead(h, e, id, b0, b1, ep, qy, qc, ed, crcs, lengths);
        }
    }
}
