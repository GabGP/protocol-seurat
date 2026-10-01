package seurat.core.viewing.session;

import java.io.IOException;
import java.io.OutputStream;
import seurat.core.shared.proto.Frame;

/** One semantic, two mappings (spec 3.1); this server serves the WebSocket one, complete on its own. */
public interface Mapping {
    /** Opens one delivery flow (WT: server uni stream; WS: channel-1 message). */
    OutputStream openDelivery(long delivery) throws IOException;

    /** Queues one control frame, in order, without blocking the caller (WT: client bidi; WS: channel 0). */
    void sendControl(byte[] frame) throws IOException;

    /** Encodes one control frame and queues it; a failed send is unchecked, for callers under a lock. */
    default void send(long type, byte[] payload) {
        try {
            sendControl(new Frame(type, payload).encode());
        } catch (Exception ex) {
            throw new RuntimeException(ex);
        }
    }

    /** Cancels a delivery (WT: RESET_STREAM; WS: only while it has not started). */
    void cancel(long delivery);

    /** Whether MIRADA may travel as datagrams (caps DATAGRAMAS); never on WS. */
    default boolean datagrams() {
        return false;
    }

    /** Fatal protocol error: close with the mapping's protocol-error code (WS 1002). */
    void fail();

    void close() throws IOException;
}
