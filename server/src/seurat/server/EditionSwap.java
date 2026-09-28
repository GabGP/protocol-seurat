package seurat.server;

import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.concession.GrantController;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.session.Canvas;
import seurat.session.Session;
import seurat.session.Sessions;

/** Edition swap (spec 7.1 [6], 7.3): every open canvas of the work moves to the new edition. */
final class EditionSwap {
    private final Catalog catalog;
    private final Sessions sessions;
    private final GrantController grants;

    EditionSwap(Catalog catalog, Sessions sessions, GrantController grants) {
        this.catalog = catalog;
        this.sessions = sessions;
        this.grants = grants;
    }

    /** False when the work is gone (nothing swapped). */
    boolean substitute(String id) {
        WorkRecord work = catalog.get(id);
        if (work == null) {
            return false;
        }
        Log.info(LogTags.INGEST, LogTags.work(id) + " edition swap ed=" + work.meta.edition());
        for (Session session : sessions.all()) {
            for (Canvas canvas : session.canvases().values()) {
                if (canvas.workId().equals(id) && canvas.meta().edition() != work.meta.edition()) {
                    grants.substitute(canvas, work);
                }
            }
        }
        return true;
    }
}
