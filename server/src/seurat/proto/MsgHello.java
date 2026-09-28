package seurat.proto;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import seurat.config.SeuratConstants;

/** SALUDO: the client hello and its REANUDAR request. Factory of records. */
public final class MsgHello {
    private MsgHello() {}

    public record Claim(long handle, Ranges ranges) {}

    public record ResumeRequest(long previousSession, byte[] ticket, List<Claim> claims) {
        public byte[] encode() {
            int n = 8 + 32 + VarInt.encodedLength(claims.size());
            List<byte[]> rs = new ArrayList<>();
            for (Claim r : claims) {
                byte[] rb = r.ranges().encode();
                n += VarInt.encodedLength(r.handle()) + rb.length;
                rs.add(rb);
            }
            ByteBuffer b = ByteBuffer.allocate(n + 16);
            b.putLong(previousSession);
            b.put(ticket);
            VarInt.put(b, claims.size());
            for (int i = 0; i < claims.size(); i++) {
                VarInt.put(b, claims.get(i).handle());
                b.put(rs.get(i));
            }
            return Arrays.copyOf(b.array(), b.position());
        }
    }

    public record Hello(long minVersion, long maxVersion, long caps, long memMib,
            byte[] token, ResumeRequest resume) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(SeuratConstants.FRAME_MAX);
            VarInt.put(b, minVersion);
            VarInt.put(b, maxVersion);
            VarInt.put(b, caps);
            VarInt.put(b, memMib);
            VarInt.put(b, token.length);
            b.put(token);
            if (resume != null) {
                b.put(new Tlv(Tlv.REANUDAR, resume.encode()).encode());
            }
            return Arrays.copyOf(b.array(), b.position());
        }

        public static Hello parse(byte[] payload) {
            ByteBuffer b = ByteBuffer.wrap(payload);
            long v0 = VarInt.get(b);
            long v1 = VarInt.get(b);
            long caps = VarInt.get(b);
            long mem = VarInt.get(b);
            byte[] token = Buf.bytes(b, VarInt.get(b));
            ResumeRequest resumeRequest = null;
            for (Tlv t : Buf.tail(b)) {
                if (t.tag() == Tlv.REANUDAR) {
                    resumeRequest = parseResume(t.value());
                }
            }
            return new Hello(v0, v1, caps, mem, token, resumeRequest);
        }
    }

    static ResumeRequest parseResume(byte[] v) {
        ByteBuffer b = ByteBuffer.wrap(v);
        long session = b.getLong();
        byte[] ticket = new byte[SeuratConstants.TOKEN_BYTES];
        b.get(ticket);
        long n = VarInt.get(b);
        List<Claim> rs = new ArrayList<>();
        for (long i = 0; i < n; i++) {
            rs.add(new Claim(VarInt.get(b), Ranges.decode(b)));
        }
        if (b.hasRemaining()) {
            throw new IllegalArgumentException("REANUDAR: trailing bytes");
        }
        return new ResumeRequest(session, ticket, List.copyOf(rs));
    }
}
