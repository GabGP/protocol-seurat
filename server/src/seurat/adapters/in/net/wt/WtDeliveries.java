package seurat.adapters.in.net.wt;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.time.Duration;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicReference;
import seurat.adapters.in.net.h3.H3Settings;
import seurat.adapters.in.net.h3.H3Wire;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.proto.VarInt;
import tech.kwik.core.QuicConnection;
import tech.kwik.core.QuicStream;

/** Delivery flows of one session: a unidirectional stream each, RESET_STREAM to cancel (spec 5.1). */
final class WtDeliveries {
    private final QuicConnection connection;
    private final long sessionId;
    private final ConcurrentMap<Long, QuicStream> streams = new ConcurrentHashMap<>();
    private final Set<Long> cancelled = ConcurrentHashMap.newKeySet();

    WtDeliveries(QuicConnection connection, long sessionId) {
        this.connection = Objects.requireNonNull(connection);
        this.sessionId = sessionId;
    }

    OutputStream open(long delivery) {
        return new ByteArrayOutputStream() {
            private boolean sent;

            @Override
            public void close() throws IOException {
                if (sent) {
                    return;
                }
                sent = true;
                if (cancelled.remove(delivery)) {
                    throw new IOException("cancelled");
                }
                byte[] payload = H3Wire.concat(
                    VarInt.encode(H3Settings.WT_UNI_STREAM),
                    VarInt.encode(sessionId),
                    toByteArray()
                );
                AtomicReference<Throwable> failure = new AtomicReference<>();
                Thread writer = Thread.ofVirtual().start(() -> {
                    try {
                        QuicStream stream = connection.createStream(false);
                        streams.put(delivery, stream);
                        if (cancelled.remove(delivery)) {
                            stream.resetStream(H3Settings.WT_STREAM_CANCELLED);
                            throw new IOException("cancelled");
                        }
                        try (OutputStream out = stream.getOutputStream()) {
                            out.write(payload);
                        }
                    } catch (Throwable ex) {
                        failure.set(ex);
                    }
                });
                try {
                    try {
                        if (!writer.join(Duration.ofSeconds(SeuratConstants.STALL_S))) {
                            writer.interrupt();
                            QuicStream stream = streams.get(delivery);
                            if (stream != null) {
                                stream.resetStream(H3Settings.WT_STREAM_CANCELLED);
                            }
                            throw new IOException("stalled " + SeuratConstants.STALL_S + " s");
                        }
                    } catch (InterruptedException ex) {
                        Thread.currentThread().interrupt();
                        writer.interrupt();
                        QuicStream stream = streams.get(delivery);
                        if (stream != null) {
                            stream.resetStream(H3Settings.WT_STREAM_CANCELLED);
                        }
                        throw new IOException("interrupted", ex);
                    }
                    Throwable err = failure.get();
                    if (err != null) {
                        if (err instanceof IOException io) {
                            throw io;
                        }
                        throw new IOException(err.getMessage(), err);
                    }
                } finally {
                    streams.remove(delivery);
                }
            }
        };
    }

    void cancel(long delivery) {
        QuicStream stream = streams.get(delivery);
        if (stream != null) {
            stream.resetStream(H3Settings.WT_STREAM_CANCELLED);
        } else {
            cancelled.add(delivery);
        }
    }
}
