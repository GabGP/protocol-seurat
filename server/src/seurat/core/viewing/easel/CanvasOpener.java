package seurat.core.viewing.easel;

import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.proto.Frame;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Wire;
import seurat.core.shared.proto.msg.MsgCatalog;
import seurat.core.shared.proto.msg.MsgError;
import seurat.core.viewing.concession.Concessions;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Mapping;
import seurat.core.viewing.session.Session;
import seurat.core.works.catalog.WorkRecord;

/** ABRIR (spec 3.3, 7.3): ABIERTA, then CONCESION and the sketch. RECIBIENDO is ERROR 5, not fatal. */
final class CanvasOpener {
    private CanvasOpener() {}

    static void open(Mapping mapping, EaselContext ctx, Session session, Frame f) {
        MsgCatalog.OpenWork request = Wire.parse(f.type(), () -> MsgCatalog.OpenWork.parse(f.payload()));
        WorkRecord work = ctx.catalog().get(request.id());
        if (work == null || work.meta.state() == ProtoCodes.ST_RETIRADA) {
            Log.warn(LogTags.SESSION, "s" + session.id() + " open failed work=" + request.id() + ": no such work");
            mapping.send(FrameType.ERROR, new MsgError.ProtocolError(
                    ProtoCodes.ERR_OBRA_INEXISTENTE, 0, FrameType.ABRIR, request.id()).encode());
            return;
        }
        int state = work.meta.state();
        if (work.store == null || state == ProtoCodes.ST_RECIBIENDO || state == ProtoCodes.ST_FALLIDA) {
            Log.warn(LogTags.SESSION, "s" + session.id() + " open failed work=" + request.id()
                    + ": not ready state=" + ProtoCodes.stateName(state));
            mapping.send(FrameType.ERROR, new MsgError.ProtocolError(
                    ProtoCodes.ERR_OBRA_NO_LISTA, 0, FrameType.ABRIR, request.id()).encode());
            return;
        }
        long handle = session.newHandle();
        int top = work.meta.strata() - 1;
        Canvas canvas = new Canvas(handle, request.id(), work.store, work.meta,
                Concessions.initial(session.memMib(), ctx.sessionMax(), top));
        canvas.session(session);
        canvas.renewNs = System.nanoTime();
        canvas.auditNs = System.nanoTime();
        long paddedW = ((long) work.meta.width() + (1L << top) - 1) >> top << top;
        long paddedH = ((long) work.meta.height() + (1L << top) - 1) >> top << top;
        Log.info(LogTags.SESSION, "s" + session.id() + "/c" + handle + " opened work=" + request.id()
                + " size=" + work.meta.width() + "x" + work.meta.height() + " strata="
                + work.meta.strata() + " ed=" + work.meta.edition());
        synchronized (canvas) {
            session.canvases().put(handle, canvas);
            mapping.send(FrameType.ABIERTA, new MsgCatalog.WorkOpened(handle,
                    work.meta.width(), work.meta.height(), work.meta.strata(), work.meta.edition(),
                    paddedW >> top, paddedH >> top).encode());
            ctx.grants().open(session, canvas);
        }
    }
}
