package seurat.core.works.store;

/** Work metadata: mirrors meta.json. */
public record WorkMeta(String id, String name, int width, int height, int side,
        int strata, int state, long edition) {

    /** The same work in another state and edition. */
    public WorkMeta with(int nextState, long nextEdition) {
        return new WorkMeta(id, name, width, height, side, strata, nextState, nextEdition);
    }

    /** The same work under another display name. */
    public WorkMeta named(String nextName) {
        return new WorkMeta(id, nextName, width, height, side, strata, state, edition);
    }
}
