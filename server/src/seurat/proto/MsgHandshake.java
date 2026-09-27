package seurat.proto;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import seurat.config.SeuratConstants;

/** SALUDO / BIENVENIDA / LATIDO / ECO / ERROR. Factory of records (ADIOS: MsgGoodbye). */
public final class MsgHandshake {
    private MsgHandshake() {}

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

    public record Heartbeat(long nonce) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(8);
            b.putLong(nonce);
            return b.array();
        }

        public static Heartbeat parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            Heartbeat h = new Heartbeat(b.getLong());
            Buf.tail(b);
            return h;
        }
    }

    public record ProtocolError(long code, int fail, long refType, String msg) {
        public byte[] encode() {
            ByteBuffer b = ByteBuffer.allocate(64 + msg.length() * 3);
            VarInt.put(b, code);
            Buf.u8(b, fail);
            VarInt.put(b, refType);
            Buf.viStr(b, msg);
            return Arrays.copyOf(b.array(), b.position());
        }

        public static ProtocolError parse(byte[] p) {
            ByteBuffer b = ByteBuffer.wrap(p);
            long c = VarInt.get(b);
            int f = Buf.u8(b);
            long r = VarInt.get(b);
            return new ProtocolError(c, f, r, Buf.viStr(b));
        }
    }
}
