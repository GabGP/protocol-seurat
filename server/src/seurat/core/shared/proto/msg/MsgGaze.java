package seurat.core.shared.proto.msg;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import seurat.core.shared.proto.Buf;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.Tlv;
import seurat.core.shared.proto.VarInt;

/** MIRADA / CONCESION / PLAN. */
public final class MsgGaze {
    private MsgGaze() {}

    public static final int M_OCULTA = 1;
    public static final int M_QUIETA = 2;

    public record Gaze(long handle, long seq, long x0, long y0, long x1, long y1,
            long vw, long vh, int flags) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(64);
            VarInt.put(b, handle);
            VarInt.put(b, seq);
            VarInt.put(b, x0);
            VarInt.put(b, y0);
            VarInt.put(b, x1);
            VarInt.put(b, y1);
            VarInt.put(b, vw);
            VarInt.put(b, vh);
            Buf.u8(b, flags);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static Gaze parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            Gaze g = new Gaze(VarInt.get(b), VarInt.get(b), VarInt.get(b), VarInt.get(b),
                    VarInt.get(b), VarInt.get(b), VarInt.get(b), VarInt.get(b), Buf.u8(b));
            Buf.tail(b);
            if (g.x1() < g.x0() || g.y1() < g.y0()) {
                throw new IllegalArgumentException("MIRADA: inverted rectangle");
            }
            return g;
        }
    }

    public record ConcessionMessage(long handle, long epoch, int minStratum, int maxBands,
            int reason, long maxBrushes, long maxKiB, long leaseS) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(32);
            VarInt.put(b, handle);
            VarInt.put(b, epoch);
            Buf.u8(b, minStratum);
            Buf.u8(b, maxBands);
            Buf.u8(b, reason);
            VarInt.put(b, maxBrushes);
            VarInt.put(b, maxKiB);
            VarInt.put(b, leaseS);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static ConcessionMessage parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            return new ConcessionMessage(VarInt.get(b), VarInt.get(b), Buf.u8(b), Buf.u8(b),
                    Buf.u8(b), VarInt.get(b), VarInt.get(b), VarInt.get(b));
        }
    }

    public record Plan(long handle, long gazeSeq, int event, long first,
            long expectedCount, int throttle, long last, Ranges cancelled,
            List<Long> unrecoverable) {
        public Plan {
            unrecoverable = unrecoverable == null ? List.of() : List.copyOf(unrecoverable);
        }

        public static Plan start(long h, long seq, long first, long count, int flags) {
            return start(h, seq, first, count, flags, List.of());
        }

        /** unrec: brush ids given up (TLV IRRECUPERABLES, ADR-06). */
        public static Plan start(long h, long seq, long first, long count, int flags, List<Long> unrec) {
            return new Plan(h, seq, ProtoCodes.PLAN_INICIO, first, count, flags, 0, null, unrec);
        }

        public static Plan end(long h, long seq, long last) {
            return new Plan(h, seq, ProtoCodes.PLAN_FIN, 0, 0, 0, last, null, List.of());
        }

        public static Plan cancelled(long h, long seq, Ranges r) {
            return new Plan(h, seq, ProtoCodes.PLAN_CANCELADAS, 0, 0, 0, 0, r, List.of());
        }

        public byte[] encode() {
            byte[] sets = cancelled == null ? new byte[0] : cancelled.encode();
            ByteBuffer b = ByteBuffer.allocate(64 + 10 * unrecoverable.size() + sets.length);
            VarInt.put(b, handle);
            VarInt.put(b, gazeSeq);
            Buf.u8(b, event);
            if (event == ProtoCodes.PLAN_INICIO) {
                VarInt.put(b, first);
                VarInt.put(b, expectedCount);
                Buf.u8(b, throttle);
                if (!unrecoverable.isEmpty()) {
                    int valLen = VarInt.encodedLength(unrecoverable.size()) + 8 * unrecoverable.size();
                    ByteBuffer vb = ByteBuffer.allocate(valLen);
                    VarInt.put(vb, unrecoverable.size());
                    for (long id : unrecoverable) Buf.u64(vb, id);
                    b.put(new Tlv(Tlv.IRRECUPERABLES, vb.array()).encode());
                }
            } else if (event == ProtoCodes.PLAN_FIN) {
                VarInt.put(b, last);
            } else {
                b.put(sets);
            }
            return Arrays.copyOf(b.array(), b.position());
        }

        public static Plan parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            long h = VarInt.get(b);
            long seq = VarInt.get(b);
            int e = Buf.u8(b);
            if (e == ProtoCodes.PLAN_INICIO) {
                long first = VarInt.get(b);
                long expected = VarInt.get(b);
                int throttle = Buf.u8(b);
                List<Long> unrec = new ArrayList<>();
                for (Tlv t : Buf.tail(b)) {
                    if (t.tag() == Tlv.IRRECUPERABLES) {
                        ByteBuffer v = ByteBuffer.wrap(t.value());
                        for (long i = 0, n = VarInt.get(v); i < n; i++) {
                            unrec.add(v.getLong());
                        }
                    }
                }
                return start(h, seq, first, expected, throttle, unrec);
            }
            return e == ProtoCodes.PLAN_FIN ? end(h, seq, VarInt.get(b)) : cancelled(h, seq, Ranges.decode(b));
        }
    }
}
