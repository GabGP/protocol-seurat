package seurat.session;

import seurat.catalog.WorkRecord;
import seurat.concession.Concessions;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgCatalog;
import seurat.proto.MsgError;
import seurat.proto.ProtoCodes;
import seurat.proto.Wire;

/** ABRIR (spec 3.3, 7.3): ABIERTA, then CONCESION and the sketch. RECIBIENDO is ERROR 5, not fatal. */
final class CanvasOpener {
    private CanvasOpener() {}

    static void open(Mapping mapping, EaselContext ctx, Session session, Frame f) {
        MsgCatalog.OpenWork request = Wire.parse(f.type(), () -> MsgCatalog.OpenWork.parse(f.payload()));
        WorkRecord work = ctx.catalog().get(request.id());
        if (work == null || work.meta.state() == ProtoCodes.ST_RETIRADA) {
            Log.warn(LogTags.SESSION, "s" + session.id() + " open failed work=" + request.id() + ": no such work");
            Easel.send(mapping, FrameType.ERROR, new MsgError.ProtocolError(
                    ProtoCodes.ERR_OBRA_INEXISTENTE, 0, FrameType.ABRIR, request.id()).encode());
            return;
        }
        int state = work.meta.state();
        if (work.store == null || state == ProtoCodes.ST_RECIBIENDO || state == ProtoCodes.ST_FALLIDA) {
            Log.warn(LogTags.SESSION, "s" + session.id() + " open failed work=" + request.id()
                    + ": not ready state=" + ProtoCodes.stateName(state));
            Easel.send(mapping, FrameType.ERROR, new MsgError.ProtocolError(
                    ProtoCodes.ERR_OBRA_NO_LISTA, 0, FrameType.ABRIR, request.id()).encode());
            return;
        }
        long handle = session.newHandle();
        long[] ceiling = work.ceiling(session.role());
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
            Easel.send(mapping, FrameType.ABIERTA, new MsgCatalog.WorkOpened(handle,
                    work.meta.width(), work.meta.height(), work.meta.strata(), work.meta.edition(),
                    (int) ceiling[0], (int) ceiling[1], paddedW >> top, paddedH >> top).encode());
            ctx.grants().open(session, canvas);
        }
    }
}
