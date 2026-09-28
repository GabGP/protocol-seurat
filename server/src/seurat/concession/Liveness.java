package seurat.concession;

import java.util.function.Predicate;
import seurat.config.SeuratConstants;
import seurat.config.Units;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;
import seurat.proto.FatalProtocol;
import seurat.proto.FrameType;
import seurat.plan.ConePlanner;
import seurat.proto.MsgAudit;
import seurat.proto.MsgGaze;
import seurat.proto.MsgHandshake;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.CanvasOrders;
import seurat.session.Delivery;
import seurat.session.Session;
import seurat.session.Sessions;

/** 1 s tick (spec 4.2, 8): scrape deadlines, expiry, inactivity floor, RENOVAR, AUDITAR, heartbeat. */
public final class Liveness {
    private final GrantController grants;
    private final Sessions sessions;

    public Liveness(GrantController grants, Sessions sessions) {
        this.grants = grants;
        this.sessions = sessions;
    }

    public void tick() {
        long now = System.nanoTime();
        for (Session session : sessions.all()) {
            if (now - session.lastEchoNs > SeuratConstants.HEARTBEAT_MISSES * SeuratConstants.HEARTBEAT_S * Units.NANOS_PER_S) {
                Log.warn(LogTags.LIVENESS, "s" + session.id() + " closing: no ECO for "
                        + SeuratConstants.HEARTBEAT_MISSES + " LATIDO");
                close(session, null);
                continue;
            }
            for (Canvas canvas : session.canvases().values()) {
                try {
                    tickCanvas(session, canvas, now);
                } catch (FatalProtocol fail) {
                    Log.warn(LogTags.LIVENESS, canvas.subject() + " closing: " + fail.getMessage());
                    close(session, fail);
                    break;
                } catch (RuntimeException ex) {
                    Log.info(LogTags.LIVENESS, "s" + session.id() + " closing: unreachable: " + LogUnits.cause(ex));
                    close(session, null);
                    break;
                }
            }
        }
    }

    private void tickCanvas(Session session, Canvas canvas, long now) {
        synchronized (canvas) {
            for (CanvasOrders.ScrapeOrder order : canvas.orders().pendingScrapes()) {
                if (order.deadlineNs() < now) {
                    throw new FatalProtocol(ProtoCodes.ERR_LIQUIDACION, FrameType.RASPADO, "LIQUIDACION_VENCIDA");
                }
            }
            canvas.book().pruneExpired(now);
            if (!canvas.floored && session.lastGazeNs > 0 && now - session.lastGazeNs > SeuratConstants.IDLE_S * Units.NANOS_PER_S) {
                canvas.floored = true;
                grants.apply(canvas, Concessions.target(grants.ceiling(canvas), true, canvas.meta().strata() - 1),
                        ProtoCodes.MOT_INACTIVIDAD, false);
            }
            MsgGaze.Gaze gaze = canvas.gaze();
            boolean hidden = gaze != null && (gaze.flags() & MsgGaze.M_OCULTA) != 0;
            if (!canvas.retiring && !hidden && canvas.plan().stale(ConePlanner.rung(session.share))) {
                grants.plans.replan(canvas, grants.sketch(canvas)); // spec 6.3, 8
            }
            if (now - canvas.renewNs > SeuratConstants.RENEW_S * Units.NANOS_PER_S) {
                canvas.renewNs = now;
                renew(session, canvas);
            }
            long done = canvas.book().settledThrough();
            if (canvas.orders().pendingScrapes().isEmpty() && done > 0
                    && (now - canvas.auditNs > SeuratConstants.AUDIT_S * Units.NANOS_PER_S
                    || done - canvas.auditBase > SeuratConstants.AUDIT_EVERY_N)) {
                canvas.auditNs = now;
                canvas.auditBase = done;
                long order = canvas.orders().next();
                canvas.orders().addAudit(new CanvasOrders.AuditOrder(order, done));
                GrantController.send(session, FrameType.AUDITAR, new MsgAudit.Audit(canvas.handle(), order, done).encode());
            }
        }
    }

    /** Passive revocation (spec 4.2.6): what is no longer permitted is never renewed. */
    private static void renew(Session session, Canvas canvas) {
        Predicate<Delivery> scraping = d -> false;
        for (CanvasOrders.ScrapeOrder o : canvas.orders().pendingScrapes()) {
            Predicate<Delivery> p = o.scrape();
            scraping = scraping.or(d -> d.number() <= o.through() && p.test(d));
        }
        Predicate<Delivery> pending = scraping;
        Ranges ranges = canvas.book().select(d -> !canvas.retiring
                && canvas.concession().allows(d.brush(), d.through()) && !pending.test(d));
        if (ranges.isEmpty()) {
            return;
        }
        long order = canvas.orders().next();
        canvas.orders().addRenewal(order, ranges);
        GrantController.send(session, FrameType.RENOVAR,
                new MsgAudit.Renew(canvas.handle(), order, SeuratConstants.LEASE_S, ranges).encode());
    }

    private void close(Session session, FatalProtocol fail) {
        if (fail != null) {
            try {
                GrantController.send(session, FrameType.ERROR,
                        new MsgHandshake.ProtocolError(fail.code, 1, fail.refType, fail.getMessage()).encode());
            } catch (RuntimeException ignored) {
            }
        }
        try {
            session.mapping().close();
        } catch (Exception ignored) {
        }
    }
}
