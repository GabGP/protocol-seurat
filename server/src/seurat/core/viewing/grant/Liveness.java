package seurat.core.viewing.grant;

import java.util.function.Predicate;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.shared.proto.FatalProtocol;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgAudit;
import seurat.core.shared.proto.msg.MsgError;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.viewing.concession.Concessions;
import seurat.core.viewing.loans.CanvasOrders;
import seurat.core.viewing.loans.Delivery;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Session;
import seurat.core.viewing.session.Sessions;

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
        sessions.pruneExpired(now);
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
                grants.apply(canvas, Concessions.target(grants.policy.ceiling(canvas), true, canvas.meta().strata() - 1),
                        ProtoCodes.MOT_INACTIVIDAD, false);
            }
            replanIfStale(session, canvas);
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

    private void replanIfStale(Session session, Canvas canvas) {
        MsgGaze.Gaze gaze = canvas.gaze();
        boolean hidden = gaze != null && (gaze.flags() & MsgGaze.M_OCULTA) != 0;
        if (!canvas.retiring && !hidden && canvas.plan().stale(session.rung)) {
            grants.plans.replan(canvas, grants.sketch(canvas)); // spec 6.3, 8
        }
    }

    /** ADR-07 rule 5: a session whose rung rose plans its live MIRADA again at once, not at the next 1 s tick. */
    public void climbed(Session session) {
        for (Canvas canvas : session.canvases().values()) {
            synchronized (canvas) {
                try {
                    replanIfStale(session, canvas);
                } catch (RuntimeException ex) {
                    Log.warn(LogTags.LIVENESS, canvas.subject() + " replan failed: " + LogUnits.cause(ex));
                }
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
                        new MsgError.ProtocolError(fail.code, 1, fail.refType, fail.getMessage()).encode());
            } catch (RuntimeException ignored) {
            }
        }
        try {
            session.mapping().close();
        } catch (Exception ignored) {
        }
    }
}
