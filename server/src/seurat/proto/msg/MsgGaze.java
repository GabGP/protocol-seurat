package seurat.proto.msg;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.proto.Buf;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.proto.VarInt;

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
            long expectedCount, int throttle, long last, Ranges cancelled) {
        public static Plan start(long h, long seq, long first, long expectedCount, int flags) {
            return new Plan(h, seq, ProtoCodes.PLAN_INICIO, first, expectedCount, flags, 0, null);
        }

        public static Plan end(long h, long seq, long last) {
            return new Plan(h, seq, ProtoCodes.PLAN_FIN, 0, 0, 0, last, null);
        }

        public static Plan cancelled(long h, long seq, Ranges r) {
            return new Plan(h, seq, ProtoCodes.PLAN_CANCELADAS, 0, 0, 0, 0, r);
        }

        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(64);
            VarInt.put(b, handle);
            VarInt.put(b, gazeSeq);
            Buf.u8(b, event);
            if (event == ProtoCodes.PLAN_INICIO) {
                VarInt.put(b, first);
                VarInt.put(b, expectedCount);
                Buf.u8(b, throttle);
            } else if (event == ProtoCodes.PLAN_FIN) {
                VarInt.put(b, last);
            } else {
                b.put(cancelled.encode());
            }
            return Arrays.copyOf(b.array(), b.position());
        }

        public static Plan parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            long h = VarInt.get(b);
            long stratum = VarInt.get(b);
            int e = Buf.u8(b);
            if (e == ProtoCodes.PLAN_INICIO) {
                return start(h, stratum, VarInt.get(b), VarInt.get(b), Buf.u8(b));
            }
            if (e == ProtoCodes.PLAN_FIN) {
                return end(h, stratum, VarInt.get(b));
            }
            return cancelled(h, stratum, Ranges.decode(b));
        }
    }
}
