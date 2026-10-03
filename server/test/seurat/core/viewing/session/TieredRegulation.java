package seurat.core.viewing.session;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import seurat.adapters.in.net.socket.RecordingMapping;
import seurat.core.shared.config.Units;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.viewing.plan.PlanEntry;

/**
 * The ADR-07 arm: the server's own Regulator, CapacityMeter and TierDemand, fed the way the
 * Painter (backlog, opened) and PlanIssuer.cone (the uncut cone's demand) feed them.
 */
final class TieredRegulation implements RegulationSim.Arm {
    private final Regulator regulator = new Regulator();
    private final Map<RegulationViewer, Session> sessions = new HashMap<>();
    private final Map<RegulationViewer, TierDemand> demand = new HashMap<>();

    private Session session(RegulationViewer v) {
        return sessions.computeIfAbsent(v, k -> new Session(k.id, "v", 128, ProtoCodes.CAP_REGULACION,
                new RecordingMapping(), new byte[32]));
    }

    private TierDemand demand(RegulationViewer v) {
        return demand.computeIfAbsent(v, k -> new TierDemand());
    }

    @Override
    public String name() {
        return "tiered (ADR-07)";
    }

    @Override
    public void planned(RegulationViewer v, List<PlanEntry> full, boolean newGaze) {
        demand(v).plan(TierDemand.estimate(full, regulator.meter()), newGaze);
    }

    @Override
    public void opened(RegulationViewer v, PlanEntry e, long bytes, long dwellNs, long sojournNs) {
        regulator.meter().opened(e.brush().stratum(), e.through() - e.from(), bytes);
        demand(v).opened(e.pass(), bytes);
    }

    @Override
    public void backlog(boolean waiting, long nowNs) {
        regulator.meter().backlog(waiting, nowNs);
    }

    @Override
    public void tick(List<RegulationViewer> active, long nowNs) {
        Map<Session, long[]> wanted = new HashMap<>();
        for (RegulationViewer v : active) {
            long[] sum = new long[Allotment.TIERS];
            demand(v).tick((double) RegulationSim.TICK_NS / Units.NANOS_PER_S);
            demand(v).addTo(sum);
            wanted.put(session(v), sum);
            session(v).stride = v.stride;
        }
        regulator.tick(wanted, nowNs);
        active.forEach(v -> v.rung = session(v).rung);
    }

    /** REGULACION frames sent to every viewer, in bytes. */
    @Override
    public long controlBytes() {
        long sum = 0;
        for (Session s : sessions.values()) {
            for (byte[] frame : ((RecordingMapping) s.mapping()).control) {
                sum += frame.length;
            }
        }
        return sum;
    }

    @Override
    public boolean replansOnRise() {
        return true;
    }
}
