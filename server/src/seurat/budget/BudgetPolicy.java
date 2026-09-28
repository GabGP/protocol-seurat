package seurat.budget;

import seurat.catalog.WorkRecord;
import seurat.concession.Concessions;
import seurat.config.Units;
import seurat.store.WorkMeta;

/**
 * Spec 9.2 brush budget per (principal, work), in bands. Only the finest stratum the role
 * may reach on the work (its concession's estrato_min, when that is 0 or 1) is budgeted;
 * every other (role, stratum) pair is free, and the privileged role is never budgeted.
 */
public final class BudgetPolicy {
    private BudgetPolicy() {}

    /** capacity in bands, refill in bands/s, cap as a fraction of the stratum's brushes. */
    public record Rule(long capacity, double perS, double cap) {}

    /** Authenticated (spec default: at stratum 0): 20 000 bands, 10/s, at most 15 % of the stratum. */
    public static final Rule AUTHENTICATED = new Rule(20_000, 10, 0.15);
    /** Anonymous (spec default: at stratum 1): 1 000 bands, 1/s, at most 25 % of the stratum. */
    public static final Rule ANONYMOUS = new Rule(1_000, 1, 0.25);
    /** Global cap per (work, role) summed over all principals, per window (spec 9.2: 30 % in 24 h). */
    public static final double GLOBAL_CAP = 0.30;
    public static final long GLOBAL_WINDOW_MS = 24L * 60 * 60 * Units.MS_PER_S;

    /** The sketch strata are never budgeted: on tiny works they reach s <= 1. */
    public static Rule rule(String role, int stratum, int finest, WorkMeta meta) {
        if (stratum != finest || stratum >= Concessions.sketchMin(meta.strata() - 1)) {
            return null;
        }
        return switch (role) {
            case WorkRecord.PRIVILEGED -> null;
            case WorkRecord.AUTHENTICATED -> AUTHENTICATED;
            default -> ANONYMOUS; // an unknown role is held to the anonymous ceiling (WorkRecord)
        };
    }
}
