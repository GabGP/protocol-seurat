package seurat.core.shared.proto.msg;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.core.shared.proto.Buf;
import seurat.core.shared.proto.VarInt;

/** CATALOGO / OBRA / ABRIR / ABIERTA / CERRAR. */
public final class MsgCatalog {
    private MsgCatalog() {}

    public record WorkMessage(int event, int state, int progress, long edition,
            long width, long height, int strata, String id, String name) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(128 + id.length() + name.length() * 3);
            Buf.u8(b, event);
            Buf.u8(b, state);
            Buf.u8(b, progress);
            VarInt.put(b, edition);
            VarInt.put(b, width);
            VarInt.put(b, height);
            Buf.u8(b, strata);
            Buf.viStr(b, id);
            Buf.viStr(b, name);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static WorkMessage parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            int ev = Buf.u8(b);
            int st = Buf.u8(b);
            int pr = Buf.u8(b);
            long ed = VarInt.get(b);
            long an = VarInt.get(b);
            long al = VarInt.get(b);
            int es = Buf.u8(b);
            return new WorkMessage(ev, st, pr, ed, an, al, es, Buf.viStr(b), Buf.viStr(b));
        }
    }

    public record OpenWork(String id) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(16 + id.length() * 3);
            Buf.viStr(b, id);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static OpenWork parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            OpenWork w = new OpenWork(Buf.viStr(b));
            Buf.tail(b);
            return w;
        }
    }

    public record WorkOpened(long handle, long width, long height, int strata, long edition,
            int ceilingStratum, int ceilingBands, long seedWidth, long seedHeight) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(64);
            VarInt.put(b, handle);
            VarInt.put(b, width);
            VarInt.put(b, height);
            Buf.u8(b, strata);
            VarInt.put(b, edition);
            Buf.u8(b, ceilingStratum);
            Buf.u8(b, ceilingBands);
            VarInt.put(b, seedWidth);
            VarInt.put(b, seedHeight);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static WorkOpened parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            long h = VarInt.get(b);
            long an = VarInt.get(b);
            long al = VarInt.get(b);
            int es = Buf.u8(b);
            long ed = VarInt.get(b);
            int te = Buf.u8(b);
            int tb = Buf.u8(b);
            return new WorkOpened(h, an, al, es, ed, te, tb, VarInt.get(b), VarInt.get(b));
        }
    }
}
