package seurat.session;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import seurat.catalog.WorkRecord;
import seurat.config.SeuratConstants;
import seurat.config.Units;
import seurat.observe.Log;
import seurat.proto.MsgHandshake;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;

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
    Result adopt(Session session, MsgHandshake.ResumeRequest request) {
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
        Log.info("session", "s" + session.id() + " resumed canvases=" + handles.size());
        return new Result(handles, reissued);
    }

    private boolean valid(Session holder, List<MsgHandshake.Claim> claims) {
        long now = System.nanoTime();
        for (MsgHandshake.Claim claim : claims) {
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
