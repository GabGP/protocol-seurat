package seurat.net;

import java.io.IOException;
import java.io.OutputStream;
import seurat.session.Canvas;
import seurat.session.Delivery;

/** One semantic, two mappings (spec 3.1); this server serves the WebSocket one, complete on its own. */
public interface Mapping {
    /** Opens one delivery flow (WT: server uni stream; WS: channel-1 message). */
    OutputStream openDelivery(Canvas canvas, Delivery e) throws IOException;

    /** Queues one control frame, in order, without blocking the caller (WT: client bidi; WS: channel 0). */
    void sendControl(byte[] frame) throws IOException;

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
