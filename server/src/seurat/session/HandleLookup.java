package seurat.session;

import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.proto.FrameType;
import seurat.proto.MsgError;
import seurat.proto.ProtoCodes;

/** Finds the canvas a frame names. An unknown handle is ERROR 6 (not fatal) and the frame is skipped. */
final class HandleLookup {
    private HandleLookup() {}

    /** The canvas, or null after answering ERROR 6 to the frame of `type`. */
    static Canvas find(Mapping mapping, Session session, long handle, long type) {
        Canvas canvas = session.canvases().get(handle);
        if (canvas == null) {
            Log.warn(LogTags.SESSION, "s" + session.id() + " invalid handle=" + handle);
            Easel.send(mapping, FrameType.ERROR, new MsgError.ProtocolError(
                    ProtoCodes.ERR_HANDLE, 0, type, "handle " + handle).encode());
        }
        return canvas;
    }
}
