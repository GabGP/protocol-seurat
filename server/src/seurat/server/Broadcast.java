package seurat.server;

import java.util.function.Consumer;
import seurat.observe.Log;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgCatalog;
import seurat.proto.MsgHandshake;
import seurat.session.Session;
import seurat.session.Sessions;

/** Pushes to every live session: OBRA on each catalog change (spec 7.3) and LATIDO (spec 3.3, 8). */
public final class Broadcast implements Consumer<MsgCatalog.WorkMessage> {
    private final Sessions sessions;

    public Broadcast(Sessions sessions) {
        this.sessions = sessions;
    }

    @Override
    public void accept(MsgCatalog.WorkMessage message) {
        Log.info("catalog", "Work '" + message.id() + "' event=" + message.event() + " state="
                + message.state() + " (" + message.progress() + "%, ed=" + message.edition() + ")");
        send(sessions, FrameType.OBRA, message.encode());
    }

    public static void heartbeat(Sessions sessions) {
        send(sessions, FrameType.LATIDO, new MsgHandshake.Heartbeat(System.nanoTime()).encode());
    }

    private static void send(Sessions sessions, long type, byte[] payload) {
        byte[] frame = new Frame(type, payload).encode();
        for (Session session : sessions.all()) {
            try {
                session.mapping().sendControl(frame);
            } catch (Exception ex) {
                Log.debug("server", "Push to session " + session.id() + " failed: " + ex.getMessage());
            }
        }
    }
}
