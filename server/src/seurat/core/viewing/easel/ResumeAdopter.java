package seurat.core.viewing.easel;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgHello;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Session;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.catalog.WorkRecord;

/**
 * SALUDO REANUDAR (spec 3.4.4, 8): the ticket matches, the principal is the same,
 * every claimed work is still there and every claim is inside the unexpired book.
 * Then the claimed canvases move to the new session, their books cut to the claim.
 */
final class ResumeAdopter {
    /** Adopted handles plus the RASPAR still owed to them (sent after BIENVENIDA). */
    record Result(List<Long> handles, Map<Long, List<MsgLoans.Scrape>> reissued) {}

    private final EaselContext ctx;

    ResumeAdopter(EaselContext ctx) {
        this.ctx = ctx;
    }

    /** null = rejected (ERROR 12, not fatal: the client empties the canvas and starts over). */
    Result adopt(Session session, MsgHello.ResumeRequest request) {
        Sessions.Resumable r = ctx.sessions().resumable(request.previousSession(), request.ticket(),
                session.principal());
        if (r == null || !valid(r.holder(), request.claims())) {
            return null;
        }
        Session holder = r.holder();
        Map<Long, Ranges> claims = new HashMap<>();
        request.claims().forEach(c -> claims.put(c.handle(), c.ranges()));
        List<Long> handles = new ArrayList<>();
        Map<Long, List<MsgLoans.Scrape>> reissued = new HashMap<>();
        long now = System.nanoTime();
        for (Canvas canvas : List.copyOf(holder.canvases().values())) {
            session.claimHandle(canvas.handle());
            synchronized (canvas) {
                Ranges claim = claims.get(canvas.handle());
                if (claim == null) {
                    ctx.grants().drop(canvas);
                    continue;
                }
                canvas.book().retainOnly(canvas.book().lastNumber(), claim);
                canvas.session(session);
                canvas.renewNs = now;
                canvas.auditNs = now;
                reissued.put(canvas.handle(), canvas.orders().reissue(
                        now + SeuratConstants.SCRAPE_TIMEOUT_S * Units.NANOS_PER_S));
                session.canvases().put(canvas.handle(), canvas);
                handles.add(canvas.handle());
            }
        }
        holder.canvases().clear();
        if (ctx.sessions().find(holder.id()) != null) {
            closeQuietly(holder); // a retry while the adopter still looked alive
        }
        ctx.sessions().adopted(request.previousSession(), r, session);
        Log.info(LogTags.SESSION, "s" + session.id() + " resumed canvases=" + handles.size());
        return new Result(handles, reissued);
    }

    private boolean valid(Session holder, List<MsgHello.Claim> claims) {
        long now = System.nanoTime();
        for (MsgHello.Claim claim : claims) {
            Canvas canvas = holder.canvases().get(claim.handle());
            if (canvas == null) {
                return false;
            }
            WorkRecord work = ctx.catalog().get(canvas.workId());
            if (work == null || work.meta.state() == ProtoCodes.ST_RETIRADA || canvas.retiring) {
                return false; // a withdrawn work is never resumed (spec 7.4)
            }
            synchronized (canvas) {
                canvas.book().pruneExpired(now);
                boolean[] inside = {true};
                claim.ranges().forEach(n -> inside[0] &= canvas.book().contains(n));
                if (!inside[0]) {
                    return false;
                }
            }
        }
        return true;
    }

    private static void closeQuietly(Session holder) {
        try {
            holder.mapping().close();
        } catch (Exception ignored) {
        }
    }
}
