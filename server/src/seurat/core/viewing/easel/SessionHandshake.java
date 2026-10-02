package seurat.core.viewing.easel;

import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.proto.FatalProtocol;
import seurat.core.shared.proto.Frame;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Wire;
import seurat.core.shared.proto.msg.MsgError;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.shared.proto.msg.MsgHello;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.core.shared.proto.msg.MsgWelcome;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Mapping;
import seurat.core.viewing.session.Session;
import seurat.core.viewing.session.Sessions;

/** SALUDO (spec 3.4.1): version, single-use token, caps subset, optional REANUDAR. No state before it. */
final class SessionHandshake {
    private final Mapping mapping;
    private final BlockingQueue<byte[]> entry;
    private final EaselContext ctx;
    private final long timeoutMs;

    SessionHandshake(Mapping mapping, BlockingQueue<byte[]> entry, EaselContext ctx) {
        this(mapping, entry, ctx, SeuratConstants.HANDSHAKE_S * Units.MS_PER_S);
    }

    SessionHandshake(Mapping mapping, BlockingQueue<byte[]> entry, EaselContext ctx, long timeoutMs) {
        this.mapping = mapping;
        this.entry = entry;
        this.ctx = ctx;
        this.timeoutMs = timeoutMs;
    }

    Session hello() throws Exception {
        byte[] raw = entry.poll(timeoutMs, TimeUnit.MILLISECONDS);
        if (raw == null) {
            throw new java.io.EOFException("no SALUDO within " + timeoutMs + " ms");
        }
        if (raw.length == 0) {
            throw new java.io.EOFException("control closed");
        }
        Frame f = Wire.parse(0, () -> Frame.decodeExact(raw));
        if (f.type() != FrameType.SALUDO) {
            throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, f.type(), "missing SALUDO");
        }
        MsgHello.Hello hello = Wire.parse(f.type(), () -> MsgHello.Hello.parse(f.payload()));
        if (hello.maxVersion() < 1 || hello.minVersion() > 1) {
            throw new FatalProtocol(ProtoCodes.ERR_VERSION, f.type(), "VERSION");
        }
        Sessions.Token token = ctx.sessions().consumeToken(HexFormat.of().formatHex(hello.token()));
        if (token == null) {
            Log.warn(LogTags.SESSION, "handshake rejected: token invalid or expired");
            throw new FatalProtocol(ProtoCodes.ERR_AUTENTICACION, f.type(), "token");
        }
        long offered = ProtoCodes.CAP_REANUDAR | (mapping.datagrams() ? ProtoCodes.CAP_DATAGRAMAS : 0);
        long caps = hello.caps() & offered;
        Session session = new Session(ctx.sessions().reserveId(), token.principal(),
                token.memMib(), caps, mapping, ctx.sessions().newTicket(), ctx.rateBytesPerS());
        ResumeAdopter.Result resumed = null;
        if (hello.resume() != null) {
            resumed = new ResumeAdopter(ctx).adopt(session, hello.resume());
            if (resumed == null) {
                Log.warn(LogTags.SESSION, "s" + session.id() + " resume rejected");
                mapping.send(FrameType.ERROR, new MsgError.ProtocolError(
                        ProtoCodes.ERR_REANUDACION, 0, FrameType.SALUDO, "REANUDAR").encode());
            }
        }
        ctx.sessions().add(session);
        List<Long> handles = resumed == null ? List.of() : resumed.handles();
        Log.info(LogTags.SESSION, "s" + session.id() + " established principal=" + token.principal()
                + " mem=" + token.memMib() + " MiB caps=0x" + Long.toHexString(caps));
        mapping.send(FrameType.BIENVENIDA, new MsgWelcome.Welcome(1, caps, session.id(),
                SeuratConstants.BRUSH_SIDE, SeuratConstants.LEASE_S, SeuratConstants.HEARTBEAT_S,
                SeuratConstants.MAX_IN_FLIGHT, ctx.sessionMax(), session.ticket(), handles).encode());
        for (long h : handles) {
            Canvas c = session.canvases().get(h);
            synchronized (c) {
                Concession con = c.concession();
                mapping.send(FrameType.CONCESION, new MsgGaze.ConcessionMessage(h, con.epoch(),
                        con.minStratum(), con.maxBands(), con.reason(), con.maxBrushes(), con.maxKiB(),
                        con.leaseS()).encode());
                for (MsgLoans.Scrape s : resumed.reissued().getOrDefault(h, List.of())) {
                    mapping.send(FrameType.RASPAR, s.encode());
                }
            }
            var work = ctx.catalog().get(c.workId());
            if (work != null && work.meta.edition() != c.meta().edition()) {
                ctx.grants().substitute(c, work); // went LISTA while disconnected (spec 7.3)
            }
        }
        return session;
    }
}
