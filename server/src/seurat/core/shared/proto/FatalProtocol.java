package seurat.core.shared.proto;

/** Fatal wire error: carries ERROR code + offending type. */
public final class FatalProtocol extends RuntimeException {
    private static final long serialVersionUID = 1L;
    public final int code;
    public final long refType;

    public FatalProtocol(int code, long refType, String msg) {
        super(msg);
        this.code = code;
        this.refType = refType;
    }
}
