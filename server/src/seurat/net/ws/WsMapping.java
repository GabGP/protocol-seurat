package seurat.net.ws;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import seurat.config.SeuratConstants;
import seurat.net.Mapping;
import seurat.observe.Log;
import seurat.observe.LogUnits;
import seurat.session.Canvas;
import seurat.session.Delivery;

/** WebSocket mapping (spec 3.1): reader into the input queue, WsOutbound as the only writer. */
public final class WsMapping implements Mapping {
    private final Socket socket;
    private final InputStream in;
    private final BlockingQueue<byte[]> control;
    private final WsOutbound outbound;
    private volatile Thread pumpThread;

    public WsMapping(Socket socket, BlockingQueue<byte[]> control) throws IOException {
        this.socket = socket;
        this.in = socket.getInputStream();
        this.control = control;
        this.outbound = new WsOutbound(socket.getOutputStream());
        Thread.ofVirtual().start(outbound);
    }

    /** Reader: a full input queue (256 frames, spec 9.2) stops reading, i.e. backpressure. */
    public void pump() {
        pumpThread = Thread.currentThread();
        try {
            for (;;) {
                WsFraming.Msg m = WsFraming.read(in, SeuratConstants.FRAME_MAX + 16);
                if (m.opcode() == WsFraming.CLOSE) {
                    break;
                }
                if (m.opcode() == WsFraming.PING) {
                    outbound.control(WsFraming.PONG, m.data());
                    continue;
                }
                if (m.opcode() == WsFraming.PONG) {
                    continue;
                }
                byte[] frame = WsChannels.inbound(m);
                control.put(frame == null ? WsChannels.MALFORMED : frame);
                if (frame == null) {
                    break; // the Easel answers ERROR 1 fatal and closes with 1002
                }
            }
        } catch (Exception ex) {
            Log.debug("ws", "reader stopped: " + LogUnits.cause(ex));
        } finally {
            control.offer(new byte[0]);
        }
    }

    @Override
    public void sendControl(byte[] frame) throws IOException {
        outbound.control(WsChannels.wrap(WsChannels.CONTROL, frame));
    }

    @Override
    public OutputStream openDelivery(Canvas canvas, Delivery e) {
        return new ByteArrayOutputStream() {
            private boolean sent;

            @Override
            public void close() throws IOException {
                if (sent) {
                    return;
                }
                sent = true;
                var done = outbound.delivery(e.number(), WsChannels.wrap(WsChannels.DELIVERY, toByteArray()));
                try {
                    done.get(SeuratConstants.STALL_S, TimeUnit.SECONDS);
                } catch (TimeoutException stalled) {
                    if (outbound.cancel(e.number())) {
                        throw new IOException("stalled " + SeuratConstants.STALL_S + " s"); // spec 6.1
                    }
                    await(done);
                } catch (Exception ex) {
                    throw new IOException(ex.getMessage(), ex);
                }
            }
        };
    }

    private static void await(java.util.concurrent.CompletableFuture<Void> done) throws IOException {
        try {
            done.get();
        } catch (Exception ex) {
            throw new IOException(ex.getMessage(), ex);
        }
    }

    @Override
    public void cancel(long delivery) {
        outbound.cancel(delivery);
    }

    @Override
    public void fail() {
        outbound.close(WsFraming.PROTOCOL_ERROR);
    }

    @Override
    public void close() throws IOException {
        outbound.close(WsFraming.NORMAL);
        Thread.ofVirtual().start(() -> {
            try {
                Thread.sleep(SeuratConstants.SHUTDOWN_POLL_MS * 20); // let the writer flush the last frames
                socket.close();
            } catch (Exception ignored) {
            }
            Thread t = pumpThread;
            if (t != null) {
                t.interrupt();
            }
        });
    }
}
