package seurat.adapters.in.net.wt;

import java.io.Closeable;
import java.net.DatagramSocket;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.viewing.session.Mapping;
import tech.kwik.core.QuicConnection;
import tech.kwik.core.log.NullLogger;
import tech.kwik.core.server.ApplicationProtocolConnection;
import tech.kwik.core.server.ApplicationProtocolConnectionFactory;
import tech.kwik.core.server.ServerConnectionConfig;
import tech.kwik.core.server.ServerConnector;

/** The UDP listener of the WebTransport mapping: QUIC (Kwik) with ALPN h3, one WtConnection per viewer. */
public final class WtListener implements Closeable {
    public interface Acceptor {
        /** A viewer opened its control stream: the Easel reads `control` and writes through `mapping`. */
        void accept(Mapping mapping, BlockingQueue<byte[]> control);
    }

    public static final String ALPN = "h3";

    private final DatagramSocket socket;
    private final ServerConnector connector;

    private WtListener(DatagramSocket socket, ServerConnector connector) {
        this.socket = socket;
        this.connector = connector;
    }

    public static WtListener open(int port, SelfSignedCert cert, List<String> origins, Acceptor acceptor) throws Exception {
        DatagramSocket socket = new DatagramSocket(port);
        ServerConnector connector;
        try {
            ServerConnectionConfig limits = ServerConnectionConfig.builder()
                    .maxIdleTimeoutInSeconds(SeuratConstants.WT_IDLE_S)
                    .maxOpenPeerInitiatedUnidirectionalStreams(SeuratConstants.WT_PEER_STREAMS)
                    .maxOpenPeerInitiatedBidirectionalStreams(SeuratConstants.WT_PEER_STREAMS)
                    .build();
            connector = ServerConnector.builder()
                    .withSocket(socket)
                    .withKeyStore(cert.store(), SelfSignedCert.ALIAS, SelfSignedCert.PASSWORD)
                    .withConfiguration(limits)
                    .withLogger(new NullLogger())
                    .build();
            connector.registerApplicationProtocol(ALPN, new ApplicationProtocolConnectionFactory() {
                @Override
                public ApplicationProtocolConnection createConnection(String protocol, QuicConnection connection) {
                    return new WtConnection(connection, origins, acceptor);
                }

                @Override
                public int maxConcurrentPeerInitiatedUnidirectionalStreams() {
                    return SeuratConstants.WT_PEER_STREAMS;
                }

                @Override
                public int maxConcurrentPeerInitiatedBidirectionalStreams() {
                    return SeuratConstants.WT_PEER_STREAMS;
                }

                @Override
                public boolean enableDatagramExtension() {
                    return true;
                }
            });
            connector.start();
        } catch (Throwable t) {
            socket.close();
            throw t;
        }
        return new WtListener(socket, connector);
    }

    /** The bound UDP port (the tests bind port 0). */
    public int port() {
        return socket.getLocalPort();
    }

    @Override
    public void close() {
        try {
            connector.close();
        } catch (Exception ignored) {}
        try {
            socket.close();
        } catch (Exception ignored) {}
    }
}
