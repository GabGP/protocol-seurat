package seurat.session;

import java.nio.ByteBuffer;
import seurat.config.SeuratConstants;
import seurat.config.Units;
import seurat.net.Mapping;
import seurat.observe.AuditLog;
import seurat.observe.Log;
import seurat.proto.Buf;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgAudit;
import seurat.proto.MsgGaze;
import seurat.proto.MsgHandshake;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.VarInt;
import seurat.proto.Wire;

/** Per-frame handlers of an Easel. An unknown handle is ERROR 6 (not fatal) and the frame is skipped. */
final class CanvasService {
    private final Mapping mapping;
    private final EaselContext ctx;

    CanvasService(Mapping mapping, EaselContext ctx) {
        this.mapping = mapping;
        this.ctx = ctx;
    }

    private Canvas canvas(Session session, long handle, long type) {
        Canvas canvas = session.canvases().get(handle);
        if (canvas == null) {
            Log.warn("session", "s" + session.id() + " invalid handle=" + handle);
            Easel.send(mapping, FrameType.ERROR, new MsgHandshake.ProtocolError(
                    ProtoCodes.ERR_HANDLE, 0, type, "handle " + handle).encode());
        }
        return canvas;
    }

    void gaze(Session session, Frame f) {
        MsgGaze.Gaze gaze = Wire.parse(f.type(), () -> MsgGaze.Gaze.parse(f.payload()));
        session.lastGazeNs = System.nanoTime();
        Canvas canvas = canvas(session, gaze.handle(), f.type());
        if (canvas != null) {
            ctx.gazes().offer(session, canvas, gaze);
        }
    }

    void receipt(Session session, Frame f) {
        MsgLoans.Receipt receipt = Wire.parse(f.type(), () -> MsgLoans.Receipt.parse(f.payload()));
        Canvas canvas = canvas(session, receipt.handle(), f.type());
        if (canvas == null) {
            return;
        }
        synchronized (canvas) {
            long now = System.nanoTime();
            long leaseNs = SeuratConstants.LEASE_S * Units.NANOS_PER_S;
            long skewNs = session.roundTrip.deltaNs();
            canvas.book().acknowledge(receipt.completed(), now, leaseNs, skewNs);
            canvas.book().settle(receipt.completed());
            for (var ranges : canvas.orders().takeRenewalsThrough(receipt.renewThrough())) {
                canvas.book().acknowledge(ranges, now, leaseNs, skewNs); // vence_srv from renov_hasta
            }
            canvas.free = receipt.free();
            session.queue(receipt.queueMs());
        }
        ctx.sessions().settled(session);
        ctx.grants().credit(canvas);
    }

    void release(Session session, Frame f) {
        MsgLoans.Release release = Wire.parse(f.type(), () -> MsgLoans.Release.parse(f.payload()));
        Canvas canvas = canvas(session, release.handle(), f.type());
        if (canvas == null) {
            return;
        }
        synchronized (canvas) {
            if (release.reason() == ProtoCodes.SOLTAR_DECODIFICACION || release.reason() == ProtoCodes.SOLTAR_CRC) {
                release.ranges().forEach(n -> {
                    Delivery d = canvas.book().get(n);
                    if (d == null) {
                        return;
                    }
                    if (canvas.retryOnce(d.brush())) {
                        ctx.grants().resend(canvas, d); // spec 5.3: resent once, then unusable
                    } else if (release.reason() == ProtoCodes.SOLTAR_CRC) {
                        AuditLog.alert("s" + session.id() + "/c" + canvas.handle() + " CRC failed twice on "
                                + d.brush() + ": unusable in this session");
                    }
                });
            }
            canvas.book().release(release.ranges());
        }
        ctx.grants().credit(canvas);
    }

    void scraped(Session session, Frame f) {
        MsgLoans.Scraped scraped = Wire.parse(f.type(), () -> MsgLoans.Scraped.parse(f.payload()));
        Canvas canvas = canvas(session, scraped.handle(), f.type());
        if (canvas != null) {
            ctx.grants().confirm(canvas, scraped);
            ctx.grants().credit(canvas);
        }
    }

    void inventory(Session session, Frame f) {
        MsgAudit.Inventory inventory = Wire.parse(f.type(), () -> MsgAudit.Inventory.parse(f.payload()));
        Canvas canvas = canvas(session, inventory.handle(), f.type());
        if (canvas != null) {
            ctx.grants().audit(canvas, inventory);
        }
    }

    void open(Session session, Frame f) {
        CanvasOpener.open(mapping, ctx, session, f);
    }

    /** CERRAR: the client released everything of that canvas (spec 3.3). */
    void closeCanvas(Session session, Frame f) {
        long handle = Wire.parse(f.type(), () -> {
            ByteBuffer b = ByteBuffer.wrap(f.payload());
            long h = VarInt.get(b);
            Buf.tail(b);
            return h;
        });
        Canvas closed = session.canvases().remove(handle);
        if (closed == null) {
            canvas(session, handle, f.type());
            return;
        }
        ctx.grants().drop(closed);
        Log.info("session", "s" + session.id() + "/c" + handle + " closed");
    }

    void echo(Session session, Frame f) {
        var echo = Wire.parse(f.type(), () -> MsgHandshake.Heartbeat.parse(f.payload()));
        long now = System.nanoTime();
        session.lastEchoNs = now;
        session.roundTrip.sample(echo.nonce(), now);
    }

    void sendCatalog(Session session, Frame f) {
        Wire.parse(f.type(), () -> Buf.tail(ByteBuffer.wrap(f.payload())));
        for (var message : ctx.catalog().listing()) {
            Easel.send(mapping, FrameType.OBRA, message.encode());
        }
    }
}
