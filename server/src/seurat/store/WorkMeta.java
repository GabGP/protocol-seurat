package seurat.store;

/** Work metadata: mirrors meta.json. */
public record WorkMeta(String id, String name, int width, int height, int side,
        int strata, int state, long edition, long ceilingStratum, long ceilingBands) {

    /** Ceilings a work starts with: none on stratum, two bands (spec 5.3). */
    private static final long DEFAULT_CEILING_STRATUM = 0;
    private static final long DEFAULT_CEILING_BANDS = 2;

    /** A work with the default ceilings. */
    public static WorkMeta of(String id, String name, int width, int height, int side,
            int strata, int state, long edition) {
        return new WorkMeta(id, name, width, height, side, strata, state, edition,
                DEFAULT_CEILING_STRATUM, DEFAULT_CEILING_BANDS);
    }

    /** The same work in another state and edition. */
    public WorkMeta with(int nextState, long nextEdition) {
        return new WorkMeta(id, name, width, height, side, strata, nextState, nextEdition,
                ceilingStratum, ceilingBands);
    }
}
