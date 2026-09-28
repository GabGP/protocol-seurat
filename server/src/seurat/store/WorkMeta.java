package seurat.store;

/** Work metadata: mirrors meta.json. */
public record WorkMeta(String id, String name, int width, int height, int side,
        int strata, int state, long edition, long ceilingStratum, long ceilingBands) {

    /** The same work in another state and edition. */
    public WorkMeta with(int nextState, long nextEdition) {
        return new WorkMeta(id, name, width, height, side, strata, nextState, nextEdition,
                ceilingStratum, ceilingBands);
    }
}
