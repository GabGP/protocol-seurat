package seurat.core.viewing.easel;

import java.nio.ByteBuffer;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.proto.Buf;
import seurat.core.shared.proto.Frame;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.VarInt;
import seurat.core.shared.proto.Wire;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.shared.proto.msg.MsgHeartbeat;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Mapping;
import seurat.core.viewing.session.Session;

/** Session-side frames of an Easel: MIRADA, ABRIR, CERRAR, CATALOGO and ECO. Loan frames are in {@link LoanHandlers}. */
final class CanvasService {
    private final Mapping mapping;
    private final EaselContext ctx;

    CanvasService(Mapping mapping, EaselContext ctx) {
        this.mapping = mapping;
        this.ctx = ctx;
    }

    void gaze(Session session, Frame f) {
        MsgGaze.Gaze gaze = Wire.parse(f.type(), () -> MsgGaze.Gaze.parse(f.payload()));
        session.lastGazeNs = System.nanoTime();
        Canvas canvas = HandleLookup.find(mapping, session, gaze.handle(), f.type());
        if (canvas != null) {
            ctx.gazes().offer(session, canvas, gaze);
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
            HandleLookup.find(mapping, session, handle, f.type());
            return;
        }
        ctx.grants().drop(closed);
        Log.info(LogTags.SESSION, "s" + session.id() + "/c" + handle + " closed");
    }

    void echo(Session session, Frame f) {
        var echo = Wire.parse(f.type(), () -> MsgHeartbeat.Heartbeat.parse(f.payload()));
        long now = System.nanoTime();
        session.lastEchoNs = now;
        session.roundTrip.sample(echo.nonce(), now);
    }

    void sendCatalog(Session session, Frame f) {
        Wire.parse(f.type(), () -> Buf.tail(ByteBuffer.wrap(f.payload())));
        for (var message : ctx.catalog().listing()) {
            mapping.send(FrameType.OBRA, message.encode());
        }
    }
}
