package seurat.core.shared.proto;

import java.nio.BufferUnderflowException;
import java.util.function.Supplier;

/** Parsing a C->S payload: anything malformed is fatal ERROR 1 (spec 8, "trama C->S invalida"). */
public final class Wire {
    private Wire() {}

    public static <T> T parse(long type, Supplier<T> parser) {
        try {
            return parser.get();
        } catch (BufferUnderflowException | IllegalArgumentException | IndexOutOfBoundsException ex) {
            throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, type, "malformed: " + ex.getMessage());
        }
    }
}
