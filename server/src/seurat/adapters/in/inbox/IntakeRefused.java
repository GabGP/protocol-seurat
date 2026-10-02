package seurat.adapters.in.inbox;

/** Thrown when intake rejects an incoming master before storing or queueing it. */
public final class IntakeRefused extends Exception {

    /** Categorized reasons for refusing an intake request. */
    public enum Reason {
        /** Not an admitted master or zip name, or invalid path. */
        UNSUPPORTED,
        /** Already present in inbox or active in catalog. */
        EXISTS,
        /** Storage volume has insufficient free space. */
        NO_SPACE,
        /** Content length is missing, zero or negative. */
        BAD_LENGTH,
        /** Request attempted to access a non-local file. */
        NOT_LOCAL_FILE,
        /** Remote upstream download failed or timed out. */
        UPSTREAM
    }

    public final Reason reason;

    public IntakeRefused(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
