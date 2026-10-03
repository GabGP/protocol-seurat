package seurat.core.shared.proto.msg;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.core.shared.proto.Buf;
import seurat.core.shared.proto.VarInt;

/** REGULACION codec (ADR-07). Factory of records. */
public final class MsgRegulation {
    /** Maximum wire bytes for a REGULACION frame payload (1 byte u8 + 3 varints of up to 8 bytes). */
    private static final int MAX_BYTES = 1 + 3 * 8;

    private MsgRegulation() {}

    /** REGULACION (ADR-07): u8 peldano, vi presupuesto_kib_s (0 = no budget), vi capacidad_kib_s (0 = unbounded), vi sesiones_activas. */
    public record Regulation(int rung, long budgetKibS, long capacityKibS, long sessions) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(MAX_BYTES);
            Buf.u8(b, rung);
            VarInt.put(b, budgetKibS);
            VarInt.put(b, capacityKibS);
            VarInt.put(b, sessions);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static Regulation parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            int rung = Buf.u8(b);
            long budgetKibS = VarInt.get(b);
            long capacityKibS = VarInt.get(b);
            long sessions = VarInt.get(b);
            return new Regulation(rung, budgetKibS, capacityKibS, sessions);
        }
    }
}
