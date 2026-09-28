package seurat.budget;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import seurat.codec.BrushId;
import seurat.observe.Log;
import seurat.plan.PlanEntry;
import seurat.store.WorkMeta;

/**
 * PresupuestoDePincel (spec 9.2, 10): per (principal, work) token buckets in bands
 * for the budgeted strata, a persistent coverage map (4 bits per E0/E1 brush) and a
 * global cap per (work, role). Re-delivering covered bands is free.
 */
public final class BrushBudget {
    private final Path base;
    private final Map<String, TokenBucket> buckets = new ConcurrentHashMap<>();
    private final Map<String, Coverage> coverages = new ConcurrentHashMap<>();
    private final GlobalCoverage global = new GlobalCoverage();

    public BrushBudget(Path base) throws IOException {
        this.base = base;
        Files.createDirectories(base);
    }

    /**
     * Painter check (d), at open: charges the new bands or refuses (the caller serves s + 1).
     * `finest` is the role's finest stratum on the work (the concession's estrato_min).
     */
    public synchronized boolean consume(String principal, String work, BrushId p, int from,
            int through, String role, int finest, WorkMeta meta) {
        BudgetPolicy.Rule rule = BudgetPolicy.rule(role, p.stratum(), finest, meta);
        if (rule == null) {
            return true;
        }
        try {
            Coverage seen = coverage(principal, work, meta);
            int fresh = Math.max(0, through - Math.max(from, seen.get(p)));
            if (fresh == 0) {
                return true;
            }
            String key = GlobalCoverage.key(work, role, p.stratum());
            if (seen.fraction(p.stratum()) >= rule.cap()
                    || global.fraction(key, seen.totalBrushes(p.stratum())) >= BudgetPolicy.GLOBAL_CAP
                    || !bucket(principal, work, p.stratum(), rule).take(fresh)) {
                return false;
            }
            seen.set(p, through);
            global.mark(key, p, seen.width(p.stratum()));
            return true;
        } catch (IOException ex) {
            Log.warn("budget", "coverage unavailable for " + work + ": " + ex);
            return false;
        }
    }

    /** Plan time, nothing charged: would any entry be cut? Sets PLAN INICIO's PRESUPUESTO bit. */
    public synchronized boolean wouldCut(String principal, String work, String role, int finest,
            WorkMeta meta, List<PlanEntry> entries) {
        Map<Integer, Long> demand = new HashMap<>();
        try {
            for (PlanEntry e : entries) {
                BudgetPolicy.Rule rule = BudgetPolicy.rule(role, e.brush().stratum(), finest, meta);
                if (rule == null) {
                    continue;
                }
                Coverage seen = coverage(principal, work, meta);
                int fresh = Math.max(0, e.through() - Math.max(e.from(), seen.get(e.brush())));
                if (fresh > 0 && seen.fraction(e.brush().stratum()) >= rule.cap()) {
                    return true;
                }
                long need = demand.merge(e.brush().stratum(), (long) fresh, Long::sum);
                if (need > bucket(principal, work, e.brush().stratum(), rule).balance()) {
                    return true;
                }
            }
            return false;
        } catch (IOException ex) {
            return true;
        }
    }

    private TokenBucket bucket(String principal, String work, int stratum, BudgetPolicy.Rule rule) {
        return buckets.computeIfAbsent(principal + "\0" + work + "\0" + stratum,
                k -> new TokenBucket(rule.capacity(), rule.perS()));
    }

    private Coverage coverage(String principal, String work, WorkMeta meta) throws IOException {
        String k = principal + "\0" + work;
        Coverage c = coverages.get(k);
        if (c == null) {
            Path file = base.resolve(principal).resolve(work + ".bits");
            Files.createDirectories(file.getParent()); // work ids may nest: img-peq/name
            c = new Coverage(file, meta);
            coverages.put(k, c);
        }
        return c;
    }
}
