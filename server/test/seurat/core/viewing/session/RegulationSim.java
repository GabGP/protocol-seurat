package seurat.core.viewing.session;

import java.util.ArrayList;
import java.util.List;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.viewing.plan.PlanEntry;

/**
 * The ADR-07 bench world, 1 ms steps: viewers that pan every 500 ms, one Painter that opens at most
 * CAP bytes per second in spec 6.2 order (aged class, pass, stride), the 1 s liveness replan, and a
 * regulation arm ticked every 250 ms. The arm sets each viewer's rung; the planner cuts to it.
 */
final class RegulationSim {
    static final long MS = 1_000_000L;
    static final long TICK_NS = 250 * MS;
    static final long GAZE_NS = 500 * MS;
    static final long LIVENESS_NS = 1000 * MS;
    private static final long AGING_NS = 500 * MS;

    /** A regulation algorithm under test. */
    interface Arm {
        String name();

        /** A plan was issued; full is the uncut (rung 3) cone of the same MIRADA. */
        void planned(RegulationViewer v, List<PlanEntry> full);

        /** dwellNs counts from "lista" (head of its queue, spec 6.3), sojournNs from PLAN INICIO. */
        void opened(RegulationViewer v, PlanEntry e, long bytes, long dwellNs, long sojournNs);

        /** After each Painter step: whether a ready entry is left unopened. */
        void backlog(boolean waiting, long nowNs);

        void tick(List<RegulationViewer> active, long nowNs);

        /** Whether a rung rise replans at once (at the tick) rather than at the 1 s liveness tick. */
        boolean replansOnRise();
    }

    final List<RegulationViewer> viewers;
    final RegulationStats stats;
    private final Arm arm;
    private final long perStep;
    private long credit;

    RegulationSim(Arm arm, List<RegulationViewer> viewers, long capBytesPerS, RegulationStats stats) {
        this.arm = arm;
        this.viewers = viewers;
        this.perStep = capBytesPerS / 1000;
        this.stats = stats;
    }

    void run(long endNs) {
        for (long now = 0; now < endNs; now += MS) {
            List<RegulationViewer> active = new ArrayList<>();
            for (RegulationViewer v : viewers) {
                if (v.active(now)) {
                    active.add(v);
                    long offset = v.id * 37 % 500 * MS; // viewers' MIRADA are staggered
                    if (now - v.joinNs >= offset && (now - v.joinNs - offset) % GAZE_NS == 0) {
                        if (v.plan != null) {
                            v.pan();
                        }
                        issue(v, now);
                    }
                } else if (now == v.leaveNs) {
                    v.queue.clear();
                }
            }
            step(now);
            if (now % TICK_NS == 0 && now > 0) {
                int[] before = active.stream().mapToInt(v -> v.rung).toArray();
                arm.tick(active, now);
                for (int i = 0; i < active.size(); i++) {
                    RegulationViewer v = active.get(i);
                    if (v.rung != before[i]) {
                        stats.rungChange(v, now);
                    }
                    if (arm.replansOnRise() && v.rung > v.cutRung) {
                        issue(v, now);
                    }
                }
                stats.sample(active, now);
            }
            if (now % LIVENESS_NS == 0 && now > 0) {
                for (RegulationViewer v : active) {
                    if (v.rung > v.cutRung) {
                        issue(v, now); // spec 6.3: load recovered past the rung the plan was cut to
                    }
                }
            }
        }
    }

    /** PLAN INICIO of the live gaze at the viewer's rung; replaces its queue (spec 4.1.3). */
    private void issue(RegulationViewer v, long now) {
        if (v.plan != null && v.plan.coreDoneNs < 0) {
            stats.coreCensored(now);
        }
        List<PlanEntry> cut = v.cone(v.rung);
        arm.planned(v, v.rung == 3 ? cut : v.cone(3));
        if (v.queue.isEmpty()) {
            // Stride scheduling: a viewer that becomes active starts at the current pass.
            viewers.stream().filter(o -> !o.queue.isEmpty()).mapToDouble(o -> o.stride).min()
                    .ifPresent(min -> v.stride = Math.max(v.stride, min));
        }
        v.queue.clear();
        v.cutRung = v.rung;
        v.plan = new RegulationViewer.Plan(now);
        for (PlanEntry e : cut) {
            v.queue.add(new RegulationViewer.Item(e, RegulationViewer.bytes(e), v.plan, now, now));
            if (e.pass() <= 2) {
                v.plan.coreLeft++;
            }
        }
        if (v.plan.coreLeft == 0) {
            v.plan.coreDoneNs = now;
        }
    }

    /** One Painter millisecond: open the best ready heads while there is credit. */
    private void step(long now) {
        credit += perStep;
        for (;;) {
            RegulationViewer best = null;
            for (RegulationViewer v : viewers) {
                if (!v.queue.isEmpty() && (best == null || better(v, best, now))) {
                    best = v;
                }
            }
            if (best == null) {
                credit = Math.min(credit, perStep); // an idle Painter banks no credit
                arm.backlog(false, now);
                return;
            }
            if (credit <= 0) {
                arm.backlog(true, now);
                return;
            }
            open(best, now);
        }
    }

    private void open(RegulationViewer v, long now) {
        RegulationViewer.Item item = v.queue.pollFirst();
        PlanEntry e = item.entry();
        v.book.log(e.brush(), e.from(), e.through(), (int) item.bytes(), 1);
        credit -= item.bytes();
        v.stride += item.bytes();
        arm.opened(v, e, item.bytes(), now - item.readyNs(), now - item.queuedNs());
        stats.opened(v, item, now);
        if (e.pass() <= 2 && --item.plan().coreLeft == 0) {
            item.plan().coreDoneNs = now;
            stats.coreDone(item.plan(), now);
        }
        RegulationViewer.Item next = v.queue.pollFirst();
        if (next != null) {
            v.queue.addFirst(new RegulationViewer.Item(next.entry(), next.bytes(), next.plan(), next.queuedNs(), now));
        }
    }

    private static boolean better(RegulationViewer a, RegulationViewer b, long now) {
        RegulationViewer.Item x = a.queue.peekFirst();
        RegulationViewer.Item y = b.queue.peekFirst();
        int cx = effectiveClass(x, now);
        int cy = effectiveClass(y, now);
        if (cx != cy) {
            return cx > cy;
        }
        if (x.entry().pass() != y.entry().pass()) {
            return x.entry().pass() < y.entry().pass();
        }
        return a.stride < b.stride;
    }

    private static int effectiveClass(RegulationViewer.Item item, long now) {
        return (int) Math.min(SeuratConstants.SEED_STRATUM, item.entry().brush().stratum() + (now - item.queuedNs()) / AGING_NS);
    }
}
