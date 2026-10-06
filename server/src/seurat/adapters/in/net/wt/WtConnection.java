package seurat.adapters.in.net.wt;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import seurat.adapters.in.net.h3.ConnectRequest;
import seurat.adapters.in.net.h3.H3Headers;
import seurat.adapters.in.net.h3.H3Settings;
import seurat.adapters.in.net.h3.H3Wire;
import seurat.adapters.in.net.http.HttpConstants;
import seurat.adapters.in.net.ws.WsHandshake;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.proto.VarInt;
import tech.kwik.core.QuicConnection;
import tech.kwik.core.QuicStream;
import tech.kwik.core.server.ApplicationProtocolConnection;

/** One QUIC connection: HTTP/3 just far enough to hold one WebTransport session (spec 5.1). */
final class WtConnection implements ApplicationProtocolConnection {
    private final QuicConnection connection;
    private final List<String> origins;
    private final WtListener.Acceptor acceptor;
    private final AtomicReference<WtMapping> session = new AtomicReference<>();
    private final AtomicBoolean controlTaken = new AtomicBoolean();

    WtConnection(QuicConnection connection, List<String> origins, WtListener.Acceptor acceptor) {
        this.connection = Objects.requireNonNull(connection);
        this.origins = origins;
        this.acceptor = Objects.requireNonNull(acceptor);
        Thread.ofVirtual().start(this::openServerStreams);
        connection.setDatagramHandler(this::datagram);
        connection.setConnectionListener(event -> ended());
    }

    private void openServerStreams() {
        try {
            openUniStream(H3Settings.controlPreface());
            openUniStream(VarInt.encode(H3Settings.STREAM_QPACK_ENCODER));
            openUniStream(VarInt.encode(H3Settings.STREAM_QPACK_DECODER));
        } catch (Exception ex) {
            Log.debug(LogTags.WT, "init streams failed: " + ex.getMessage());
            try { connection.close(H3Settings.H3_GENERAL_PROTOCOL_ERROR, "init failed"); } catch (Exception ignored) {}
        }
    }

    private void openUniStream(byte[] data) throws IOException {
        QuicStream stream = connection.createStream(false);
        OutputStream out = stream.getOutputStream();
        out.write(data);
        out.flush();
    }

    private void ended() {
        WtMapping m = session.get();
        if (m != null) m.peerClosed();
    }

    @Override
    public void acceptPeerInitiatedStream(QuicStream stream) {
        Thread.ofVirtual().start(() -> {
            try { serve(stream); } catch (Throwable t) { Log.debug(LogTags.WT, "stream error: " + t.getMessage()); }
        });
    }

    private void serve(QuicStream stream) throws IOException {
        if (stream.isUnidirectional()) {
            try (InputStream in = stream.getInputStream()) { in.transferTo(OutputStream.nullOutputStream()); }
            return;
        }
        InputStream in = stream.getInputStream();
        long first = H3Wire.readVarint(in);
        if (first == H3Settings.FRAME_HEADERS) {
            connect(stream, in);
        } else if (first == H3Settings.WT_BIDI_STREAM) {
            long id = H3Wire.readVarint(in);
            WtMapping m = session.get();
            if (m != null && m.sessionId() == id && controlTaken.compareAndSet(false, true)) {
                m.attach(stream);
                acceptor.accept(m, m.control());
            } else {
                refuse(stream);
            }
        } else {
            refuse(stream);
        }
    }

    private void refuse(QuicStream stream) {
        stream.resetStream(H3Settings.H3_REQUEST_REJECTED);
        stream.abortReading(H3Settings.H3_REQUEST_REJECTED);
    }

    private void connect(QuicStream stream, InputStream in) throws IOException {
        byte[] block = H3Wire.readPayload(in, SeuratConstants.WT_HEADERS_MAX);
        ConnectRequest request = ConnectRequest.of(H3Headers.decode(block));
        int refusal = refusal(request);
        OutputStream out = stream.getOutputStream();
        if (refusal != 0) { out.write(H3Headers.status(refusal)); out.close(); return; }
        WtMapping mapping = new WtMapping(connection, stream.getStreamId());
        if (!session.compareAndSet(null, mapping)) {
            out.write(H3Headers.status(HttpConstants.CONFLICT));
            out.close();
            return;
        }
        out.write(H3Headers.accepted());
        out.flush();
        Log.info(LogTags.WT, "webtransport session opened origin=" + request.origin());
        try { in.transferTo(OutputStream.nullOutputStream()); } finally { mapping.peerClosed(); }
    }

    private int refusal(ConnectRequest request) {
        if (!request.opensCanvas()) {
            Log.warn(LogTags.WT, "rejected canvas: " + request.path());
            return HttpConstants.NOT_FOUND;
        }
        var h = Map.of("origin", request.origin() != null ? request.origin() : "",
                "host", request.authority() != null ? request.authority() : "");
        if (!WsHandshake.originAllowed(h, origins)) {
            Log.warn(LogTags.WT, "rejected origin: " + request.origin());
            return HttpConstants.FORBIDDEN;
        }
        return 0;
    }

    private void datagram(byte[] data) {
        try {
            ByteBuffer buffer = ByteBuffer.wrap(data);
            long quarter = VarInt.get(buffer);
            WtMapping mapping = session.get();
            if (mapping != null && quarter == mapping.sessionId() / 4) {
                mapping.datagram(Arrays.copyOfRange(data, buffer.position(), data.length));
            }
        } catch (RuntimeException ignored) {}
    }
}
