package seurat.grant;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import seurat.config.SeuratConstants;
import seurat.config.Units;
import seurat.proto.FatalProtocol;
import seurat.proto.FrameType;
import seurat.proto.ProtoCodes;
import seurat.proto.msg.MsgGaze;
import seurat.session.Canvas;
import seurat.session.Session;

/**
 * MIRADA admission (spec 4.1.1, 6.2): a 20/s bucket with a burst of 40 per session.
 * The excess is coalesced (the highest seq per canvas waits for the next token), not
 * an error; ERROR 9 only for sustained abuse (> 200/s for 5 s).
 */
public final class GazeGate {
    private static final class State {
        double tokens = SeuratConstants.GAZE_BURST;
        long refillNs = System.nanoTime();
        long secondNs = System.nanoTime();
        int thisSecond;
        int abusiveSeconds;
        final Map<Canvas, MsgGaze.Gaze> waiting = new LinkedHashMap<>();
    }

    private final GrantController grants;
    private final Map<Session, State> states = new ConcurrentHashMap<>();

    public GazeGate(GrantController grants) {
        this.grants = grants;
    }

    /** Easel thread: apply now if a token is left, else keep only the newest per canvas. */
    public void offer(Session session, Canvas canvas, MsgGaze.Gaze gaze) {
        State s = states.computeIfAbsent(session, k -> new State());
        MsgGaze.Gaze now;
        synchronized (s) {
            count(s);
            MsgGaze.Gaze held = s.waiting.get(canvas);
            if (held == null || gaze.seq() > held.seq()) {
                s.waiting.put(canvas, gaze);
            }
            now = take(s, canvas);
        }
        if (now != null) {
            grants.gaze(session, canvas, now);
        }
    }

    /** Clock tick: coalesced gazes go out as the bucket refills. */
    public void tick() {
        for (var e : states.entrySet()) {
            State s = e.getValue();
            Canvas canvas;
            MsgGaze.Gaze gaze;
            synchronized (s) {
                if (s.waiting.isEmpty()) {
                    continue;
                }
                canvas = s.waiting.keySet().iterator().next();
                gaze = take(s, canvas);
            }
            if (gaze != null && e.getKey().canvases().get(canvas.handle()) == canvas) {
                grants.gaze(e.getKey(), canvas, gaze);
            }
        }
    }

    public void forget(Session session) {
        states.remove(session);
    }

    private static MsgGaze.Gaze take(State s, Canvas canvas) {
        long now = System.nanoTime();
        s.tokens = Math.min(SeuratConstants.GAZE_BURST, s.tokens + (now - s.refillNs) / (double) Units.NANOS_PER_S * SeuratConstants.GAZE_PER_S);
        s.refillNs = now;
        if (s.tokens < 1) {
            return null;
        }
        s.tokens -= 1;
        return s.waiting.remove(canvas);
    }

    private static void count(State s) {
        long now = System.nanoTime();
        if (now - s.secondNs >= Units.NANOS_PER_S) {
            s.abusiveSeconds = s.thisSecond > SeuratConstants.GAZE_ABUSE_PER_S ? s.abusiveSeconds + 1 : 0;
            s.thisSecond = 0;
            s.secondNs = now;
        }
        if (++s.thisSecond > SeuratConstants.GAZE_ABUSE_PER_S && s.abusiveSeconds + 1 >= SeuratConstants.GAZE_ABUSE_S) {
            throw new FatalProtocol(ProtoCodes.ERR_TASA, FrameType.MIRADA, "LIMITE_TASA");
        }
    }
}
