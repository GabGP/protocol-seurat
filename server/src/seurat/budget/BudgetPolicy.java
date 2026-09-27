package seurat.budget;

import seurat.catalog.WorkRecord;
import seurat.concession.Concessions;
import seurat.store.WorkMeta;

/**
 * Spec 9.2 brush budget per (principal, work), in bands. Only the finest stratum a
 * role may reach is budgeted; every other (role, stratum) pair is free.
 */
public final class BudgetPolicy {
    private BudgetPolicy() {}

    /** capacity in bands, refill in bands/s, cap as a fraction of the stratum's brushes. */
    public record Rule(long capacity, double perS, double cap) {}

    /** Authenticated, stratum 0: 20 000 bands, 10/s, at most 15 % of E0. */
    public static final Rule AUTHENTICATED_S0 = new Rule(20_000, 10, 0.15);
    /** Anonymous, stratum 1: 1 000 bands, 1/s, at most 25 % of E1. */
    public static final Rule ANONYMOUS_S1 = new Rule(1_000, 1, 0.25);
    /** Global cap per (work, role) summed over all principals, per window (spec 9.2: 30 % in 24 h). */
    public static final double GLOBAL_CAP = 0.30;
    public static final long GLOBAL_WINDOW_MS = 24L * 60 * 60 * 1000;

    /** The sketch strata are never budgeted: on tiny works they reach s <= 1. */
    public static Rule rule(String role, int stratum, WorkMeta meta) {
        if (stratum >= Concessions.sketchMin(meta.strata() - 1)) {
            return null;
        }
        if (role.equals(WorkRecord.AUTHENTICATED) && stratum == 0) {
            return AUTHENTICATED_S0;
        }
        if (role.equals(WorkRecord.ANONYMOUS) && stratum == 1) {
            return ANONYMOUS_S1;
        }
        return null;
    }
}
