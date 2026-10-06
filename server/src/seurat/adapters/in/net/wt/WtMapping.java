package seurat.adapters.in.net.wt;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import seurat.adapters.in.net.h3.H3Settings;
import seurat.adapters.in.net.h3.H3Wire;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.shared.proto.Datagrams;
import seurat.core.shared.proto.Frame;
import seurat.core.viewing.session.Mapping;
import tech.kwik.core.QuicConnection;
import tech.kwik.core.QuicStream;

/** WebTransport mapping (spec 5.1): control on the client's first bidirectional stream, a stream per delivery, MIRADA in datagrams. */
public final class WtMapping implements Mapping {
    private final QuicConnection connection;
    private final long sessionId;
    private final BlockingQueue<byte[]> control = new ArrayBlockingQueue<>(SeuratConstants.INPUT_QUEUE_FRAMES);
    private final WtDeliveries deliveries;
    private final AtomicBoolean connectionClosed = new AtomicBoolean();
    private volatile WtOutbound outbound;
    private volatile long closeCode = H3Settings.H3_NO_ERROR;
    private volatile String closeReason = "bye";

    WtMapping(QuicConnection connection, long sessionId) {
        this.connection = Objects.requireNonNull(connection);
        this.sessionId = sessionId;
        this.deliveries = new WtDeliveries(connection, sessionId);
    }

    public BlockingQueue<byte[]> control() { return control; }
    long sessionId() { return sessionId; }
    boolean attached() { return outbound != null; }

    /** The client's control stream arrived: start its reader and its writer. */
    void attach(QuicStream stream) {
        this.outbound = new WtOutbound(stream.getOutputStream(), this::closeConnection);
        Thread.ofVirtual().start(this.outbound);
        Thread.ofVirtual().start(() -> readControl(stream.getInputStream()));
    }

    private void readControl(InputStream in) {
        try {
            for (;;) {
                long type = H3Wire.readVarint(in);
                long length = H3Wire.readVarint(in);
                if (length > SeuratConstants.FRAME_MAX) {
                    control.put(Frame.malformed());
                    break;
                }
                byte[] payload = in.readNBytes((int) length);
                if (payload.length < length) break;
                control.put(new Frame(type, payload).encode());
            }
        } catch (Exception ex) {
            Log.debug(LogTags.WT, "reader stopped: " + LogUnits.cause(ex));
        } finally {
            control.offer(new byte[0]);
        }
    }

    /** One datagram payload (after the quarter stream id): a MIRADA becomes a control frame; a full queue drops it. */
    void datagram(byte[] payload) {
        byte[] frame = Datagrams.gazeFrame(payload, 0);
        if (frame != null) control.offer(frame);
    }

    /** The session ended on the peer side. */
    void peerClosed() {
        control.offer(new byte[0]);
    }

    @Override
    public OutputStream openDelivery(long delivery) throws IOException {
        return deliveries.open(delivery);
    }

    @Override
    public void sendControl(byte[] frame) throws IOException {
        WtOutbound out = outbound;
        if (out == null) throw new IOException("wt not attached");
        out.send(frame);
    }

    @Override
    public void cancel(long delivery) {
        deliveries.cancel(delivery);
    }

    @Override
    public boolean datagrams() {
        return true;
    }

    @Override
    public void fail() {
        closeCode = H3Settings.H3_GENERAL_PROTOCOL_ERROR;
        closeReason = "seurat protocol error";
        closeOrOutbound();
    }

    @Override
    public void close() throws IOException {
        closeOrOutbound();
    }

    private void closeOrOutbound() {
        WtOutbound out = outbound;
        if (out != null) {
            out.close();
        } else {
            closeConnection();
        }
    }

    private void closeConnection() {
        if (connectionClosed.compareAndSet(false, true)) {
            try {
                if (outbound != null) {
                    try {
                        Thread.sleep(SeuratConstants.WT_CLOSE_GRACE_MS);
                    } catch (InterruptedException ex) {
                        Thread.currentThread().interrupt();
                    }
                }
                connection.close(closeCode, closeReason);
            } catch (Exception ignored) {}
        }
    }
}
