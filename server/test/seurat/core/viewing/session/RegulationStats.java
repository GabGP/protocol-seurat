package seurat.core.viewing.session;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * What the ADR-07 gate compares, per load phase: bytes per viewer (Jain), queue dwell, core
 * completion, rung changes; and, after the load drops, how long until every viewer is back at rung 3.
 */
final class RegulationStats {
    private final long[] bounds;
    private final Map<Integer, long[]> bytesByViewer = new HashMap<>();
    private final List<List<Long>> dwell = new ArrayList<>();
    private final List<List<Long>> core = new ArrayList<>();
    private final long[] censored;
    private final long[] opened;
    private final long[] coreOpened;
    private long rungChanges;
    private long lastCutNs;
    private long lastConeCutNs;
    private long totalBytes;

    /** bounds: phase starts, then the end; the last phase is the one after the load drops. */
    RegulationStats(long... bounds) {
        this.bounds = bounds;
        for (int i = 0; i + 1 < bounds.length; i++) {
            dwell.add(new ArrayList<>());
            core.add(new ArrayList<>());
        }
        censored = new long[bounds.length - 1];
        opened = new long[bounds.length - 1];
        coreOpened = new long[bounds.length - 1];
    }

    private int phase(long now) {
        int p = 0;
        while (p + 2 < bounds.length && now >= bounds[p + 1]) {
            p++;
        }
        return p;
    }

    void opened(RegulationViewer v, RegulationViewer.Item item, long now) {
        int p = phase(now);
        bytesByViewer.computeIfAbsent(v.id, k -> new long[bounds.length - 1])[p] += item.bytes();
        dwell.get(p).add(now - item.readyNs());
        opened[p] += item.bytes();
        if (item.entry().pass() <= 2) {
            coreOpened[p] += item.bytes();
        }
        totalBytes += item.bytes();
    }

    void coreDone(RegulationViewer.Plan plan, long now) {
        core.get(phase(now)).add(now - plan.issuedNs);
    }

    void coreCensored(long now) {
        censored[phase(now)]++;
    }

    void rungChange(RegulationViewer v, long now) {
        rungChanges++;
    }

    void sample(List<RegulationViewer> active, long now) {
        if (active.stream().anyMatch(v -> v.rung < 3)) {
            lastCutNs = now;
        }
        if (active.stream().anyMatch(v -> v.cutRung < 3)) {
            lastConeCutNs = now;
        }
    }

    /** Jain's index over the bytes each viewer opened in phase p (viewers present all phase). */
    double jain(int p, List<RegulationViewer> viewers) {
        double sum = 0;
        double squares = 0;
        int n = 0;
        for (RegulationViewer v : viewers) {
            if (v.joinNs <= bounds[p] && v.leaveNs >= bounds[p + 1]) {
                double x = bytesByViewer.getOrDefault(v.id, new long[bounds.length])[p];
                sum += x;
                squares += x * x;
                n++;
            }
        }
        return squares == 0 ? 1 : sum * sum / (n * squares);
    }

    double utilization(int p, long capBytesPerS) {
        return opened[p] / (capBytesPerS * ((bounds[p + 1] - bounds[p]) / 1e9));
    }

    /** Share of the Painter's capacity spent on core entries (passes 1-2). */
    double coreUtilization(int p, long capBytesPerS) {
        return coreOpened[p] / (capBytesPerS * ((bounds[p + 1] - bounds[p]) / 1e9));
    }

    long p95DwellMs(int p) {
        return p95(dwell.get(p)) / RegulationSim.MS;
    }

    long p95CoreMs(int p) {
        return p95(core.get(p)) / RegulationSim.MS;
    }

    long coreDone(int p) {
        return core.get(p).size();
    }

    long censored(int p) {
        return censored[p];
    }

    /** Ms from the last load drop until every viewer stayed at rung 3 (rung) and was planned at it (cone). */
    long rungBackMs() {
        return backMs(lastCutNs);
    }

    long coneBackMs() {
        return backMs(lastConeCutNs);
    }

    /** The first tick after the last one that still saw a cut. */
    private long backMs(long lastNs) {
        long drop = bounds[bounds.length - 2];
        return lastNs < drop ? 0 : (lastNs + RegulationSim.TICK_NS - drop) / RegulationSim.MS;
    }

    double rungChangesPerViewerMinute(List<RegulationViewer> viewers) {
        double minutes = viewers.stream().mapToDouble(v -> (Math.min(v.leaveNs, bounds[bounds.length - 1]) - v.joinNs) / 60e9).sum();
        return rungChanges / minutes;
    }

    long totalBytes() {
        return totalBytes;
    }

    private static long p95(List<Long> xs) {
        if (xs.isEmpty()) {
            return 0;
        }
        List<Long> sorted = new ArrayList<>(xs);
        Collections.sort(sorted);
        return sorted.get((int) Math.min(sorted.size() - 1, Math.ceil(0.95 * sorted.size()) - 1));
    }
}
