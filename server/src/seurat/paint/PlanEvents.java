package seurat.paint;

import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.Ranges;
import seurat.proto.msg.MsgGaze;
import seurat.session.Canvas;

/** PLAN FIN / PLAN CANCELADAS emitted by the paint side. Callers hold the canvas lock. */
final class PlanEvents {
    private PlanEvents() {}

    /** One entry of plan `generation` is done; the last one emits PLAN FIN (spec 4.1.7). */
    static void resolved(Canvas canvas, long generation) {
        if (canvas.plan().resolve(generation)) {
            send(canvas, MsgGaze.Plan.end(canvas.handle(), canvas.plan().seq(),
                    canvas.plan().lastNumber()).encode());
        }
    }

    static void cancelled(Canvas canvas, Ranges numbers) {
        send(canvas, MsgGaze.Plan.cancelled(canvas.handle(), canvas.plan().seq(), numbers).encode());
    }

    private static void send(Canvas canvas, byte[] payload) {
        try {
            canvas.session().mapping().sendControl(new Frame(FrameType.PLAN, payload).encode());
        } catch (Exception ex) {
            Log.debug(LogTags.PAINT, canvas.subject() + " PLAN not sent: " + LogUnits.cause(ex));
        }
    }
}
