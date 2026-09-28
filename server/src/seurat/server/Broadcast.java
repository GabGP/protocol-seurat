package seurat.server;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import seurat.observe.Log;
import seurat.observe.LogUnits;
import seurat.observe.Progress;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgCatalog;
import seurat.proto.MsgHandshake;
import seurat.proto.ProtoCodes;
import seurat.session.Session;
import seurat.session.Sessions;

/** Pushes to every live session: OBRA on each catalog change (spec 7.3) and LATIDO (spec 3.3, 8). */
public final class Broadcast implements Consumer<MsgCatalog.WorkMessage> {
    private final Sessions sessions;
    /** Last state logged per work: a percent tick in the same state goes to the progress bar. */
    private final Map<String, Integer> states = new ConcurrentHashMap<>();

    public Broadcast(Sessions sessions) {
        this.sessions = sessions;
    }

    @Override
    public void accept(MsgCatalog.WorkMessage message) {
        log(message);
        send(sessions, FrameType.OBRA, message.encode());
    }

    private void log(MsgCatalog.WorkMessage m) {
        String key = "work=" + m.id();
        Integer before = states.put(m.id(), m.state());
        if (m.event() == ProtoCodes.OBRA_ESTADO && before != null && before == m.state()) {
            Progress.update("catalog", key, m.progress(), "");
            return;
        }
        Log.info("catalog", key + " " + ProtoCodes.eventName(m.event()) + " state=" + ProtoCodes.stateName(m.state())
                + " progress=" + m.progress() + "% ed=" + m.edition());
        if (m.event() == ProtoCodes.OBRA_BAJA) {
            states.remove(m.id());
        }
        if (m.event() == ProtoCodes.OBRA_BAJA || m.state() != ProtoCodes.ST_PINTANDO) {
            Progress.done(key);
        }
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
                Log.debug("server", "s" + session.id() + " push failed: " + LogUnits.cause(ex));
            }
        }
    }
}
